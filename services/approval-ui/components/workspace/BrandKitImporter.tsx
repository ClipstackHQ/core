// BrandKitImporter — the "brand in at nine" wedge component.
//
// Paste your homepage URL → server fetches + extracts a proposed brand
// kit → user reviews + saves. Lives on /workspace as a standalone card
// inside the editorial-voice column.
//
// Three states: idle (URL input), proposing (loading + extracted preview),
// saved (success + reset). The proposal preview is editable — the user
// can override any palette swatch / font / tone before committing.
//
// v1 backs the heuristic extractor in lib/brand-kit/infer.ts. v2 lights
// up an LLM-driven extractor when ANTHROPIC_API_KEY is configured.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Check, X as XIcon } from "lucide-react";

import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface BrandKitProposal {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontPrimary: string | null;
  fontSecondary: string | null;
  toneOfVoice: string | null;
  logoUrl: string | null;
  sourceUrl: string;
  inferenceMeta: Record<string, unknown>;
}

interface BrandKitImporterProps {
  companyId: string;
  /** Existing brand kit summary (when one's already saved). Lets the
   *  card state read "imported from {sourceUrl}" without an extra fetch. */
  existing: {
    primaryColor: string | null;
    secondaryColor: string | null;
    accentColor: string | null;
    fontPrimary: string | null;
    sourceUrl: string | null;
  } | null;
}

export function BrandKitImporter({ companyId, existing }: BrandKitImporterProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [url, setUrl] = useState(existing?.sourceUrl ?? "");
  const [phase, setPhase] = useState<"idle" | "proposing" | "saving" | "saved">(
    "idle",
  );
  const [proposal, setProposal] = useState<BrandKitProposal | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onInfer(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || phase === "proposing") return;
    setErrorMsg(null);
    setPhase("proposing");
    try {
      const resp = await fetch(
        `/api/companies/${companyId}/brand-kit/infer-from-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        },
      );
      const data = (await resp.json()) as {
        data?: { proposal?: BrandKitProposal };
        error?: { message?: string };
      };
      if (!resp.ok) {
        setErrorMsg(data.error?.message ?? `Inference failed (HTTP ${resp.status})`);
        setPhase("idle");
        return;
      }
      const prop = data.data?.proposal;
      if (!prop) {
        setErrorMsg("Inference returned no proposal — try a different URL");
        setPhase("idle");
        return;
      }
      setProposal(prop);
      setPhase("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  async function onSave() {
    if (!proposal || phase === "saving") return;
    setErrorMsg(null);
    setPhase("saving");
    try {
      const resp = await fetch(
        `/api/companies/${companyId}/brand-kit/save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proposal),
        },
      );
      const data = (await resp.json()) as {
        data?: { id?: string; action?: string };
        error?: { message?: string };
      };
      if (!resp.ok) {
        setErrorMsg(data.error?.message ?? `Save failed (HTTP ${resp.status})`);
        setPhase("idle");
        return;
      }
      setPhase("saved");
      // Refresh the SSR'd workspace page so the brand-kit summary
      // updates from "not yet wired" to the new kit.
      startTransition(() => router.refresh());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  function onReset() {
    setProposal(null);
    setPhase("idle");
    setErrorMsg(null);
  }

  return (
    <Card size="medium" tone="accent" className="flex flex-col">
      <CardHeader>
        <Sparkles className="h-4 w-4 text-accent-500 shrink-0" aria-hidden />
        <CardLabel>brand in at nine</CardLabel>
        {existing?.sourceUrl && (
          <Badge variant="success" className="font-mono tabular-nums shrink-0 text-[10px]">
            imported
          </Badge>
        )}
      </CardHeader>

      <p className="text-xs text-text-tertiary leading-relaxed mb-3">
        Paste your homepage URL — Mira reads the live styles and proposes
        a brand kit in real time. Palette, typography, tone of voice. You
        review + save; every agent on the team picks it up before the
        next draft.
      </p>

      {phase !== "saved" && (
        <form onSubmit={onInfer} className="flex flex-wrap gap-2 mb-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-brand.com"
            disabled={phase === "proposing"}
            className="flex-1 min-w-[200px] rounded-md border border-border-subtle bg-bg-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500 font-mono"
            aria-label="Homepage URL"
          />
          <Button
            type="submit"
            disabled={!url.trim() || phase === "proposing"}
            variant="primary"
            className="shrink-0"
          >
            {phase === "proposing" ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden />
                Reading…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1.5" aria-hidden />
                Import
              </>
            )}
          </Button>
        </form>
      )}

      {errorMsg && (
        <p className="text-xs text-status-danger leading-relaxed mb-3" role="alert">
          {errorMsg}
        </p>
      )}

      {phase === "saved" && (
        <div className="rounded-md border border-status-success/40 bg-status-success/10 px-3 py-2 mb-3 flex items-center gap-2">
          <Check className="h-4 w-4 text-status-success shrink-0" aria-hidden />
          <span className="text-sm text-text-primary">
            Brand kit saved. Every agent picks it up on the next draft.
          </span>
          <button
            type="button"
            onClick={onReset}
            className="ml-auto text-xs text-text-tertiary hover:text-text-primary transition-colors"
          >
            import another →
          </button>
        </div>
      )}

      {/* Proposal preview — only when we have one and we haven't saved yet. */}
      {proposal && phase !== "saved" && (
        <div className="rounded-md border border-border-subtle bg-bg-default p-3 space-y-3">
          <div className="text-[11px] font-mono uppercase tracking-wide text-text-tertiary">
            proposed kit
          </div>

          {/* Palette swatches */}
          <div>
            <div className="text-xs text-text-secondary mb-1.5">palette</div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "primary", value: proposal.primaryColor },
                { label: "secondary", value: proposal.secondaryColor },
                { label: "accent", value: proposal.accentColor },
              ].map((slot) => (
                <div
                  key={slot.label}
                  className="flex items-center gap-2 rounded border border-border-subtle bg-bg-elevated px-2 py-1"
                >
                  <span
                    className="h-4 w-4 rounded shrink-0 border border-border-subtle"
                    style={{ background: slot.value ?? "#666" }}
                    aria-hidden
                  />
                  <span className="text-[11px] text-text-tertiary uppercase font-mono">
                    {slot.label}
                  </span>
                  <span className="text-[11px] text-text-primary font-mono tabular-nums">
                    {slot.value ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Typography */}
          {(proposal.fontPrimary || proposal.fontSecondary) && (
            <div>
              <div className="text-xs text-text-secondary mb-1.5">typography</div>
              <div className="flex flex-wrap gap-2 text-xs">
                {proposal.fontPrimary && (
                  <span className="rounded border border-border-subtle bg-bg-elevated px-2 py-1 text-text-primary">
                    primary: <span className="font-mono">{proposal.fontPrimary}</span>
                  </span>
                )}
                {proposal.fontSecondary && (
                  <span className="rounded border border-border-subtle bg-bg-elevated px-2 py-1 text-text-primary">
                    secondary: <span className="font-mono">{proposal.fontSecondary}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Tone of voice */}
          {proposal.toneOfVoice && (
            <div>
              <div className="text-xs text-text-secondary mb-1.5">tone of voice</div>
              <p className="text-xs text-text-primary leading-relaxed">
                {proposal.toneOfVoice}
              </p>
            </div>
          )}

          {/* Logo */}
          {proposal.logoUrl && (
            <div>
              <div className="text-xs text-text-secondary mb-1.5">logo</div>
              <div className="rounded border border-border-subtle bg-bg-elevated p-2 inline-flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={proposal.logoUrl}
                  alt="proposed logo"
                  className="h-8 w-auto max-w-[160px] object-contain"
                />
                <span className="text-[11px] text-text-tertiary font-mono break-all">
                  {proposal.logoUrl.length > 60
                    ? proposal.logoUrl.slice(0, 60) + "…"
                    : proposal.logoUrl}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
            <Button
              type="button"
              onClick={onSave}
              disabled={phase === "saving"}
              variant="primary"
              className="shrink-0"
            >
              {phase === "saving" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-1.5" aria-hidden />
                  Save brand kit
                </>
              )}
            </Button>
            <Button
              type="button"
              onClick={onReset}
              disabled={phase === "saving"}
              variant="ghost"
              className="shrink-0"
            >
              <XIcon className="h-4 w-4 mr-1.5" aria-hidden />
              Discard
            </Button>
          </div>
        </div>
      )}

      {/* When we have an existing kit AND no in-flight proposal, show
          the saved-state summary. */}
      {!proposal && existing && phase !== "saved" && (
        <div className="rounded-md border border-border-subtle bg-bg-default p-3 space-y-2">
          <div className="text-[11px] font-mono uppercase tracking-wide text-text-tertiary">
            current kit
          </div>
          <div className="flex flex-wrap gap-2">
            {[existing.primaryColor, existing.secondaryColor, existing.accentColor]
              .filter((c): c is string => Boolean(c))
              .map((color, i) => (
                <span
                  key={`${color}-${i}`}
                  className="h-5 w-5 rounded border border-border-subtle shrink-0"
                  style={{ background: color }}
                  title={color}
                  aria-label={`color ${color}`}
                />
              ))}
            {existing.fontPrimary && (
              <span className="text-xs text-text-primary font-mono ml-1">
                {existing.fontPrimary}
              </span>
            )}
          </div>
          {existing.sourceUrl && (
            <p className="text-[11px] text-text-tertiary font-mono break-all">
              imported from {existing.sourceUrl}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
