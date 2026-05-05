// DemoBadge — fixed-position chip surfaced when the active workspace is
// the seeded demo tenant. Trust signal for pitch/demo audiences: the
// numbers they're seeing are seed data, not production traffic.
//
// Trigger logic: server component reads the session and shows the
// badge ONLY when activeCompanyId matches DEMO_COMPANY_ID. Hardcoded
// UUID match (not env-driven) — env detection would falsely fire in
// self-host installs sharing the same UUID, but the demo UUID is
// intentionally collision-free (00000000-...).
//
// Placement: rendered inside AppShell so it appears on every
// authenticated route. /login is unaffected (no AppShell there).

import { DEMO_COMPANY_ID } from "@/lib/constants/demo";
import { getSession } from "@/lib/api/session";

export async function DemoBadge() {
  // Defensive: any failure resolving the session means we silently
  // skip the badge rather than 500 the page. The badge is a hint, not
  // a load-bearing surface.
  let activeCompanyId: string | null = null;
  try {
    const session = await getSession();
    activeCompanyId = session.activeCompanyId ?? null;
  } catch {
    return null;
  }

  if (activeCompanyId !== DEMO_COMPANY_ID) return null;

  return (
    <div
      // Fixed top-right, above page content but below modals (AppShell
      // modals use z-40+; we sit at z-30 so we never cover the inbox
      // approval dialog or the help panel).
      className="fixed top-3 right-3 z-30 pointer-events-none select-none"
      // aria-live="polite" so screen readers announce the badge on
      // first paint without interrupting whatever the user is reading.
      aria-live="polite"
      aria-atomic="true"
      role="status"
    >
      <div
        className="
          inline-flex items-center gap-2
          px-2.5 py-1 rounded-md
          bg-bg-elevated/95 backdrop-blur-sm
          border border-status-warning/40
          text-[11px] font-mono tabular-nums
          text-text-secondary
          shadow-sm
        "
      >
        <span
          className="h-1.5 w-1.5 rounded-full bg-status-warning animate-pulse"
          aria-hidden
        />
        <span className="uppercase tracking-wide font-semibold text-status-warning">
          DEMO DATA
        </span>
        <span className="text-text-tertiary">·</span>
        <span>seeded workspace</span>
      </div>
    </div>
  );
}
