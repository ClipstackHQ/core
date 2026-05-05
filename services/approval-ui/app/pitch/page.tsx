// /pitch — guided tour for investor + design-partner demos.
//
// Not in the sidebar nav. Bookmarkable, single-pager. The audience-
// facing version of the README quick-start: walks the closed-loop
// story across the surfaces that already exist, with talking-point
// callouts you can lift verbatim during a live demo.
//
// Pure content — no DB reads. The page exists to anchor the narrative,
// not surface live numbers (those live on Mission Control + every
// detail surface). Keeps the cognitive load right when you're rehearsing
// or live-screen-sharing: tour stays stable while the data refreshes.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Pitch tour · Clipstack",
  description: "Guided walkthrough of the closed-loop story.",
};

interface TalkingPoint {
  text: string;
}

interface TourSection {
  beat: number;
  heading: string;
  surfaceLink: { href: string; label: string };
  narrative: string[];
  talkingPoints: TalkingPoint[];
}

const SECTIONS: TourSection[] = [
  {
    beat: 1,
    heading: "The closed loop is the company",
    surfaceLink: { href: "/", label: "Open Mission Control" },
    narrative: [
      "Most AI marketing tools sell drafting. The interesting product is the loop: predict performance before publish, measure after, capture the lesson, retrain. Drafting is a feature; the loop is the company.",
      "Every Clipstack workspace runs four phases continuously: a strategist agent generates drafts → a percentile predictor scores them pre-publish → the channel adapter ships approved drafts → performance-ingest pulls real metrics back into the predictor's training set within the same day. Then the bandit allocator routes the next decision based on what worked. The lessons captured along the way feed every future generation.",
      "The architecture mirrors the story: nine real-data tiles on the home page, every one linking to the surface that explains it. There's no demo-ware here — the data flows for real.",
    ],
    talkingPoints: [
      { text: "We don't sell drafting. We sell the loop." },
      { text: "Predict, publish, measure, learn — all four phases shipped end-to-end. Closed-loop pipeline went green 2026-04-30." },
      { text: "Every tile on Mission Control is real data through real services. None of it is mock." },
    ],
  },
  {
    beat: 2,
    heading: "Mission Control — what each tile is doing",
    surfaceLink: { href: "/", label: "Tour the bento" },
    narrative: [
      "The hero KPI shows your workspace's predicted percentile this week, calibrated to ±15 points by the LightGBM model. Below it: the approval queue (pending drafts), the agent activity stream (which agents are working right now), the bandit experiments (Thompson sampling allocations across variants), and the institutional memory tile — the count of editorial lessons captured.",
      "Three secondary tiles show the AI spend, the CTR/reach KPIs over the last 7 days, and the bus health (the three-dot operator pulse for the closed-loop services). The crisis monitor is the one stub left on the page — that signal class needs live external feeds we ship in Phase D.",
      "Every tile click-throughs. Predicted percentile → /performance for KPI history. Team → /agents for the full roster. Bus health → /system for service-level detail. Institutional memory → /memory for the lessons archive. Approval queue → /inbox for the full editorial queue.",
    ],
    talkingPoints: [
      { text: "Nine real-data tiles. Each one drills to a detail surface. No half-built corners." },
      { text: "The hero KPI is calibrated within ±15 points by per-workspace LightGBM training. That's the bandit's reward signal made human-readable." },
      { text: "Three secondary tiles cover the operational dashboard ops teams normally have to ssh in for. Bus health · AI spend · CTR/reach. One screen." },
    ],
  },
  {
    beat: 3,
    heading: "Editorial memory is the moat",
    surfaceLink: { href: "/memory", label: "Browse the lessons archive" },
    narrative: [
      "Every twelve months a new flagship model is 30% smarter and 50% cheaper. We don't fight that — we ride it. The moat lives one layer below.",
      "Every human denial captures a structured rationale and a scope (forever / this_topic / this_client). The rationale becomes a vector embedded into pgvector. The next time the strategist generates a draft on a touching topic, it queries the cosine-similarity index and pulls those lessons into the system prompt. The agent literally cannot make the same mistake twice.",
      "The seeded demo workspace has 8 lessons spanning all three scopes — universal voice rules, topic-bounded tone overrides, and per-client tone exceptions. In production, this number compounds with every approval session. Workspaces that capture lessons rigorously have a moat that survives the org chart.",
    ],
    talkingPoints: [
      { text: "Persistent state is the moat. The model swap is non-disruptive — the workspace's institutional memory is the load-bearing asset." },
      { text: "Every denial = vector. Every future draft has to clear it. Cosine-similarity recall via pgvector ivfflat index." },
      { text: "Three scope levels — forever, topic-bounded, client-specific. Captures the actual editorial structure marketing teams already use." },
    ],
  },
  {
    beat: 4,
    heading: "The agent crew — geometric marks, not avatars",
    surfaceLink: { href: "/agents", label: "See the agent roster" },
    narrative: [
      "Doc 8 §11.7 — agents are geometric AgentMarks (shape × color), never humanoid avatars. The hierarchy of interaction rule: only the orchestrator gets a chat dock; the rest are status-only. We don't anthropomorphize past 'agent'.",
      "The seeded demo has 6 agents: Mira (orchestrator, teal circle), Atlas (strategist, amber hexagon), Saoirse (long-form writer, violet rounded square), Kai (social adapter, rose diamond), Juno (voice QA, sky octagon), Nova (claim verifier, slate pentagon). Each renders identically across surfaces — same shape, same color — so the same agent reads as the same agent on Mission Control, the inbox, the activity feed, the workspace dashboard.",
      "The visual identity is a deliberate ethical choice. The agent isn't pretending to be a human team member. It's a tool with a stable identity, doing a specific job. The system reads as software you run, not co-workers you delegate to.",
    ],
    talkingPoints: [
      { text: "Geometric marks, not avatars. We don't sell the fiction of AI co-workers — we sell tools with stable identities." },
      { text: "Hierarchy of interaction: only the orchestrator chats. Everything else is status-only. Calmer surface, less anthropomorphism." },
      { text: "Each agent is a specific role with a job description, allowed tools, and a model profile. The workspace owner sees who's running, what they're allowed to do, and what they cost." },
    ],
  },
  {
    beat: 5,
    heading: "The publish pipeline — eight nodes, deterministic",
    surfaceLink: { href: "/pipeline", label: "Watch drafts flow through" },
    narrative: [
      "Every draft moves through the langgraph publish_pipeline state graph: review_cycle → percentile_gate → awaiting_human_approval → bandit_allocate → publish_to_channel → record_metering. With two terminal branches: record_block_lesson (critic blocked the draft) and record_deny_lesson (human denied with rationale).",
      "The /pipeline page renders this as a horizontal flow with current draft counts at each stage. You can see exactly how many drafts are in review, how many are awaiting human approval, how many got blocked or denied in the last 30 days. State is checkpointed to Postgres via PostgresSaver — so a 24-hour-old paused awaiting_human_approval run survives a service restart.",
      "This is the primary deterministic loop. Each node has a typed input/output schema, a clear failure mode, and a logged trace ID through Langfuse. When something breaks, you don't ssh — you read the bus health tile and the pipeline lane that's degraded.",
    ],
    talkingPoints: [
      { text: "Eight-node langgraph state machine. Deterministic, checkpointed, traced through Langfuse." },
      { text: "The pipeline view turns 'where's my content' from a Slack question into a glance at a screen. Counts at every stage." },
      { text: "Block + deny terminals capture lessons automatically. Every failure mode feeds the next generation. The loop self-improves." },
    ],
  },
];

export default function PitchPage() {
  return (
    <AppShell title="pitch tour">
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-fast mb-4 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          mission control
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">
            pitch tour
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed">
            A walkthrough of the closed-loop story across the surfaces
            that already exist. Each section has narrative explanation and
            a talking-points callout you can lift verbatim during a live
            demo. Not in the sidebar nav — bookmark this page and have it
            open during pitches as a teleprompter.
          </p>
        </div>

        <div className="space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.beat}>
              <div className="flex items-baseline gap-2 mb-3 pb-1 border-b border-border-subtle">
                <span className="text-[11px] text-text-tertiary font-mono uppercase tracking-wide">
                  Beat {section.beat} of {SECTIONS.length}
                </span>
                <Link
                  href={section.surfaceLink.href}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors duration-fast"
                >
                  {section.surfaceLink.label}
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
              <h2 className="text-xl font-semibold text-text-primary mb-3 leading-tight">
                {section.heading}
              </h2>
              <div className="space-y-3 text-sm text-text-secondary leading-relaxed mb-4">
                {section.narrative.map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
              <Card size="medium" tone="accent" className="flex flex-col">
                <CardHeader>
                  <CardLabel>talking points</CardLabel>
                  <Badge variant="default" className="font-mono tabular-nums shrink-0 text-[10px]">
                    lift verbatim
                  </Badge>
                </CardHeader>
                <ul className="space-y-2 text-sm text-text-primary leading-relaxed">
                  {section.talkingPoints.map((tp, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-text-tertiary font-mono shrink-0 mt-0.5">
                        {i + 1}.
                      </span>
                      <span>{tp.text}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>

        <section className="mt-12 pt-6 border-t border-border-subtle">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Closing — the moat slide
          </h2>
          <div className="space-y-3 text-sm text-text-secondary leading-relaxed">
            <p className="text-text-primary text-base font-medium leading-snug">
              &ldquo;The integration is the moat.&rdquo;
            </p>
            <p>
              Clipstack replaces six categories of tooling at once — website
              builder, brand identity, creative production, scheduling,
              analytics, review workflow. Specialist tools don&apos;t ship the
              orchestration layer. Horizontal AI labs don&apos;t ship the six
              verticals. One login, one invoice, one voice across every
              surface — the thing no competitor can deliver without becoming
              us.
            </p>
            <p className="text-text-primary text-base font-medium leading-snug pt-2">
              &ldquo;Persistent state is the moat.&rdquo;
            </p>
            <p>
              Every twelve months a new flagship model is 30% smarter and
              50% cheaper. The moat lives one layer below: USP 5 (lessons),
              USP 1 (workspace-relative percentile baseline), USP 3 (per-
              workspace voice corpus) all compound with every approval
              session. The model swap is non-disruptive; the workspace&apos;s
              institutional memory is the load-bearing asset.
            </p>
          </div>
        </section>

        <div className="mt-10 text-xs text-text-tertiary leading-relaxed">
          Tour matches the bento order — open Mission Control in another
          tab, click each linked surface as you cover the beat, and the
          audience sees real data (live counts, real agents, the seeded
          demo workspace) backing every claim. Reset the seed via{" "}
          <span className="font-mono">
            pnpm exec tsx scripts/seed-demo.ts
          </span>{" "}
          if the data drifts mid-rehearsal.
        </div>
      </div>
    </AppShell>
  );
}
