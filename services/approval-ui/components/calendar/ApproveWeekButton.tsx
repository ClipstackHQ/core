// ApproveWeekButton — the "approve the week in 60 seconds" wedge button.
//
// Client component: gives the user a big, theatrical "approve all N
// drafts queued for this week" CTA. On click: optional countdown-style
// ramp (Doc 8 §11.4 — hard rule against decorative animation, but
// progress feedback during a destructive-feeling bulk action is fine
// and useful), POST to /calendar/approve-week, success toast, refresh
// the page so the SSR-rendered list re-renders with the new state.
//
// Why client: the page-level SSR computes the upcoming-week count; the
// button needs the click handler + fetch + toast feedback that the SSR
// path can't provide. The count comes in via prop from the server
// component.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ApproveWeekButtonProps {
  companyId: string;
  /** How many drafts are queued in the upcoming-7d window. Server-rendered. */
  pendingCount: number;
}

interface ApproveWeekResponse {
  approved?: number;
  ids?: string[];
}

export function ApproveWeekButton({ companyId, pendingCount }: ApproveWeekButtonProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ count: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Disabled when nothing's pending. Still rendered (keep the affordance
  // visible so the user knows the surface exists) — just non-actionable.
  const disabled = pendingCount === 0 || submitting;

  async function onClick() {
    if (disabled) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const resp = await fetch(
        `/api/companies/${companyId}/calendar/approve-week`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Empty body — defaults are now → +7d, which matches the
          // pendingCount the SSR computed.
          body: JSON.stringify({}),
        },
      );
      const data = (await resp.json()) as { data?: ApproveWeekResponse; error?: { message?: string } };
      if (!resp.ok) {
        setErrorMsg(data.error?.message ?? `Approve failed (HTTP ${resp.status})`);
        return;
      }
      const count = data.data?.approved ?? 0;
      setResult({ count });
      // Refresh the SSR'd page so the upcoming list reflects the
      // new approved status. Toast hangs around long enough for the
      // user to read it before the calendar refreshes.
      startTransition(() => router.refresh());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-md border border-accent-500/30 bg-accent-500/5 px-4 py-3 mb-6 flex flex-wrap items-center gap-3">
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-semibold text-text-primary">
          Approve next week
        </span>
        <span className="text-xs text-text-tertiary leading-relaxed">
          {pendingCount === 0
            ? "Nothing pending in the next 7 days. The strategist queues drafts here as they reach the awaiting-approval gate."
            : (
              <>
                <span className="font-mono tabular-nums text-text-primary">
                  {pendingCount}
                </span>{" "}
                draft{pendingCount === 1 ? "" : "s"} queued for the next 7
                days. One click flips every one to{" "}
                <span className="font-mono">approved</span>; the publish
                pipeline takes it from there.
              </>
            )}
        </span>
        {result && (
          <span className="mt-1 text-xs text-status-success font-mono tabular-nums">
            ✓ approved {result.count} draft{result.count === 1 ? "" : "s"}
          </span>
        )}
        {errorMsg && (
          <span className="mt-1 text-xs text-status-danger leading-relaxed">
            {errorMsg}
          </span>
        )}
      </div>
      <Button
        type="button"
        onClick={onClick}
        disabled={disabled}
        variant="primary"
        className="shrink-0"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden />
            Approving…
          </>
        ) : (
          <>
            <CheckCheck className="h-4 w-4 mr-1.5" aria-hidden />
            Approve {pendingCount > 0 ? `${pendingCount} ` : ""}drafts
          </>
        )}
      </Button>
    </div>
  );
}
