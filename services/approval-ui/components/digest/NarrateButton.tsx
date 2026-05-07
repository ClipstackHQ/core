// NarrateButton — kicks the Managed Agents digest agent to write a
// 200-word weekly recap. Surfaces only when MA is configured (the
// server-side check is the source of truth; the prop just hides
// the button in the unconfigured case).
//
// First Managed Agents UI surface in core/. Pattern documented inline
// for future MA-driven components (research crew, vertical-pack
// composition).

"use client";

import { useState } from "react";
import { Loader2, Sparkles, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

interface NarrateButtonProps {
  companyId: string;
  /**
   * Whether MA is configured server-side. Pre-fetched at SSR time
   * (cheap env-var lookup) so the button doesn't render at all when
   * the agent + environment aren't set up. Avoids a "click → 'not
   * configured' error" UX.
   */
  managedAgentsConfigured: boolean;
}

interface NarrateSuccessResponse {
  ok: true;
  narrative: string;
  sessionId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    elapsedMs: number;
  };
}

interface NarrateSkippedResponse {
  ok: false;
  skipped: true;
  reason: string;
}

type NarrateResponse = NarrateSuccessResponse | NarrateSkippedResponse;

export function NarrateButton({ companyId, managedAgentsConfigured }: NarrateButtonProps) {
  const [phase, setPhase] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [narrative, setNarrative] = useState<string | null>(null);
  const [usage, setUsage] = useState<NarrateSuccessResponse["usage"] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!managedAgentsConfigured) {
    // Replace the button with an explanatory state so the surface
    // stays visible (the user knows the feature exists) but the
    // affordance reads as "not yet configured" rather than
    // "broken".
    return (
      <div className="rounded-md border border-border-subtle bg-bg-default px-3 py-2 mb-3">
        <p className="text-[11px] text-text-tertiary leading-relaxed">
          <span className="font-mono text-text-secondary">Mira-narrated digest</span>{" "}
          available when Managed Agents is configured. Run{" "}
          <span className="font-mono">scripts/setup-managed-agents.ts</span>{" "}
          and set <span className="font-mono">MANAGED_AGENTS_DIGEST_AGENT_ID</span> +{" "}
          <span className="font-mono">MANAGED_AGENTS_ENVIRONMENT_ID</span> in{" "}
          <span className="font-mono">.env.local</span>.
        </p>
      </div>
    );
  }

  async function onClick() {
    if (phase === "running") return;
    setPhase("running");
    setNarrative(null);
    setUsage(null);
    setErrorMsg(null);
    try {
      const resp = await fetch(`/api/companies/${companyId}/digest/narrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await resp.json()) as { data?: NarrateResponse; error?: { message?: string } };
      if (!resp.ok) {
        setErrorMsg(data.error?.message ?? `HTTP ${resp.status}`);
        setPhase("error");
        return;
      }
      const inner = data.data;
      if (!inner) {
        setErrorMsg("Empty response");
        setPhase("error");
        return;
      }
      if (inner.ok === false) {
        setErrorMsg(inner.reason);
        setPhase("error");
        return;
      }
      setNarrative(inner.narrative);
      setUsage(inner.usage);
      setPhase("complete");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  return (
    <div className="space-y-3 mb-3">
      <Button
        type="button"
        onClick={onClick}
        disabled={phase === "running"}
        variant="primary"
        className="w-full"
      >
        {phase === "running" ? (
          <>
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden />
            Mira is writing your week…
          </>
        ) : phase === "complete" ? (
          <>
            <Sparkles className="h-4 w-4 mr-1.5" aria-hidden />
            Regenerate narrative
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-1.5" aria-hidden />
            Have Mira write the week
          </>
        )}
      </Button>

      {phase === "running" && (
        <p className="text-[11px] text-text-tertiary leading-relaxed text-center">
          Spawning a Managed Agents session — typically 5–15s for the 200-word
          recap. The session has its own sandboxed container; future v2 will
          render a 60-second voice-over video from the same session.
        </p>
      )}

      {narrative && phase === "complete" && (
        <div className="rounded-md border border-accent-500/30 bg-accent-500/5 px-4 py-3">
          <div className="flex items-baseline gap-2 mb-2">
            <Sparkles className="h-3 w-3 text-accent-500 shrink-0" aria-hidden />
            <span className="text-[11px] font-mono uppercase tracking-wide text-accent-500">
              Mira&apos;s recap
            </span>
            {usage && (
              <span className="ml-auto text-[10px] text-text-tertiary font-mono tabular-nums">
                {usage.inputTokens.toLocaleString("en-US")}+
                {usage.outputTokens.toLocaleString("en-US")} tok ·{" "}
                {(usage.elapsedMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
            {narrative}
          </p>
        </div>
      )}

      {phase === "error" && errorMsg && (
        <div className="rounded-md border border-status-danger/30 bg-status-danger/5 px-3 py-2 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-status-danger shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-primary leading-relaxed">{errorMsg}</p>
            <p className="text-[10px] text-text-tertiary mt-1 leading-relaxed">
              Falls back gracefully — the SSR aggregation above stays
              authoritative. Check the server logs for the upstream error.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
