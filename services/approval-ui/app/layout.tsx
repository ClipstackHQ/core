import type { Metadata, Viewport } from "next";
import { interVariable, jetbrainsMonoVariable } from "./fonts";
import "./globals.css";
import { KeyboardShortcuts } from "@/components/keyboard/KeyboardShortcuts";
import { DemoBadge } from "@/components/layout/DemoBadge";
import { ToastProvider } from "@/components/ui/toast";

// Mission Control is the workspace home — never indexed publicly. Per-page
// titles override via the `%s` template; description is the brand-level
// fallback that page metadata can replace freely.
export const metadata: Metadata = {
  title: {
    default: "Clipstack",
    template: "%s",
  },
  description: "The institutional memory layer for marketing teams.",
  // Mission Control is gated behind WorkOS auth — no SEO crawling. Per-page
  // metadata can override locally if a public surface ships later.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Doc 8 charcoal — keeps the iOS / Android Material You browser chrome
  // tinted to match our base background instead of going stark white.
  themeColor: "#0B0C0E",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Dark mode is the default per Doc 8 hard rule #6. Light mode is parallel.
  //
  // The two providers wrap every page so any client component can call
  // useToast() and the global keyboard listener is alive on every route.
  // KeyboardShortcuts itself renders no visible DOM — it owns the help +
  // command palette modals and a single document-level keydown listener.
  return (
    <html
      lang="en"
      className={`${interVariable.variable} ${jetbrainsMonoVariable.variable} dark`}
      suppressHydrationWarning
    >
      <body>
        <ToastProvider>
          <KeyboardShortcuts />
          {/* DemoBadge is a server component — surfaces only when the
              active session is scoped to the seeded demo tenant. Renders
              null on /login (no session yet) and on production tenants
              (activeCompanyId !== DEMO_COMPANY_ID). */}
          <DemoBadge />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
