// Bus-health tile — operator readout for the Redpanda + service mesh
// underneath the closed-loop pipeline. When this tile shows three
// green dots, the pipeline is delivering signal end-to-end. When any
// indicator goes red, the corresponding stage of the loop is
// degraded — surfaces the reason without anyone needing to ssh.
//
// Reads:
//   agent-langgraph        /producer/status  (publish_pipeline emitter)
//   performance-ingest     /producer/status  (metric/anomaly emitter)
//   bandit-orchestrator    /consumer/status  (auto-reward listener)
//
// Each stage shows enabled/connected + emit_count or consumed_count.
// Errors visible as a tertiary line so the root cause is one read away.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";

export interface BusStatus {
  // The HTTP-level status for our fetch attempt to the service. When
  // the proxy can't reach the service at all (timeout / refused) we
  // surface "unreachable" rather than the raw payload.
  reachable: boolean;
  // The service's own self-reported state. Only populated when
  // reachable=true.
  enabled?: boolean;
  // Optional counters from /producer/status. Pulled by name so the
  // tile renders cleanly across consumer + producer payload shapes.
  emitCount?: number;
  emitErrors?: number;
  consumedCount?: number;
  matchedCount?: number;
  handleErrors?: number;
}

export interface BusHealth {
  publishPipeline: BusStatus; // agent-langgraph producer
  performanceIngest: BusStatus; // performance-ingest producer
  banditConsumer: BusStatus; // bandit-orchestrator consumer
}

interface BusHealthTileProps {
  health: BusHealth;
}

function statusDotClass(s: BusStatus): string {
  if (!s.reachable) return "bg-status-danger";
  if (!s.enabled) return "bg-status-warning";
  if ((s.emitErrors ?? 0) > 0 || (s.handleErrors ?? 0) > 0) {
    return "bg-status-warning";
  }
  return "bg-status-success";
}

function statusVerb(s: BusStatus): string {
  if (!s.reachable) return "unreachable";
  if (!s.enabled) return "disabled";
  return "live";
}

function StageRow({
  label,
  status,
  countLabel,
  countValue,
  errorCount,
}: {
  label: string;
  status: BusStatus;
  countLabel: string;
  countValue: number | undefined;
  errorCount: number | undefined;
}) {
  const dot = statusDotClass(status);
  const verb = statusVerb(status);
  const errs = errorCount ?? 0;
  return (
    <li className="flex items-baseline justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span
          className={`h-2 w-2 rounded-full ${dot} shrink-0`}
          aria-hidden
        />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm text-text-primary truncate">{label}</span>
          <span className="text-xs text-text-tertiary font-mono tabular-nums">
            {verb}
            {status.reachable && status.enabled && countValue !== undefined && (
              <>
                {" · "}
                {countValue.toLocaleString("en-US")} {countLabel}
              </>
            )}
            {errs > 0 && (
              <>
                {" · "}
                <span className="text-status-warning">
                  {errs} {errs === 1 ? "error" : "errors"}
                </span>
              </>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

export function BusHealthTile({ health }: BusHealthTileProps) {
  // Aggregate status for the header badge: any unreachable → danger,
  // any disabled or with errors → warning, all live + clean → success.
  const all = [
    health.publishPipeline,
    health.performanceIngest,
    health.banditConsumer,
  ];
  const anyUnreachable = all.some((s) => !s.reachable);
  const anyDegraded = all.some(
    (s) =>
      s.reachable &&
      (!s.enabled ||
        (s.emitErrors ?? 0) > 0 ||
        (s.handleErrors ?? 0) > 0),
  );

  return (
    <Card size="medium" tone="default" className="flex flex-col">
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <CardLabel>bus health</CardLabel>
          <span className="text-xs text-text-tertiary">
            redpanda producers + bandit consumer
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              anyUnreachable
                ? "bg-status-danger"
                : anyDegraded
                  ? "bg-status-warning"
                  : "bg-status-success"
            }`}
            aria-label={
              anyUnreachable
                ? "one or more stages unreachable"
                : anyDegraded
                  ? "one or more stages degraded"
                  : "all stages live"
            }
          />
          <Link
            href="/system"
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
            aria-label="open system health"
          >
            details
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>

      <ul className="space-y-3 mt-2">
        <StageRow
          label="publish pipeline"
          status={health.publishPipeline}
          countLabel="emitted"
          countValue={health.publishPipeline.emitCount}
          errorCount={health.publishPipeline.emitErrors}
        />
        <StageRow
          label="performance ingest"
          status={health.performanceIngest}
          countLabel="emitted"
          countValue={health.performanceIngest.emitCount}
          errorCount={health.performanceIngest.emitErrors}
        />
        <StageRow
          label="bandit consumer"
          status={health.banditConsumer}
          countLabel="consumed"
          countValue={health.banditConsumer.consumedCount}
          errorCount={health.banditConsumer.handleErrors}
        />
      </ul>
    </Card>
  );
}
