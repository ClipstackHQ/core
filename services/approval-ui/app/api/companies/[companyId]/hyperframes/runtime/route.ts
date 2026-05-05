// GET /api/companies/:companyId/hyperframes/runtime
// Reports whether the host environment satisfies HyperFrames' prerequisites
// (Node 22+, ffmpeg, npx). The Studio page hits this on load so the user
// sees the readiness state BEFORE submitting a render.
//
// Cheap probe — just runs `ffmpeg -version` + `npx --version` with 5s
// timeouts. No DB hit.

import { type NextRequest } from "next/server";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { badRequest } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { probeRuntime } from "@/lib/hyperframes/runner";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const result = await probeRuntime();
  return ok(result);
});
