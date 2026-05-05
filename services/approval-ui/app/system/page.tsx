// /system — service + bus health.
//
// Mission Control's BusHealthTile is the operator pulse: three dots that
// summarise the closed-loop status. This page is the detail view —
// every service the platform reaches, with its own health probe, latency,
// counters, and any structured errors the producer/consumer surfaces.
//
// Reads the same /api/health/services aggregator the BusHealthTile uses,
// then renders per-service rows with full context. Refreshes on page
// load (no polling here — refresh = browser refresh, by design; we don't
// want a background fetcher consuming bandwidth on a tab the user left
// open all day).

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "System · Clipstack",
  description: "Service + bus health. Operator readout for the closed-loop pipeline.",
};

// Matches the envelope shape /api/health/services returns. Each entry
// represents one upstream service the approval-ui proxies to.
interface ServiceHealth {
  name: string;
  url: string | null;
  reachable: boolean;
  latencyMs: number | null;
  status?: string;
  enabled?: boolean;
  emitCount?: number;
  emitErrors?: number;
  consumedCount?: number;
  matchedCount?: number;
  handleErrors?: number;
  error?: string;
  // Optional human description so this page reads even before the
  // user knows every service abbreviation.
  description?: string;
}

interface ServiceGroup {
  label: string;
  description: string;
  services: ServiceHealth[];
}

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  "agent-langgraph":
    "Publish pipeline orchestrator. Runs the 8-node state graph that takes a brief from review through human approval to bandit allocation and channel publish.",
  "performance-ingest":
    "Metrics collector. Computes per-workspace percentile + velocity from raw snapshots and emits content.metric_update + content.anomaly events.",
  "bandit-orchestrator":
    "Thompson-sampling allocator. Subscribes to content.metric_update and applies posteriors to the workspace's live bandits in-process.",
  "percentile-predictor":
    "Pre-publish percentile prediction. Per-workspace × KPI LightGBM model retrained nightly on every published artifact.",
  "voice-scorer":
    "Voice cosine-similarity scorer. Per-workspace voice corpus indexed in Qdrant; scores every draft before approval against the workspace's own voice.",
  "pii-detection":
    "Presidio analyzer with custom recognizers (crypto wallet, API key). Scrubs every draft + every audit row before persistence.",
  "output-moderation":
    "Llama Guard 3 verdict against the workspace policy. Conservative-fallback when model emits unsafe without categories.",
  "agent-crewai":
    "Agent runner. Hosts the 8-role content_factory crew + 5 real-time crews (devil's advocate, claim verifier, trend detector, algorithm probe, live event monitor).",
};

async function fetchHealth(): Promise<ServiceHealth[]> {
  // Server component → fetch our own /api/health/services. Build the URL
  // from the incoming request's host header so it works equally in dev
  // (localhost:3000), preview deploys, and production.
  try {
    const hdrs = await headers();
    const host = hdrs.get("host") ?? "localhost:3000";
    const proto = hdrs.get("x-forwarded-proto") ?? "http";
    const url = `${proto}://${host}/api/health/services`;
    const resp = await fetch(url, {
      // Forward the cookie so the API route's auth resolves cleanly.
      headers: { cookie: hdrs.get("cookie") ?? "" },
      // Generous timeout — any individual service probe inside the
      // aggregator already has its own 2s budget; the aggregator runs
      // them in parallel so the page should be back in <3s.
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!resp.ok) {
      console.error("[system] health endpoint non-200", resp.status);
      return [];
    }
    const payload = (await resp.json()) as {
      services?: ServiceHealth[];
    };
    return payload.services ?? [];
  } catch (err) {
    console.error("[system] fetchHealth failed", err);
    return [];
  }
}

function statusTone(s: ServiceHealth): "success" | "warning" | "danger" | "default" {
  if (!s.reachable) return "danger";
  if (s.enabled === false) return "warning";
  if ((s.emitErrors ?? 0) > 0 || (s.handleErrors ?? 0) > 0) return "warning";
  return "success";
}

function statusLabel(s: ServiceHealth): string {
  if (!s.reachable) return "unreachable";
  if (s.enabled === false) return "disabled";
  if ((s.emitErrors ?? 0) > 0 || (s.handleErrors ?? 0) > 0) return "degraded";
  return "live";
}

export default async function SystemPage() {
  const services = await fetchHealth();

  // Group services by tier so the page reads as a stack: closed-loop bus
  // first (the visible heart), then the model + scoring services, then
  // the safety surfaces. Order is intentional — the operator scans
  // top-to-bottom and gets the most-critical state first.
  const groups: ServiceGroup[] = [
    {
      label: "Closed-loop bus",
      description:
        "The three services that move signal end-to-end. When all three are green the pipeline is delivering: drafts publish, metrics flow back, bandits learn.",
      services: services.filter((s) =>
        ["agent-langgraph", "performance-ingest", "bandit-orchestrator"].includes(s.name),
      ),
    },
    {
      label: "Models + scoring",
      description:
        "Per-workspace ML — predicts performance pre-publish, scores voice fidelity, and routes the strategist's brief through the 8-role agent crew.",
      services: services.filter((s) =>
        ["percentile-predictor", "voice-scorer", "agent-crewai"].includes(s.name),
      ),
    },
    {
      label: "Safety + compliance",
      description:
        "Every draft + every audit row passes through PII detection and output moderation before it reaches storage or the publish path.",
      services: services.filter((s) =>
        ["pii-detection", "output-moderation"].includes(s.name),
      ),
    },
  ];
  // Catch-all bucket so a future service we forget to categorize still
  // renders on this page rather than silently disappearing.
  const known = new Set(groups.flatMap((g) => g.services.map((s) => s.name)));
  const orphans = services.filter((s) => !known.has(s.name));
  if (orphans.length > 0) {
    groups.push({
      label: "Other",
      description: "Services not yet sorted into the canonical tiers.",
      services: orphans,
    });
  }

  const total = services.length;
  const live = services.filter((s) => statusTone(s) === "success").length;
  const down = services.filter((s) => statusTone(s) === "danger").length;
  const degraded = services.filter((s) => statusTone(s) === "warning").length;

  return (
    <AppShell title="system">
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
            system health
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed">
            Live readout from every service the platform reaches. Each row
            shows the probe latency, the producer/consumer counters, and
            any errors the service has surfaced. Refresh the page to
            re-poll.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <span>
            <span className="font-mono tabular-nums text-text-primary">
              {total}
            </span>{" "}
            services
          </span>
          {live > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-success">
                  {live}
                </span>{" "}
                live
              </span>
            </>
          )}
          {degraded > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-warning">
                  {degraded}
                </span>{" "}
                degraded
              </span>
            </>
          )}
          {down > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-danger">
                  {down}
                </span>{" "}
                down
              </span>
            </>
          )}
        </div>

        {services.length === 0 ? (
          <Card size="medium" tone="default">
            <div className="text-sm text-text-tertiary leading-relaxed">
              The health aggregator returned no services. Either the
              upstream services aren&apos;t running locally (start the
              docker-compose stack with{" "}
              <span className="font-mono">docker compose up</span>) or the
              aggregator itself is failing — check the server logs for{" "}
              <span className="font-mono">[api/health/services]</span>.
            </div>
          </Card>
        ) : (
          <div className="space-y-8">
            {groups
              .filter((g) => g.services.length > 0)
              .map((group) => (
                <section key={group.label}>
                  <div className="mb-3 pb-1 border-b border-border-subtle">
                    <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-0.5">
                      {group.label}
                    </h2>
                    <p className="text-xs text-text-tertiary leading-relaxed">
                      {group.description}
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {group.services.map((s) => (
                      <li
                        key={s.name}
                        className="rounded-md border border-border-subtle bg-bg-default px-4 py-3"
                      >
                        <div className="flex items-baseline gap-3 mb-1.5">
                          <span className="font-mono tabular-nums text-sm text-text-primary truncate">
                            {s.name}
                          </span>
                          <Badge
                            variant={statusTone(s)}
                            className="font-mono tabular-nums shrink-0 text-[10px]"
                          >
                            {statusLabel(s)}
                          </Badge>
                          {s.latencyMs !== null && s.latencyMs !== undefined && (
                            <span className="text-xs text-text-tertiary font-mono tabular-nums ml-auto shrink-0">
                              {s.latencyMs}ms
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-tertiary leading-relaxed mb-2">
                          {SERVICE_DESCRIPTIONS[s.name] ??
                            s.description ??
                            "No description registered."}
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-text-tertiary font-mono tabular-nums">
                          {s.url && <span>url: {s.url}</span>}
                          {s.emitCount !== undefined && (
                            <span>emit: {s.emitCount.toLocaleString("en-US")}</span>
                          )}
                          {s.consumedCount !== undefined && (
                            <span>
                              consumed: {s.consumedCount.toLocaleString("en-US")}
                            </span>
                          )}
                          {s.matchedCount !== undefined && (
                            <span>
                              matched: {s.matchedCount.toLocaleString("en-US")}
                            </span>
                          )}
                          {(s.emitErrors ?? 0) > 0 && (
                            <span className="text-status-warning">
                              emit errors: {s.emitErrors}
                            </span>
                          )}
                          {(s.handleErrors ?? 0) > 0 && (
                            <span className="text-status-warning">
                              handle errors: {s.handleErrors}
                            </span>
                          )}
                        </div>
                        {s.error && (
                          <div className="mt-2 text-[11px] text-status-danger font-mono leading-relaxed break-all">
                            {s.error}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}

        <div className="mt-8 text-xs text-text-tertiary">
          Source: <span className="font-mono">/api/health/services</span> ·
          aggregates per-service /producer/status and /consumer/status probes.
        </div>
      </div>
    </AppShell>
  );
}
