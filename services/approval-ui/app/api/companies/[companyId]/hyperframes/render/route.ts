// POST /api/companies/:companyId/hyperframes/render
// Kick a Hyperframes render. Body: { prompt, durationSec, aspectRatio }.
//
// Returns 202 with the artifact id immediately; the actual render runs
// fire-and-forget on the server. The UI polls GET /jobs to discover when
// status flips queued → rendering → complete.
//
// Why fire-and-forget over a job queue: HyperFrames typical render is
// 30-90 seconds. Synchronous request would block the route past
// reasonable HTTP timeout windows; a real job queue (Redpanda + worker)
// is over-engineered for the v1 single-tenant Studio. The async
// promise is `void`-awaited; failures land in artifacts.error_message
// for the UI to surface.

import { type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { artifacts } from "@/lib/db/schema/artifacts";
import { renderHyperframes, HyperframesRunnerError } from "@/lib/hyperframes/runner";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  prompt: z.string().min(1).max(4000),
  durationSec: z.coerce.number().int().min(5).max(60).default(10),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5"]).default("16:9"),
});

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

export const POST = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    validationFailed("invalid render body", { issues: parsed.error.issues });
  }
  const { prompt, durationSec, aspectRatio } = parsed.data;

  // Insert the artifact row in queued state immediately so the UI can
  // poll for progress. The render runs on the next tick.
  const insertedId = await withTenant(companyId, async (tx) => {
    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "artifact.queued",
      details: { source: "hyperframes", durationSec, aspectRatio, promptLength: prompt.length },
    });
    const [row] = await tx
      .insert(artifacts)
      .values({
        companyId,
        kind: "video",
        source: "hyperframes",
        title: prompt.slice(0, 80),
        prompt,
        status: "queued",
        mediaMimeType: "video/mp4",
        providerMeta: { aspectRatio, durationSec, mode: "scene" },
        costUsd: 0,
      })
      .returning({ id: artifacts.id });
    return row?.id ?? null;
  });

  if (!insertedId) badRequest("failed to enqueue render");

  // Fire-and-forget the render. We mark in-progress immediately, then
  // either flip to complete or failed depending on the runner outcome.
  void runRender(companyId, insertedId, prompt, durationSec, aspectRatio);

  return ok({ companyId, jobId: insertedId, status: "queued" }, { status: 202 });
});

async function runRender(
  companyId: string,
  jobId: string,
  prompt: string,
  durationSec: number,
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5",
): Promise<void> {
  // Step 1: flip queued → rendering. Lets the UI show "rendering" state
  // even while the actual CLI spawn is still warming up npx.
  try {
    await withTenant(companyId, async (tx) => {
      await tx
        .update(artifacts)
        .set({ status: "rendering" })
        .where(eq(artifacts.id, jobId));
    });
  } catch (err) {
    console.error("[hyperframes] failed to flip status to rendering", { jobId, err });
    // Continue anyway — the render itself is the load-bearing step.
  }

  // Step 2: actual render.
  try {
    const result = await renderHyperframes({ jobId, prompt, durationSec, aspectRatio });
    await withTenant(companyId, async (tx) => {
      await tx
        .update(artifacts)
        .set({
          status: "complete",
          mediaUrl: result.publicUrl,
          providerMeta: {
            aspectRatio,
            durationSec: result.durationSec,
            appliedStyleKey: result.appliedStyleKey,
            mode: "scene",
            completedAt: new Date().toISOString(),
          },
        })
        .where(eq(artifacts.id, jobId));
    });
  } catch (err) {
    const message =
      err instanceof HyperframesRunnerError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[hyperframes] render failed", { jobId, message });
    try {
      await withTenant(companyId, async (tx) => {
        await tx
          .update(artifacts)
          .set({
            status: "failed",
            errorMessage: message.slice(0, 1800),
          })
          .where(eq(artifacts.id, jobId));
      });
    } catch (writeErr) {
      console.error("[hyperframes] failed to write failure state", { jobId, writeErr });
    }
  }
}
