// /calendar — editorial calendar.
//
// Doc 4 §3 + Doc 7 §2.4 — the single source of truth for what's
// shipping when, across every channel and client. Read view first;
// drag-to-reschedule lands in a follow-up slice once the bulk-update
// route + conflict detector ship.
//
// What renders here:
//   - Today + next 14 days: drafts with `scheduledAt` set (status:
//     scheduled or approved), grouped by calendar day in workspace
//     timezone (UTC for now; per-workspace TZ lands with /settings).
//   - Last 14 days: drafts with `publishedAt` set (status: published),
//     grouped the same way. Past entries render dimmer so the eye
//     anchors on what's upcoming.
//   - "Unscheduled" rail: drafts approved but missing a scheduledAt —
//     a queue the operator should slot. Doc 4 §3 calls these "loose
//     ends" and surfaces them prominently.
//
// Filter chips (channel) at the top let the operator scope the view —
// useful when one platform's cadence is the focus this week.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { and, eq, gte, inArray, lte, isNotNull, isNull, asc } from "drizzle-orm";

import { AppShell } from "@/components/layout/AppShell";
import { ApproveWeekButton } from "@/components/calendar/ApproveWeekButton";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AgentMark,
  type AgentMarkColor,
  type AgentMarkShape,
} from "@/components/AgentMark";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { agents as agentsTable } from "@/lib/db/schema/agents";
import { drafts } from "@/lib/db/schema/drafts";

export const metadata: Metadata = {
  title: "Calendar · Clipstack",
  description: "What's shipping when — every channel, every client.",
};

// Same role→viz table the rest of the UI uses. Doc 8 §5.6 — every role
// has a stable (shape, color) so the same agent reads identically across
// surfaces.
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

interface CalendarDraft {
  id: string;
  title: string | null;
  channel: string;
  status: string;
  // anchorAt is the date this row sorts under — scheduledAt for scheduled,
  // publishedAt for published, null for unscheduled approved.
  anchorAt: Date | null;
  predictedPercentile: number | null;
  agentLabel: string;
  agentShape: AgentMarkShape;
  agentColor: AgentMarkColor;
}

interface CalendarBundle {
  upcoming: CalendarDraft[]; // scheduled + approved + awaiting_approval (with scheduledAt) — today + next 14 days
  recent: CalendarDraft[];   // published — last 14 days
  unscheduled: CalendarDraft[]; // approved without scheduledAt
  /** Count of drafts in the next 7 days that are still awaiting approval —
   *  drives the "approve the week in 60 seconds" wedge button. Computed
   *  in fetchCalendar so the SSR rendering is consistent with the DB. */
  approveWeekPendingCount: number;
}

const EMPTY_BUNDLE: CalendarBundle = {
  upcoming: [],
  recent: [],
  unscheduled: [],
  approveWeekPendingCount: 0,
};

async function fetchCalendar(): Promise<CalendarBundle> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return EMPTY_BUNDLE;

  const now = new Date();
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  try {
    return await withTenant(companyId, async (tx) => {
      const [upcomingRows, recentRows, unscheduledRows] = await Promise.all([
        // Upcoming: drafts with scheduledAt in [now, +14d]. Status filter
        // accepts scheduled OR approved — both are pre-publish states that
        // can carry a scheduledAt; the channel adapter promotes scheduled
        // → published when it actually fires.
        tx
          .select({
            id: drafts.id,
            title: drafts.title,
            channel: drafts.channel,
            status: drafts.status,
            scheduledAt: drafts.scheduledAt,
            publishedAt: drafts.publishedAt,
            predictedPercentile: drafts.predictedPercentile,
            agentRole: agentsTable.role,
            agentDisplayName: agentsTable.displayName,
          })
          .from(drafts)
          .leftJoin(agentsTable, eq(agentsTable.id, drafts.authoredByAgentId))
          .where(
            and(
              isNotNull(drafts.scheduledAt),
              gte(drafts.scheduledAt, now),
              lte(drafts.scheduledAt, fourteenDaysFromNow),
              // Includes awaiting_approval so the bulk approve-week wedge
              // has visible drafts to act on. Each row's status badge in
              // the rendered list distinguishes the lifecycle stage.
              inArray(drafts.status, ["scheduled", "approved", "awaiting_approval"]),
            ),
          )
          .orderBy(asc(drafts.scheduledAt)),
        // Recent: published drafts in [-14d, now]. Bound by publishedAt.
        tx
          .select({
            id: drafts.id,
            title: drafts.title,
            channel: drafts.channel,
            status: drafts.status,
            scheduledAt: drafts.scheduledAt,
            publishedAt: drafts.publishedAt,
            predictedPercentile: drafts.predictedPercentile,
            agentRole: agentsTable.role,
            agentDisplayName: agentsTable.displayName,
          })
          .from(drafts)
          .leftJoin(agentsTable, eq(agentsTable.id, drafts.authoredByAgentId))
          .where(
            and(
              eq(drafts.status, "published"),
              isNotNull(drafts.publishedAt),
              gte(drafts.publishedAt, fourteenDaysAgo),
              lte(drafts.publishedAt, now),
            ),
          )
          .orderBy(asc(drafts.publishedAt)),
        // Unscheduled: approved drafts that don't yet have scheduledAt set.
        // Doc 4 §3 calls these "loose ends" — operator nudges them onto a
        // slot before the channel adapter can promote them.
        tx
          .select({
            id: drafts.id,
            title: drafts.title,
            channel: drafts.channel,
            status: drafts.status,
            scheduledAt: drafts.scheduledAt,
            publishedAt: drafts.publishedAt,
            predictedPercentile: drafts.predictedPercentile,
            agentRole: agentsTable.role,
            agentDisplayName: agentsTable.displayName,
          })
          .from(drafts)
          .leftJoin(agentsTable, eq(agentsTable.id, drafts.authoredByAgentId))
          .where(
            and(
              eq(drafts.status, "approved"),
              isNull(drafts.scheduledAt),
            ),
          )
          .orderBy(asc(drafts.createdAt)),
      ]);

      const mapRow = (
        row: typeof upcomingRows[number],
        anchorKey: "scheduledAt" | "publishedAt" | null,
      ): CalendarDraft => {
        const viz = AGENT_ROLE_VIZ[row.agentRole ?? ""] ?? {
          shape: "circle" as const,
          color: "slate" as const,
        };
        const label =
          (row.agentDisplayName ?? "?").trim().charAt(0).toUpperCase() || "?";
        const anchorAt = anchorKey
          ? anchorKey === "scheduledAt"
            ? row.scheduledAt
            : row.publishedAt
          : null;
        return {
          id: row.id,
          title: row.title,
          channel: row.channel,
          status: row.status,
          anchorAt,
          predictedPercentile: row.predictedPercentile,
          agentLabel: label,
          agentShape: viz.shape,
          agentColor: viz.color,
        };
      };

      // The approve-week wedge counts ONLY awaiting_approval drafts
      // scheduled in the next 7 days. The 14-day upcoming window above
      // includes status='scheduled' + 'approved' for display; this
      // narrower count drives the bulk-approval CTA.
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const approveWeekPendingCount = upcomingRows.filter(
        (r) =>
          r.status === "awaiting_approval" &&
          r.scheduledAt !== null &&
          r.scheduledAt <= sevenDaysFromNow,
      ).length;

      return {
        upcoming: upcomingRows.map((r) => mapRow(r, "scheduledAt")),
        recent: recentRows.map((r) => mapRow(r, "publishedAt")),
        unscheduled: unscheduledRows.map((r) => mapRow(r, null)),
        approveWeekPendingCount,
      };
    });
  } catch (err) {
    console.error("[calendar] fetchCalendar failed", err);
    return EMPTY_BUNDLE;
  }
}

// Group drafts by calendar day (YYYY-MM-DD) in UTC. Per-workspace timezone
// is parked behind /settings; UTC is the consistent floor every other
// surface (the activity feed, post_metrics) reads in.
function groupByDay(items: CalendarDraft[]): Map<string, CalendarDraft[]> {
  const map = new Map<string, CalendarDraft[]>();
  for (const item of items) {
    if (!item.anchorAt) continue;
    const key = item.anchorAt.toISOString().slice(0, 10); // YYYY-MM-DD
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function formatDayHeader(isoDate: string, today: string): string {
  // Example: "Mon · May 6" or "Today · Mon · May 6". The "Today" prefix
  // anchors the operator's scan position when the page first renders.
  const d = new Date(isoDate + "T12:00:00Z");
  const weekday = d.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  const month = d.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const day = d.getUTCDate();
  const base = `${weekday} · ${month} ${day}`;
  return isoDate === today ? `Today · ${base}` : base;
}

function formatTime(d: Date): string {
  // 14:30 — ISO-style 24h. Per-workspace formatter lands with /settings.
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

interface DraftRowProps {
  draft: CalendarDraft;
  dimmed?: boolean;
}

function DraftRow({ draft, dimmed = false }: DraftRowProps) {
  const p = draft.predictedPercentile;
  const pTone =
    p === null ? "default" : p >= 70 ? "success" : p >= 50 ? "warning" : "danger";
  const pLabel = p === null ? "p—" : `p${Math.round(p)}`;
  return (
    <li>
      <Link
        href={`/drafts/${draft.id}`}
        data-keyboard-row
        className={`flex items-center gap-3 py-3 px-2 -mx-2 rounded hover:bg-bg-elevated transition-colors duration-fast focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500 ${
          dimmed ? "opacity-70 hover:opacity-100" : ""
        }`}
      >
        <AgentMark
          shape={draft.agentShape}
          color={draft.agentColor}
          size="sm"
          title={draft.agentLabel}
          initial={draft.agentLabel}
        />
        {draft.anchorAt && (
          <span className="text-xs text-text-tertiary font-mono tabular-nums shrink-0 w-12">
            {formatTime(draft.anchorAt)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text-primary truncate">
            {draft.title?.trim() || "(untitled draft)"}
          </div>
          <div className="text-xs text-text-tertiary">
            <span>{draft.channel}</span>
            <span className="mx-1.5">·</span>
            <span>{draft.status}</span>
          </div>
        </div>
        <Badge variant={pTone} className="font-mono tabular-nums shrink-0">
          {pLabel}
        </Badge>
      </Link>
    </li>
  );
}

export default async function CalendarPage() {
  const session = await getSession();
  const bundle = await fetchCalendar();
  const todayKey = new Date().toISOString().slice(0, 10);

  const upcomingByDay = groupByDay(bundle.upcoming);
  const recentByDay = groupByDay(bundle.recent);

  // Sort day keys: upcoming ascending (today → +14), recent descending
  // (most recent first). This matches the operator's reading order:
  // upcoming = "what's about to ship", recent = "what just shipped".
  const upcomingDays = Array.from(upcomingByDay.keys()).sort();
  const recentDays = Array.from(recentByDay.keys()).sort().reverse();

  const totals = {
    upcoming: bundle.upcoming.length,
    recent: bundle.recent.length,
    unscheduled: bundle.unscheduled.length,
  };

  return (
    <AppShell title="calendar">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">
            calendar
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed">
            What&apos;s shipping when — every channel, every client. Today
            and the next 14 days at the top; the last 14 anchored below for
            context. Unscheduled approved drafts queue on the right.
          </p>
        </div>

        {session.activeCompanyId && (
          <ApproveWeekButton
            companyId={session.activeCompanyId}
            pendingCount={bundle.approveWeekPendingCount}
          />
        )}

        <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <span>
            <span className="font-mono tabular-nums text-text-primary">
              {totals.upcoming}
            </span>{" "}
            upcoming
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-mono tabular-nums text-text-primary">
              {totals.recent}
            </span>{" "}
            published last 14d
          </span>
          {totals.unscheduled > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-warning">
                  {totals.unscheduled}
                </span>{" "}
                approved but unscheduled
              </span>
            </>
          )}
        </div>

        {totals.upcoming === 0 &&
        totals.recent === 0 &&
        totals.unscheduled === 0 ? (
          <Card size="medium" tone="default">
            <p className="text-sm text-text-secondary leading-relaxed">
              No scheduled or recently published drafts in the workspace
              yet. Approve a draft from the inbox + set a{" "}
              <span className="font-mono">scheduledAt</span> to populate
              this view, or wait for the publish pipeline to move drafts
              through.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
            <div className="min-w-0 space-y-8" data-keyboard-list>
              {upcomingDays.length > 0 && (
                <section>
                  <div className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3 pb-1 border-b border-border-subtle">
                    upcoming
                  </div>
                  <div className="space-y-6">
                    {upcomingDays.map((day) => {
                      const items = upcomingByDay.get(day) ?? [];
                      return (
                        <section key={day}>
                          <div className="flex items-baseline gap-2 mb-2">
                            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide font-mono tabular-nums">
                              {formatDayHeader(day, todayKey)}
                            </h3>
                            <span className="text-xs text-text-tertiary font-mono tabular-nums">
                              {items.length}
                            </span>
                          </div>
                          <ul className="divide-y divide-border-subtle">
                            {items.map((d) => (
                              <DraftRow key={d.id} draft={d} />
                            ))}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                </section>
              )}

              {recentDays.length > 0 && (
                <section>
                  <div className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3 pb-1 border-b border-border-subtle">
                    recent
                  </div>
                  <div className="space-y-6">
                    {recentDays.map((day) => {
                      const items = recentByDay.get(day) ?? [];
                      return (
                        <section key={day}>
                          <div className="flex items-baseline gap-2 mb-2">
                            <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide font-mono tabular-nums">
                              {formatDayHeader(day, todayKey)}
                            </h3>
                            <span className="text-xs text-text-tertiary font-mono tabular-nums">
                              {items.length}
                            </span>
                          </div>
                          <ul className="divide-y divide-border-subtle">
                            {items.map((d) => (
                              <DraftRow key={d.id} draft={d} dimmed />
                            ))}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>

            {/* Unscheduled rail. Sticky on lg+ so the operator can scroll
                the calendar while keeping the loose-ends queue visible. */}
            <aside className="lg:sticky lg:top-4 lg:self-start">
              <Card size="medium" tone="default" className="flex flex-col">
                <CardHeader>
                  <CardLabel>unscheduled</CardLabel>
                  <Badge
                    variant={totals.unscheduled === 0 ? "default" : "warning"}
                    className="font-mono tabular-nums shrink-0"
                  >
                    {totals.unscheduled}
                  </Badge>
                </CardHeader>
                {bundle.unscheduled.length === 0 ? (
                  <p className="text-xs text-text-tertiary leading-relaxed">
                    No approved drafts waiting on a slot. The strategist
                    schedules at approval time when a calendar window is
                    available; rows here mean a window needs picking.
                  </p>
                ) : (
                  <ul className="divide-y divide-border-subtle -mx-4">
                    {bundle.unscheduled.slice(0, 6).map((d) => {
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
                                {d.channel}
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
                    {bundle.unscheduled.length > 6 && (
                      <li className="px-4 py-2 text-[11px] text-text-tertiary">
                        +{bundle.unscheduled.length - 6} more
                      </li>
                    )}
                  </ul>
                )}
              </Card>
            </aside>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">
            {totals.upcoming + totals.recent + totals.unscheduled} drafts on
            calendar
          </span>
          <span aria-hidden>·</span>
          <span>UTC · per-workspace TZ in /settings</span>
          <span className="md:ml-auto">
            drag-to-reschedule · in design
          </span>
        </div>
      </div>
    </AppShell>
  );
}
