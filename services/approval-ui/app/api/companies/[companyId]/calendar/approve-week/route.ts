// POST /api/companies/:companyId/calendar/approve-week
// The "approve the week in 60 seconds" wedge. Bulk-flip every draft with
// status='awaiting_approval' AND scheduledAt within [from, to] to
// status='approved' in one transaction. Writes one audit_log row of
// kind 'calendar.week_approved' with the aggregate count + ids — that
// row is the trail an auditor / DPO follows to reconstruct intent.
//
// Why a single audit row vs one-per-draft: the action IS singular ("Jake
// approved the week"), and the per-draft history lives in drafts.updatedAt
// + the prior approval row's payload. A flood of one-row-per-draft audit
// entries on a 7-draft week obscures the bulk-action signal in the audit
// feed.
//
// Cost-policy hook: agents cannot trigger this — header check rejects
// x-agent-trigger / x-heartbeat-trigger. Bulk approval is by definition
// a human-in-the-loop trust surface.

import { type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, forbidden, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { drafts } from "@/lib/db/schema/drafts";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  // ISO timestamp range. Defaults: now → +7d when omitted (the canonical
  // "approve next week" UX). Both bounds inclusive at the SQL layer.
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

const DEFAULT_WINDOW_DAYS = 7;
const MAX_BULK_APPROVALS = 100;

export const POST = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  // Hard-reject agent-triggered calls. Bulk approval is by definition a
  // human-in-the-loop action — even a "trusted" agent can't compress 7
  // drafts of taste judgment into a single autonomous click.
  if (
    req.headers.get("x-agent-trigger") === "true" ||
    req.headers.get("x-heartbeat-trigger") === "true"
  ) {
    forbidden(
      "approve-week is human-only. Agents must route per-draft through the approval queue.",
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    validationFailed("invalid approve-week body", { issues: parsed.error.issues });
  }

  const now = new Date();
  const fromDate = parsed.data.fromDate ? new Date(parsed.data.fromDate) : now;
  const toDate = parsed.data.toDate
    ? new Date(parsed.data.toDate)
    : new Date(now.getTime() + DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  if (fromDate >= toDate) badRequest("fromDate must be before toDate");

  const result = await withTenant(companyId, async (tx) => {
    // Find candidates first so we can return the ids + audit them.
    // The bulk update could JOIN+UPDATE in one statement, but the two-
    // step pattern lets the audit row record the actual ids that flipped
    // (vs the count alone, which doesn't survive a future reconciliation).
    const candidates = await tx
      .select({ id: drafts.id })
      .from(drafts)
      .where(
        and(
          eq(drafts.status, "awaiting_approval"),
          gte(drafts.scheduledAt, fromDate),
          lte(drafts.scheduledAt, toDate),
        ),
      )
      .limit(MAX_BULK_APPROVALS);

    const ids = candidates.map((c) => c.id);

    if (ids.length === 0) {
      await auditAccess({
        tx,
        ctx: ctxAuth,
        companyId,
        kind: "calendar.week_approved",
        details: {
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString(),
          count: 0,
        },
      });
      return { approved: 0, ids: [] };
    }

    await tx
      .update(drafts)
      .set({ status: "approved", updatedAt: new Date() })
      .where(inArray(drafts.id, ids));

    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "calendar.week_approved",
      details: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        count: ids.length,
        ids,
      },
    });

    return { approved: ids.length, ids };
  });

  return ok({ companyId, ...result });
});
