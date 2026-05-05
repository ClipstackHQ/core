// Doc 7 §2.1 agent activity stream tile. Pulse-animated when working.
// Doc 8 §11.7 — agents as geometric marks, not faces. Hierarchy-of-interaction
// rule: only the orchestrator gets a chat dock; this is just status.
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { AgentMark, type AgentMarkColor, type AgentMarkShape, type AgentStatus } from "@/components/AgentMark";

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

export function AgentActivityTile({ agents }: { agents: AgentActivity[] }) {
  const working = agents.filter((a) => a.status === "working").length;

  return (
    <Card size="medium" tone="default">
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <CardLabel>team</CardLabel>
          <span className="text-xs text-text-tertiary">
            <span className="font-mono tabular-nums text-text-primary">{working}</span>{" "}
            of {agents.length} working now
          </span>
        </div>
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
          aria-label="open agents directory"
        >
          all agents
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </CardHeader>

      <ul className="space-y-2">
        {agents.map((a) => (
          <li key={a.id} className="flex items-center gap-3">
            <AgentMark shape={a.shape} color={a.color} status={a.status} size="sm" initial={a.label[0]} title={a.label} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-text-primary truncate">{a.label}</div>
              <div className="text-xs text-text-tertiary truncate">
                {a.role}
                {a.recentAction && (
                  <>
                    <span className="mx-1.5">·</span>
                    <span>{a.recentAction}</span>
                  </>
                )}
              </div>
            </div>
            {typeof a.costThisWeek === "number" && (
              <span className="font-mono tabular-nums text-xs text-text-tertiary shrink-0">
                ${a.costThisWeek.toFixed(2)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
