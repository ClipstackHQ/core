// GET /api/companies/:companyId/hyperframes/jobs
// List recent Hyperframes render jobs for this workspace. Newest first,
// capped at 50 for the UI list.
//
// Filters by source='hyperframes' against the artifacts table. Other
// providers (fal, runway, luma, higgsfield) get their own per-source
// listing routes when they ship.

import { type NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { artifacts } from "@/lib/db/schema/artifacts";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIST_LIMIT = 50;

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

export const GET = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  try {
    const rows = await withTenant(companyId, async (tx) => {
      await auditAccess({
        tx,
        ctx: ctxAuth,
        companyId,
        kind: "artifacts.listed",
        details: { source: "hyperframes", limit: LIST_LIMIT },
      });
      return tx
        .select({
          id: artifacts.id,
          kind: artifacts.kind,
          source: artifacts.source,
          title: artifacts.title,
          prompt: artifacts.prompt,
          status: artifacts.status,
          mediaUrl: artifacts.mediaUrl,
          mediaMimeType: artifacts.mediaMimeType,
          providerMeta: artifacts.providerMeta,
          errorMessage: artifacts.errorMessage,
          costUsd: artifacts.costUsd,
          createdAt: artifacts.createdAt,
          updatedAt: artifacts.updatedAt,
        })
        .from(artifacts)
        .where(and(eq(artifacts.companyId, companyId), eq(artifacts.source, "hyperframes")))
        .orderBy(desc(artifacts.createdAt))
        .limit(LIST_LIMIT);
    });

    return ok({ companyId, jobs: rows });
  } catch (err) {
    // Same fail-soft pattern as the other API routes; log the cause so
    // a wedged DB doesn't hide as an empty Studio job list.
    console.error("[api/hyperframes/jobs] list failed", { companyId, err });
    return ok({ companyId, jobs: [], skipped: true });
  }
});
