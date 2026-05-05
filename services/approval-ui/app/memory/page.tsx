// /memory — institutional memory archive.
//
// Every blocked draft, every human override, every drift detection that
// the team caught lands in `company_lessons` with a rationale + scope
// (forever | this_topic | this_client). Those lessons feed back into the
// Strategist's brief generation via the recall_lessons cosine retrieval —
// every new piece is anchored in what the team has already learned.
//
// This page is the read view: every lesson, grouped by scope so the user
// can see what's universal vs topic-bounded vs client-specific. Newest
// first within each group.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { desc } from "drizzle-orm";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/api/session";
import { withTenant } from "@/lib/db/client";
import { companyLessons } from "@/lib/db/schema/lessons";

export const metadata: Metadata = {
  title: "Memory · Clipstack",
  description: "Editorial lessons captured from human feedback — your moat.",
};

interface LessonRow {
  id: string;
  kind: string;
  scope: string;
  rationale: string;
  topicTags: string[];
  capturedAt: Date;
}

async function fetchLessons(): Promise<LessonRow[]> {
  const session = await getSession();
  const companyId = session.activeCompanyId;
  if (!companyId) return [];

  try {
    return await withTenant(companyId, async (tx) => {
      const rows = await tx
        .select({
          id: companyLessons.id,
          kind: companyLessons.kind,
          scope: companyLessons.scope,
          rationale: companyLessons.rationale,
          topicTags: companyLessons.topicTags,
          capturedAt: companyLessons.capturedAt,
        })
        .from(companyLessons)
        .orderBy(desc(companyLessons.capturedAt));
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        scope: r.scope,
        rationale: r.rationale,
        topicTags: r.topicTags,
        capturedAt: r.capturedAt,
      }));
    });
  } catch (err) {
    console.error("[memory] fetchLessons failed", err);
    return [];
  }
}

function formatCapturedAgo(capturedAt: Date): string {
  const elapsed = Date.now() - capturedAt.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SCOPE_ORDER = ["forever", "this_topic", "this_client"] as const;
const SCOPE_LABEL: Record<string, string> = {
  forever: "Forever — apply to every draft",
  this_topic: "Topic-scoped — apply when the topic matches",
  this_client: "Client-scoped — apply when the client matches",
};
const SCOPE_DESC: Record<string, string> = {
  forever:
    "These lessons apply to every draft the workspace produces. The strongest rules — voice, structural patterns, hard policy.",
  this_topic:
    "Tone or framing rules tied to a particular subject. Cosine recall surfaces them only when a new draft's topic vector matches.",
  this_client:
    "Per-client tone exceptions. Recall fires when the brief carries a clientId that matches the lesson's anchor.",
};

const KIND_TONE: Record<string, "default" | "danger" | "warning" | "success"> = {
  human_denied: "danger",
  critic_blocked: "warning",
  policy_rule: "default",
};
const KIND_LABEL: Record<string, string> = {
  human_denied: "human denied",
  critic_blocked: "critic blocked",
  policy_rule: "policy rule",
};

export default async function MemoryPage() {
  const lessons = await fetchLessons();

  // Group by scope, preserving SCOPE_ORDER so the page reads from
  // most-universal to most-specific. Within each group rows are already
  // newest-first from the SQL ORDER BY.
  const byScope = lessons.reduce<Record<string, LessonRow[]>>((acc, l) => {
    (acc[l.scope] ??= []).push(l);
    return acc;
  }, {});
  const scopes = SCOPE_ORDER.filter((s) => byScope[s]?.length);

  return (
    <AppShell title="memory">
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
            institutional memory
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed">
            Every lesson the workspace has captured — human denials, critic
            blocks, codified policy. The Strategist consults these via
            cosine recall before queueing each new draft. Newest first within
            each scope.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <span>
            <span className="font-mono tabular-nums text-text-primary">
              {lessons.length}
            </span>{" "}
            total
          </span>
          {SCOPE_ORDER.map((s) => {
            const count = byScope[s]?.length ?? 0;
            if (count === 0) return null;
            return (
              <span key={s}>
                <span className="font-mono tabular-nums text-text-primary">
                  {count}
                </span>{" "}
                {s.replace(/_/g, " ")}
              </span>
            );
          })}
        </div>

        {lessons.length === 0 ? (
          <Card size="medium" tone="default">
            <div className="text-sm text-text-tertiary leading-relaxed">
              No lessons captured yet. The first time you deny a draft with
              a rationale, or the critic blocks one, it lands here as a
              vector that future drafts have to clear.
            </div>
          </Card>
        ) : (
          <div className="space-y-8" data-keyboard-list>
            {scopes.map((scope) => {
              const group = byScope[scope] ?? [];
              return (
                <section key={scope}>
                  <div className="mb-3 pb-1 border-b border-border-subtle">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        {SCOPE_LABEL[scope] ?? scope}
                      </h2>
                      <span className="text-xs text-text-tertiary font-mono tabular-nums">
                        {group.length}
                      </span>
                    </div>
                    <p className="text-xs text-text-tertiary leading-relaxed">
                      {SCOPE_DESC[scope]}
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {group.map((lesson) => (
                      <li
                        key={lesson.id}
                        data-keyboard-row
                        className="rounded-md border border-border-subtle bg-bg-default px-4 py-3 hover:bg-bg-elevated transition-colors duration-fast"
                      >
                        <div className="flex items-baseline gap-2 mb-1.5">
                          <Badge
                            variant={KIND_TONE[lesson.kind] ?? "default"}
                            className="font-mono tabular-nums shrink-0 text-[10px]"
                          >
                            {KIND_LABEL[lesson.kind] ?? lesson.kind}
                          </Badge>
                          <span className="text-xs text-text-tertiary font-mono tabular-nums ml-auto">
                            {formatCapturedAgo(lesson.capturedAt)}
                          </span>
                        </div>
                        <p className="text-sm text-text-primary leading-relaxed mb-2">
                          {lesson.rationale}
                        </p>
                        {lesson.topicTags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {lesson.topicTags.map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] font-mono tabular-nums text-text-tertiary px-1.5 py-0.5 rounded border border-border-subtle"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
          <span className="font-mono tabular-nums">{lessons.length} lessons</span>
          <span aria-hidden>·</span>
          <span>USP 5 — institutional memory moat</span>
          <span className="md:ml-auto">recalled via 384-d cosine</span>
        </div>
      </div>
    </AppShell>
  );
}
