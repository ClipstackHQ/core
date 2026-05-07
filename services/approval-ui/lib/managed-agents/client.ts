// Managed Agents — shared Anthropic client + env resolver.
//
// First Managed Agents surface in core/. Lives in approval-ui (vs a
// separate agent-managed service) for v1 — the code path is small
// enough that an extra service + cross-service plumbing isn't worth
// the architectural cleanliness yet. If MA grows beyond /digest into
// research-crew or vertical-pack composition, extracting a dedicated
// service is the right move; for now keep it inline.
//
// Why Managed Agents at all (vs CrewAI / LangGraph already in core/):
//   - CrewAI is for per-draft choreography (8-role sequential crew).
//   - LangGraph is for state-machine control loops (publish_pipeline).
//   - Managed Agents is for stateful multi-step specialist sub-tasks
//     where Anthropic provides the container + agent loop. The /digest
//     narrative generation is the v1 use case: read workspace data,
//     write a 200-word recap, optionally render a video. Future
//     candidates: research crew, vertical-pack composition.
//
// Architecture decisions documented inline so a future dev knows why
// the integration looks the way it does.

import Anthropic from "@anthropic-ai/sdk";

let cachedClient: Anthropic | null = null;

/**
 * Returns the shared Anthropic client. Lazy-initialised so importers
 * that don't call MA paths (every page that doesn't hit /digest/narrate)
 * don't pay the import-time cost.
 *
 * Throws if ANTHROPIC_API_KEY is unset — MA cannot run without it,
 * and silently returning a non-functional client would cause confusing
 * errors deep in the request path. Fail loud at boundary.
 */
export function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not configured. Managed Agents requires a real API key — set it in .env.local.",
      );
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

/**
 * The agent ID for the weekly-digest agent. Created via
 * `pnpm exec tsx scripts/setup-managed-agents.ts` and persisted to
 * .env.local as MANAGED_AGENTS_DIGEST_AGENT_ID.
 *
 * Why we don't auto-create on first use: MA agents are persistent
 * resources keyed by ID. Creating one in the request path means a
 * new agent gets created on every cold start (or worse, every
 * request) — that's the #1 anti-pattern in the MA docs. Setup
 * happens once via a CLI script; runtime references the ID.
 */
export function getDigestAgentId(): string | null {
  return process.env.MANAGED_AGENTS_DIGEST_AGENT_ID ?? null;
}

/**
 * The environment ID for MA sessions. Same persistence model as the
 * agent ID — created once, referenced at runtime.
 */
export function getEnvironmentId(): string | null {
  return process.env.MANAGED_AGENTS_ENVIRONMENT_ID ?? null;
}

/**
 * Convenience for routes that need both the client and the IDs to
 * spawn a session. Returns null if MA isn't configured (digest agent
 * or environment not set up); the route should fall back gracefully
 * instead of 500ing.
 */
export interface ManagedAgentsConfig {
  client: Anthropic;
  digestAgentId: string;
  environmentId: string;
}

export function resolveManagedAgentsConfig(): ManagedAgentsConfig | null {
  const digestAgentId = getDigestAgentId();
  const environmentId = getEnvironmentId();
  if (!digestAgentId || !environmentId) return null;
  // getAnthropicClient throws on missing API key; let it propagate.
  return {
    client: getAnthropicClient(),
    digestAgentId,
    environmentId,
  };
}
