// Doc 7 + USP 5 — institutional memory tile.
//
// The lessons-captured number is the moat readout. Every blocked draft,
// every human override, every drift detection that the team caught
// gets persisted as a row in `company_lessons` with a rationale + scope
// (forever | this_topic | this_client). Those lessons feed back into
// the Strategist's brief generation via the recall_lessons cosine
// retrieval — every new piece is anchored in what the team has
// already learned.
//
// The "this week" delta is what makes it interesting over time:
// workspaces accumulate institutional knowledge that compounds. A
// stagnant number = the team isn't capturing what it learns; a
// growing number = the moat is widening.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";

export interface LessonStats {
  totalCount: number;
  thisWeekCount: number;
  clientScopedCount: number;
}

interface InstitutionalMemoryTileProps {
  stats: LessonStats;
}

export function InstitutionalMemoryTile({ stats }: InstitutionalMemoryTileProps) {
  return (
    <Card size="medium" tone="accent" className="flex flex-col">
      <CardHeader>
        <CardLabel>institutional memory</CardLabel>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-tertiary font-mono tabular-nums">
            live
          </span>
          <Link
            href="/memory"
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
            aria-label="open lessons archive"
          >
            browse
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <div className="space-y-2 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="font-mono tabular-nums text-2xl font-semibold text-text-primary leading-none">
            {stats.totalCount.toLocaleString("en-US")}
          </span>
          <span className="text-xs text-text-tertiary">
            lesson{stats.totalCount === 1 ? "" : "s"} captured
          </span>
        </div>
        <div className="text-xs text-text-tertiary">
          {stats.thisWeekCount > 0 ? (
            <>
              <span className="font-mono tabular-nums text-status-success">
                +{stats.thisWeekCount}
              </span>{" "}
              this week
            </>
          ) : (
            <span className="text-text-tertiary">no new lessons this week</span>
          )}
          {stats.clientScopedCount > 0 && (
            <>
              {" · "}
              <span className="font-mono tabular-nums">
                {stats.clientScopedCount}
              </span>{" "}
              client-specific tone exception
              {stats.clientScopedCount === 1 ? "" : "s"}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
