// Doc 8 §8.6 — Sidebar. w-60, bg-subtle, border-r border-subtle.
// Section labels uppercase tracked per Doc 8 §11.2.
//
// Responsive behavior: on md+ the sidebar is always visible as a column
// inside the AppShell flex row. On smaller viewports it hides entirely
// and re-renders as a slide-in drawer driven by props from AppShell —
// the TopBar's hamburger toggles `mobileOpen`. Clicking a Link inside
// the drawer (or pressing Escape) closes it via `onMobileClose` so
// mobile nav advances cleanly without leaving the drawer hanging open.
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Inbox,
  PenLine,
  Calendar,
  Users,
  TrendingUp,
  Settings,
  Activity,
  GitBranch,
  Brain,
  Cpu,
  Film,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// Doc 7 §2.4 — persistent global elements; Mission Control is the home.
const sections: NavSection[] = [
  {
    label: "Daily",
    items: [
      { label: "Mission Control", href: "/",            icon: LayoutDashboard, shortcut: "G H" },
      { label: "Inbox",           href: "/inbox",       icon: Inbox,           shortcut: "G I" },
      { label: "Workspace",       href: "/workspace",   icon: PenLine,         shortcut: "G W" },
      { label: "Studio",          href: "/studio",      icon: Film,            shortcut: "G S" },
      { label: "Calendar",        href: "/calendar",    icon: Calendar,        shortcut: "G C" },
    ],
  },
  {
    label: "Insight",
    items: [
      { label: "Pipeline",        href: "/pipeline",    icon: GitBranch },
      { label: "Performance",     href: "/performance", icon: TrendingUp },
      { label: "Memory",          href: "/memory",      icon: Brain },
      { label: "Activity",        href: "/activity",    icon: Activity },
    ],
  },
  {
    label: "Team",
    items: [
      { label: "Agents",          href: "/agents",      icon: Cpu },
      { label: "Members",         href: "/members",     icon: Users },
      { label: "Settings",        href: "/settings",    icon: Settings },
    ],
  },
];

interface SidebarProps {
  // When true, render the slide-in drawer overlay (mobile only). On md+
  // viewports this prop is ignored — the sidebar is always present in
  // the flex column.
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

function NavList({ onItemClick }: { onItemClick?: () => void }) {
  const pathname = usePathname();
  return (
    <nav
      role="navigation"
      aria-label="Primary"
      className="px-2 py-3 space-y-5"
    >
      {sections.map((section) => (
        <div key={section.label}>
          <div className="px-2 mb-1 text-xs uppercase tracking-wider font-medium text-text-tertiary">
            {section.label}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onItemClick}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      // `group` here so the inner shortcut hint can use
                      // group-hover/group-focus-within to fade in on
                      // pointer + keyboard focus alike.
                      "group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors duration-fast ease-default",
                      "focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500",
                      active
                        ? "bg-bg-elevated text-text-primary"
                        : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.shortcut && (
                      <span className="font-mono text-xs text-text-tertiary opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100">
                        {item.shortcut}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  // Esc closes the mobile drawer when it's open. We attach the listener
  // only when open so the global keyboard shortcuts (which also listen
  // for Escape) aren't double-firing on every escape across the app.
  useEffect(() => {
    if (!mobileOpen || !onMobileClose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onMobileClose?.();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {/* Desktop sidebar — always present at md+ via the flex column.
          On <md it's hidden; the drawer below is what the user sees. */}
      <aside
        className="hidden md:block w-60 shrink-0 border-r border-border-subtle bg-bg-subtle"
        aria-label="Sidebar"
      >
        <div className="flex h-14 items-center px-4 border-b border-border-subtle">
          <span className="font-semibold text-text-primary tracking-tight">Clipstack</span>
          <span className="ml-auto font-mono text-xs text-text-tertiary">core/0.1.0</span>
        </div>
        <NavList />
      </aside>

      {/* Mobile drawer — overlay + slide-in panel. Only renders when
          mobileOpen=true so the DOM is clean on closed state. The
          backdrop dismisses on click; the panel closes on Esc + on
          any nav link click via onItemClick. data-modal-open opts the
          drawer into the same convention HelpDialog uses so the global
          keyboard listener suppresses J/K nav while the drawer is up. */}
      {mobileOpen && (
        <div
          data-modal-open
          className="md:hidden fixed inset-0 z-40"
          aria-modal="true"
          role="dialog"
          aria-label="Navigation menu"
        >
          {/* Backdrop — clicking dismisses. */}
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm cursor-default"
            onClick={onMobileClose}
          />
          {/* Panel — slides in from the left. */}
          <aside
            className="absolute inset-y-0 left-0 w-64 max-w-[80vw] border-r border-border-subtle bg-bg-subtle shadow-lg flex flex-col"
            aria-label="Sidebar"
          >
            <div className="flex h-14 items-center px-4 border-b border-border-subtle">
              <span className="font-semibold text-text-primary tracking-tight">
                Clipstack
              </span>
              <span className="ml-auto font-mono text-xs text-text-tertiary mr-2">
                core/0.1.0
              </span>
              <button
                type="button"
                onClick={onMobileClose}
                aria-label="Close navigation"
                className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors duration-fast focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavList onItemClick={onMobileClose} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
