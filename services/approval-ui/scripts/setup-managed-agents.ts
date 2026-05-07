// One-time setup for Managed Agents. Creates the Clipstack environment
// + the digest agent, then prints the IDs to copy into .env.local.
//
// Run from services/approval-ui:
//   pnpm exec tsx scripts/setup-managed-agents.ts
//
// Idempotency: this script is NOT idempotent. Each run creates new
// resources (matches the MA design: agents are append-only, you update
// in-place). If you've already run it once, copy the printed IDs into
// .env.local and don't run it again — running it twice creates a
// second agent + environment and orphans the first.
//
// To update an existing agent (change system prompt, add tools), use
// the update API instead — see managed-agents-core.md → Versioning.
// That path lands as a follow-up; v1 of this POC just creates.
//
// Required env: ANTHROPIC_API_KEY (a real one — Managed Agents is a
// real beta surface and creates real billable resources).

import {
  getAnthropicClient,
} from "@/lib/managed-agents/client";
import {
  DIGEST_AGENT_NAME,
  DIGEST_AGENT_SYSTEM_PROMPT,
  DIGEST_AGENT_TOOLS,
} from "@/lib/managed-agents/digest-agent";

async function main(): Promise<void> {
  console.log("[managed-agents:setup] ─── creating Managed Agents resources ───");
  console.log("");

  const client = getAnthropicClient();

  // ─── Environment ─────────────────────────────────────────────────────
  // Cloud sandbox with unrestricted networking. Restricted networking
  // would require allowlisting every host the agent might fetch from
  // (web_search would break against unknown domains). For the digest
  // agent this is overkill — it's reading a structured input, not
  // crawling the web — but the same environment will be reused by
  // future MA agents (research crew, vertical-pack composition) that
  // benefit from the open egress. One environment, multiple agents.
  console.log("[managed-agents:setup] creating environment...");
  const environment = await client.beta.environments.create({
    name: "clipstack-default",
    description:
      "Default Clipstack environment for Managed Agents. Cloud sandbox with unrestricted networking. Reused across digest agent + future research / vertical-pack composition agents.",
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
    },
  });
  console.log(`[managed-agents:setup]   ✓ environment.id: ${environment.id}`);

  // ─── Digest agent ────────────────────────────────────────────────────
  console.log("[managed-agents:setup] creating digest agent...");
  const agent = await client.beta.agents.create({
    name: DIGEST_AGENT_NAME,
    model: "claude-opus-4-7",
    description:
      "Reads a workspace's weekly digest data (top performers, lessons captured, anomalies, decisions made) and writes a 200-word editorial recap in Clipstack's voice. Used by the /digest page's 'Generate narrative' button.",
    system: DIGEST_AGENT_SYSTEM_PROMPT,
    tools: [...DIGEST_AGENT_TOOLS],
  });
  console.log(`[managed-agents:setup]   ✓ agent.id: ${agent.id}`);
  console.log(`[managed-agents:setup]   ✓ agent.version: ${agent.version}`);

  // ─── Print env-var snippet for copy/paste ────────────────────────────
  console.log("");
  console.log("─".repeat(72));
  console.log("Add these lines to services/approval-ui/.env.local:");
  console.log("");
  console.log(`MANAGED_AGENTS_ENVIRONMENT_ID=${environment.id}`);
  console.log(`MANAGED_AGENTS_DIGEST_AGENT_ID=${agent.id}`);
  console.log("─".repeat(72));
  console.log("");
  console.log(
    "Restart the dev server after updating .env.local. The /digest page's",
  );
  console.log(
    "'Generate narrative' button surfaces only when both env vars are set.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[managed-agents:setup] failed:", err);
    process.exit(1);
  });
