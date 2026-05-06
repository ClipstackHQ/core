// /digest — your team's week in 60 seconds.
//
// The recurring backward-looking wedge. Aggregates real workspace data
// (top performers, lessons captured, anomalies, decisions made) into a
// single "what your team did this week" surface.
//
// v1 ships as pure SSR aggregation — no new tables, no crewai integration,
// no LLM-generated narrative. The data is real because the workspace is
// real; the structure is the pitch wedge. v2 adds an LLM-generated
// narrative layer (the weekly_digest crew) that turns the structured
// data into a 60-second voice-over script + Hyperframes video render.
//
// Pitch context: distributed-popping-scone.md line 19 names this as the
// "primary recurring flow" wedge. clipstack-pitch-deck.md positions it
// as the surface that proves the closed loop is moving without making
// the user read a dashboard.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Sparkles, TrendingUp, BookMarked, AlertTriangle, FileCheck } from "lucide-react";
import { and, desc, eq, gte, sql, isNotNull } from "drizzle-orm";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { drafts } from "@/lib/db/schema/drafts";
import { postMetrics } from "@/lib/db/schema/post-metrics";
import { companyLessons } from "@/lib/db/schema/lessons";
import { auditLog } from "@/lib/db/schema/audit";

export const metadata: Metadata = {
  title: "Digest · Clipstack",
  description: "Your team's week in 60 seconds — top performers, lessons captured, decisions made.",
};

interface DigestData {
  weekEndDate: Date;
  weekStartDate: Date;
  // Top 3 performers: drafts published last 7d sorted by avg engagement_percentile across all snapshots.
  topPerformers: Array<{
    id: string;
    title: string | null;
    channel: string;
    avgPercentile: number;
    impressions: number | null;
  }>;
  // Lessons captured in the last 7 days, grouped by scope.
  lessonsCaptured: {
    total: number;
    forever: number;
    thisTopic: number;
    thisClient: number;
    samples: Array<{ id: string; rationale: string; scope: string }>;
  };
  // Anomalies detected (engagement_percentile spike or drop, |z| ≥ 2.5).
  anomaliesCount: number;
  // Decisions made: approve / deny / week_approved counts in the last 7 days.
  decisionsMade: {
    approved: number;
    denied: number;
    weekApprovals: number;
    total: number;
  };
  // Drafts published count (just the count; titles already in topPerformers).
  publishedCount: number;
  // Drafts created (any status) this week — the strategist's output volume.
  draftsCreated: number;
}

const EMPTY_DIGEST: DigestData = {
  weekEndDate: new Date(),
  weekStartDate: new Date(),
  topPerformers: [],
  lessonsCaptured: {
    total: 0,
    forever: 0,
    thisTopic: 0,
    thisClient: 0,
    samples: [],
  },
  anomaliesCount: 0,
  decisionsMade: {
    approved: 0,
    denied: 0,
    weekApprovals: 0,
    total: 0,
  },
  publishedCount: 0,
  draftsCreated: 0,
};

async function fetchDigest(): Promise<DigestData> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return EMPTY_DIGEST;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();

  try {
    return await withTenant(companyId, async (tx) => {
      // ─── Top performers (last 7d, by avg engagement_percentile) ───────
      // Aggregate post_metrics by draft_id, average the percentile across
      // every snapshot in the window, take top 3. The window bound on
      // post_metrics.snapshot_at uses the ::timestamptz cast — same
      // silent-fail SQL fix as commit 2149e45.
      const topPerformersRaw = await tx
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

      // Look up titles for those drafts. Two-step rather than a JOIN
      // because the post_metrics table doesn't have a denormalized title.
      const topDraftIds = topPerformersRaw.map((p) => p.draftId);
      const topPerformerTitles = topDraftIds.length > 0
        ? await tx
            .select({
              id: drafts.id,
              title: drafts.title,
              channel: drafts.channel,
            })
            .from(drafts)
            .where(sql`${drafts.id} = ANY(${sql.raw(`ARRAY[${topDraftIds.map((id) => `'${id}'::uuid`).join(",")}]`)})`)
        : [];

      const titleById = new Map<string, { title: string | null; channel: string }>();
      for (const row of topPerformerTitles) {
        titleById.set(row.id, { title: row.title, channel: row.channel });
      }

      const topPerformers = topPerformersRaw.map((p) => {
        const meta = titleById.get(p.draftId);
        return {
          id: p.draftId,
          title: meta?.title ?? null,
          channel: meta?.channel ?? "unknown",
          avgPercentile: Number(p.avgPercentile ?? 0),
          impressions: p.totalImpressions !== null ? Number(p.totalImpressions) : null,
        };
      });

      // ─── Lessons captured (last 7d) ───────────────────────────────────
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
          id: companyLessons.id,
          rationale: companyLessons.rationale,
          scope: companyLessons.scope,
        })
        .from(companyLessons)
        .where(sql`${companyLessons.capturedAt} >= ${sevenDaysAgoIso}::timestamptz`)
        .orderBy(desc(companyLessons.capturedAt))
        .limit(3);

      // ─── Anomalies + decisions (audit_log rollups, last 7d) ───────────
      const [auditRollup] = await tx
        .select({
          anomalies: sql<number>`COUNT(*) FILTER (WHERE ${auditLog.kind} = 'anomalies.listed')`,
          approved: sql<number>`COUNT(*) FILTER (WHERE ${auditLog.kind} = 'approval.approved')`,
          denied: sql<number>`COUNT(*) FILTER (WHERE ${auditLog.kind} = 'approval.denied')`,
          weekApprovals: sql<number>`COUNT(*) FILTER (WHERE ${auditLog.kind} = 'calendar.week_approved')`,
        })
        .from(auditLog)
        .where(sql`${auditLog.occurredAt} >= ${sevenDaysAgoIso}::timestamptz`);

      // ─── Drafts published + created (last 7d) ────────────────────────
      const [draftStats] = await tx
        .select({
          publishedCount: sql<number>`COUNT(*) FILTER (WHERE ${drafts.status} = 'published' AND ${drafts.publishedAt} >= ${sevenDaysAgoIso}::timestamptz)`,
          draftsCreated: sql<number>`COUNT(*) FILTER (WHERE ${drafts.createdAt} >= ${sevenDaysAgoIso}::timestamptz)`,
        })
        .from(drafts);

      return {
        weekEndDate: now,
        weekStartDate: sevenDaysAgo,
        topPerformers,
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
  } catch (err) {
    console.error("[digest] fetchDigest failed", err);
    return EMPTY_DIGEST;
  }
}

const SCOPE_LABEL: Record<string, string> = {
  forever: "forever",
  this_topic: "topic-bounded",
  this_client: "client-specific",
};

function formatDateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}`;
}

function formatImpressions(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

export default async function DigestPage() {
  const data = await fetchDigest();

  // Headline reads as a single sentence: "Your week — N drafts shipped,
  // M lessons captured, K decisions made." The 60-second-video framing
  // is the wedge: what would Mira say in 60 seconds about your week?
  // She'd say this.

  return (
    <AppShell title="digest">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        <div className="mb-6">
          <div className="flex items-baseline gap-3 mb-2">
            <h1 className="text-2xl font-semibold text-text-primary">
              your week in 60 seconds
            </h1>
            <Badge variant="default" className="font-mono tabular-nums shrink-0 text-[10px]">
              {formatDateRange(data.weekStartDate, data.weekEndDate)}
            </Badge>
          </div>
          <p className="text-sm text-text-tertiary leading-relaxed">
            What your team did, what your team learned, what the next week
            should look like. Aggregated live from the workspace data —
            no manual rollup required. Mira can render this as a 60-second
            voice-over video on demand.
          </p>
        </div>

        {/* Headline number strip — the fast scan. */}
        <div className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card size="medium" tone="default" className="flex flex-col">
            <CardHeader>
              <CardLabel>drafts shipped</CardLabel>
            </CardHeader>
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-3xl font-semibold text-text-primary leading-none">
                {data.publishedCount}
              </span>
              <span className="text-xs text-text-tertiary">this week</span>
            </div>
            <div className="text-xs text-text-tertiary mt-1">
              {data.draftsCreated} new drafts created
            </div>
          </Card>

          <Card size="medium" tone="accent" className="flex flex-col">
            <CardHeader>
              <CardLabel>lessons captured</CardLabel>
            </CardHeader>
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-3xl font-semibold text-text-primary leading-none">
                {data.lessonsCaptured.total}
              </span>
              <span className="text-xs text-text-tertiary">added</span>
            </div>
            <div className="text-xs text-text-tertiary mt-1 truncate">
              {data.lessonsCaptured.forever}f · {data.lessonsCaptured.thisTopic}t · {data.lessonsCaptured.thisClient}c
            </div>
          </Card>

          <Card size="medium" tone="default" className="flex flex-col">
            <CardHeader>
              <CardLabel>decisions made</CardLabel>
            </CardHeader>
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-3xl font-semibold text-text-primary leading-none">
                {data.decisionsMade.total}
              </span>
              <span className="text-xs text-text-tertiary">total</span>
            </div>
            <div className="text-xs text-text-tertiary mt-1">
              <span className="text-status-success">{data.decisionsMade.approved}✓</span> ·{" "}
              <span className="text-status-danger">{data.decisionsMade.denied}✗</span> ·{" "}
              {data.decisionsMade.weekApprovals} weekly
            </div>
          </Card>

          <Card size="medium" tone="default" className="flex flex-col">
            <CardHeader>
              <CardLabel>anomalies</CardLabel>
            </CardHeader>
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-3xl font-semibold text-text-primary leading-none">
                {data.anomaliesCount}
              </span>
              <span className="text-xs text-text-tertiary">flagged</span>
            </div>
            <div className="text-xs text-text-tertiary mt-1">
              |z| ≥ 2.5σ on engagement
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Left: top performers + lessons captured */}
          <div className="min-w-0 space-y-6">
            {/* Top performers */}
            <section>
              <div className="flex items-baseline gap-2 mb-3 pb-1 border-b border-border-subtle">
                <TrendingUp className="h-4 w-4 text-status-success shrink-0" aria-hidden />
                <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                  top performers this week
                </h2>
                <span className="text-xs text-text-tertiary">
                  by avg engagement percentile (workspace-relative)
                </span>
              </div>
              {data.topPerformers.length === 0 ? (
                <Card size="medium" tone="default">
                  <p className="text-sm text-text-tertiary leading-relaxed">
                    No published drafts with engagement metrics yet. Top
                    performers populate after the publish pipeline ships
                    drafts and performance-ingest pulls the first metric
                    snapshots.
                  </p>
                </Card>
              ) : (
                <ul className="space-y-2">
                  {data.topPerformers.map((p, i) => {
                    const tone = p.avgPercentile >= 70
                      ? "success"
                      : p.avgPercentile >= 50
                        ? "warning"
                        : "danger";
                    return (
                      <li key={p.id}>
                        <Link
                          href={`/drafts/${p.id}`}
                          className="block rounded-md border border-border-subtle bg-bg-default px-4 py-3 hover:bg-bg-elevated transition-colors duration-fast"
                        >
                          <div className="flex items-baseline gap-3 mb-1">
                            <span className="font-mono tabular-nums text-text-tertiary text-sm shrink-0">
                              #{i + 1}
                            </span>
                            <span className="text-sm text-text-primary truncate flex-1">
                              {p.title?.trim() || "(untitled draft)"}
                            </span>
                            <Badge variant={tone} className="font-mono tabular-nums shrink-0 text-[10px]">
                              p{Math.round(p.avgPercentile)}
                            </Badge>
                          </div>
                          <div className="flex items-baseline gap-2 text-xs text-text-tertiary font-mono tabular-nums">
                            <span>{p.channel}</span>
                            <span aria-hidden>·</span>
                            <span>{formatImpressions(p.impressions)} impressions</span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Lessons captured */}
            <section>
              <div className="flex items-baseline gap-2 mb-3 pb-1 border-b border-border-subtle">
                <BookMarked className="h-4 w-4 text-accent-500 shrink-0" aria-hidden />
                <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                  lessons captured
                </h2>
                <Link
                  href="/memory"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
                >
                  full archive
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
              {data.lessonsCaptured.samples.length === 0 ? (
                <Card size="medium" tone="default">
                  <p className="text-sm text-text-tertiary leading-relaxed">
                    No new lessons captured this week. Workspaces accumulate
                    institutional knowledge through human denials + critic
                    blocks; an empty week here usually means the strategist
                    + critic loop is on auto-pilot — fine, but worth
                    spot-checking.
                  </p>
                </Card>
              ) : (
                <ul className="space-y-2">
                  {data.lessonsCaptured.samples.map((lesson) => (
                    <li
                      key={lesson.id}
                      className="rounded-md border border-border-subtle bg-bg-default px-4 py-3"
                    >
                      <div className="flex items-baseline gap-2 mb-1">
                        <Badge variant="default" className="font-mono tabular-nums shrink-0 text-[10px]">
                          {SCOPE_LABEL[lesson.scope] ?? lesson.scope}
                        </Badge>
                      </div>
                      <p className="text-sm text-text-primary leading-relaxed">
                        {lesson.rationale}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Right rail: the script + render-as-video CTA */}
          <aside className="space-y-4">
            <Card size="medium" tone="accent" className="flex flex-col">
              <CardHeader>
                <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
                <CardLabel>render as 60s video</CardLabel>
              </CardHeader>
              <p className="text-xs text-text-tertiary leading-relaxed mb-3">
                Hyperframes can render this digest as a Doc 8 charcoal
                voice-over video — 60 seconds, watchable on mobile,
                shareable in the team Slack. Click below to queue
                the render in the Studio.
              </p>
              <Link
                href={`/studio?prompt=${encodeURIComponent(
                  `A 60-second weekly digest video. Top performer: ${
                    data.topPerformers[0]?.title ?? "(none yet)"
                  } at p${Math.round(data.topPerformers[0]?.avgPercentile ?? 0)}. ${
                    data.lessonsCaptured.total
                  } lessons captured. ${data.decisionsMade.total} decisions made. ${
                    data.publishedCount
                  } drafts shipped.`,
                )}`}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent-500 text-text-inverted text-sm font-medium hover:bg-accent-600 transition-colors duration-fast"
              >
                <Sparkles className="h-3 w-3" aria-hidden />
                Send to Studio
              </Link>
            </Card>

            <Card size="medium" tone="default" className="flex flex-col">
              <CardHeader>
                <FileCheck className="h-4 w-4 shrink-0" aria-hidden />
                <CardLabel>recommended next week</CardLabel>
              </CardHeader>
              <ul className="space-y-2 text-sm text-text-secondary leading-relaxed">
                {data.topPerformers.length > 0 && (
                  <li className="flex items-baseline gap-2">
                    <span className="text-status-success shrink-0">→</span>
                    <span>
                      Repurpose{" "}
                      <span className="text-text-primary">
                        &ldquo;{data.topPerformers[0]?.title?.slice(0, 60) ?? "top draft"}&rdquo;
                      </span>{" "}
                      across other channels — it landed at p
                      {Math.round(data.topPerformers[0]?.avgPercentile ?? 0)}.
                    </span>
                  </li>
                )}
                {data.lessonsCaptured.total > 0 && (
                  <li className="flex items-baseline gap-2">
                    <span className="text-accent-500 shrink-0">→</span>
                    <span>
                      Brief the strategist on the {data.lessonsCaptured.total} new
                      lesson{data.lessonsCaptured.total === 1 ? "" : "s"}.
                      The next draft cycle should pull these into the system
                      prompt.
                    </span>
                  </li>
                )}
                {data.anomaliesCount > 0 && (
                  <li className="flex items-baseline gap-2">
                    <AlertTriangle className="h-3 w-3 text-status-warning shrink-0 mt-1" aria-hidden />
                    <span>
                      Investigate the {data.anomaliesCount} anomaly
                      {data.anomaliesCount === 1 ? "" : "ies"} flagged this
                      week — performance outside ±2.5σ usually has a
                      teachable cause.
                    </span>
                  </li>
                )}
                {data.lessonsCaptured.total === 0 &&
                  data.anomaliesCount === 0 &&
                  data.topPerformers.length === 0 && (
                    <li className="flex items-baseline gap-2">
                      <span className="text-text-tertiary shrink-0">→</span>
                      <span>
                        Quiet week. Either the team is on autopilot or the
                        ingestion lane is wedged — check{" "}
                        <Link href="/system" className="text-accent-500 hover:underline">
                          /system
                        </Link>{" "}
                        for bus health.
                      </span>
                    </li>
                  )}
              </ul>
            </Card>

            <Card size="small" tone="default" className="flex flex-col">
              <CardHeader>
                <CardLabel>also see</CardLabel>
              </CardHeader>
              <div className="flex flex-col gap-1.5 text-xs">
                <Link
                  href="/performance"
                  className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors duration-fast"
                >
                  full performance history <ArrowUpRight className="h-3 w-3" />
                </Link>
                <Link
                  href="/memory"
                  className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors duration-fast"
                >
                  every lesson captured <ArrowUpRight className="h-3 w-3" />
                </Link>
                <Link
                  href="/activity"
                  className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors duration-fast"
                >
                  the audit feed <ArrowUpRight className="h-3 w-3" />
                </Link>
                <Link
                  href="/pipeline"
                  className="inline-flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors duration-fast"
                >
                  what&apos;s in flight now <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            </Card>
          </aside>
        </div>

        <div className="mt-8 text-xs text-text-tertiary leading-relaxed">
          v1 ships pure SSR aggregation from workspace data. v2 adds an
          LLM-generated narrative + Hyperframes 60s video render via the
          weekly_digest crew. Cron-driven Sunday 9am send is parked
          behind a scheduler service that lands with the channel-publisher
          sprint.
        </div>
      </div>
    </AppShell>
  );
}
