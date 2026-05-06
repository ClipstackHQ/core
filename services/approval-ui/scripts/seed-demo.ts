// seed-demo.ts — synthetic demo workspace for design partners and local dev.
//
// Populates a single tenant (the "Demo Workspace") with realistic content so
// every Mission Control tile + page renders against actual data instead of
// the empty-state. Idempotent: re-running rebuilds the same final state by
// wiping the demo tenant up front and re-inserting with deterministic UUIDs.
//
// Run from the approval-ui package directory:
//   pnpm exec tsx scripts/seed-demo.ts
//
// Required env: DATABASE_URL (the Postgres connection string the Drizzle
// client reads in lib/db/client.ts).
//
// What this script does NOT seed:
//   - content_embeddings: vector(384) needs a real embedder to produce
//     non-degenerate vectors; recall_lessons would surface noise from random
//     floats. Wire this in after the embedder service has a /embed endpoint.
//   - bandit-orchestrator state at BANDIT_DATA_DIR/{id}.json: filesystem-
//     scoped to that container; out of scope for the approval-ui seeder.

import { and, eq } from "drizzle-orm";

import { DEMO_COMPANY_ID, DEMO_USER_ID } from "@/lib/constants/demo";
import { withTenant } from "@/lib/db/client";
import {
  agents,
  approvals,
  artifacts,
  auditLog,
  brandKits,
  companies,
  companyLessons,
  drafts,
  memberships,
  meterEvents,
  postMetrics,
  roles,
  users,
} from "@/lib/db/schema";
import type {
  NewAgent,
  NewApproval,
  NewArtifact,
  NewAuditLogRow,
  NewCompanyLesson,
  NewDraft,
  NewMeterEvent,
  NewPostMetric,
} from "@/lib/db/schema";

// ─── Stable identifiers ────────────────────────────────────────────────────
// DEMO_COMPANY_ID + DEMO_USER_ID now imported from lib/constants/demo so the
// runtime DemoBadge component reads the same value (single source of truth).
// Everything else is built from counter-derived UUIDs so re-runs collide
// rather than duplicate.

const DEMO_MEMBERSHIP_ID = "00000000-0000-0000-0000-000000000003";

/**
 * Pad a counter into a v4-shaped UUID for a given namespace digit.
 * Namespaces: 1=agent, 2=draft, 3=approval, 4=post_metric, 5=lesson,
 * 6=audit_log, 7=meter_event. Output: `aaaaaaaa-bbbb-4ccc-8ddd-NNCCCCCCCCCC`
 * (12 hex chars in the final segment) with the namespace + counter packed in.
 *
 * The "4" in position 13 + "8" in position 17 keep this a syntactically
 * valid v4 UUID, which is what Postgres's uuid type accepts.
 */
function stableUuid(namespace: number, counter: number): string {
  const ns = String(namespace).padStart(2, "0"); // 2 hex
  const c = String(counter).padStart(10, "0"); // 10 hex → 2 + 10 = 12 chars total
  return `aaaaaaaa-bbbb-4ccc-8ddd-${ns}${c}`;
}

// ─── Channel + agent role types from enum modules ──────────────────────────

type Channel = "x" | "linkedin" | "reddit" | "tiktok" | "instagram" | "newsletter" | "blog";
type DraftStatus =
  | "drafting"
  | "in_review"
  | "awaiting_approval"
  | "approved"
  | "scheduled"
  | "published"
  | "denied"
  | "archived";
type AgentRole =
  | "orchestrator"
  | "strategist"
  | "long_form_writer"
  | "social_adapter"
  | "brand_qa"
  | "claim_verifier";
type AgentStatus = "idle" | "working" | "blocked";
type LessonScope = "forever" | "this_topic" | "this_client";
type LessonKind = "human_denied" | "critic_blocked" | "policy_rule";

// ─── Agent specs ───────────────────────────────────────────────────────────

interface AgentSpec {
  role: AgentRole;
  displayName: string;
  jobDescription: string;
  status: AgentStatus;
}

const AGENT_SPECS: AgentSpec[] = [
  {
    role: "orchestrator",
    displayName: "Mira",
    jobDescription:
      "Lead orchestrator. Routes briefs to the right specialist agents, watches the publish pipeline, and escalates to a human the moment voice or claims drift outside policy.",
    status: "working",
  },
  {
    role: "strategist",
    displayName: "Strategy — Atlas",
    jobDescription:
      "Reads the campaign brief, reviews last week's percentile rankings, and decides which channels and topics deserve a draft this cycle. Owns the editorial calendar.",
    status: "idle",
  },
  {
    role: "long_form_writer",
    displayName: "Long-form — Saoirse",
    jobDescription:
      "Drafts blog posts, newsletters, and pillar essays. Pulls voice from the corpus, leans on company_lessons for what not to say, and hands off to social_adapter once a draft is approved.",
    status: "idle",
  },
  {
    role: "social_adapter",
    displayName: "Social — Kai",
    jobDescription:
      "Adapts approved long-form into channel-native LinkedIn, X, and Reddit drafts. Respects platform-specific length, tone, and hashtag conventions per the algorithm probe's last reading.",
    status: "blocked",
  },
  {
    role: "brand_qa",
    displayName: "Voice QA — Juno",
    jobDescription:
      "Scores every draft against the workspace voice corpus before it reaches the approval queue. Blocks anything below 0.72 cosine similarity until the writer revises.",
    status: "idle",
  },
  {
    role: "claim_verifier",
    displayName: "Claims — Nova",
    jobDescription:
      "Verifies every factual statement in a draft against its supporting URL. Flags drift, dead links, and unsupported claims so the human reviewer never approves stale numbers.",
    status: "idle",
  },
];

// ─── Draft specs ───────────────────────────────────────────────────────────

interface DraftSpec {
  channel: Channel;
  status: DraftStatus;
  /** Null is fine — drafts.title is nullable in the schema and X posts often run titleless. */
  title: string | null;
  body: string;
  predictedPercentile: number | null;
  ageMinutes: number; // how long ago the draft was created
  hashtags: string[];
  /**
   * Minutes from NOW until scheduled publish. Positive = future, null =
   * unscheduled. The /calendar surface reads this column to populate the
   * "upcoming" lanes; without it the page renders the loose-ends rail
   * only. Seed sets a handful of forward-dated rows so the calendar
   * demo isn't an empty grid on a fresh tenant.
   */
  scheduledInMinutes?: number | null;
}

const DRAFT_SPECS: DraftSpec[] = [
  // ─── 4 awaiting_approval ────────────────────────────────────────────────
  {
    channel: "linkedin",
    status: "awaiting_approval",
    title: "Why AI agents need editorial memory, not just retrieval",
    body:
      "Most AI marketing tools forget the lesson the moment the founder corrects them. We took a different bet at Clipstack: every human denial captures a structured rationale and a scope, then becomes a vector the next draft has to clear. The result is a system that gets sharper the more you reject it. After fourteen days with our first design partner, the agents stopped writing the three sentences the founder hated most. That's the bar.",
    predictedPercentile: 78,
    ageMinutes: 12,
    hashtags: ["AI", "marketing", "agents"],
  },
  {
    channel: "x",
    status: "awaiting_approval",
    title: null, // X posts often run titleless; intentional null
    body:
      "The honest version of 'AI replaces marketing teams' is: AI replaces the parts of marketing teams that were already templated. The strategy, the taste, the relationships — those don't compress. The drafting, the channel adaptation, the measurement loop — those do. Build the second category, leave the first.",
    predictedPercentile: 64,
    ageMinutes: 47,
    hashtags: ["AI"],
  },
  {
    channel: "newsletter",
    status: "awaiting_approval",
    title: "This week in Clipstack: percentile prediction goes live",
    body:
      "Our predictor now ships a workspace-relative score for every draft before it hits the approval queue. The number you see is calibrated against your last ninety days of post performance, not an industry benchmark. We learned the hard way that benchmarks lie — your audience isn't anyone else's audience. The model lives at services/percentile-predictor and retrains nightly on every published artifact you measure.",
    predictedPercentile: 49,
    ageMinutes: 92,
    hashtags: ["product", "ml"],
  },
  {
    channel: "blog",
    status: "awaiting_approval",
    title: "Open-core, privately licensed signals: how Clipstack splits the IP",
    body:
      "The orchestration framework is MIT-licensed and lives in the public core repo. The signal packs — regulatory regimes, platform algorithm heuristics, vertical-specific personas — sit in a private repo behind a signed-access EULA. Self-hosters get the framework. Design partners get signal access for the regimes they need. Hosted SaaS customers get all of it transparently. Three trees, three license boundaries, one CI gate that fails if core ever imports from the proprietary halves.",
    predictedPercentile: null,
    ageMinutes: 180,
    hashtags: ["open-source", "licensing", "saas"],
  },

  // ─── 2 in_review ────────────────────────────────────────────────────────
  {
    channel: "linkedin",
    status: "in_review",
    title: "The seven editorial lessons every marketing team forgets",
    body:
      "After three months of human denials at our first design partner, the same seven lessons surfaced again and again. They aren't blockchain-specific or AI-specific — they're the lessons every editorial team rediscovers in its second year. Lead with the user's problem, not the product feature. Avoid hedge words that undermine the argument. Cut the third adjective. The institutional version of these lessons is what a great editor enforces, and what most marketing operations re-learn from scratch every time someone leaves.",
    predictedPercentile: 71,
    ageMinutes: 30,
    hashtags: ["editorial", "leadership"],
  },
  {
    channel: "x",
    status: "in_review",
    title: null,
    body:
      "The cheapest moat in software right now is institutional memory. Every team is one departure away from forgetting why the second sentence on its homepage matters. Codify the lessons and the moat survives the org chart.",
    predictedPercentile: 58,
    ageMinutes: 65,
    hashtags: ["startups"],
  },

  // ─── 1 drafting ─────────────────────────────────────────────────────────
  {
    channel: "blog",
    status: "drafting",
    title: "How we measure voice drift in shipping content",
    body:
      "Voice drift is the slow tonal slide that happens when an organization grows past the point where one editor can read everything before it ships. We built a vector-similarity scorer against a seeded voice corpus per workspace, then thresholded the publish pipeline at 0.72 cosine. The number is calibrated per workspace because every brand sits at a different baseline tightness — a financial newsletter and a Web3 community manager occupy different points on the same scoring axis.",
    predictedPercentile: 55,
    ageMinutes: 240,
    hashtags: ["voice", "ml", "engineering"],
  },

  // ─── 4 published ────────────────────────────────────────────────────────
  {
    channel: "linkedin",
    status: "published",
    title: "What two months of design-partner data taught us about onboarding",
    body:
      "The single highest-leverage onboarding step turned out to be the one we almost cut: walking the founder through capturing their first three lessons. Not their first draft, not their first publish — their first lesson. The moment the system has three rationales to clear, every subsequent draft visibly improves, and the founder's trust compounds from there. We now make lesson capture the second screen of onboarding, ahead of channel connection.",
    predictedPercentile: 82,
    ageMinutes: 60 * 24 * 3, // 3 days ago
    hashtags: ["onboarding", "product"],
  },
  {
    channel: "x",
    status: "published",
    title: null,
    body:
      "Most 'AI for marketing' tools sell drafting. The interesting product is the loop: predict performance before publish, measure after, capture the lesson, retrain. Drafting is a feature. The loop is the company.",
    predictedPercentile: 75,
    ageMinutes: 60 * 24 * 5, // 5 days ago
    hashtags: ["AI", "marketing"],
  },
  {
    channel: "newsletter",
    status: "published",
    title: "Closing the loop: predict, publish, measure, learn",
    body:
      "This week the closed-loop pipeline went green end-to-end. A draft now leaves the writer with a calibrated percentile prediction, lands in the approval queue, publishes to its destination channel, and pulls metrics back into the predictor's training set within the same day. The retrieve_high_performers helper queries the post_metrics table directly, sorted by workspace-relative engagement percentile, and feeds the next strategist run. This is the loop that makes the rest of the system worth shipping.",
    predictedPercentile: 68,
    ageMinutes: 60 * 24 * 2, // 2 days ago
    hashtags: ["product", "ml"],
  },
  {
    channel: "blog",
    status: "published",
    title: "Why we chose pgvector over a dedicated vector store",
    body:
      "Pinecone, Weaviate, and Qdrant are excellent products. They are also another database to operate, another set of credentials to rotate, and another consistency boundary to reason about. Our cosine-similarity recalls fit comfortably inside Postgres with the pgvector extension and an ivfflat index, which is one of the load-bearing reasons our self-host story is two containers and a `docker compose up` instead of the seven-service deployment guide most agentic platforms ship with.",
    predictedPercentile: 60,
    ageMinutes: 60 * 24 * 6, // 6 days ago
    hashtags: ["postgres", "infrastructure"],
  },

  // ─── 1 denied ────────────────────────────────────────────────────────────
  {
    channel: "x",
    status: "denied",
    title: null,
    body:
      "Simply put, our agents are smarter than every competing tool on the market — by orders of magnitude. If you aren't using Clipstack, you're falling behind. Period.",
    predictedPercentile: 22,
    ageMinutes: 60 * 24 * 1, // 1 day ago
    hashtags: ["AI"],
  },

  // ─── 4 scheduled (future-dated) — populates /calendar's upcoming lanes ──
  // The calendar groups by scheduledAt UTC day; we seed across the next
  // ~10 days so the page renders a multi-day strip rather than collapsing
  // into a single bucket.
  {
    channel: "linkedin",
    status: "scheduled",
    title: "Three editorial primitives every AI marketing tool will steal",
    body:
      "After eighteen months of building Clipstack, three primitives keep showing up at every workspace that gets institutional voice right. Lesson capture with structured rationale + scope. Workspace-relative percentile prediction (not industry benchmark). Per-workspace voice corpus that doesn't degrade when you add a new client. The labs will catch up. The team that owns the lesson trail wins anyway.",
    predictedPercentile: 73,
    ageMinutes: 60 * 6, // created 6h ago
    scheduledInMinutes: 60 * 22, // ships in ~22h (tomorrow morning)
    hashtags: ["AI", "editorial", "marketing"],
  },
  {
    channel: "x",
    status: "scheduled",
    title: null,
    body:
      "The cheapest moat in software right now is institutional memory. Every team is one departure away from forgetting why the second sentence on its homepage matters. Codify the lessons and the moat survives the org chart.",
    predictedPercentile: 65,
    ageMinutes: 60 * 8,
    scheduledInMinutes: 60 * 24 * 2, // ships in 2 days
    hashtags: ["startups"],
  },
  {
    channel: "newsletter",
    status: "scheduled",
    title: "Calendar v1: every channel, every client, one source of truth",
    body:
      "This week's calendar surface lands. Approved drafts flow onto a slot; channel adapters pull from the same plan; conflicts surface before they ship rather than after. Drag-to-reschedule + bulk move come in the follow-up slice once the conflict detector ships. The thing that makes this feel different from every other content calendar — every row is a draft the predictor has already scored, so the calendar isn't a wishlist, it's a portfolio.",
    predictedPercentile: 70,
    ageMinutes: 60 * 12,
    scheduledInMinutes: 60 * 24 * 5, // ships in 5 days
    hashtags: ["product", "calendar"],
  },
  {
    channel: "blog",
    status: "scheduled",
    title: "What the closed-loop pipeline taught us in its first 30 days",
    body:
      "Thirty days of generate → publish → measure → learn at our first design partner. The loop's first observation: the percentile predictor's calibration band tightened from ±18 to ±11 inside two weeks of training on workspace-specific post_metrics. The second: the bandit's exploration rate dropped from 35% to 18% as Beta posteriors stabilized — meaning the system stopped second-guessing variants the workspace had already validated. The third: lessons captured per week settled at 4-7, which compounds into the strategist's brief generation through the cosine recall path.",
    predictedPercentile: 76,
    ageMinutes: 60 * 24,
    scheduledInMinutes: 60 * 24 * 9, // ships in 9 days
    hashtags: ["product", "ml", "case-study"],
  },

  // ─── 6 awaiting_approval (with scheduledAt) — targets for the
  // "approve the week in 60 seconds" wedge button on /calendar.
  // These differ from the 4 awaiting_approval drafts above (which have
  // scheduledAt=null) by being scheduled within the next 7 days. The
  // ApproveWeekButton flips them to approved on click.
  {
    channel: "x",
    status: "awaiting_approval",
    title: null,
    body:
      "Most AI 'creator tools' compress the marketing department into a chat box. Clipstack does the opposite — it spreads the work across a team of role-specialised agents who each own a stage of the loop, and gives the human the one moment where taste actually matters. That's not a chat box. That's an editor in chief.",
    predictedPercentile: 71,
    ageMinutes: 60 * 4,
    scheduledInMinutes: 60 * 26, // ~26h from now (tomorrow afternoon)
    hashtags: ["AI", "editorial"],
  },
  {
    channel: "linkedin",
    status: "awaiting_approval",
    title: "Why we ship the loop, not the drafting tool",
    body:
      "The cheapest version of an AI marketing product is a chat interface that drafts copy. The hardest version is the loop: predict performance before publish, measure after, capture the lesson, retrain. Drafting is a feature; the loop is the company. After ninety days at our design partner we can prove the calibration band tightens and the lesson archive compounds. The drafts are downstream of the system that learns.",
    predictedPercentile: 76,
    ageMinutes: 60 * 5,
    scheduledInMinutes: 60 * 24 * 2 + 60 * 4, // ~52h from now
    hashtags: ["AI", "marketing", "product"],
  },
  {
    channel: "newsletter",
    status: "awaiting_approval",
    title: "The week's wrap: top performers + lessons captured",
    body:
      "Three pieces shipped strong this week. The closed-loop launch landed at p82, the editorial-primitives explainer at p76, the long-take essay on persistent memory at p71. Two new lessons in the workspace: avoid 'simply' as a hedge, and lead with the user's problem before the product feature. Both are now vectors the next draft has to clear. See the full digest in /memory.",
    predictedPercentile: 68,
    ageMinutes: 60 * 6,
    scheduledInMinutes: 60 * 24 * 3, // 3 days from now
    hashtags: ["weekly", "product"],
  },
  {
    channel: "blog",
    status: "awaiting_approval",
    title: "Open-core in practice: what we tell self-hosters",
    body:
      "Three things every self-hoster gets without a license fee: the orchestration framework (CrewAI + LangGraph), the Mission Control UI shell, and the adapter interfaces. Three things they don't get: the regime YAMLs (MiCA / FCA / ASA / FDA), the per-platform algorithm heuristics, and the vertical-pack persona libraries. CI enforces the boundary — any PR that imports from signals/ inside core/ fails the build. That's the IP split, codified.",
    predictedPercentile: 69,
    ageMinutes: 60 * 8,
    scheduledInMinutes: 60 * 24 * 4, // 4 days from now
    hashtags: ["open-source", "product", "licensing"],
  },
  {
    channel: "linkedin",
    status: "awaiting_approval",
    title: "Specialist tools vs horizontal labs: where Clipstack lives",
    body:
      "Specialist marketing tools don't ship the orchestration layer. Horizontal AI labs don't ship the six verticals. Clipstack lives in the gap: one orchestration framework, six tooling categories collapsed into one workflow, vertical packs that compose on top. The integration is the moat — and it's the thing no competitor can deliver without becoming us.",
    predictedPercentile: 78,
    ageMinutes: 60 * 10,
    scheduledInMinutes: 60 * 24 * 5 + 60 * 8, // 5d8h from now
    hashtags: ["positioning", "AI"],
  },
  {
    channel: "x",
    status: "awaiting_approval",
    title: null,
    body:
      "Approve a week of content in sixty seconds. The agents already wrote it. The bandit already picked the variants. The predictor already said which ones will land. You confirm taste; the loop ships everything else.",
    predictedPercentile: 74,
    ageMinutes: 60 * 12,
    scheduledInMinutes: 60 * 24 * 6 + 60 * 4, // 6d4h from now
    hashtags: ["product", "AI"],
  },
];

// ─── Lesson specs ──────────────────────────────────────────────────────────

interface LessonSpec {
  kind: LessonKind;
  scope: LessonScope;
  rationale: string;
  topicTags: string[];
  daysAgo: number;
}

const LESSON_SPECS: LessonSpec[] = [
  {
    kind: "human_denied",
    scope: "forever",
    rationale:
      "Avoid 'simply' as a hedge — it undermines authority and signals the writer didn't trust the argument.",
    topicTags: ["voice", "hedging"],
    daysAgo: 1,
  },
  {
    kind: "human_denied",
    scope: "forever",
    rationale:
      "Always lead with the user's problem, not the product feature. The feature is the answer, not the opening.",
    topicTags: ["structure", "editorial"],
    daysAgo: 2,
  },
  {
    kind: "policy_rule",
    scope: "forever",
    rationale:
      "Never claim 'orders of magnitude' improvement without a benchmark, a number, and a methodology link. Marketing claims need primary sources.",
    topicTags: ["claims", "compliance"],
    daysAgo: 3,
  },
  {
    kind: "human_denied",
    scope: "this_topic",
    rationale:
      "When writing about AI agents, do not anthropomorphize past 'agent' — no 'thinks', no 'wants', no 'feels'. Describes operations, not feelings.",
    topicTags: ["AI", "voice"],
    daysAgo: 4,
  },
  {
    kind: "critic_blocked",
    scope: "forever",
    rationale:
      "Cut the third adjective every time. Two adjectives sharpen, three soften, four signal the author is hiding from the noun.",
    topicTags: ["voice", "concision"],
    daysAgo: 6,
  },
  {
    kind: "human_denied",
    scope: "this_client",
    rationale:
      "For VeChain content, never pitch token-price speculation. The community there punishes price-talk and rewards utility-talk; the entire editorial line is calibrated against that.",
    topicTags: ["client:vechain", "compliance"],
    daysAgo: 8,
  },
  {
    kind: "policy_rule",
    scope: "forever",
    rationale:
      "Every blockchain claim with a number attached needs a block-explorer URL or a primary-source link in the supporting evidence array.",
    topicTags: ["claims", "blockchain"],
    daysAgo: 10,
  },
  {
    kind: "critic_blocked",
    scope: "this_topic",
    rationale:
      "On the topic of pricing, never compare to a competitor by name in a published draft — it triggers their legal team and never converts the prospect anyway.",
    topicTags: ["pricing", "compliance"],
    daysAgo: 12,
  },
];

// ─── Audit kinds and meter kinds ───────────────────────────────────────────

const AUDIT_KINDS = [
  "approval.approved",
  "approval.denied",
  "lessons.recalled",
  "post_metrics.written",
  "experiments.listed",
  "anomalies.listed",
  "metering.written",
] as const;
type AuditKind = (typeof AUDIT_KINDS)[number];

const ACTOR_KINDS = ["user", "agent", "system"] as const;
type ActorKind = (typeof ACTOR_KINDS)[number];

const METER_KINDS = ["publish", "metered_asset_generation", "voice_score_query"] as const;
type MeterKind = (typeof METER_KINDS)[number];

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Seeded PRNG so the same counter always yields the same value. */
function rand(seed: number): number {
  // Mulberry32 — small, fast, deterministic, no deps.
  let t = seed + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pickFrom<T>(arr: readonly [T, ...T[]], seed: number): T {
  // The non-empty tuple type means arr[0] is always defined, and arr[safe]
  // is index-into-non-empty so TS keeps the narrow return type.
  const idx = Math.floor(rand(seed) * arr.length);
  const safe = Math.min(idx, arr.length - 1);
  return arr[safe] ?? arr[0];
}

function minutesAgo(min: number): Date {
  return new Date(Date.now() - min * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[seed] DATABASE_URL is not set. Export the Postgres connection string and re-run.",
    );
    process.exit(1);
  }

  // Run the entire seed inside a single tenant-scoped transaction. This
  // sets `app.current_company_id = DEMO_COMPANY_ID` at the session level so
  // every RLS-filtered statement passes — required because the application
  // user `clipstack_app` (the documented role behind DATABASE_URL) is
  // NOBYPASSRLS. Without this wrapper every DELETE silently affects 0 rows
  // and the company INSERT fails the WITH CHECK predicate (`id = active`).
  //
  // The DEMO_COMPANY_ID is the value the policy compares against on both
  // the companies table (`id = app_current_company_id()`) and every child
  // table (`app_company_matches(company_id)`), so wiping + reinserting the
  // demo tenant works inside one txn.
  await withTenant(DEMO_COMPANY_ID, async (tx) => {
    console.log("[seed] wiping any prior demo-tenant rows for idempotency...");
    // Order matters — children before parents. Most tables ON DELETE CASCADE
    // off companies, but cleaning explicitly keeps the script obvious.
    await tx.delete(brandKits).where(eq(brandKits.companyId, DEMO_COMPANY_ID));
    await tx.delete(artifacts).where(eq(artifacts.companyId, DEMO_COMPANY_ID));
    await tx.delete(meterEvents).where(eq(meterEvents.companyId, DEMO_COMPANY_ID));
    await tx.delete(auditLog).where(eq(auditLog.companyId, DEMO_COMPANY_ID));
    await tx.delete(companyLessons).where(eq(companyLessons.companyId, DEMO_COMPANY_ID));
    await tx.delete(postMetrics).where(eq(postMetrics.companyId, DEMO_COMPANY_ID));
    // drafts.approval_id has no FK enforced in Drizzle (cycle break) but the
    // DB FK is deferred; clear approvals first via the draft cascade trick:
    // null out drafts.approvalId, then delete approvals, then drafts, then agents.
    await tx
      .update(drafts)
      .set({ approvalId: null })
      .where(eq(drafts.companyId, DEMO_COMPANY_ID));
    await tx.delete(approvals).where(eq(approvals.companyId, DEMO_COMPANY_ID));
    await tx.delete(drafts).where(eq(drafts.companyId, DEMO_COMPANY_ID));
    await tx.delete(agents).where(eq(agents.companyId, DEMO_COMPANY_ID));
    await tx.delete(memberships).where(eq(memberships.companyId, DEMO_COMPANY_ID));
    // Don't drop the user yet — keep workosUserId stable across runs.
    await tx.delete(companies).where(eq(companies.id, DEMO_COMPANY_ID));

    console.log("[seed] inserting Demo Workspace company + user + membership...");

    await tx
      .insert(companies)
      .values({
        id: DEMO_COMPANY_ID,
        name: "Demo Workspace",
        type: "in_house",
        uiMode: "web2",
        // companies has no slug/website columns; stash on contextJson per the
        // schema's documented escape hatch.
        contextJson: {
          slug: "demo",
          website: "https://demo.clipstack.app",
          seedSource: "scripts/seed-demo.ts",
        },
      })
      .onConflictDoNothing();

    await tx
      .insert(users)
      .values({
        id: DEMO_USER_ID,
        email: "demo@clipstack.app",
        name: "Demo User",
        workosUserId: "demo_user_v1",
        uiMode: "web2",
      })
      .onConflictDoNothing();

    // Owner role is auto-seeded by the trigger in 0003_rbac_seed.sql when the
    // company row is inserted. Look it up here to bind the membership.
    const ownerRoleRow = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.companyId, DEMO_COMPANY_ID), eq(roles.slug, "owner")))
      .limit(1);
    const ownerRoleId = ownerRoleRow[0]?.id;
    if (!ownerRoleId) {
      throw new Error(
        "[seed] owner role not found — the 0003_rbac_seed trigger should auto-seed it on company insert. Check that migration 0003 has been applied.",
      );
    }

    await tx
      .insert(memberships)
      .values({
        id: DEMO_MEMBERSHIP_ID,
        userId: DEMO_USER_ID,
        companyId: DEMO_COMPANY_ID,
        roleId: ownerRoleId,
      })
      .onConflictDoNothing();

    console.log(`[seed] inserting ${AGENT_SPECS.length} agents...`);
    const agentValues: NewAgent[] = AGENT_SPECS.map((spec, i) => ({
      id: stableUuid(1, i),
      companyId: DEMO_COMPANY_ID,
      role: spec.role,
      displayName: spec.displayName,
      jobDescription: spec.jobDescription,
      status: spec.status,
      modelProfile: "WRITER_MODEL",
      toolsAllowed: ["asset.generate", "draft.publish", "lesson.record"],
    }));
    await tx.insert(agents).values(agentValues).onConflictDoNothing();

    console.log(`[seed] inserting ${DRAFT_SPECS.length} drafts + matching approvals...`);
    // Round-robin draft authorship across the four "writer-ish" agents
    // (orchestrator + strategist + long_form_writer + social_adapter).
    const writerAgentIds = [
      agentValues[0]?.id, // orchestrator
      agentValues[1]?.id, // strategist
      agentValues[2]?.id, // long_form_writer
      agentValues[3]?.id, // social_adapter
    ].filter((id): id is string => Boolean(id));

    // Pre-compute draft IDs so the approval-binding step below can reference
    // them as plain `string` (no `as string` casts, no `?? ""` fallbacks).
    const draftIds: string[] = DRAFT_SPECS.map((_, i) => stableUuid(2, i));

    const draftValues: NewDraft[] = DRAFT_SPECS.map((spec, i) => {
      const created = minutesAgo(spec.ageMinutes);
      const authorId = writerAgentIds[i % writerAgentIds.length];
      // scheduledInMinutes is forward-dated (positive = future). Convert
      // to a Date by adding to now() rather than the inverse-of-minutesAgo
      // path (which is for past-dated rows like createdAt/publishedAt).
      const scheduledAt =
        typeof spec.scheduledInMinutes === "number"
          ? new Date(Date.now() + spec.scheduledInMinutes * 60 * 1000)
          : null;
      return {
        id: draftIds[i],
        companyId: DEMO_COMPANY_ID,
        channel: spec.channel,
        status: spec.status,
        title: spec.title,
        body: spec.body,
        hashtags: spec.hashtags,
        voiceScore: spec.status === "denied" ? 0.41 : 0.78 + (i % 5) * 0.03,
        predictedPercentile: spec.predictedPercentile,
        authoredByAgentId: authorId ?? null,
        createdAt: created,
        updatedAt: created,
        // publishedAt only for published drafts
        publishedAt: spec.status === "published" ? created : null,
        publishedUrl:
          spec.status === "published"
            ? `https://demo.clipstack.app/p/${i}-${spec.channel}`
            : null,
        scheduledAt,
      };
    });
    await tx.insert(drafts).values(draftValues).onConflictDoNothing();

    // Build approval rows: one per draft that needs human action.
    // - awaiting_approval / in_review → status=pending
    // - denied → status=denied + denyRationale + denyScope
    const approvalRows: { draftIdx: number; approvalId: string; approval: NewApproval }[] = [];
    let approvalCounter = 0;
    for (let i = 0; i < DRAFT_SPECS.length; i++) {
      const spec = DRAFT_SPECS[i];
      const draftRow = draftValues[i];
      const draftId = draftIds[i];
      if (!spec || !draftRow || !draftId) continue;

      if (spec.status === "awaiting_approval" || spec.status === "in_review") {
        const approvalId = stableUuid(3, approvalCounter++);
        approvalRows.push({
          draftIdx: i,
          approvalId,
          approval: {
            id: approvalId,
            companyId: DEMO_COMPANY_ID,
            kind: "draft_publish",
            status: "pending",
            payload: {
              draftId,
              channel: spec.channel,
              predictedPercentile: spec.predictedPercentile,
            },
            createdByAgentId: draftRow.authoredByAgentId ?? null,
            createdAt: minutesAgo(spec.ageMinutes - 1),
          },
        });
      } else if (spec.status === "denied") {
        const approvalId = stableUuid(3, approvalCounter++);
        approvalRows.push({
          draftIdx: i,
          approvalId,
          approval: {
            id: approvalId,
            companyId: DEMO_COMPANY_ID,
            kind: "draft_publish",
            status: "denied",
            payload: {
              draftId,
              channel: spec.channel,
            },
            createdByAgentId: draftRow.authoredByAgentId ?? null,
            createdAt: minutesAgo(spec.ageMinutes + 30),
            decidedByUserId: DEMO_USER_ID,
            decidedAt: minutesAgo(spec.ageMinutes),
            denyRationale:
              "Hyperbolic claim without supporting evidence — 'orders of magnitude' needs a benchmark and 'period' is hostile sign-off. Rewrite without the superlatives.",
            denyScope: "forever",
          },
        });
      }
    }
    if (approvalRows.length > 0) {
      await tx
        .insert(approvals)
        .values(approvalRows.map((r) => r.approval))
        .onConflictDoNothing();
      // Back-link drafts.approvalId so the inbox query joins cleanly.
      for (const row of approvalRows) {
        const draftId = draftIds[row.draftIdx];
        if (!draftId) continue;
        await tx
          .update(drafts)
          .set({ approvalId: row.approvalId })
          .where(eq(drafts.id, draftId));
      }
    }

    console.log("[seed] inserting post_metrics for the 4 published drafts...");
    const publishedIndices = DRAFT_SPECS
      .map((spec, i) => ({ spec, i }))
      .filter(({ spec }) => spec.status === "published")
      .map(({ i }) => i);

    const metricRows: NewPostMetric[] = [];
    let metricCounter = 0;
    for (const draftIdx of publishedIndices) {
      const spec = DRAFT_SPECS[draftIdx];
      const draftId = draftIds[draftIdx];
      if (!spec || !draftId) continue;
      // Generate ~10 snapshots over the last 7 days for each. Realistic
      // monotonic-ish growth so the trend chart slopes upward.
      for (let snap = 0; snap < 10; snap++) {
        const seed = draftIdx * 100 + snap;
        const ageHours = 24 * 7 - snap * 16; // ~16h between snapshots
        const impressionsBase = 5000 + Math.floor(rand(seed) * 45_000);
        const impressions = Math.floor(impressionsBase * (0.4 + snap * 0.07));
        const ctr = 0.01 + rand(seed + 1) * 0.04; // 1-5%
        const clicks = Math.floor(impressions * ctr);
        const reactions = Math.floor(clicks * (0.08 + rand(seed + 2) * 0.04));
        const shares = Math.floor(reactions * (0.01 + rand(seed + 3) * 0.02));
        const comments = Math.floor(reactions * 0.15);
        const saves = Math.floor(reactions * 0.05);
        const conversions = Math.floor(clicks * (0.005 + rand(seed + 4) * 0.015));
        const engagementRate =
          impressions > 0 ? (reactions + comments + shares + saves) / impressions : 0;
        const conversionRate = clicks > 0 ? conversions / clicks : 0;

        metricRows.push({
          id: stableUuid(4, metricCounter++),
          companyId: DEMO_COMPANY_ID,
          draftId,
          platform: spec.channel,
          snapshotAt: new Date(Date.now() - ageHours * 60 * 60 * 1000),
          impressions,
          reach: Math.floor(impressions * 0.85),
          clicks,
          reactions,
          comments,
          shares,
          saves,
          conversions,
          ctr,
          engagementRate,
          conversionRate,
          ctrPercentile: 30 + rand(seed + 5) * 60,
          engagementPercentile: 30 + rand(seed + 6) * 60,
          conversionPercentile: 30 + rand(seed + 7) * 60,
          raw: { source: "seed-demo" },
        });
      }
    }
    if (metricRows.length > 0) {
      await tx.insert(postMetrics).values(metricRows).onConflictDoNothing();
    }

    console.log(`[seed] inserting ${LESSON_SPECS.length} company_lessons...`);
    // The orchestrator agent captures most of them; some are user-captured.
    const orchestratorAgentId = agentValues[0]?.id ?? null;
    const lessonValues: NewCompanyLesson[] = LESSON_SPECS.map((spec, i) => ({
      id: stableUuid(5, i),
      companyId: DEMO_COMPANY_ID,
      kind: spec.kind,
      scope: spec.scope,
      rationale: spec.rationale,
      topicTags: spec.topicTags,
      // Skip embedding — vector(384) needs a real embedder; recall_lessons can
      // function on text/tag matching for the seed and the embedder backfills
      // when it's wired up.
      embedding: null,
      capturedByUserId: i % 2 === 0 ? DEMO_USER_ID : null,
      capturedByAgentId: i % 2 === 0 ? null : orchestratorAgentId,
      capturedAt: daysAgo(spec.daysAgo),
    }));
    await tx.insert(companyLessons).values(lessonValues).onConflictDoNothing();

    console.log("[seed] inserting 30 audit_log rows over the last 7 days...");
    const auditValues: NewAuditLogRow[] = [];
    for (let i = 0; i < 30; i++) {
      const kind: AuditKind = pickFrom(AUDIT_KINDS, i);
      const actorKind: ActorKind = pickFrom(ACTOR_KINDS, i + 100);
      const hoursAgo = Math.floor(rand(i + 200) * 24 * 7);
      let actorId: string | null = null;
      if (actorKind === "user") actorId = DEMO_USER_ID;
      else if (actorKind === "agent") {
        const a = agentValues[i % agentValues.length];
        actorId = a?.id ?? null;
      } else actorId = "system";

      let detailsJson: Record<string, unknown> = {};
      if (kind === "approval.approved" || kind === "approval.denied") {
        const draftRow = draftValues[i % draftValues.length];
        detailsJson = {
          draftId: draftRow?.id ?? null,
          channel: draftRow?.channel ?? "linkedin",
        };
      } else if (kind === "lessons.recalled") {
        detailsJson = { matchedCount: 1 + Math.floor(rand(i) * 4) };
      } else if (kind === "post_metrics.written") {
        const draftRow = draftValues[i % draftValues.length];
        detailsJson = {
          draftId: draftRow?.id ?? null,
          platform: draftRow?.channel ?? "linkedin",
          impressions: 1000 + Math.floor(rand(i) * 50_000),
        };
      } else if (kind === "experiments.listed") {
        detailsJson = { count: 2 + Math.floor(rand(i) * 5) };
      } else if (kind === "anomalies.listed") {
        detailsJson = { count: Math.floor(rand(i) * 3) };
      } else if (kind === "metering.written") {
        detailsJson = { kind: "publish", quantity: 1 };
      }

      auditValues.push({
        id: stableUuid(6, i),
        companyId: DEMO_COMPANY_ID,
        kind,
        actorKind,
        actorId,
        detailsJson,
        occurredAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
      });
    }
    await tx.insert(auditLog).values(auditValues).onConflictDoNothing();

    console.log("[seed] inserting 20 meter_events for the current month...");
    const meterValues: NewMeterEvent[] = [];
    for (let i = 0; i < 20; i++) {
      const kind: MeterKind = pickFrom(METER_KINDS, i + 300);
      // Spread across the current month — 0..30 days back, but never future.
      const hoursAgo = Math.floor(rand(i + 400) * 24 * 30);
      // totalCostUsd in [0.01, 2.50]
      const totalCostUsd = 0.01 + rand(i + 500) * 2.49;
      const quantity = kind === "voice_score_query" ? 10 + Math.floor(rand(i) * 90) : 1;
      const unitCostUsd = quantity > 0 ? totalCostUsd / quantity : totalCostUsd;
      meterValues.push({
        id: stableUuid(7, i),
        companyId: DEMO_COMPANY_ID,
        kind,
        quantity,
        unitCostUsd,
        totalCostUsd,
        refKind: kind === "publish" ? "draft" : null,
        refId: kind === "publish" ? (draftIds[i % draftIds.length] ?? null) : null,
        occurredAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
      });
    }
    await tx.insert(meterEvents).values(meterValues).onConflictDoNothing();

    // ─── Studio artifacts ───────────────────────────────────────────────
    // Sample artifacts across every adapter source so /studio's recent-
    // renders list demos the FREE composers (satori, motion, hyperframes)
    // alongside the METERED providers (higgsfield, runway, luma,
    // elevenlabs, suno) — even before any real key is configured.
    //
    // Each row has a deterministic UUID + realistic prompt + status
    // representative of how that adapter typically lands. Complete
    // rows point at placeholder paths that may not exist on disk
    // locally — the player elements render either way, and a missing
    // file shows the right "rendered but not on this disk" UX for a
    // cold-start demo.
    console.log("[seed] inserting Studio artifacts across all adapters...");
    const artifactValues: NewArtifact[] = [
      {
        id: stableUuid(8, 0),
        companyId: DEMO_COMPANY_ID,
        kind: "video",
        source: "hyperframes",
        title: "Q4 results — 47% YoY growth headline",
        prompt:
          "A 10-second LinkedIn announcement video. Three scenes: (1) headline 'Q4 was the strongest quarter on record', (2) the stat '47% YoY revenue growth' in big mono numbers, (3) call-to-action 'Read the full investor brief'.",
        status: "complete",
        mediaUrl: "/uploads/hyperframes/sample-q4-headline.mp4",
        mediaMimeType: "video/mp4",
        providerMeta: {
          aspectRatio: "16:9",
          durationSec: 10,
          appliedStyleKey: "default",
          mode: "scene",
          completedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
        costUsd: 0,
        createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
      },
      {
        id: stableUuid(8, 1),
        companyId: DEMO_COMPANY_ID,
        kind: "video",
        source: "hyperframes",
        title: "Closed-loop pipeline launch — newsletter teaser",
        prompt:
          "A 15-second vertical (9:16) Instagram Reels teaser for the closed-loop pipeline launch. Scene 1: 'Predict before publish', Scene 2: 'Measure after', Scene 3: 'Retrain nightly', closing card 'The loop is the company.'",
        status: "rendering",
        mediaUrl: null,
        mediaMimeType: "video/mp4",
        providerMeta: {
          aspectRatio: "9:16",
          durationSec: 15,
          mode: "scene",
        },
        costUsd: 0,
        createdAt: new Date(Date.now() - 30 * 1000), // 30s ago — actively rendering
      },
      {
        id: stableUuid(8, 2),
        companyId: DEMO_COMPANY_ID,
        kind: "video",
        source: "hyperframes",
        title: "Open-core split announcement (failed render)",
        prompt:
          "A 20-second blog header announcing the three-tier open-core architecture: core/ MIT (public), signals/ proprietary, hosted/ SaaS.",
        status: "failed",
        mediaUrl: null,
        mediaMimeType: "video/mp4",
        providerMeta: {
          aspectRatio: "16:9",
          durationSec: 20,
          mode: "scene",
        },
        errorMessage:
          "npx hyperframes exited 1. stderr: ffmpeg encoder libx264 not available — install with: brew install ffmpeg --with-libx264 (or set HYPERFRAMES_CODEC=h264_videotoolbox on Apple Silicon).",
        costUsd: 0,
        createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10min ago
      },
      // ─── Satori (FREE, image, complete) ────────────────────────────
      {
        id: stableUuid(8, 3),
        companyId: DEMO_COMPANY_ID,
        kind: "image",
        source: "satori",
        title: "Q3 governance metrics — LinkedIn header",
        prompt:
          "A LinkedIn header card: foundation governance Q3 metrics — 3 proposals submitted, 2 ratified, 94.3% validator participation.",
        status: "complete",
        mediaUrl: "/uploads/satori/sample-q3-governance.png",
        mediaMimeType: "image/png",
        providerMeta: {
          aspectRatio: "16:9",
          dimensions: { w: 1920, h: 1080 },
          template: "editorial",
          providerModelId: "satori-editorial-v1",
        },
        costUsd: 0,
        createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4h ago
      },
      // ─── Motion (FREE, video, complete) ────────────────────────────
      {
        id: stableUuid(8, 4),
        companyId: DEMO_COMPANY_ID,
        kind: "video",
        source: "motion",
        title: "Quick stat reveal — daily-active growth",
        prompt:
          "A 5-second stat reveal: 'DAU growth: +47% MoM' on charcoal background, no animation.",
        status: "complete",
        mediaUrl: "/uploads/motion/sample-dau-growth.mp4",
        mediaMimeType: "video/mp4",
        providerMeta: {
          aspectRatio: "16:9",
          durationSec: 5,
          dimensions: { w: 1920, h: 1080 },
          encoder: "libx264",
          providerModelId: "motion-drawtext-v1",
        },
        costUsd: 0,
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3h ago
      },
      // ─── Higgsfield (METERED, video, complete) ────────────────────
      {
        id: stableUuid(8, 5),
        companyId: DEMO_COMPANY_ID,
        kind: "video",
        source: "higgsfield",
        title: "Cinematic product reveal — orbital camera move",
        prompt:
          "A 5-second cinematic product reveal with an orbital camera move around a product silhouette, charcoal-to-amber lighting, 16:9 broadcast quality.",
        status: "complete",
        mediaUrl: "/uploads/stubs/higgsfield-placeholder.mp4",
        mediaMimeType: "video/mp4",
        providerMeta: {
          aspectRatio: "16:9",
          durationSec: 5,
          cameraMove: "orbit",
          stub: true,
          providerModelId: "higgsfield-mix-v1",
          wouldHaveCost: 0.55,
        },
        costUsd: 0.55,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
      },
      // ─── Runway (METERED, video, complete) ────────────────────────
      {
        id: stableUuid(8, 6),
        companyId: DEMO_COMPANY_ID,
        kind: "video",
        source: "runway",
        title: "Strong-motion social clip — 5s LinkedIn vertical",
        prompt:
          "A 5-second vertical (9:16) social clip with strong motion: a cityscape morning timelapse, soft warm light, ending on a single window lit.",
        status: "complete",
        mediaUrl: "/uploads/stubs/runway-placeholder.mp4",
        mediaMimeType: "video/mp4",
        providerMeta: {
          aspectRatio: "9:16",
          durationSec: 5,
          stub: true,
          providerModelId: "gen3a-turbo",
          wouldHaveCost: 1.50,
        },
        costUsd: 1.50,
        createdAt: new Date(Date.now() - 90 * 60 * 1000), // 1.5h ago
      },
      // ─── Luma (METERED, video, rendering) ────────────────────────
      {
        id: stableUuid(8, 7),
        companyId: DEMO_COMPANY_ID,
        kind: "video",
        source: "luma",
        title: "9-second sustainability hero — long take",
        prompt:
          "A 9-second hero video for an ESG-aligned campaign: a long take of solar panels at golden hour, slow camera dolly, no cuts.",
        status: "rendering",
        mediaUrl: null,
        mediaMimeType: "video/mp4",
        providerMeta: {
          aspectRatio: "16:9",
          durationSec: 9,
          providerModelId: "ray-2",
        },
        costUsd: 0,
        createdAt: new Date(Date.now() - 60 * 1000), // 1min ago
      },
      // ─── ElevenLabs (METERED, audio, complete) ───────────────────
      {
        id: stableUuid(8, 8),
        companyId: DEMO_COMPANY_ID,
        kind: "audio",
        source: "elevenlabs",
        title: "Q4 results narration — 30s",
        prompt:
          "A 30-second narration in a measured, institutional voice. Script: 'Q4 was the strongest quarter on record. Revenue grew 47% year-over-year. The closed-loop pipeline shipped end-to-end in week 12. Read the full investor brief at the link below.'",
        status: "complete",
        mediaUrl: "/uploads/stubs/elevenlabs-placeholder.mp3",
        mediaMimeType: "audio/mpeg",
        providerMeta: {
          voiceId: "21m00Tcm4TlvDq8ikWAM",
          charCount: 240,
          stub: true,
          providerModelId: "eleven_multilingual_v2",
          wouldHaveCost: 0.072,
        },
        costUsd: 0.072,
        createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6h ago
      },
      // ─── Suno (METERED, audio, complete) ─────────────────────────
      {
        id: stableUuid(8, 9),
        companyId: DEMO_COMPANY_ID,
        kind: "audio",
        source: "suno",
        title: "Brand intro track — 30s loop",
        prompt:
          "A 30-second brand intro loop in the style of synthwave + minimalist piano. Tempo 110bpm, key D minor, no vocals. Suitable for podcast intro + LinkedIn video background.",
        status: "complete",
        mediaUrl: "/uploads/stubs/suno-placeholder.mp3",
        mediaMimeType: "audio/mpeg",
        providerMeta: {
          stub: true,
          providerModelId: "chirp-v3-5",
          wouldHaveCost: 0.10,
        },
        costUsd: 0.10,
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5h ago
      },
    ];
    await tx.insert(artifacts).values(artifactValues).onConflictDoNothing();

    // ─── Brand kit (Slice 3 / lost wedges) ─────────────────────────────
    // The "brand in at nine" wedge — a saved brand kit so /workspace
    // renders the existing-kit summary on cold start. Imported from
    // demo.clipstack.app (the seeded workspace's website). Doc 8
    // charcoal-and-teal palette + Inter Variable typography to match
    // Mission Control visually.
    console.log("[seed] inserting demo brand kit...");
    await tx.insert(brandKits).values({
      companyId: DEMO_COMPANY_ID,
      primaryColor: "#0B0C0E",      // Doc 8 charcoal base
      secondaryColor: "#14B8A6",    // Doc 8 accent-500 teal
      accentColor: "#F2A93A",       // Doc 8 amber accent
      fontPrimary: "Inter Variable",
      fontSecondary: "JetBrains Mono Variable",
      toneOfVoice:
        "Editorial, institutional, grandiose-over-specific. Lead with the user's problem, not the product feature. Cut the third adjective. Avoid hedge words. Two-sentence paragraphs over four. Mono-numerals for every metric.",
      logoUrl: null,
      sourceUrl: "https://demo.clipstack.app",
      inferenceMeta: {
        method: "seed",
        seededAt: new Date().toISOString(),
      },
    }).onConflictDoNothing();
    // Back-fill companies.brand_kit_id so /settings reads the active kit.
    const [kitRow] = await tx
      .select({ id: brandKits.id })
      .from(brandKits)
      .where(eq(brandKits.companyId, DEMO_COMPANY_ID))
      .limit(1);
    if (kitRow) {
      await tx
        .update(companies)
        .set({ brandKitId: kitRow.id, updatedAt: new Date() })
        .where(eq(companies.id, DEMO_COMPANY_ID));
    }

    console.log(
      `[seed] done — ${AGENT_SPECS.length} agents, ${DRAFT_SPECS.length} drafts, ${approvalRows.length} approvals, ${metricRows.length} post_metrics rows, ${LESSON_SPECS.length} lessons, ${auditValues.length} audit rows, ${meterValues.length} meter events, ${artifactValues.length} artifacts`,
    );
    console.log("[seed] login at http://localhost:3000/login as demo@clipstack.app");
  });
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  });
