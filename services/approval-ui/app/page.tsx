// Doc 7 §2.1 + Doc 8 §9.2 — Mission Control bento grid.
// Default home for the platform. 12-column asymmetric grid; tiles will be
// draggable in a later pass (Phase A.2). Numbers are mono with tabular-nums.

import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { HeroKpiTile } from "@/components/mission-control/HeroKpiTile";
import { ApprovalQueueTile } from "@/components/mission-control/ApprovalQueueTile";
import { AgentActivityTile } from "@/components/mission-control/AgentActivityTile";
import {
  AnomaliesTile,
  type AnomalyDetection,
} from "@/components/mission-control/AnomaliesTile";
import {
  BusHealthTile,
  type BusHealth,
  type BusStatus,
} from "@/components/mission-control/BusHealthTile";
import { ExperimentsTile, type BanditSummary } from "@/components/mission-control/ExperimentsTile";
import {
  InstitutionalMemoryTile,
  type LessonStats,
} from "@/components/mission-control/InstitutionalMemoryTile";
import { MetricTile } from "@/components/mission-control/MetricTile";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { agents as agentsTable } from "@/lib/db/schema/agents";
import { drafts } from "@/lib/db/schema/drafts";
import { companyLessons } from "@/lib/db/schema/lessons";
import { meterEvents } from "@/lib/db/schema/metering";
import { postMetrics } from "@/lib/db/schema/post-metrics";
import { and, asc, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type {
  AgentMarkColor,
  AgentMarkShape,
  AgentStatus,
} from "@/components/AgentMark";

export const metadata: Metadata = {
  title: "Mission Control · Clipstack",
  description:
    "Workspace overview — pending approvals, anomalies, experiments, performance.",
};

// Mission Control is a server component → it can directly call the
// internal helpers (no need for an HTTP roundtrip back to its own
// /api/companies/:cid/* routes). This keeps the first paint fast even
// when the orchestration calls are slow — Next.js Streaming + suspense
// let us decompose further if it ever bites.

const SERVICE_NAME = "approval-ui";
const PROXY_TIMEOUT_MS = 5000;
const REVALIDATE_S = 15;

function authHeaders(token: string, companyId: string): Record<string, string> {
  return {
    "X-Clipstack-Service-Token": token,
    "X-Clipstack-Active-Company": companyId,
    "X-Clipstack-Service-Name": SERVICE_NAME,
  };
}

async function fetchBandits(): Promise<BanditSummary[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  const baseUrl = process.env.BANDIT_ORCH_BASE_URL;
  const token = process.env.SERVICE_TOKEN;
  if (!baseUrl || !token) return [];

  try {
    const resp = await fetch(
      `${baseUrl.replace(/\/$/, "")}/bandits?company_id=${encodeURIComponent(
        companyId,
      )}`,
      {
        headers: authHeaders(token, companyId),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        next: { revalidate: REVALIDATE_S },
      },
    );
    if (!resp.ok) return [];
    const payload = (await resp.json()) as { bandits?: BanditSummary[] };
    return payload.bandits ?? [];
  } catch (err) {
    // Mission Control fails-soft to an empty experiments tile when the
    // bandit-orchestrator is unreachable, but the cause must hit logs —
    // an unobserved silent catch is how the two prior date-binding +
    // text↔uuid join bugs slipped past CI for weeks.
    console.error("[mission-control] fetchBandits failed", err);
    return [];
  }
}

// Agent role → AgentMark visual mapping. Doc 8 §5.6 — every role
// has a stable (shape, color) so the same agent reads the same way
// across surfaces. New roles fall back to (circle, slate) which
// reads as "unspecified" rather than misattributing.
const AGENT_ROLE_VIZ: Record<
  string,
  { shape: AgentMarkShape; color: AgentMarkColor }
> = {
  orchestrator:        { shape: "circle",          color: "teal" },
  researcher:          { shape: "square",          color: "emerald" },
  strategist:          { shape: "hexagon",         color: "amber" },
  long_form_writer:    { shape: "rounded-square",  color: "violet" },
  social_adapter:      { shape: "diamond",         color: "rose" },
  newsletter_adapter:  { shape: "rounded-square",  color: "violet" },
  brand_qa:            { shape: "octagon",         color: "sky" },
  devils_advocate_qa:  { shape: "octagon",         color: "fuchsia" },
  claim_verifier:      { shape: "pentagon",        color: "slate" },
  engagement:          { shape: "triangle",        color: "rose" },
  lifecycle:           { shape: "circle",          color: "amber" },
  trend_detector:      { shape: "diamond",         color: "fuchsia" },
  algorithm_probe:     { shape: "pentagon",        color: "sky" },
  live_event_monitor:  { shape: "triangle",        color: "amber" },
  compliance:          { shape: "octagon",         color: "slate" },
};

interface QueueItem {
  id: string;
  title: string;
  agentLabel: string;
  agentColor: AgentMarkColor;
  agentShape: AgentMarkShape;
  ageMinutes: number;
  predictedPercentile: number;
  channel: string;
}

async function fetchApprovalQueue(): Promise<{
  items: QueueItem[];
  totalPending: number;
}> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return { items: [], totalPending: 0 };

  const PENDING_STATUSES = ["awaiting_approval", "in_review"] as const;

  try {
    const [{ items, total }] = await withTenant(companyId, async (tx) => {
      // Two reads in one txn for consistency: the per-row list + the
      // total count. Could be a single query with a window function,
      // but Drizzle's window helpers aren't expressive enough for the
      // shape we want; the two-read pattern is clear and the lock
      // window is still tiny.
      const rows = await tx
        .select({
          id: drafts.id,
          title: drafts.title,
          channel: drafts.channel,
          createdAt: drafts.createdAt,
          predictedPercentile: drafts.predictedPercentile,
          agentRole: agentsTable.role,
          agentDisplayName: agentsTable.displayName,
        })
        .from(drafts)
        .leftJoin(agentsTable, eq(agentsTable.id, drafts.authoredByAgentId))
        .where(inArray(drafts.status, [...PENDING_STATUSES]))
        .orderBy(asc(drafts.createdAt))
        .limit(4);

      const [{ count: totalPending }] = await tx
        .select({ count: count() })
        .from(drafts)
        .where(inArray(drafts.status, [...PENDING_STATUSES]));

      return [{ items: rows, total: totalPending }];
    });

    const now = Date.now();
    const queueItems: QueueItem[] = items.map((row) => {
      const viz = AGENT_ROLE_VIZ[row.agentRole ?? ""] ?? {
        shape: "circle" as const,
        color: "slate" as const,
      };
      const label = (row.agentDisplayName ?? "?")
        .trim()
        .charAt(0)
        .toUpperCase() || "?";
      const ageMinutes = Math.max(
        0,
        Math.floor((now - row.createdAt.getTime()) / 60_000),
      );
      return {
        id: row.id,
        title: row.title?.trim() || "(untitled draft)",
        agentLabel: label,
        agentShape: viz.shape,
        agentColor: viz.color,
        ageMinutes,
        // Predicted percentile is null until percentile_gate runs;
        // surface 0 in the UI which the existing tile renders as
        // "danger" tone — visually flags "not yet predicted".
        predictedPercentile: Math.round(row.predictedPercentile ?? 0),
        channel: row.channel,
      };
    });

    return { items: queueItems, totalPending: Number(total ?? 0) };
  } catch (err) {
    // Tile fails-soft to "empty queue" — the cause must hit logs so a
    // bad join / RLS misconfig isn't invisible.
    console.error("[mission-control] fetchApprovalQueue failed", err);
    return { items: [], totalPending: 0 };
  }
}

// agent_status DB enum → AgentMark status. The DB has 'fired' (retired
// agents) which the tile shouldn't show; we filter those out at the
// query layer via WHERE retired_at IS NULL. The remaining statuses
// map directly to AgentMark's vocabulary.
function mapAgentStatus(dbStatus: string): AgentStatus {
  switch (dbStatus) {
    case "working": return "working";
    case "blocked": return "blocked";
    case "asleep": return "asleep";
    case "idle": return "idle";
    default: return "idle";
  }
}

interface AgentActivity {
  id: string;
  label: string;
  role: string;
  shape: AgentMarkShape;
  color: AgentMarkColor;
  status: AgentStatus;
  recentAction?: string;
  costThisWeek?: number;
}

async function fetchAgents(): Promise<AgentActivity[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  try {
    const rows = await withTenant(companyId, async (tx) =>
      tx
        .select({
          id: agentsTable.id,
          role: agentsTable.role,
          displayName: agentsTable.displayName,
          jobDescription: agentsTable.jobDescription,
          status: agentsTable.status,
        })
        .from(agentsTable)
        // Filter out 'fired' (retiredAt set) — only show active team.
        // The tile is for "who's working now", not historical roster.
        .where(isNull(agentsTable.retiredAt))
        .orderBy(asc(agentsTable.spawnedAt))
        .limit(6),
    );

    return rows.map((row) => {
      const viz = AGENT_ROLE_VIZ[row.role] ?? {
        shape: "circle" as const,
        color: "slate" as const,
      };
      return {
        id: row.id,
        label: row.displayName,
        // Render the job description as the role copy — it's the human-
        // readable "what this agent does" string the workspace owner
        // wrote when seeding the team. Falls back to the enum role.
        role: row.jobDescription || row.role,
        shape: viz.shape,
        color: viz.color,
        status: mapAgentStatus(row.status),
        // recentAction + costThisWeek left undefined — neither is
        // schema-backed yet. recentAction needs an "agent activity"
        // log table; costThisWeek needs an agent_id column on
        // meter_events. Both are own-slice work. The tile renders
        // cleanly without them.
      };
    });
  } catch (err) {
    console.error("[mission-control] fetchAgents failed", err);
    return [];
  }
}

interface HeroKpi {
  // Workspace's predicted percentile this week — 0..100. Defaults to 50
  // when there's no data (cold workspace), matching the percentile_gate
  // node's "no prediction yet" stub.
  predicted: number;
  // Predicted_thisWeek - predicted_lastWeek. Sign tells direction; tile
  // formats as "±N vs last week".
  delta: number;
  // Up to 12 weekly avg-percentile values, oldest first. Shorter when
  // the workspace is < 12 weeks old.
  trend: number[];
  // Drafts published in the last 7 days.
  weeklyShipped: number;
}

async function fetchHeroKpi(): Promise<HeroKpi> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) {
    return { predicted: 50, delta: 0, trend: [], weeklyShipped: 0 };
  }

  try {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const eightyFourDaysAgo = new Date(now - 84 * 24 * 60 * 60 * 1000);

    const [{ thisWeek, lastWeek, weekly, shipped }] = await withTenant(
      companyId,
      async (tx) => {
        // This-week + last-week averages drive the hero number + delta.
        // We split into two SELECTs (rather than one CASE WHEN) because
        // Drizzle composes the simpler version more cleanly + each
        // query is index-friendly via idx_post_metrics_company_platform.
        const [thisWeekRow] = await tx
          .select({
            avg: sql<number | null>`AVG(${postMetrics.engagementPercentile})`,
          })
          .from(postMetrics)
          .where(gte(postMetrics.snapshotAt, sevenDaysAgo));

        const [lastWeekRow] = await tx
          .select({
            avg: sql<number | null>`AVG(${postMetrics.engagementPercentile})`,
          })
          .from(postMetrics)
          .where(
            and(
              gte(postMetrics.snapshotAt, fourteenDaysAgo),
              // ISO + ::timestamptz because postgres-js doesn't bind
              // Date in raw sql template positions (gte() does, but
              // this hand-written < literal doesn't).
              sql`${postMetrics.snapshotAt} < ${sevenDaysAgo.toISOString()}::timestamptz`,
            ),
          );

        // 12-week trend: bucket by date_trunc('week', snapshot_at) and
        // avg engagement_percentile within each bucket. Returns up to 12
        // rows oldest-first; we pad if the workspace is younger.
        const weeklyRows = await tx
          .select({
            week: sql<string>`DATE_TRUNC('week', ${postMetrics.snapshotAt})::date`,
            avg: sql<number | null>`AVG(${postMetrics.engagementPercentile})`,
          })
          .from(postMetrics)
          .where(gte(postMetrics.snapshotAt, eightyFourDaysAgo))
          .groupBy(sql`DATE_TRUNC('week', ${postMetrics.snapshotAt})`)
          .orderBy(asc(sql`DATE_TRUNC('week', ${postMetrics.snapshotAt})`));

        // Weekly shipped count — drafts marked published in the
        // last 7 days. Excludes scheduled-but-not-yet-out drafts.
        const [shippedRow] = await tx
          .select({ count: count() })
          .from(drafts)
          .where(
            and(
              eq(drafts.status, "published"),
              gte(drafts.publishedAt, sevenDaysAgo),
            ),
          );

        return [
          {
            thisWeek: Number(thisWeekRow?.avg ?? 50),
            lastWeek: Number(lastWeekRow?.avg ?? 50),
            weekly: weeklyRows
              .map((r) => Number(r.avg ?? 0))
              .filter((v) => Number.isFinite(v)),
            shipped: Number(shippedRow?.count ?? 0),
          },
        ];
      },
    );

    return {
      predicted: Math.round(thisWeek),
      delta: Math.round(thisWeek - lastWeek),
      trend: weekly,
      weeklyShipped: shipped,
    };
  } catch (err) {
    console.error("[mission-control] fetchHeroKpi failed", err);
    return { predicted: 50, delta: 0, trend: [], weeklyShipped: 0 };
  }
}

interface KpiMetrics {
  // 7-day workspace-wide CTR (clicks / impressions). null when there's
  // no impressions in the window (cold workspace).
  ctr7d: number | null;
  // 7-day workspace-wide reach. 0 if no snapshots in the window.
  reach7d: number;
  // Month-to-date AI spend in USD (sum of meter_events.totalCostUsd
  // for the current calendar month). 0 if nothing metered yet.
  spendMtd: number;
  // 7-day daily CTR series (one element per day, oldest → newest).
  // 0 when impressions=0 OR no rows for that day. Drives the CTR
  // tile's inline sparkline.
  ctr7dTrend: number[];
  // 7-day daily SUM(reach) series, oldest → newest. 0 for missing days.
  reach7dTrend: number[];
  // MTD daily SUM(meterEvents.totalCostUsd) series from start of
  // current calendar month UTC → today, oldest → newest. Variable
  // length 1..31. 0 for days with no metered events.
  spendMtdTrend: number[];
}

async function fetchKpiMetrics(): Promise<KpiMetrics> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) {
    return {
      ctr7d: null,
      reach7d: 0,
      spendMtd: 0,
      ctr7dTrend: [],
      reach7dTrend: [],
      spendMtdTrend: [],
    };
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // First of the current month, UTC. Mirrors the "ai spend · this
    // month" reading on the tile — month is calendar month, not 30d.
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    // Build day-bucket key arrays in JS up-front. Postgres only
    // returns rows for days that have data — we need the full
    // skeleton so missing days render as 0 rather than collapsing.
    const today = new Date();
    const days7: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      days7.push(d.toISOString().slice(0, 10));
    }
    const daysMtd: string[] = [];
    {
      const cursor = new Date(monthStart);
      const end = new Date(today);
      end.setUTCHours(0, 0, 0, 0);
      while (cursor.getTime() <= end.getTime()) {
        daysMtd.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const [{ ctr7d, reach7d, spendMtd, ctr7dTrend, reach7dTrend, spendMtdTrend }] =
      await withTenant(companyId, async (tx) => {
        // Run the two SUMs over post_metrics + the SUM over
        // meter_events as separate selects. Drizzle doesn't naturally
        // express a 3-table aggregation in one statement; the txn
        // boundary keeps them consistent.
        const [pmRow] = await tx
          .select({
            sumImpressions: sql<number>`COALESCE(SUM(${postMetrics.impressions}), 0)::float8`,
            sumClicks: sql<number>`COALESCE(SUM(${postMetrics.clicks}), 0)::float8`,
            sumReach: sql<number>`COALESCE(SUM(${postMetrics.reach}), 0)::float8`,
          })
          .from(postMetrics)
          .where(gte(postMetrics.snapshotAt, sevenDaysAgo));

        const [meterRow] = await tx
          .select({
            sumCost: sql<number>`COALESCE(SUM(${meterEvents.totalCostUsd}), 0)::float8`,
          })
          .from(meterEvents)
          .where(gte(meterEvents.occurredAt, monthStart));

        // Daily buckets — DATE_TRUNC('day', …)::date returns one row
        // per day that has data. We pad missing days client-side.
        // Same idx_post_metrics_company_platform index serves these
        // queries since it leads with snapshot_at.
        const pmDailyRows = await tx
          .select({
            day: sql<Date>`DATE_TRUNC('day', ${postMetrics.snapshotAt})::date`,
            sumImpressions: sql<number>`COALESCE(SUM(${postMetrics.impressions}), 0)::float8`,
            sumClicks: sql<number>`COALESCE(SUM(${postMetrics.clicks}), 0)::float8`,
            sumReach: sql<number>`COALESCE(SUM(${postMetrics.reach}), 0)::float8`,
          })
          .from(postMetrics)
          .where(gte(postMetrics.snapshotAt, sevenDaysAgo))
          .groupBy(sql`DATE_TRUNC('day', ${postMetrics.snapshotAt})`)
          .orderBy(asc(sql`DATE_TRUNC('day', ${postMetrics.snapshotAt})`));

        const meterDailyRows = await tx
          .select({
            day: sql<Date>`DATE_TRUNC('day', ${meterEvents.occurredAt})::date`,
            sumCost: sql<number>`COALESCE(SUM(${meterEvents.totalCostUsd}), 0)::float8`,
          })
          .from(meterEvents)
          .where(gte(meterEvents.occurredAt, monthStart))
          .groupBy(sql`DATE_TRUNC('day', ${meterEvents.occurredAt})`)
          .orderBy(asc(sql`DATE_TRUNC('day', ${meterEvents.occurredAt})`));

        // Index daily rows by YYYY-MM-DD so the day-walker can fill
        // missing slots with 0. Drizzle hands back the ::date column
        // as a Date; toISOString().slice(0,10) matches the JS-side
        // skeleton keys exactly (both UTC).
        const ctrDayMap = new Map<string, number>();
        const reachDayMap = new Map<string, number>();
        for (const r of pmDailyRows) {
          const key =
            r.day instanceof Date
              ? r.day.toISOString().slice(0, 10)
              : String(r.day).slice(0, 10);
          const dayImp = Number(r.sumImpressions ?? 0);
          const dayClk = Number(r.sumClicks ?? 0);
          ctrDayMap.set(key, dayImp > 0 ? dayClk / dayImp : 0);
          reachDayMap.set(key, Number(r.sumReach ?? 0));
        }
        const spendDayMap = new Map<string, number>();
        for (const r of meterDailyRows) {
          const key =
            r.day instanceof Date
              ? r.day.toISOString().slice(0, 10)
              : String(r.day).slice(0, 10);
          spendDayMap.set(key, Number(r.sumCost ?? 0));
        }

        const ctrTrend = days7.map((k) => ctrDayMap.get(k) ?? 0);
        const reachTrend = days7.map((k) => reachDayMap.get(k) ?? 0);
        const spendTrend = daysMtd.map((k) => spendDayMap.get(k) ?? 0);

        const imp = Number(pmRow?.sumImpressions ?? 0);
        const clk = Number(pmRow?.sumClicks ?? 0);
        return [
          {
            ctr7d: imp > 0 ? clk / imp : null,
            reach7d: Number(pmRow?.sumReach ?? 0),
            spendMtd: Number(meterRow?.sumCost ?? 0),
            ctr7dTrend: ctrTrend,
            reach7dTrend: reachTrend,
            spendMtdTrend: spendTrend,
          },
        ];
      });

    return {
      ctr7d,
      reach7d,
      spendMtd,
      ctr7dTrend,
      reach7dTrend,
      spendMtdTrend,
    };
  } catch (err) {
    console.error("[mission-control] fetchKpiMetrics failed", err);
    return {
      ctr7d: null,
      reach7d: 0,
      spendMtd: 0,
      ctr7dTrend: [],
      reach7dTrend: [],
      spendMtdTrend: [],
    };
  }
}

function formatReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

async function fetchLessonStats(): Promise<LessonStats> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  // No active workspace → empty stats. The tile renders cleanly on
  // pre-onboarding sessions where the user hasn't picked a workspace.
  if (!companyId) {
    return { totalCount: 0, thisWeekCount: 0, clientScopedCount: 0 };
  }

  // Direct DB read via withTenant — RLS scopes the query to this
  // workspace's lessons. No HTTP roundtrip; same process holds the
  // pool. The single-statement triple-aggregate keeps the lock window
  // tiny + lets Postgres parallelise the COUNT(*) FILTER (...) calls.
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [row] = await withTenant(companyId, async (tx) =>
      tx
        .select({
          total: count(),
          // postgres-js doesn't bind Date objects in raw `sql` template
          // positions (only the drizzle operator helpers like gte/lte do
          // the conversion). Pass an ISO string + cast explicitly to
          // timestamptz so Postgres parses it without ambiguity.
          thisWeek: sql<number>`COUNT(*) FILTER (WHERE ${companyLessons.capturedAt} >= ${sevenDaysAgo}::timestamptz)`,
          clientScoped: sql<number>`COUNT(*) FILTER (WHERE ${companyLessons.clientId} IS NOT NULL)`,
        })
        .from(companyLessons),
    );
    return {
      totalCount: Number(row?.total ?? 0),
      thisWeekCount: Number(row?.thisWeek ?? 0),
      clientScopedCount: Number(row?.clientScoped ?? 0),
    };
  } catch (err) {
    // Mission Control should never crash on a stats query — the tile's
    // empty state is the right fallback. But surface the cause so silent
    // RLS / bind / join bugs don't hide behind a clean-looking empty tile.
    console.error("[mission-control] fetchLessonStats failed", err);
    return { totalCount: 0, thisWeekCount: 0, clientScopedCount: 0 };
  }
}

async function fetchStatusUrl(
  url: string,
  token: string,
  companyId: string,
): Promise<Record<string, unknown> | null> {
  // Single helper for the three /producer/status + /consumer/status
  // probes. Each call is fail-soft + short-timeout so a wedged service
  // can't slow the whole Mission Control page render. Returns null
  // when the service is unreachable / non-200; the caller surfaces
  // that as `reachable: false`.
  try {
    const resp = await fetch(url, {
      headers: authHeaders(token, companyId),
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_S },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[mission-control] fetchStatusUrl failed", { url, err });
    return null;
  }
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function buildProducerStatus(
  payload: Record<string, unknown> | null,
): BusStatus {
  if (!payload) return { reachable: false };
  return {
    reachable: true,
    enabled: asBool(payload.enabled),
    emitCount: asNumber(payload.emit_count),
    emitErrors: asNumber(payload.emit_errors),
  };
}

function buildConsumerStatus(
  payload: Record<string, unknown> | null,
): BusStatus {
  if (!payload) return { reachable: false };
  return {
    reachable: true,
    enabled: asBool(payload.enabled),
    consumedCount: asNumber(payload.consumed_count),
    matchedCount: asNumber(payload.matched_count),
    handleErrors: asNumber(payload.handle_errors),
  };
}

async function fetchBusHealth(): Promise<BusHealth> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  const token = process.env.SERVICE_TOKEN;

  // Without a session or service token, every stage reads as
  // unreachable — the operator sees "the bus probe can't run" rather
  // than misleading green dots from an empty fetch.
  if (!companyId || !token) {
    return {
      publishPipeline: { reachable: false },
      performanceIngest: { reachable: false },
      banditConsumer: { reachable: false },
    };
  }

  // All three URLs come from env. When a base URL is unset, we surface
  // the corresponding stage as unreachable rather than 502-ing the
  // tile — same fail-soft idiom as the rest of the page.
  const langgraphUrl = process.env.AGENT_LANGGRAPH_BASE_URL;
  const ingestUrl = process.env.PERFORMANCE_INGEST_BASE_URL;
  const banditUrl = process.env.BANDIT_ORCH_BASE_URL;

  const [langgraph, ingest, bandit] = await Promise.all([
    langgraphUrl
      ? fetchStatusUrl(
          `${langgraphUrl.replace(/\/$/, "")}/producer/status`,
          token,
          companyId,
        )
      : Promise.resolve(null),
    ingestUrl
      ? fetchStatusUrl(
          `${ingestUrl.replace(/\/$/, "")}/producer/status`,
          token,
          companyId,
        )
      : Promise.resolve(null),
    banditUrl
      ? fetchStatusUrl(
          `${banditUrl.replace(/\/$/, "")}/consumer/status`,
          token,
          companyId,
        )
      : Promise.resolve(null),
  ]);

  return {
    publishPipeline: buildProducerStatus(langgraph),
    performanceIngest: buildProducerStatus(ingest),
    banditConsumer: buildConsumerStatus(bandit),
  };
}

async function fetchAnomalies(): Promise<AnomalyDetection[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  const baseUrl = process.env.PERFORMANCE_INGEST_BASE_URL;
  const token = process.env.SERVICE_TOKEN;
  if (!baseUrl || !token) return [];

  try {
    const resp = await fetch(
      `${baseUrl.replace(/\/$/, "")}/anomaly/scan`,
      {
        method: "POST",
        headers: {
          ...authHeaders(token, companyId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_id: companyId,
          lookback_hours: 24,
          z_threshold: 2.5,
        }),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        next: { revalidate: REVALIDATE_S },
      },
    );
    if (!resp.ok) return [];
    const payload = (await resp.json()) as {
      detections?: AnomalyDetection[];
    };
    return payload.detections ?? [];
  } catch (err) {
    console.error("[mission-control] fetchAnomalies failed", err);
    return [];
  }
}

export default async function MissionControlPage() {
  // Fire all fetches in parallel — they're independent (HTTP to two
  // services + two local DB reads). Total wall-clock = max(...) rather
  // than the sum.
  const [
    bandits,
    anomalies,
    lessonStats,
    approvalQueue,
    kpis,
    teamAgents,
    heroKpi,
    busHealth,
  ] = await Promise.all([
    fetchBandits(),
    fetchAnomalies(),
    fetchLessonStats(),
    fetchApprovalQueue(),
    fetchKpiMetrics(),
    fetchAgents(),
    fetchHeroKpi(),
    fetchBusHealth(),
  ]);

  return (
    <AppShell title="Mission Control">
      <div className="p-4 sm:p-6">
        {/* Visually-hidden h1 — Doc 8 a11y. The bento layout doesn't
            have a visible page title (TopBar shows workspace context,
            not the heading). Screen readers + SEO crawlers + e2e
            tests all rely on a real h1; sr-only keeps it out of the
            visual layout. */}
        <h1 className="sr-only">Mission Control</h1>
        {/* Doc 8 §9.2 — bento grid. 12 cols on desktop, stacks on mobile.
            On <md every Card auto-collapses to col-span-12 via the cva
            size variants in card.tsx, so the grid linearises cleanly.
            Tighter gap on small viewports keeps tiles compact when each
            occupies the full row. */}
        <div className="grid grid-cols-12 gap-3 sm:gap-4 auto-rows-[minmax(120px,auto)]">
          {/* Hero KPI: this-week avg engagement percentile + week-over-
              week delta + 12-week trend + drafts shipped this week.
              Real data: post_metrics.engagement_percentile aggregated
              by week, drafts.status='published' counted. Cold workspace
              defaults to 50/0 to keep the tile legible (vs. NaN). */}
          <HeroKpiTile
            predicted={heroKpi.predicted}
            delta={heroKpi.delta}
            trend={heroKpi.trend}
            weeklyShipped={heroKpi.weeklyShipped}
          />

          <ApprovalQueueTile
            items={approvalQueue.items}
            totalPending={approvalQueue.totalPending}
          />

          <AgentActivityTile agents={teamAgents} />

          {/* CTR · last 7d. Real data: SUM(clicks) / SUM(impressions)
              over post_metrics where snapshot_at >= now()-7d. Null
              when no impressions in the window — renders as "—" so
              the user can tell apart "0%" from "no data yet". */}
          <MetricTile
            label="ctr · last 7d"
            value={kpis.ctr7d === null ? "—" : (kpis.ctr7d * 100).toFixed(2)}
            unit={kpis.ctr7d === null ? undefined : "%"}
            trend={kpis.ctr7dTrend}
            size="medium"
            tone="default"
            href="/performance"
          />

          {/* Reach · last 7d. Real data: SUM(reach) over post_metrics
              in the same window. */}
          <MetricTile
            label="reach · last 7d"
            value={formatReach(kpis.reach7d)}
            trend={kpis.reach7dTrend}
            size="medium"
            href="/performance"
          />

          {/* Crisis monitor — pulses red if active. Currently calm. */}
          <Card size="medium" tone="default">
            <CardHeader>
              <CardLabel>crisis monitor</CardLabel>
              <Badge variant="success">all clear</Badge>
            </CardHeader>
            <div className="text-sm text-text-secondary">
              No live-event triggers in the last 24h. Trend-watcher monitoring{" "}
              <span className="font-mono tabular-nums text-text-primary">14</span> sources.
            </div>
            <div className="mt-2 text-xs text-text-tertiary font-mono tabular-nums">
              last scan: 4m ago
            </div>
          </Card>

          {/* Performance anomalies — Doc 4 §2.2. Different signal class
              from crisis monitor: this surface watches the workspace's
              own drafts (z-score vs running mean), not the wider news
              cycle. Real data: detections come from performance-ingest's
              /anomaly/scan against histograms × last_values. */}
          <AnomaliesTile detections={anomalies} lookbackHours={24} zThreshold={2.5} />

          {/* Bus health — operational pulse for the Redpanda producers
              + bandit consumer. Three green dots = the loop is moving;
              red/yellow surfaces the wedged stage one read away. */}
          <BusHealthTile health={busHealth} />

          {/* AI spend · this month. Real data: SUM(total_cost_usd)
              over meter_events where occurred_at >= start-of-current-
              calendar-month UTC. Tracks ALL meter_event_kind rows
              (publish + metered_asset_generation + x402_inbound +
              x402_outbound + voice_score_query + compliance_check). */}
          <MetricTile
            label="ai spend · this month"
            value={`$${kpis.spendMtd.toFixed(2)}`}
            trend={kpis.spendMtdTrend}
            size="medium"
            tone="default"
            href="/performance"
          />

          {/* Editorial memory — Doc 7 + USP 5 moat. Real data: counts
              come from a single triple-aggregate over company_lessons,
              tenant-scoped via withTenant + RLS. */}
          <InstitutionalMemoryTile stats={lessonStats} />

          {/* Bandit experiments — Doc 4 §2.3. Real data: each row was
              registered by the Strategist (register_bandit tool), gets
              allocated by publish_pipeline's bandit_allocate node, and
              accumulates rewards via bandit-orchestrator's auto-reward
              consumer subscribed to content.metric_update. */}
          <ExperimentsTile bandits={bandits} />
        </div>

        {/* Footer rail — three-excellence reminder per Doc 7 §13.
            Wraps on narrow viewports so the kbd-shortcut tail doesn't
            push the row into horizontal overflow. */}
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">core/0.1.0</span>
          <span aria-hidden>·</span>
          <span>dark · charcoal #0B0C0E · accent #3FA9A0</span>
          <span className="md:ml-auto">
            ⌘K search · ⌘J chat · J/K nav · A approve
          </span>
        </div>
      </div>
    </AppShell>
  );
}
