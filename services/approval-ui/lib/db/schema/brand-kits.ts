// brand_kits — workspace brand identity composition.
// Per migrations/0009_brand_kits.sql. One active row per company; future
// "brand kit history" lands as soft-deletion + list view.

import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { companies } from "./companies";

export const brandKits = pgTable(
  "brand_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    primaryColor: text("primary_color"),
    secondaryColor: text("secondary_color"),
    accentColor: text("accent_color"),
    fontPrimary: text("font_primary"),
    fontSecondary: text("font_secondary"),
    toneOfVoice: text("tone_of_voice"),
    logoUrl: text("logo_url"),
    sourceUrl: text("source_url"),
    inferenceMeta: jsonb("inference_meta")
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUnique: uniqueIndex("idx_brand_kits_company").on(table.companyId),
  }),
);

export type BrandKit = typeof brandKits.$inferSelect;
export type NewBrandKit = typeof brandKits.$inferInsert;
