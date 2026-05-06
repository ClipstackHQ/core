// POST /api/companies/:companyId/brand-kit/infer-from-url
// The "brand in at nine" wedge endpoint. Body: { url }.
// Server-side fetches + heuristically extracts a brand kit proposal —
// palette, typography, tone-of-voice, logo. Returns the proposal for
// the user to review BEFORE persisting (the human judgment gate).
//
// v1 path: pure heuristic regex on inline CSS. No LLM dep.
// v2 path: when ANTHROPIC_API_KEY is configured, layer an LLM call
// that turns the raw DOM into a richer proposal. Heuristic stays as
// the fallback so dev/demo works without a key.

import { type NextRequest } from "next/server";
import { z } from "zod";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import {
  inferBrandKitFromUrl,
  BrandKitInferenceError,
} from "@/lib/brand-kit/infer";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  url: z.string().url().max(1000),
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
    validationFailed("invalid infer-from-url body", { issues: parsed.error.issues });
  }

  // Audit the inference attempt regardless of whether the user later
  // saves the proposal — it's a privileged read of arbitrary external
  // URLs and worth the audit trail.
  await withTenant(companyId, async (tx) => {
    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "brand_kit.inference_attempted",
      details: { url: parsed.data.url },
    });
  });

  try {
    const proposal = await inferBrandKitFromUrl(parsed.data.url);
    return ok({ companyId, proposal });
  } catch (err) {
    if (err instanceof BrandKitInferenceError) {
      // 400 vs 500 — these are user-input errors (bad URL, fetch failed)
      // not server-side bugs.
      badRequest(err.message);
    }
    throw err;
  }
});
