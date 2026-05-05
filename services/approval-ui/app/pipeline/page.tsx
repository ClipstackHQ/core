// /pipeline — publish pipeline visualization.
//
// The langgraph publish_pipeline state graph (services/agent-langgraph/
// workflows/publish_pipeline/graph.py) routes every draft through 8 nodes:
// review_cycle → percentile_gate → awaiting_human_approval → bandit_allocate
// → publish_to_channel → record_metering → END, with side branches for
// blocked (record_block_lesson) + denied (record_deny_lesson).
//
// This page is the operator's window into that graph — it shows the
// happy-path flow horizontally with current draft counts at each stage,
// plus the two terminal branches for blocked + denied artifacts. Each
// draft card links to /drafts/[id] for the full detail pane.
//
// We map draft.status onto pipeline stages because the langgraph state is
// not currently mirrored into the drafts row — drafts.status is the
// authoritative "what stage is this in" signal the rest of the UI reads.
// When the langgraph PostgresSaver state becomes queryable per-thread we
// can enrich this view with sub-stage detail (review_cycle iteration N
// vs N+1, percentile_gate threshold readout, etc).
//
// Pipeline stage → draft.status mapping:
//   review_cycle              ← drafting, in_review
//   awaiting_human_approval   ← awaiting_approval
//   bandit_allocate / publish ← approved, scheduled
//   record_metering / END     ← published (last 7d, freshness band)
//   record_block_lesson       ← archived (terminal)
//   record_deny_lesson        ← denied   (terminal)

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { asc, desc, eq, gte, inArray } from "drizzle-orm";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { drafts } from "@/lib/db/schema/drafts";

export const metadata: Metadata = {
  title: "Pipeline · Clipstack",
  description: "Publish pipeline state — drafts in flight, blocked, denied.",
};

interface PipelineDraft {
  id: string;
  // drafts.title is nullable (X posts often run titleless); the renderer
  // falls back to "(untitled draft)" when null/empty.
  title: string | null;
  channel: string;
  status: string;
  createdAt: Date;
  predictedPercentile: number | null;
}

interface PipelineGroups {
  review: PipelineDraft[];           // drafting + in_review
  awaitingApproval: PipelineDraft[]; // awaiting_approval
  publishing: PipelineDraft[];       // approved + scheduled
  published7d: PipelineDraft[];      // published (last 7d)
  denied: PipelineDraft[];           // denied (last 30d)
  blocked: PipelineDraft[];          // archived (last 30d)
}

const EMPTY_GROUPS: PipelineGroups = {
  review: [],
  awaitingApproval: [],
  publishing: [],
  published7d: [],
  denied: [],
  blocked: [],
};

async function fetchPipeline(): Promise<PipelineGroups> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return EMPTY_GROUPS;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  try {
    return await withTenant(companyId, async (tx) => {
      // One query per terminal status group. Each is short + index-friendly
      // (idx_drafts_company_status). Issuing them in parallel via
      // Promise.all keeps total wall time at ~one round-trip rather than
      // serializing six.
      const [
        reviewRows,
        awaitingRows,
        publishingRows,
        publishedRows,
        deniedRows,
        blockedRows,
      ] = await Promise.all([
        tx
          .select({
            id: drafts.id,
            title: drafts.title,
            channel: drafts.channel,
            status: drafts.status,
            createdAt: drafts.createdAt,
            predictedPercentile: drafts.predictedPercentile,
          })
          .from(drafts)
          .where(inArray(drafts.status, ["drafting", "in_review"]))
          .orderBy(asc(drafts.createdAt)),
        tx
          .select({
            id: drafts.id,
            title: drafts.title,
            channel: drafts.channel,
            status: drafts.status,
            createdAt: drafts.createdAt,
            predictedPercentile: drafts.predictedPercentile,
          })
          .from(drafts)
          .where(eq(drafts.status, "awaiting_approval"))
          .orderBy(asc(drafts.createdAt)),
        tx
          .select({
            id: drafts.id,
            title: drafts.title,
            channel: drafts.channel,
            status: drafts.status,
            createdAt: drafts.createdAt,
            predictedPercentile: drafts.predictedPercentile,
          })
          .from(drafts)
          .where(inArray(drafts.status, ["approved", "scheduled"]))
          .orderBy(asc(drafts.createdAt)),
        tx
          .select({
            id: drafts.id,
            title: drafts.title,
            channel: drafts.channel,
            status: drafts.status,
            createdAt: drafts.createdAt,
            predictedPercentile: drafts.predictedPercentile,
          })
          .from(drafts)
          .where(eq(drafts.status, "published"))
          // Bound to last 7 days so the lane reads as "freshly published"
          // not "every published artifact ever". The publishedAt vs
          // createdAt distinction matters here — a draft published this
          // week could have been created weeks ago. We sort by createdAt
          // since publishedAt may be null even for status=published when
          // the publisher didn't backfill the timestamp; the seed always
          // sets it but legacy or hand-imported rows may not.
          .orderBy(desc(drafts.createdAt)),
        tx
          .select({
            id: drafts.id,
            title: drafts.title,
            channel: drafts.channel,
            status: drafts.status,
            createdAt: drafts.createdAt,
            predictedPercentile: drafts.predictedPercentile,
          })
          .from(drafts)
          .where(eq(drafts.status, "denied"))
          .orderBy(desc(drafts.createdAt)),
        tx
          .select({
            id: drafts.id,
            title: drafts.title,
            channel: drafts.channel,
            status: drafts.status,
            createdAt: drafts.createdAt,
            predictedPercentile: drafts.predictedPercentile,
          })
          .from(drafts)
          .where(eq(drafts.status, "archived"))
          .orderBy(desc(drafts.createdAt)),
      ]);

      // Filter the published+denied+blocked lanes to the freshness windows
      // in JS rather than SQL — the WHERE-clause filter on createdAt would
      // require another `gte` per query; the row counts in these terminal
      // lanes are bounded by workspace activity, so post-filtering is
      // negligible cost and keeps the query shape uniform.
      const filterSince = (rows: typeof publishedRows, since: Date) =>
        rows.filter((r) => r.createdAt >= since);

      return {
        review: reviewRows,
        awaitingApproval: awaitingRows,
        publishing: publishingRows,
        published7d: filterSince(publishedRows, sevenDaysAgo),
        denied: filterSince(deniedRows, thirtyDaysAgo),
        blocked: filterSince(blockedRows, thirtyDaysAgo),
      };
    });
  } catch (err) {
    console.error("[pipeline] fetchPipeline failed", err);
    return EMPTY_GROUPS;
  }
}

function formatAge(createdAt: Date): string {
  const elapsed = Date.now() - createdAt.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface StageProps {
  step: number;
  nodeName: string;
  description: string;
  drafts: PipelineDraft[];
  emptyHint: string;
  // Last column suppresses the trailing arrow.
  isLast?: boolean;
  // Visual tone — `terminal` for END states, `default` for in-flight.
  tone?: "default" | "terminal" | "warn";
}

function PipelineStage({
  step,
  nodeName,
  description,
  drafts,
  emptyHint,
  isLast,
  tone = "default",
}: StageProps) {
  // Nodes show count + sample drafts (top 3 by sort order). Click-through
  // on each draft lands on /drafts/[id]. The stage card itself is not a
  // link — that would steal clicks from the inner draft links.
  const cardTone =
    tone === "terminal" ? "default" : tone === "warn" ? "default" : "default";
  const countTone =
    drafts.length === 0
      ? "default"
      : tone === "warn"
        ? "warning"
        : tone === "terminal"
          ? "default"
          : drafts.length >= 5
            ? "warning"
            : "success";

  return (
    <div className="flex items-stretch gap-3 min-w-0">
      <div className="flex flex-col min-w-[240px] flex-1">
        <Card size="medium" tone={cardTone} className="flex flex-col flex-1">
          <CardHeader>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[11px] text-text-tertiary font-mono uppercase tracking-wide">
                step {step}
              </span>
              <CardLabel>{nodeName}</CardLabel>
              <span className="text-xs text-text-tertiary line-clamp-2">
                {description}
              </span>
            </div>
            <Badge variant={countTone} className="font-mono tabular-nums shrink-0">
              {drafts.length}
            </Badge>
          </CardHeader>

          {drafts.length === 0 ? (
            <div className="text-xs text-text-tertiary leading-relaxed">
              {emptyHint}
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle -mx-4 mt-1">
              {drafts.slice(0, 3).map((d) => {
                const p = d.predictedPercentile;
                const pTone =
                  p === null
                    ? "default"
                    : p >= 70
                      ? "success"
                      : p >= 50
                        ? "warning"
                        : "danger";
                const pLabel = p === null ? "p—" : `p${Math.round(p)}`;
                return (
                  <li key={d.id}>
                    <Link
                      href={`/drafts/${d.id}`}
                      className="flex items-start gap-2 px-4 py-2 hover:bg-bg-elevated transition-colors duration-fast"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-text-primary truncate">
                          {d.title?.trim() || "(untitled draft)"}
                        </div>
                        <div className="text-[11px] text-text-tertiary">
                          <span>{d.channel}</span>
                          <span className="mx-1">·</span>
                          <span className="font-mono tabular-nums">
                            {formatAge(d.createdAt)}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant={pTone}
                        className="font-mono tabular-nums shrink-0 text-[10px]"
                      >
                        {pLabel}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
              {drafts.length > 3 && (
                <li className="px-4 py-2 text-[11px] text-text-tertiary">
                  +{drafts.length - 3} more
                </li>
              )}
            </ul>
          )}
        </Card>
      </div>

      {!isLast && (
        <div
          aria-hidden
          className="flex items-center text-text-tertiary shrink-0"
        >
          <ArrowRight className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

export default async function PipelinePage() {
  const groups = await fetchPipeline();

  const totalInFlight =
    groups.review.length +
    groups.awaitingApproval.length +
    groups.publishing.length;

  return (
    <AppShell title="pipeline">
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">
            publish pipeline
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed">
            Every draft moves through the langgraph publish_pipeline state
            graph: review &rarr; percentile gate &rarr; human approval &rarr;
            bandit allocation &rarr; channel publish &rarr; metering. Counts
            below reflect drafts currently at each node — click any draft for
            the full detail pane.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <span>
            <span className="font-mono tabular-nums text-text-primary">
              {totalInFlight}
            </span>{" "}
            in flight
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-mono tabular-nums text-text-primary">
              {groups.published7d.length}
            </span>{" "}
            published in last 7d
          </span>
          {groups.denied.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-danger">
                  {groups.denied.length}
                </span>{" "}
                denied in last 30d
              </span>
            </>
          )}
          {groups.blocked.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-warning">
                  {groups.blocked.length}
                </span>{" "}
                blocked in last 30d
              </span>
            </>
          )}
        </div>

        {/* Happy path: 5 horizontal stages, scroll-x on narrow viewports
            (the cards have a 240px min-width so a phone can swipe through
            instead of cramming all 5 into 320px). */}
        <section className="mb-8">
          <div className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3 pb-1 border-b border-border-subtle">
            happy path
          </div>
          <div className="flex items-stretch gap-0 overflow-x-auto pb-2 -mx-1 px-1">
            <PipelineStage
              step={1}
              nodeName="review_cycle"
              description="Voice scoring, claim verification, devil's-advocate critique. Up to 3 revisions before block."
              drafts={groups.review}
              emptyHint="No drafts in review. The strategist queues new drafts here when a brief arrives."
            />
            <PipelineStage
              step={2}
              nodeName="awaiting_human_approval"
              description="Human reviews voice + claims + predicted percentile. Approve, deny with rationale, or hold."
              drafts={groups.awaitingApproval}
              emptyHint="Inbox empty. Approved drafts move on to bandit allocation; denied ones capture a lesson."
            />
            <PipelineStage
              step={3}
              nodeName="bandit_allocate"
              description="Thompson sampling picks the variant. Pass-through if no campaign bandit is wired."
              drafts={groups.publishing}
              emptyHint="No approved drafts queued for publish."
            />
            <PipelineStage
              step={4}
              nodeName="publish_to_channel"
              description="Channel adapter posts the artefact. Emits content.published with variant_id for reward attribution."
              drafts={[]}
              emptyHint="Transient — drafts pass through this node within seconds of approval."
              tone="terminal"
            />
            <PipelineStage
              step={5}
              nodeName="record_metering"
              description="Writes meter_event + completes the run. End of the happy-path graph."
              drafts={groups.published7d}
              emptyHint="No drafts published in the last 7 days."
              isLast
              tone="terminal"
            />
          </div>
        </section>

        {/* Side branches: terminal-state lanes (denied + blocked). These
            don't sit on the happy path so they get their own row, smaller
            visual weight (fewer columns + warning/danger tone on the badge
            count when populated). */}
        <section>
          <div className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3 pb-1 border-b border-border-subtle">
            terminal branches
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card size="medium" tone="default" className="flex flex-col">
              <CardHeader>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[11px] text-text-tertiary font-mono uppercase tracking-wide">
                    branch
                  </span>
                  <CardLabel>record_deny_lesson</CardLabel>
                  <span className="text-xs text-text-tertiary">
                    Human denied at the approval gate. Captures a USP 5
                    rationale + scope so the same draft pattern blocks
                    earlier next time.
                  </span>
                </div>
                <Badge
                  variant={groups.denied.length === 0 ? "default" : "danger"}
                  className="font-mono tabular-nums shrink-0"
                >
                  {groups.denied.length}
                </Badge>
              </CardHeader>
              {groups.denied.length === 0 ? (
                <div className="text-xs text-text-tertiary">
                  No denied drafts in the last 30 days.
                </div>
              ) : (
                <ul className="divide-y divide-border-subtle -mx-4">
                  {groups.denied.slice(0, 5).map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/drafts/${d.id}`}
                        className="flex items-start gap-2 px-4 py-2 hover:bg-bg-elevated transition-colors duration-fast"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-text-primary truncate">
                            {d.title?.trim() || "(untitled draft)"}
                          </div>
                          <div className="text-[11px] text-text-tertiary">
                            <span>{d.channel}</span>
                            <span className="mx-1">·</span>
                            <span className="font-mono tabular-nums">
                              {formatAge(d.createdAt)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                  {groups.denied.length > 5 && (
                    <li className="px-4 py-2 text-[11px] text-text-tertiary">
                      +{groups.denied.length - 5} more
                    </li>
                  )}
                </ul>
              )}
            </Card>

            <Card size="medium" tone="default" className="flex flex-col">
              <CardHeader>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[11px] text-text-tertiary font-mono uppercase tracking-wide">
                    branch
                  </span>
                  <CardLabel>record_block_lesson</CardLabel>
                  <span className="text-xs text-text-tertiary">
                    Critic blocked the draft before it reached human
                    review (voice fail, unverified claim, percentile
                    gate, exhausted revisions).
                  </span>
                </div>
                <Badge
                  variant={groups.blocked.length === 0 ? "default" : "warning"}
                  className="font-mono tabular-nums shrink-0"
                >
                  {groups.blocked.length}
                </Badge>
              </CardHeader>
              {groups.blocked.length === 0 ? (
                <div className="text-xs text-text-tertiary">
                  No blocked drafts in the last 30 days.
                </div>
              ) : (
                <ul className="divide-y divide-border-subtle -mx-4">
                  {groups.blocked.slice(0, 5).map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/drafts/${d.id}`}
                        className="flex items-start gap-2 px-4 py-2 hover:bg-bg-elevated transition-colors duration-fast"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-text-primary truncate">
                            {d.title?.trim() || "(untitled draft)"}
                          </div>
                          <div className="text-[11px] text-text-tertiary">
                            <span>{d.channel}</span>
                            <span className="mx-1">·</span>
                            <span className="font-mono tabular-nums">
                              {formatAge(d.createdAt)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                  {groups.blocked.length > 5 && (
                    <li className="px-4 py-2 text-[11px] text-text-tertiary">
                      +{groups.blocked.length - 5} more
                    </li>
                  )}
                </ul>
              )}
            </Card>
          </div>
        </section>

        <div className="mt-8 text-xs text-text-tertiary">
          Source: services/agent-langgraph/workflows/publish_pipeline/graph.py
          · langgraph state checkpointed to PostgresSaver when POSTGRES_URL
          is set.
        </div>
      </div>
    </AppShell>
  );
}
