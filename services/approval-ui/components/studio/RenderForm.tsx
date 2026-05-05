// Studio render form — client component.
//
// The Studio page is a server component (initial job list + runtime
// state via SSR), but the render form needs client-side interactivity:
// submit POST → poll GET /jobs every 3s until the new job's status
// flips out of queued/rendering. This component owns that loop.
//
// Why polling vs SSE / Redpanda: the v1 Studio is single-tenant, single-
// instance, and Hyperframes renders complete in 30-90s. A polling loop
// is correct for that scale; SSE/event-bus comes when the Studio
// grows into a multi-tenant render queue (Phase B of the media-gen
// migration).

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2 } from "lucide-react";

import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface RenderFormProps {
  companyId: string;
  runtimeReady: boolean;
}

interface RenderResponse {
  jobId?: string;
  status?: string;
}

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 — landscape (LinkedIn, blog header)" },
  { value: "9:16", label: "9:16 — vertical (TikTok, Reels, Stories)" },
  { value: "1:1", label: "1:1 — square (Instagram feed, X)" },
  { value: "4:5", label: "4:5 — tall (Instagram feed, LinkedIn)" },
] as const;

export function RenderForm({ companyId, runtimeReady }: RenderFormProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [prompt, setPrompt] = useState("");
  const [durationSec, setDurationSec] = useState(10);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1" | "4:5">("16:9");

  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Poll for the active job's status. The interval is cleared when the
  // job's status flips out of queued/rendering, or when the user
  // submits a new render (which resets activeJobId).
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const resp = await fetch(`/api/companies/${companyId}/hyperframes/jobs`, {
          // No-cache so the router doesn't serve stale lists during the poll.
          cache: "no-store",
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as { data?: { jobs?: Array<{ id: string; status: string }> } };
        const job = data.data?.jobs?.find((j) => j.id === activeJobId);
        if (job && (job.status === "complete" || job.status === "failed")) {
          cancelled = true;
          setActiveJobId(null);
          // Re-render the SSR list with the new state.
          startTransition(() => router.refresh());
          return;
        }
      } catch {
        /* transient — keep polling */
      }
    };
    const id = setInterval(tick, 3000);
    // Fire one immediately so the user gets a quick "rendering" badge.
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeJobId, companyId, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!prompt.trim()) {
      setErrorMsg("Add a brief — what's the scene about?");
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/companies/${companyId}/hyperframes/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), durationSec, aspectRatio }),
      });
      const data = (await resp.json()) as { data?: RenderResponse; error?: { message?: string } };
      if (!resp.ok) {
        setErrorMsg(data.error?.message ?? `Render request failed (HTTP ${resp.status})`);
        return;
      }
      const jobId = data.data?.jobId ?? null;
      if (jobId) {
        setActiveJobId(jobId);
        setPrompt("");
        // Refresh the SSR job list immediately so the new "queued" row appears.
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card size="medium" tone="default" className="flex flex-col">
      <CardHeader>
        <CardLabel>render scene</CardLabel>
        <Badge
          variant={runtimeReady ? "success" : "warning"}
          className="font-mono tabular-nums shrink-0 text-[10px]"
        >
          {runtimeReady ? "runtime ready" : "runtime missing prerequisites"}
        </Badge>
      </CardHeader>

      {!runtimeReady && (
        <p className="text-xs text-status-warning leading-relaxed mb-3">
          The host environment is missing one or more Hyperframes
          prerequisites (Node ≥ 22, ffmpeg, npx). The form below stays
          enabled so you can preview the workflow, but submitting will
          fail until prerequisites are installed. Check the Runtime
          panel for specifics.
        </p>
      )}

      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="prompt"
            className="block text-xs text-text-secondary uppercase tracking-wide font-mono mb-1"
          >
            brief
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A 10-second LinkedIn announcement: headline → key stat → call-to-action."
            disabled={submitting || activeJobId !== null}
            className="w-full min-h-[88px] rounded-md border border-border-subtle bg-bg-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500 resize-y"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="durationSec"
              className="block text-xs text-text-secondary uppercase tracking-wide font-mono mb-1"
            >
              duration
            </label>
            <select
              id="durationSec"
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value))}
              disabled={submitting || activeJobId !== null}
              className="w-full rounded-md border border-border-subtle bg-bg-default px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500 font-mono tabular-nums"
            >
              {[5, 10, 15, 30, 60].map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="aspectRatio"
              className="block text-xs text-text-secondary uppercase tracking-wide font-mono mb-1"
            >
              aspect
            </label>
            <select
              id="aspectRatio"
              value={aspectRatio}
              onChange={(e) =>
                setAspectRatio(e.target.value as "16:9" | "9:16" | "1:1" | "4:5")
              }
              disabled={submitting || activeJobId !== null}
              className="w-full rounded-md border border-border-subtle bg-bg-default px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500 font-mono"
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {errorMsg && (
          <p className="text-xs text-status-danger leading-relaxed" role="alert">
            {errorMsg}
          </p>
        )}

        <Button
          type="submit"
          disabled={submitting || activeJobId !== null}
          className="w-full"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden />
              Submitting...
            </>
          ) : activeJobId ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden />
              Rendering — typically 30-90s
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4 mr-1.5" aria-hidden />
              Render
            </>
          )}
        </Button>
      </form>
    </Card>
  );
}
