// POST /api/companies/:companyId/digest/narrate
// Spawns a Managed Agents session, feeds it the workspace's weekly
// digest data, returns the 200-word editorial narrative + token usage.
//
// First Managed Agents API surface in core/. Architecture decisions:
//
// 1. Synchronous, not streaming. The digest narrative is ~200 words —
//    Opus 4.7 produces that in 1-2 seconds. SSE complexity doesn't pay
//    off at this scale. v2 (when the Hyperframes video render lands)
//    will switch to streaming because that path is 30-60s.
//
// 2. Live data, not cached. Each request re-aggregates the workspace
//    data + spawns a fresh MA session. Caching the narrative would
//    require a digests table and TTL handling that's overkill for v1.
//    If digest generation becomes high-volume we cache; for now it's
//    user-triggered.
//
// 3. Falls through gracefully when MA isn't configured. Returns a
//    skipped: true response instead of 500ing — the /digest page's
//    button surfaces only when MANAGED_AGENTS_DIGEST_AGENT_ID is set,
//    so this only fires when MA is wired, but the fallback is
//    defensive against env-var drift.

import { type NextRequest } from "next/server";
import { and, desc, eq, gte, sql, isNotNull } from "drizzle-orm";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { drafts } from "@/lib/db/schema/drafts";
import { postMetrics } from "@/lib/db/schema/post-metrics";
import { companyLessons } from "@/lib/db/schema/lessons";
import { auditLog } from "@/lib/db/schema/audit";
import { resolveManagedAgentsConfig } from "@/lib/managed-agents/client";
import { narrateDigest, type DigestData } from "@/lib/managed-agents/digest-agent";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// MA sessions can take 5-15s for narrative generation. Default Vercel
// limit is 10s for hobby, 60s for pro. The route is server-only so
// the timeout's set by the platform; declare it explicitly so future
// dev knows the budget.
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

/**
 * Discriminated union for the route response. Three terminal shapes:
 *   - `ok: true, narrative: ...` — MA spawned, narrative returned
 *   - `ok: false, skipped: true, reason: ...` — MA unconfigured or
 *     errored gracefully (returns 200 still, but `ok: false` so the
 *     UI knows to surface the reason)
 *
 * Why a union vs throwing: digest is best-effort; a failure shouldn't
 * 5xx the page. The UI handles both shapes.
 */
type NarrateResponse =
  | {
      ok: true;
      companyId: string;
      narrative: string;
      sessionId: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        elapsedMs: number;
      };
    }
  | {
      ok: false;
      skipped: true;
      reason: string;
    };

export const POST = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  // Resolve MA config first — fail fast if unconfigured rather than
  // running the (cheap but non-zero) data aggregation only to bail.
  const maConfig = resolveManagedAgentsConfig();
  if (!maConfig) {
    return ok<NarrateResponse>(
      {
        ok: false,
        skipped: true,
        reason:
          "Managed Agents not configured. Run scripts/setup-managed-agents.ts and set MANAGED_AGENTS_DIGEST_AGENT_ID + MANAGED_AGENTS_ENVIRONMENT_ID in .env.local.",
      },
      { status: 200 },
    );
  }

  // Aggregate the digest data (same logic as /digest SSR path —
  // duplicated here rather than abstracted because the SSR path
  // currently lives inline in app/digest/page.tsx and a shared util
  // would force a server-component refactor). Extract to a module if
  // a third caller appears.
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();

  const data: DigestData = await withTenant(companyId, async (tx) => {
    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "digest.narrate_requested",
      details: { weekStart: sevenDaysAgoIso, weekEnd: now.toISOString() },
    });

    // Top 3 performers
    const topRaw = await tx
      .select({
        draftId: postMetrics.draftId,
        avgPercentile: sql<number | null>`AVG(${postMetrics.engagementPercentile})`,
        totalImpressions: sql<number | null>`SUM(${postMetrics.impressions})`,
      })
      .from(postMetrics)
      .where(
        and(
          sql`${postMetrics.snapshotAt} >= ${sevenDaysAgoIso}::timestamptz`,
          isNotNull(postMetrics.engagementPercentile),
        ),
      )
      .groupBy(postMetrics.draftId)
      .orderBy(sql`AVG(${postMetrics.engagementPercentile}) DESC NULLS LAST`)
      .limit(3);

    const topIds = topRaw.map((p) => p.draftId);
    const titleRows = topIds.length > 0
      ? await tx
          .select({ id: drafts.id, title: drafts.title, channel: drafts.channel })
          .from(drafts)
          .where(sql`${drafts.id} = ANY(${sql.raw(`ARRAY[${topIds.map((id) => `'${id}'::uuid`).join(",")}]`)})`)
      : [];
    const titleById = new Map<string, { title: string | null; channel: string }>();
    for (const r of titleRows) titleById.set(r.id, { title: r.title, channel: r.channel });

    // Lesson stats + samples
    const [lessonStats] = await tx
      .select({
        total: sql<number>`COUNT(*)`,
        forever: sql<number>`COUNT(*) FILTER (WHERE ${companyLessons.scope} = 'forever')`,
        thisTopic: sql<number>`COUNT(*) FILTER (WHERE ${companyLessons.scope} = 'this_topic')`,
        thisClient: sql<number>`COUNT(*) FILTER (WHERE ${companyLessons.scope} = 'this_client')`,
      })
      .from(companyLessons)
      .where(sql`${companyLessons.capturedAt} >= ${sevenDaysAgoIso}::timestamptz`);

    const lessonSamples = await tx
      .select({
        rationale: companyLessons.rationale,
        scope: companyLessons.scope,
      })
      .from(companyLessons)
      .where(sql`${companyLessons.capturedAt} >= ${sevenDaysAgoIso}::timestamptz`)
      .orderBy(desc(companyLessons.capturedAt))
      .limit(3);

    // Audit rollups
    const [auditRollup] = await tx
      .select({
        anomalies: sql<number>`COUNT(*) FILTER (WHERE ${auditLog.kind} = 'anomalies.listed')`,
        approved: sql<number>`COUNT(*) FILTER (WHERE ${auditLog.kind} = 'approval.approved')`,
        denied: sql<number>`COUNT(*) FILTER (WHERE ${auditLog.kind} = 'approval.denied')`,
        weekApprovals: sql<number>`COUNT(*) FILTER (WHERE ${auditLog.kind} = 'calendar.week_approved')`,
      })
      .from(auditLog)
      .where(sql`${auditLog.occurredAt} >= ${sevenDaysAgoIso}::timestamptz`);

    // Draft counts
    const [draftStats] = await tx
      .select({
        publishedCount: sql<number>`COUNT(*) FILTER (WHERE ${drafts.status} = 'published' AND ${drafts.publishedAt} >= ${sevenDaysAgoIso}::timestamptz)`,
        draftsCreated: sql<number>`COUNT(*) FILTER (WHERE ${drafts.createdAt} >= ${sevenDaysAgoIso}::timestamptz)`,
      })
      .from(drafts);

    return {
      weekEndDate: now,
      weekStartDate: sevenDaysAgo,
      topPerformers: topRaw.map((p) => {
        const meta = titleById.get(p.draftId);
        return {
          title: meta?.title ?? null,
          channel: meta?.channel ?? "unknown",
          avgPercentile: Number(p.avgPercentile ?? 0),
          impressions: p.totalImpressions !== null ? Number(p.totalImpressions) : null,
        };
      }),
      lessonsCaptured: {
        total: Number(lessonStats?.total ?? 0),
        forever: Number(lessonStats?.forever ?? 0),
        thisTopic: Number(lessonStats?.thisTopic ?? 0),
        thisClient: Number(lessonStats?.thisClient ?? 0),
        samples: lessonSamples,
      },
      anomaliesCount: Number(auditRollup?.anomalies ?? 0),
      decisionsMade: {
        approved: Number(auditRollup?.approved ?? 0),
        denied: Number(auditRollup?.denied ?? 0),
        weekApprovals: Number(auditRollup?.weekApprovals ?? 0),
        total:
          Number(auditRollup?.approved ?? 0) +
          Number(auditRollup?.denied ?? 0) +
          Number(auditRollup?.weekApprovals ?? 0),
      },
      publishedCount: Number(draftStats?.publishedCount ?? 0),
      draftsCreated: Number(draftStats?.draftsCreated ?? 0),
    };
  });

  // Spawn the MA session + drain to the narrative.
  try {
    const result = await narrateDigest(
      maConfig.client,
      maConfig.digestAgentId,
      maConfig.environmentId,
      data,
    );

    // Audit the successful run separately so the cost-visibility data
    // (token counts, elapsed) is captured in the audit feed even when
    // the request response isn't persisted.
    await withTenant(companyId, async (tx) => {
      await auditAccess({
        tx,
        ctx: ctxAuth,
        companyId,
        kind: "digest.narrated",
        details: {
          sessionId: result.sessionId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          elapsedMs: result.elapsedMs,
          narrativeLength: result.narrative.length,
        },
      });
    });

    return ok<NarrateResponse>({
      ok: true,
      companyId,
      narrative: result.narrative,
      sessionId: result.sessionId,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        elapsedMs: result.elapsedMs,
      },
    });
  } catch (err) {
    console.error("[digest/narrate] MA session failed", { companyId, err });
    return ok<NarrateResponse>(
      {
        ok: false,
        skipped: true,
        reason: `Managed Agents call failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 200 },
    );
  }
});
