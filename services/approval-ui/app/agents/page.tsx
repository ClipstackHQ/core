// /agents — agent directory.
//
// Doc 8 §11.7 — agents render as geometric AgentMarks (shape, color)
// instead of avatars. The same (shape, color) mapping shows up
// everywhere the agent appears, so the visual identity is stable
// across surfaces.
//
// This page is the read view: every agent the workspace has spawned,
// their job description (what the strategist + orchestrator route to
// them), current status (working / idle / blocked), and the tools
// they're allowed to call. Sorted: working first (the live action),
// then idle, then blocked.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { asc } from "drizzle-orm";

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

export const metadata: Metadata = {
  title: "Agents · Clipstack",
  description: "Every agent the workspace has spawned — roles, status, tools.",
};

// Same role→viz table the rest of the UI uses. Copied verbatim from
// app/page.tsx so the agent reads identically across Mission Control,
// the inbox, and this page. If either drifts, the same agent stops
// looking like the same agent.
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

interface AgentRow {
  id: string;
  role: string;
  displayName: string;
  jobDescription: string;
  status: AgentStatus;
  modelProfile: string;
  toolsAllowed: string[];
  shape: AgentMarkShape;
  color: AgentMarkColor;
}

const STATUS_ORDER: Record<AgentStatus, number> = {
  working: 0,
  idle: 1,
  blocked: 2,
  // 'error' and 'asleep' are AgentMark visual states that don't map onto
  // a DB-backed agent status today; surface them past blocked so they
  // sort to the bottom if a future state model adds them to the schema.
  error: 3,
  asleep: 4,
};

async function fetchAgents(): Promise<AgentRow[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  try {
    return await withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({
          id: agentsTable.id,
          role: agentsTable.role,
          displayName: agentsTable.displayName,
          jobDescription: agentsTable.jobDescription,
          status: agentsTable.status,
          modelProfile: agentsTable.modelProfile,
          toolsAllowed: agentsTable.toolsAllowed,
        })
        .from(agentsTable)
        .orderBy(asc(agentsTable.spawnedAt));
      return rows
        .map((r) => {
          const viz = AGENT_ROLE_VIZ[r.role] ?? {
            shape: "circle" as const,
            color: "slate" as const,
          };
          return {
            id: r.id,
            role: r.role,
            displayName: r.displayName,
            jobDescription: r.jobDescription,
            status: r.status as AgentStatus,
            modelProfile: r.modelProfile,
            toolsAllowed: r.toolsAllowed,
            shape: viz.shape,
            color: viz.color,
          };
        })
        .sort((a, b) => {
          // Status order first (working before idle before blocked), then
          // role for stable in-status ordering. Avoids re-shuffling on every
          // refresh just because the strategist quietly toggled idle→working.
          const sd = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          if (sd !== 0) return sd;
          return a.role.localeCompare(b.role);
        });
    });
  } catch (err) {
    console.error("[agents] fetchAgents failed", err);
    return [];
  }
}

const STATUS_TONE: Record<AgentStatus, "default" | "success" | "warning" | "danger"> = {
  working: "success",
  idle: "default",
  blocked: "danger",
  error: "danger",
  asleep: "default",
};

export default async function AgentsPage() {
  const agents = await fetchAgents();
  const counts = {
    total: agents.length,
    working: agents.filter((a) => a.status === "working").length,
    blocked: agents.filter((a) => a.status === "blocked").length,
  };

  return (
    <AppShell title="agents">
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
            agents
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed">
            Every agent the workspace has spawned. Working agents have
            something in flight; idle ones are waiting on a brief; blocked
            ones need human attention before the orchestrator can route
            new work to them.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <span>
            <span className="font-mono tabular-nums text-text-primary">
              {counts.total}
            </span>{" "}
            total
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-mono tabular-nums text-status-success">
              {counts.working}
            </span>{" "}
            working
          </span>
          {counts.blocked > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-danger">
                  {counts.blocked}
                </span>{" "}
                blocked
              </span>
            </>
          )}
        </div>

        {agents.length === 0 ? (
          <Card size="medium" tone="default">
            <div className="text-sm text-text-tertiary leading-relaxed">
              No agents spawned yet. Onboarding seeds the orchestrator + a
              starter pack of writer / QA / claim verifier agents.
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {agents.map((a) => (
              <Card key={a.id} size="medium" tone="default" className="flex flex-col">
                <CardHeader>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <AgentMark
                      shape={a.shape}
                      color={a.color}
                      status={a.status}
                      size="md"
                      title={a.displayName}
                      initial={a.displayName.charAt(0).toUpperCase()}
                    />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <CardLabel>{a.displayName}</CardLabel>
                      <span className="text-[11px] text-text-tertiary font-mono">
                        {a.role.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                  <Badge variant={STATUS_TONE[a.status]} className="shrink-0">
                    {a.status}
                  </Badge>
                </CardHeader>

                <p className="text-xs text-text-secondary leading-relaxed mt-1 line-clamp-4">
                  {a.jobDescription}
                </p>

                <div className="mt-3 pt-3 border-t border-border-subtle">
                  <div className="text-[10px] uppercase tracking-wide text-text-tertiary font-mono mb-1">
                    model
                  </div>
                  <div className="text-xs text-text-primary font-mono tabular-nums mb-2">
                    {a.modelProfile}
                  </div>
                  {a.toolsAllowed.length > 0 && (
                    <>
                      <div className="text-[10px] uppercase tracking-wide text-text-tertiary font-mono mb-1">
                        tools
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {a.toolsAllowed.map((tool) => (
                          <span
                            key={tool}
                            className="text-[10px] font-mono tabular-nums text-text-tertiary px-1.5 py-0.5 rounded border border-border-subtle"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-8 text-xs text-text-tertiary">
          Doc 8 §11.7 — agents read as (shape, color) marks. Hierarchy of
          interaction: only the orchestrator gets a chat dock; the rest are
          status-only.
        </div>
      </div>
    </AppShell>
  );
}
