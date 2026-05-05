// /studio — Studio asset library + render dashboard.
//
// First media-gen surface in core/. v1 ships the Hyperframes (HTML→MP4)
// path end-to-end; paid asset adapters (fal / Runway / Luma /
// Higgsfield) ship as Phase B of the media-gen sprint and surface
// here under their own filter chips.
//
// Server component for the shell + initial job list (SSR for fast
// first paint + correct seeded-data rendering). The render form is
// a client subcomponent (poll + submit). The page polls via the
// client form's useEffect; users can also refresh manually to
// re-fetch the list.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FilmIcon } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RenderForm } from "@/components/studio/RenderForm";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { artifacts } from "@/lib/db/schema/artifacts";

export const metadata: Metadata = {
  title: "Studio · Clipstack",
  description: "Generate video, image, and audio assets — HTML→MP4 today, fal / Runway / Luma / Higgsfield landing in Phase B.",
};

interface JobRow {
  id: string;
  title: string | null;
  prompt: string;
  status: string;
  source: string;
  mediaUrl: string | null;
  errorMessage: string | null;
  providerMeta: Record<string, unknown>;
  createdAt: Date;
  costUsd: number;
}

interface RuntimeProbe {
  ready: boolean;
  checks?: {
    node?: { ok: boolean; version: string; satisfies: boolean; want: string };
    ffmpeg?: { ok: boolean; version: string };
    npx?: { ok: boolean; version: string };
  };
}

async function fetchJobs(companyId: string): Promise<JobRow[]> {
  try {
    return await withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({
          id: artifacts.id,
          title: artifacts.title,
          prompt: artifacts.prompt,
          status: artifacts.status,
          source: artifacts.source,
          mediaUrl: artifacts.mediaUrl,
          errorMessage: artifacts.errorMessage,
          providerMeta: artifacts.providerMeta,
          createdAt: artifacts.createdAt,
          costUsd: artifacts.costUsd,
        })
        .from(artifacts)
        .where(and(eq(artifacts.companyId, companyId), eq(artifacts.source, "hyperframes")))
        .orderBy(desc(artifacts.createdAt))
        .limit(50);
      return rows.map((r) => ({
        ...r,
        providerMeta: (r.providerMeta ?? {}) as Record<string, unknown>,
      }));
    });
  } catch (err) {
    console.error("[studio] fetchJobs failed", err);
    return [];
  }
}

async function fetchRuntime(): Promise<RuntimeProbe> {
  try {
    const hdrs = await headers();
    const session = await getSession();
    const companyId = session.activeCompanyId;
    if (!companyId) return { ready: false };
    const host = hdrs.get("host") ?? "localhost:3000";
    const proto = hdrs.get("x-forwarded-proto") ?? "http";
    const url = `${proto}://${host}/api/companies/${companyId}/hyperframes/runtime`;
    const resp = await fetch(url, {
      headers: { cookie: hdrs.get("cookie") ?? "" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!resp.ok) return { ready: false };
    const data = (await resp.json()) as { data?: RuntimeProbe };
    return data.data ?? { ready: false };
  } catch (err) {
    console.error("[studio] fetchRuntime failed", err);
    return { ready: false };
  }
}

function formatRelative(d: Date): string {
  const elapsedMin = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60_000));
  if (elapsedMin < 1) return "just now";
  if (elapsedMin < 60) return `${elapsedMin}m ago`;
  const h = Math.floor(elapsedMin / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_TONE: Record<string, "default" | "success" | "warning" | "danger"> = {
  queued: "default",
  rendering: "warning",
  complete: "success",
  failed: "danger",
  archived: "default",
};

export default async function StudioPage() {
  const session = await getSession();
  const companyId = session.activeCompanyId;

  const [jobs, runtime] = await Promise.all([
    companyId ? fetchJobs(companyId) : Promise.resolve([] as JobRow[]),
    fetchRuntime(),
  ]);

  const counts = {
    total: jobs.length,
    rendering: jobs.filter((j) => j.status === "queued" || j.status === "rendering").length,
    complete: jobs.filter((j) => j.status === "complete").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };

  return (
    <AppShell title="studio">
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">
            studio
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed">
            Generate video, image, and audio assets. v1 ships the
            Hyperframes (HTML→MP4) path — local renderer, $0 per render,
            Apache-2.0. Paid providers (fal · Runway · Luma · Higgsfield ·
            ElevenLabs · Suno) land in Phase B with the cost-policy router
            picking between free composer paths and paid escalations.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <span>
            <span className="font-mono tabular-nums text-text-primary">
              {counts.total}
            </span>{" "}
            jobs
          </span>
          {counts.rendering > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-warning">
                  {counts.rendering}
                </span>{" "}
                rendering
              </span>
            </>
          )}
          {counts.complete > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-success">
                  {counts.complete}
                </span>{" "}
                complete
              </span>
            </>
          )}
          {counts.failed > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tabular-nums text-status-danger">
                  {counts.failed}
                </span>{" "}
                failed
              </span>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          {/* Left rail: render form + runtime probe */}
          <div className="space-y-4">
            {companyId && <RenderForm companyId={companyId} runtimeReady={runtime.ready} />}

            <Card size="medium" tone="default" className="flex flex-col">
              <CardHeader>
                <CardLabel>runtime</CardLabel>
                <span
                  className={`h-2 w-2 rounded-full ${
                    runtime.ready ? "bg-status-success" : "bg-status-warning"
                  }`}
                  aria-hidden
                />
              </CardHeader>
              <ul className="space-y-1.5 text-xs text-text-secondary">
                <li className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      runtime.checks?.node?.satisfies ? "bg-status-success" : "bg-status-warning"
                    }`}
                  />
                  <span className="font-mono tabular-nums text-text-primary">
                    Node {runtime.checks?.node?.version ?? "?"}
                  </span>
                  <span className="text-text-tertiary">
                    {runtime.checks?.node?.satisfies ? "✓" : `(want ${runtime.checks?.node?.want ?? "≥22"})`}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      runtime.checks?.ffmpeg?.ok ? "bg-status-success" : "bg-status-warning"
                    }`}
                  />
                  <span className="text-text-primary">ffmpeg</span>
                  <span className="text-text-tertiary truncate">
                    {runtime.checks?.ffmpeg?.ok
                      ? (runtime.checks.ffmpeg.version || "✓").slice(0, 40)
                      : "missing — brew install ffmpeg"}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      runtime.checks?.npx?.ok ? "bg-status-success" : "bg-status-warning"
                    }`}
                  />
                  <span className="text-text-primary">npx</span>
                  <span className="text-text-tertiary font-mono tabular-nums">
                    {runtime.checks?.npx?.ok ? runtime.checks.npx.version : "missing"}
                  </span>
                </li>
              </ul>
              {!runtime.ready && (
                <p className="mt-3 text-[11px] text-text-tertiary leading-relaxed">
                  Hyperframes is a CLI sidecar requiring Node 22+ + ffmpeg
                  + npx on the host. Most other Phase B providers (fal,
                  Runway, Luma, Higgsfield) hit external APIs and have no
                  local prerequisites — they ship without depending on
                  this probe.
                </p>
              )}
            </Card>

            <Card size="small" tone="default" className="flex flex-col">
              <CardHeader>
                <CardLabel>cost policy</CardLabel>
              </CardHeader>
              <ul className="space-y-1 text-xs text-text-secondary">
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-text-primary">Hyperframes</span>
                  <Badge variant="success" className="text-[10px]">FREE</Badge>
                </li>
                <li className="flex items-baseline justify-between gap-2 opacity-60">
                  <span>fal Seedance</span>
                  <Badge variant="warning" className="text-[10px]">METERED</Badge>
                </li>
                <li className="flex items-baseline justify-between gap-2 opacity-60">
                  <span>Runway Gen-3</span>
                  <Badge variant="warning" className="text-[10px]">METERED</Badge>
                </li>
                <li className="flex items-baseline justify-between gap-2 opacity-60">
                  <span>Luma Dream Machine</span>
                  <Badge variant="warning" className="text-[10px]">METERED</Badge>
                </li>
                <li className="flex items-baseline justify-between gap-2 opacity-60">
                  <span>Higgsfield Mix</span>
                  <Badge variant="warning" className="text-[10px]">METERED</Badge>
                </li>
              </ul>
              <p className="mt-2 text-[11px] text-text-tertiary leading-relaxed">
                FREE adapters run autonomously; METERED adapters need
                approval per call (Phase B + per-agent budget gate).
                Free composer paths preferred when the brief allows.
              </p>
            </Card>
          </div>

          {/* Right: jobs list */}
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 mb-3 pb-1 border-b border-border-subtle">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                recent renders
              </h2>
              <span className="text-xs text-text-tertiary">
                Hyperframes only · all sources land here when Phase B ships
              </span>
            </div>

            {jobs.length === 0 ? (
              <Card size="medium" tone="default">
                <div className="flex items-start gap-3">
                  <FilmIcon
                    className="h-5 w-5 text-text-tertiary mt-0.5 shrink-0"
                    aria-hidden
                  />
                  <div>
                    <p className="text-sm text-text-secondary leading-relaxed mb-2">
                      No renders yet. Submit a brief on the left to kick the
                      first one — typical render is 30-90 seconds.
                    </p>
                    <p className="text-xs text-text-tertiary leading-relaxed">
                      Renders land in the artifacts table (migration 0008)
                      and surface here, plus on the draft detail pane when
                      you associate them with a brief. Channel adapters
                      (Phase B sprint of the media-gen migration) pull
                      from this same library at publish time.
                    </p>
                  </div>
                </div>
              </Card>
            ) : (
              <ul className="space-y-3" data-keyboard-list>
                {jobs.map((job) => {
                  const meta = job.providerMeta as {
                    aspectRatio?: string;
                    durationSec?: number;
                    appliedStyleKey?: string;
                  };
                  return (
                    <li
                      key={job.id}
                      data-keyboard-row
                      className="rounded-md border border-border-subtle bg-bg-default px-4 py-3"
                    >
                      <div className="flex items-baseline gap-2 mb-2">
                        <Badge
                          variant={STATUS_TONE[job.status] ?? "default"}
                          className="font-mono tabular-nums shrink-0 text-[10px]"
                        >
                          {job.status}
                        </Badge>
                        <span className="text-xs text-text-tertiary font-mono">
                          {job.source}
                        </span>
                        {meta.aspectRatio && (
                          <span className="text-xs text-text-tertiary font-mono">
                            · {meta.aspectRatio}
                          </span>
                        )}
                        {typeof meta.durationSec === "number" && (
                          <span className="text-xs text-text-tertiary font-mono tabular-nums">
                            · {meta.durationSec}s
                          </span>
                        )}
                        <span className="ml-auto text-xs text-text-tertiary font-mono tabular-nums">
                          {formatRelative(job.createdAt)}
                        </span>
                      </div>

                      <p className="text-sm text-text-primary leading-relaxed mb-2 line-clamp-2">
                        {job.title || job.prompt}
                      </p>

                      {job.status === "complete" && job.mediaUrl && (
                        <div className="rounded border border-border-subtle overflow-hidden bg-black mt-2">
                          <video
                            src={job.mediaUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="w-full h-auto max-h-[480px] block"
                          />
                        </div>
                      )}

                      {job.status === "failed" && job.errorMessage && (
                        <p className="mt-2 text-[11px] text-status-danger font-mono leading-relaxed break-all">
                          {job.errorMessage}
                        </p>
                      )}

                      {(job.status === "queued" || job.status === "rendering") && (
                        <p className="mt-2 text-[11px] text-text-tertiary leading-relaxed">
                          {job.status === "queued"
                            ? "Queued — render starts in a few seconds."
                            : "Rendering — typical Hyperframes render is 30-90s. Page auto-refreshes when complete."}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-8 text-xs text-text-tertiary leading-relaxed">
          Source: Hyperframes (Apache-2.0 CLI sidecar). Paid asset
          adapters (fal · Runway · Luma · Higgsfield · ElevenLabs · Suno)
          ship in Phase B and surface as filter chips on this page.
          Channel adapters consume the artifacts library at publish time.
        </div>
      </div>
    </AppShell>
  );
}
