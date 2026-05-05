// artifacts — Studio asset library.
// Per migrations/0008_artifacts.sql. One row per render job; provider
// recorded in `source` so cost-policy attributes spend correctly.
// `kind` drives the UI player; `status` tracks the async lifecycle.

import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { companies } from "./companies";
import { drafts } from "./drafts";
import { meterEvents } from "./metering";
import { artifactKindEnum, artifactStatusEnum } from "./enums";

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // Loose FK to drafts — exploratory renders never attach to a draft;
    // brief-driven renders associate so the draft detail pane can list
    // them as "supporting media".
    draftId: uuid("draft_id").references(() => drafts.id, { onDelete: "set null" }),
    kind: artifactKindEnum("kind").notNull(),
    // Free-form provider name: 'hyperframes' | 'fal' | 'runway' | 'luma' |
    // 'higgsfield' | 'motion' | 'satori' | 'elevenlabs' | 'suno' | etc.
    // Not an enum so a new provider doesn't require a migration.
    source: text("source").notNull(),
    title: text("title"),
    // Brief / prompt that drove this render. DB CHECK 1..4000 chars.
    prompt: text("prompt").notNull(),
    status: artifactStatusEnum("status").notNull().default("queued"),
    mediaUrl: text("media_url"),
    mediaMimeType: text("media_mime_type"),
    // Provider-specific metadata. Hyperframes records sceneCount,
    // appliedStyleKey, durationSec; fal records modelId, jobId; Higgsfield
    // records cameraMove, durationSec etc.
    providerMeta: jsonb("provider_meta")
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    // Bounded at DB; defensive truncation at app layer keeps the row size
    // predictable even on a runaway exception payload.
    errorMessage: text("error_message"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    // Optional FK to the meter_events row that recorded this artifact's
    // cost. Helps trace artifact → cost → CLIP rebate accrual.
    meterEventId: uuid("meter_event_id").references(() => meterEvents.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("idx_artifacts_company_created").on(
      table.companyId,
      table.createdAt,
    ),
    companySourceCreatedIdx: index("idx_artifacts_company_source_created").on(
      table.companyId,
      table.source,
      table.createdAt,
    ),
  }),
);

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
