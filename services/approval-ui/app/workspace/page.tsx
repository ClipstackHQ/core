// /workspace — workspace at a glance.
//
// Doc 7 §6 originally framed this as the brand-kit composition surface:
// voice exemplars, banned words, glossary, per-client tone overrides.
// The schema for those surfaces lands with brand_kits in a follow-up
// slice (the column exists on companies.brand_kit_id; the table itself
// is parked behind /settings → brand kit). This page is the v1
// stand-in: a workspace identity dashboard that surfaces what every
// other surface composes off — name, type, ui mode, agent roster,
// editorial voice (read out via top lessons), recent activity.
//
// Why not punt to the stub: a workspace dashboard is the natural
// landing for "where am I, what's my workspace look like" — every
// design partner's first instinct. Putting real data here turns the
// nav entry from a placeholder into the workspace's home page.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AgentMark,
  type AgentMarkColor,
  type AgentMarkShape,
  type AgentStatus,
} from "@/components/AgentMark";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { agents as agentsTable } from "@/lib/db/schema/agents";
import { brandKits } from "@/lib/db/schema/brand-kits";
import { companies } from "@/lib/db/schema/companies";
import { companyLessons } from "@/lib/db/schema/lessons";
import { drafts } from "@/lib/db/schema/drafts";
import { BrandKitImporter } from "@/components/workspace/BrandKitImporter";

export const metadata: Metadata = {
  title: "Workspace · Clipstack",
  description: "Workspace at a glance — identity, voice, roster, activity.",
};

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

interface WorkspaceSnapshot {
  name: string;
  type: string;
  uiMode: string;
  slug: string | null;
  website: string | null;
  activeRegimes: string[];
  // Counters — populated from a single triple-aggregate per table.
  agentCount: number;
  agentsWorking: number;
  draftCount: number;
  draftsAwaitingApproval: number;
  draftsLast7d: number;
  lessonCount: number;
  lessonsForever: number;
  lessonsThisTopic: number;
  lessonsThisClient: number;
  // Voice score average across drafts that have one set.
  voiceScoreAvg: number | null;
  // Top agents (preview of /agents).
  topAgents: Array<{
    id: string;
    role: string;
    displayName: string;
    status: AgentStatus;
    shape: AgentMarkShape;
    color: AgentMarkColor;
  }>;
  // Top lessons (preview of /memory).
  topLessons: Array<{
    id: string;
    rationale: string;
    scope: string;
    topicTags: string[];
  }>;
  // Active brand kit (when one's saved). Drives the BrandKitImporter
  // existing-state surface so the user sees their saved kit at a glance.
  brandKit: {
    primaryColor: string | null;
    secondaryColor: string | null;
    accentColor: string | null;
    fontPrimary: string | null;
    sourceUrl: string | null;
  } | null;
}

const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  name: "—",
  type: "in_house",
  uiMode: "web2",
  slug: null,
  website: null,
  activeRegimes: [],
  agentCount: 0,
  agentsWorking: 0,
  draftCount: 0,
  draftsAwaitingApproval: 0,
  draftsLast7d: 0,
  lessonCount: 0,
  lessonsForever: 0,
  lessonsThisTopic: 0,
  lessonsThisClient: 0,
  voiceScoreAvg: null,
  topAgents: [],
  topLessons: [],
  brandKit: null,
};

async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return EMPTY_SNAPSHOT;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    return await withTenant(companyId, async (tx) => {
      const [companyRow, agentStats, lessonStats, draftStats, agentList, lessonList, brandKitRow] =
        await Promise.all([
          tx
            .select({
              name: companies.name,
              type: companies.type,
              uiMode: companies.uiMode,
              activeRegimes: companies.activeRegimes,
              contextJson: companies.contextJson,
            })
            .from(companies)
            .where(eq(companies.id, companyId))
            .limit(1),
          tx
            .select({
              total: count(),
              working: sql<number>`COUNT(*) FILTER (WHERE ${agentsTable.status} = 'working')`,
            })
            .from(agentsTable),
          tx
            .select({
              total: count(),
              forever: sql<number>`COUNT(*) FILTER (WHERE ${companyLessons.scope} = 'forever')`,
              thisTopic: sql<number>`COUNT(*) FILTER (WHERE ${companyLessons.scope} = 'this_topic')`,
              thisClient: sql<number>`COUNT(*) FILTER (WHERE ${companyLessons.scope} = 'this_client')`,
            })
            .from(companyLessons),
          tx
            .select({
              total: count(),
              awaiting: sql<number>`COUNT(*) FILTER (WHERE ${drafts.status} = 'awaiting_approval')`,
              // ISO + ::timestamptz to bind reliably (the silent-fail SQL
              // class fix from commit 2149e45). Last-7d is the freshness
              // window every other surface uses.
              last7d: sql<number>`COUNT(*) FILTER (WHERE ${drafts.createdAt} >= ${sevenDaysAgo}::timestamptz)`,
              voiceAvg: sql<number | null>`AVG(${drafts.voiceScore}) FILTER (WHERE ${drafts.voiceScore} IS NOT NULL)`,
            })
            .from(drafts),
          tx
            .select({
              id: agentsTable.id,
              role: agentsTable.role,
              displayName: agentsTable.displayName,
              status: agentsTable.status,
            })
            .from(agentsTable)
            .orderBy(agentsTable.spawnedAt)
            .limit(6),
          tx
            .select({
              id: companyLessons.id,
              rationale: companyLessons.rationale,
              scope: companyLessons.scope,
              topicTags: companyLessons.topicTags,
            })
            .from(companyLessons)
            .where(eq(companyLessons.scope, "forever"))
            .orderBy(desc(companyLessons.capturedAt))
            .limit(4),
          // Active brand kit (the unique-per-company row). Limit 1
          // because the schema's uniqueIndex enforces single-active.
          tx
            .select({
              primaryColor: brandKits.primaryColor,
              secondaryColor: brandKits.secondaryColor,
              accentColor: brandKits.accentColor,
              fontPrimary: brandKits.fontPrimary,
              sourceUrl: brandKits.sourceUrl,
            })
            .from(brandKits)
            .where(eq(brandKits.companyId, companyId))
            .limit(1),
        ]);

      const company = companyRow[0];
      const ctx = (company?.contextJson ?? {}) as Record<string, unknown>;
      const slug = typeof ctx.slug === "string" ? ctx.slug : null;
      const website = typeof ctx.website === "string" ? ctx.website : null;

      const ag = agentStats[0];
      const ls = lessonStats[0];
      const ds = draftStats[0];

      return {
        name: company?.name ?? "—",
        type: company?.type ?? "in_house",
        uiMode: company?.uiMode ?? "web2",
        slug,
        website,
        activeRegimes: company?.activeRegimes ?? [],
        agentCount: Number(ag?.total ?? 0),
        agentsWorking: Number(ag?.working ?? 0),
        draftCount: Number(ds?.total ?? 0),
        draftsAwaitingApproval: Number(ds?.awaiting ?? 0),
        draftsLast7d: Number(ds?.last7d ?? 0),
        lessonCount: Number(ls?.total ?? 0),
        lessonsForever: Number(ls?.forever ?? 0),
        lessonsThisTopic: Number(ls?.thisTopic ?? 0),
        lessonsThisClient: Number(ls?.thisClient ?? 0),
        voiceScoreAvg: ds?.voiceAvg !== null && ds?.voiceAvg !== undefined
          ? Number(ds.voiceAvg)
          : null,
        topAgents: agentList.map((a) => {
          const viz = AGENT_ROLE_VIZ[a.role] ?? {
            shape: "circle" as const,
            color: "slate" as const,
          };
          return {
            id: a.id,
            role: a.role,
            displayName: a.displayName,
            status: a.status as AgentStatus,
            shape: viz.shape,
            color: viz.color,
          };
        }),
        topLessons: lessonList,
        brandKit: brandKitRow[0] ?? null,
      };
    });
  } catch (err) {
    console.error("[workspace] fetchWorkspace failed", err);
    return EMPTY_SNAPSHOT;
  }
}

const COMPANY_TYPE_LABEL: Record<string, string> = {
  agency: "Agency — manages multiple clients",
  in_house: "In-house — one brand, one team",
  agency_client: "Client of an agency",
};

const UI_MODE_LABEL: Record<string, string> = {
  web2: "Web2 — fiat + Stripe",
  web3: "Web3 — USDC + on-chain settlement",
};

export default async function WorkspacePage() {
  const ws = await fetchWorkspace();

  return (
    <AppShell title="workspace">
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
            {ws.name}
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed">
            Workspace at a glance — identity, agent roster, codified voice,
            and recent activity. The full brand-kit composition surface
            (voice exemplars, banned words, glossary) lands as a follow-up
            slice anchored on{" "}
            <span className="font-mono">companies.brand_kit_id</span>.
          </p>
        </div>

        {/* Identity strip — type, mode, slug, website. Lightweight; the
            heavy reading happens in the cards below. */}
        <div className="mb-8 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <span>
            type:{" "}
            <span className="text-text-primary">
              {COMPANY_TYPE_LABEL[ws.type] ?? ws.type}
            </span>
          </span>
          <span aria-hidden>·</span>
          <span>
            mode:{" "}
            <span className="text-text-primary">
              {UI_MODE_LABEL[ws.uiMode] ?? ws.uiMode}
            </span>
          </span>
          {ws.slug && (
            <>
              <span aria-hidden>·</span>
              <span>
                slug:{" "}
                <span className="font-mono text-text-primary">{ws.slug}</span>
              </span>
            </>
          )}
          {ws.website && (
            <>
              <span aria-hidden>·</span>
              <span>
                site:{" "}
                <a
                  href={ws.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-500 hover:underline"
                >
                  {ws.website.replace(/^https?:\/\//, "")}
                </a>
              </span>
            </>
          )}
          {ws.activeRegimes.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                regimes:{" "}
                <span className="font-mono text-text-primary">
                  {ws.activeRegimes.join(", ")}
                </span>
              </span>
            </>
          )}
        </div>

        {/* Stat row — 4 counters that link out. Same compact card shape
            so the eye reads them as a single dashboard strip. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <Card size="medium" tone="default" className="flex flex-col">
            <CardHeader>
              <CardLabel>agents</CardLabel>
              <Link
                href="/agents"
                className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
              >
                roster
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-2xl font-semibold text-text-primary leading-none">
                {ws.agentCount}
              </span>
              <span className="text-xs text-text-tertiary">total</span>
            </div>
            <div className="text-xs text-text-tertiary mt-1">
              <span className="font-mono tabular-nums text-status-success">
                {ws.agentsWorking}
              </span>{" "}
              working now
            </div>
          </Card>

          <Card size="medium" tone="default" className="flex flex-col">
            <CardHeader>
              <CardLabel>drafts</CardLabel>
              <Link
                href="/inbox"
                className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
              >
                inbox
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-2xl font-semibold text-text-primary leading-none">
                {ws.draftCount}
              </span>
              <span className="text-xs text-text-tertiary">total</span>
            </div>
            <div className="text-xs text-text-tertiary mt-1">
              <span className="font-mono tabular-nums text-status-warning">
                {ws.draftsAwaitingApproval}
              </span>{" "}
              awaiting · {ws.draftsLast7d} last 7d
            </div>
          </Card>

          <Card size="medium" tone="accent" className="flex flex-col">
            <CardHeader>
              <CardLabel>lessons</CardLabel>
              <Link
                href="/memory"
                className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
              >
                browse
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-2xl font-semibold text-text-primary leading-none">
                {ws.lessonCount}
              </span>
              <span className="text-xs text-text-tertiary">captured</span>
            </div>
            <div className="text-xs text-text-tertiary mt-1">
              <span className="font-mono tabular-nums">{ws.lessonsForever}</span>{" "}
              forever ·{" "}
              <span className="font-mono tabular-nums">{ws.lessonsThisTopic}</span>{" "}
              topic ·{" "}
              <span className="font-mono tabular-nums">{ws.lessonsThisClient}</span>{" "}
              client
            </div>
          </Card>

          <Card size="medium" tone="default" className="flex flex-col">
            <CardHeader>
              <CardLabel>voice score</CardLabel>
              <Link
                href="/performance"
                className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
              >
                history
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-2xl font-semibold text-text-primary leading-none">
                {ws.voiceScoreAvg === null ? "—" : ws.voiceScoreAvg.toFixed(2)}
              </span>
              <span className="text-xs text-text-tertiary">avg</span>
            </div>
            <div className="text-xs text-text-tertiary mt-1">
              cosine vs voice corpus · 0–1 scale
            </div>
          </Card>
        </div>

        {/* Two-column lower body: voice rules (codified lessons in the
            forever scope = your editorial bible) on the left, agent
            roster preview on the right. Both link to deeper surfaces. */}
        {/* Brand-kit importer — the "brand in at nine" wedge. Lives above
            the editorial-voice column because typing a URL is the first
            thing a new workspace owner does. Existing kit summary surfaces
            inside the card when one's already saved. */}
        {(await getSession()).activeCompanyId && (
          <div className="mb-6">
            <BrandKitImporter
              companyId={(await getSession()).activeCompanyId!}
              existing={ws.brandKit}
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section>
            <div className="flex items-baseline gap-2 mb-3 pb-1 border-b border-border-subtle">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                editorial voice
              </h2>
              <span className="text-xs text-text-tertiary">
                top forever-scope lessons
              </span>
              <Link
                href="/memory"
                className="ml-auto inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
              >
                all lessons
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            {ws.topLessons.length === 0 ? (
              <Card size="medium" tone="default">
                <p className="text-sm text-text-tertiary leading-relaxed">
                  No forever-scope lessons captured yet. Deny a draft with
                  a structured rationale and it lands here as part of the
                  workspace&apos;s codified voice.
                </p>
              </Card>
            ) : (
              <ul className="space-y-2">
                {ws.topLessons.map((lesson) => (
                  <li
                    key={lesson.id}
                    className="rounded-md border border-border-subtle bg-bg-default px-4 py-3"
                  >
                    <p className="text-sm text-text-primary leading-relaxed mb-2">
                      {lesson.rationale}
                    </p>
                    {lesson.topicTags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {lesson.topicTags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] font-mono tabular-nums text-text-tertiary px-1.5 py-0.5 rounded border border-border-subtle"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="flex items-baseline gap-2 mb-3 pb-1 border-b border-border-subtle">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                agent roster
              </h2>
              <span className="text-xs text-text-tertiary">
                first {Math.min(ws.topAgents.length, 6)} of {ws.agentCount}
              </span>
              <Link
                href="/agents"
                className="ml-auto inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
              >
                full roster
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            {ws.topAgents.length === 0 ? (
              <Card size="medium" tone="default">
                <p className="text-sm text-text-tertiary leading-relaxed">
                  No agents spawned. Onboarding seeds the orchestrator + a
                  starter pack of writer / QA / claim-verifier agents.
                </p>
              </Card>
            ) : (
              <ul className="space-y-2">
                {ws.topAgents.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-md border border-border-subtle bg-bg-default px-4 py-3 flex items-center gap-3"
                  >
                    <AgentMark
                      shape={a.shape}
                      color={a.color}
                      status={a.status}
                      size="md"
                      title={a.displayName}
                      initial={a.displayName.charAt(0).toUpperCase()}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text-primary truncate">
                        {a.displayName}
                      </div>
                      <div className="text-xs text-text-tertiary font-mono">
                        {a.role.replace(/_/g, " ")}
                      </div>
                    </div>
                    <Badge
                      variant={
                        a.status === "working"
                          ? "success"
                          : a.status === "blocked"
                            ? "danger"
                            : "default"
                      }
                      className="shrink-0"
                    >
                      {a.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="mt-8 text-xs text-text-tertiary leading-relaxed">
          Brand-kit composition (voice exemplars, banned words, glossary,
          per-client tone overrides) lands in a follow-up slice on the{" "}
          <span className="font-mono">brand_kits</span> table referenced by{" "}
          <span className="font-mono">companies.brand_kit_id</span>. Until
          then the editorial-voice column reads off forever-scope lessons.
        </div>
      </div>
    </AppShell>
  );
}
