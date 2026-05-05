// /settings — workspace configuration readout.
//
// First cut is the read view: workspace identity, active regimes,
// integration status, and a checklist of feature flags so the operator
// can see at a glance what's wired vs parked. Editable fields land
// behind /api/companies/:cid/settings (route shape final, edit form
// in design — drafted alongside the brand_kits table).

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, X as XIcon } from "lucide-react";
import { eq } from "drizzle-orm";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { companies } from "@/lib/db/schema/companies";

export const metadata: Metadata = {
  title: "Settings · Clipstack",
  description: "Workspace configuration — identity, regimes, integrations.",
};

interface SettingsSnapshot {
  name: string;
  type: string;
  uiMode: string;
  slug: string | null;
  website: string | null;
  activeRegimes: string[];
  brandKitId: string | null;
  createdAt: Date | null;
}

const EMPTY: SettingsSnapshot = {
  name: "—",
  type: "in_house",
  uiMode: "web2",
  slug: null,
  website: null,
  activeRegimes: [],
  brandKitId: null,
  createdAt: null,
};

async function fetchSettings(): Promise<SettingsSnapshot> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return EMPTY;

  try {
    return await withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({
          name: companies.name,
          type: companies.type,
          uiMode: companies.uiMode,
          activeRegimes: companies.activeRegimes,
          brandKitId: companies.brandKitId,
          contextJson: companies.contextJson,
          createdAt: companies.createdAt,
        })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);

      const row = rows[0];
      if (!row) return EMPTY;
      const ctx = (row.contextJson ?? {}) as Record<string, unknown>;
      return {
        name: row.name,
        type: row.type,
        uiMode: row.uiMode,
        slug: typeof ctx.slug === "string" ? ctx.slug : null,
        website: typeof ctx.website === "string" ? ctx.website : null,
        activeRegimes: row.activeRegimes,
        brandKitId: row.brandKitId,
        createdAt: row.createdAt,
      };
    });
  } catch (err) {
    console.error("[settings] fetchSettings failed", err);
    return EMPTY;
  }
}

const COMPANY_TYPE_LABEL: Record<string, string> = {
  agency: "Agency — manages multiple clients",
  in_house: "In-house — one brand, one team",
  agency_client: "Client of an agency",
};

const UI_MODE_LABEL: Record<string, string> = {
  web2: "Web2 — fiat + Stripe",
  web3: "Web3 — USDC + on-chain settlement",
};

// Feature flags + integration readouts. Each entry has a label, a
// truthy-check resolver, and a one-line "what this is" line so
// the operator can see what's wired without reading the source.
interface FeatureRow {
  label: string;
  enabled: boolean;
  description: string;
  // Optional sublabel for env-driven values (e.g. AUTH_STUB on/off).
  detail?: string;
}

function detectFeatures(): FeatureRow[] {
  const env = (k: string): string | undefined => process.env[k];
  const has = (k: string): boolean => Boolean(env(k));

  return [
    {
      label: "WorkOS SSO",
      enabled: has("WORKOS_API_KEY") && has("WORKOS_CLIENT_ID"),
      description: "Authkit + iron-session cookies; SAML / SSO / MFA supported.",
      detail: env("AUTH_STUB_USER_ID")
        ? "AUTH_STUB active — dev bypass enabled"
        : undefined,
    },
    {
      label: "Bandit orchestrator",
      enabled: has("BANDIT_ORCH_BASE_URL") && has("SERVICE_TOKEN"),
      description:
        "Thompson-sampling allocator — per-workspace bandits, auto-reward via content.metric_update.",
    },
    {
      label: "Performance ingest",
      enabled: has("PERFORMANCE_INGEST_BASE_URL") && has("SERVICE_TOKEN"),
      description:
        "Per-(company × platform × metric) running histograms, percentile + velocity + anomaly detection.",
    },
    {
      label: "Percentile predictor",
      enabled: has("PERCENTILE_PREDICTOR_BASE_URL") && has("SERVICE_TOKEN"),
      description:
        "LightGBM per-workspace × KPI calibration; nightly retrain on every published artifact.",
    },
    {
      label: "Voice scorer",
      enabled: has("VOICE_SCORER_BASE_URL") && has("SERVICE_TOKEN"),
      description:
        "Cosine-similarity vs workspace voice corpus (Qdrant + 384-d embeddings).",
    },
    {
      label: "PII detection",
      enabled: has("PII_DETECTION_BASE_URL"),
      description:
        "Presidio analyzer with custom CRYPTO_WALLET + API_KEY recognizers.",
    },
    {
      label: "Output moderation",
      enabled: has("OUTPUT_MODERATION_BASE_URL"),
      description:
        "Llama Guard 3 verdict + workspace-policy-aware block / flag / pass.",
    },
    {
      label: "Event bus (Redpanda)",
      enabled: env("EVENTBUS_ENABLED") === "true",
      description:
        "Kafka-compatible bus for content.published / metric_update / anomaly events.",
    },
    {
      label: "LangGraph state persistence",
      enabled: has("POSTGRES_URL"),
      description:
        "PostgresSaver checkpointer — pipeline state survives restart.",
    },
    {
      label: "Langfuse tracing",
      enabled: has("LANGFUSE_HOST") && has("LANGFUSE_PUBLIC_KEY"),
      description: "End-to-end trace IDs across crews + nodes.",
    },
  ];
}

export default async function SettingsPage() {
  const settings = await fetchSettings();
  const features = detectFeatures();
  const enabledCount = features.filter((f) => f.enabled).length;

  return (
    <AppShell title="settings">
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
            settings
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed">
            Workspace configuration readout. Edit form lands when the{" "}
            <span className="font-mono">/api/companies/:cid/settings</span>{" "}
            route ships alongside the brand-kit table; today this is the
            read view your operator + auditor + DPO consult.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card size="medium" tone="default" className="flex flex-col">
            <CardHeader>
              <CardLabel>identity</CardLabel>
              <Link
                href="/workspace"
                className="text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
              >
                workspace dashboard
              </Link>
            </CardHeader>
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-text-tertiary uppercase tracking-wide font-mono">
                  name
                </dt>
                <dd className="text-text-primary text-right">{settings.name}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-text-tertiary uppercase tracking-wide font-mono">
                  type
                </dt>
                <dd className="text-text-primary text-right">
                  {COMPANY_TYPE_LABEL[settings.type] ?? settings.type}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-text-tertiary uppercase tracking-wide font-mono">
                  ui mode
                </dt>
                <dd className="text-text-primary text-right">
                  {UI_MODE_LABEL[settings.uiMode] ?? settings.uiMode}
                </dd>
              </div>
              {settings.slug && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-text-tertiary uppercase tracking-wide font-mono">
                    slug
                  </dt>
                  <dd className="text-text-primary font-mono text-right">
                    {settings.slug}
                  </dd>
                </div>
              )}
              {settings.website && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-text-tertiary uppercase tracking-wide font-mono">
                    website
                  </dt>
                  <dd className="text-right">
                    <a
                      href={settings.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-500 hover:underline"
                    >
                      {settings.website.replace(/^https?:\/\//, "")}
                    </a>
                  </dd>
                </div>
              )}
              {settings.createdAt && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-text-tertiary uppercase tracking-wide font-mono">
                    since
                  </dt>
                  <dd className="text-text-primary font-mono tabular-nums text-right">
                    {settings.createdAt.toISOString().slice(0, 10)}
                  </dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-text-tertiary uppercase tracking-wide font-mono">
                  brand kit
                </dt>
                <dd className="text-text-primary text-right">
                  {settings.brandKitId ? (
                    <span className="font-mono tabular-nums text-xs">
                      {settings.brandKitId.slice(0, 8)}…
                    </span>
                  ) : (
                    <span className="text-text-tertiary text-xs italic">
                      not yet wired
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          <Card size="medium" tone="default" className="flex flex-col">
            <CardHeader>
              <CardLabel>active regimes</CardLabel>
              <Badge
                variant={settings.activeRegimes.length === 0 ? "default" : "success"}
                className="font-mono tabular-nums shrink-0"
              >
                {settings.activeRegimes.length}
              </Badge>
            </CardHeader>
            <p className="text-xs text-text-tertiary leading-relaxed mb-2">
              Compliance packs (USP 4) loaded for this workspace. Each
              regime adds a YAML rule pack the brand-safety critic checks
              against before publish.
            </p>
            {settings.activeRegimes.length === 0 ? (
              <p className="text-xs text-text-tertiary italic">
                No regimes loaded. Self-host gets the loader; design
                partners enable specific regimes (MiCA / FCA / ASA / FDA)
                via the regime YAML pack in <span className="font-mono">signals/</span>.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {settings.activeRegimes.map((r) => (
                  <span
                    key={r}
                    className="text-[10px] font-mono tabular-nums text-text-primary px-2 py-0.5 rounded border border-border-subtle"
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </div>

        <section className="mt-8">
          <div className="flex items-baseline gap-2 mb-3 pb-1 border-b border-border-subtle">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
              integrations + features
            </h2>
            <span className="text-xs text-text-tertiary">
              <span className="font-mono tabular-nums text-text-primary">
                {enabledCount}
              </span>{" "}
              / {features.length} enabled
            </span>
          </div>
          <ul className="divide-y divide-border-subtle border border-border-subtle rounded-md">
            {features.map((f) => (
              <li
                key={f.label}
                className="flex items-start gap-3 px-4 py-3"
              >
                <span
                  className={`mt-0.5 inline-flex items-center justify-center h-5 w-5 rounded-full shrink-0 ${
                    f.enabled
                      ? "bg-status-success/15 text-status-success"
                      : "bg-bg-elevated text-text-tertiary"
                  }`}
                  aria-hidden
                >
                  {f.enabled ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <XIcon className="h-3 w-3" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-sm text-text-primary">{f.label}</span>
                    {f.detail && (
                      <span className="text-[10px] font-mono text-text-tertiary">
                        {f.detail}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-tertiary leading-relaxed">
                    {f.description}
                  </p>
                </div>
                <Badge
                  variant={f.enabled ? "success" : "default"}
                  className="shrink-0 text-[10px]"
                >
                  {f.enabled ? "enabled" : "disabled"}
                </Badge>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-8 text-xs text-text-tertiary leading-relaxed">
          Editable workspace settings (name, slug, regimes, brand kit)
          land behind <span className="font-mono">/api/companies/:cid/settings</span>{" "}
          when the brand_kits table ships. Today: read view only — every
          field above is configured via env vars or the seed.
        </div>
      </div>
    </AppShell>
  );
}
