// Drizzle pgEnum definitions — mirror migrations/0001_init.sql exactly.
// Enum values are strings; the order matters (Postgres stores ordinal indexes)
// so adding a new value requires `ALTER TYPE ... ADD VALUE`. Keep insertions
// at the END of each list to avoid migrations that reorder.

import { pgEnum } from "drizzle-orm/pg-core";

export const companyTypeEnum = pgEnum("company_type", [
  "agency",
  "client",
  "in_house",
  "solo",
]);

export const uiModeEnum = pgEnum("ui_mode", ["web2", "web3"]);

export const agentRoleEnum = pgEnum("agent_role", [
  "orchestrator",
  "researcher",
  "strategist",
  "long_form_writer",
  "social_adapter",
  "newsletter_adapter",
  "brand_qa",
  "devils_advocate_qa",
  "engagement",
  "lifecycle",
  "trend_detector",
  "algorithm_probe",
  "live_event_monitor",
  "claim_verifier",
  "compliance",
]);

export const agentStatusEnum = pgEnum("agent_status", [
  "idle",
  "working",
  "blocked",
  "asleep",
  "fired",
]);

export const lessonKindEnum = pgEnum("lesson_kind", [
  "human_denied",
  "critic_blocked",
  "policy_rule",
]);

export const lessonScopeEnum = pgEnum("lesson_scope", [
  "forever",
  "this_topic",
  "this_client",
]);

export const approvalKindEnum = pgEnum("approval_kind", [
  "draft_publish",
  "engagement_reply",
  "campaign_launch",
  "agent_replacement",
  "reactive_trend",
  "skill_install",
  "voice_corpus_add",
  "metered_spend_unlock",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "denied",
  "expired",
  "revoked",
]);

export const denyScopeEnum = pgEnum("deny_scope", [
  "forever",
  "this_topic",
  "this_client",
]);

export const draftStatusEnum = pgEnum("draft_status", [
  "drafting",
  "in_review",
  "awaiting_approval",
  "approved",
  "scheduled",
  "published",
  "denied",
  "archived",
]);

export const channelEnum = pgEnum("channel", [
  "x",
  "linkedin",
  "reddit",
  "tiktok",
  "instagram",
  "newsletter",
  "blog",
]);

export const actorKindEnum = pgEnum("actor_kind", ["user", "agent", "system"]);

export const meterEventKindEnum = pgEnum("meter_event_kind", [
  "publish",
  "metered_asset_generation",
  "x402_outbound_call",
  "x402_inbound_call",
  "voice_score_query",
  "compliance_check",
]);

export const permissionActionEnum = pgEnum("permission_action", [
  "read",
  "create",
  "update",
  "delete",
  "approve",
  "deny",
  "publish",
  "invite",
  "revoke",
  "export",
  "admin",
]);

// Artifact taxonomy — Studio asset library (migration 0008).
//   kind   — what type of media (drives the player + adapter routing)
//   status — async lifecycle (queued → rendering → complete | failed | archived)
export const artifactKindEnum = pgEnum("artifact_kind", ["video", "image", "audio"]);

export const artifactStatusEnum = pgEnum("artifact_status", [
  "queued",
  "rendering",
  "complete",
  "failed",
  "archived",
]);
