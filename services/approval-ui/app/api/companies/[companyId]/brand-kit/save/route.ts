// POST /api/companies/:companyId/brand-kit/save
// Persist a (reviewed) brand kit proposal. Body matches the
// BrandKitProposal shape from infer-from-url; user may edit any
// field before saving.
//
// Upsert semantics: one active brand kit per company (uniqueIndex on
// brand_kits.company_id). Re-importing replaces the prior kit; v2
// adds a soft-delete + history list.

import { type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { brandKits } from "@/lib/db/schema/brand-kits";
import { companies } from "@/lib/db/schema/companies";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Hex pattern enforcement at the API layer mirrors the DB CHECK.
// Cleaner error message than letting Postgres reject after a roundtrip.
const HexPattern = /^#[0-9a-fA-F]{6}$/;

const BodySchema = z.object({
  primaryColor: z.string().regex(HexPattern).nullable().optional(),
  secondaryColor: z.string().regex(HexPattern).nullable().optional(),
  accentColor: z.string().regex(HexPattern).nullable().optional(),
  fontPrimary: z.string().max(120).nullable().optional(),
  fontSecondary: z.string().max(120).nullable().optional(),
  toneOfVoice: z.string().max(1000).nullable().optional(),
  logoUrl: z.string().url().max(1000).nullable().optional(),
  sourceUrl: z.string().url().max(1000).nullable().optional(),
  inferenceMeta: z.record(z.string(), z.unknown()).optional(),
});

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

export const POST = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    validationFailed("invalid brand-kit save body", { issues: parsed.error.issues });
  }

  const data = parsed.data;

  const result = await withTenant(companyId, async (tx) => {
    // Check for existing kit; upsert path differs based on whether one
    // exists (Drizzle's onConflictDoUpdate is fine but we want explicit
    // audit on update vs insert).
    const existing = await tx
      .select({ id: brandKits.id })
      .from(brandKits)
      .where(eq(brandKits.companyId, companyId))
      .limit(1);

    if (existing.length > 0) {
      const id = existing[0]!.id;
      await tx
        .update(brandKits)
        .set({
          primaryColor: data.primaryColor ?? null,
          secondaryColor: data.secondaryColor ?? null,
          accentColor: data.accentColor ?? null,
          fontPrimary: data.fontPrimary ?? null,
          fontSecondary: data.fontSecondary ?? null,
          toneOfVoice: data.toneOfVoice ?? null,
          logoUrl: data.logoUrl ?? null,
          sourceUrl: data.sourceUrl ?? null,
          inferenceMeta: data.inferenceMeta ?? {},
          updatedAt: new Date(),
        })
        .where(eq(brandKits.id, id));

      await auditAccess({
        tx,
        ctx: ctxAuth,
        companyId,
        kind: "brand_kit.updated",
        details: { sourceUrl: data.sourceUrl, brandKitId: id },
      });

      return { id, action: "updated" as const };
    }

    const [inserted] = await tx
      .insert(brandKits)
      .values({
        companyId,
        primaryColor: data.primaryColor ?? null,
        secondaryColor: data.secondaryColor ?? null,
        accentColor: data.accentColor ?? null,
        fontPrimary: data.fontPrimary ?? null,
        fontSecondary: data.fontSecondary ?? null,
        toneOfVoice: data.toneOfVoice ?? null,
        logoUrl: data.logoUrl ?? null,
        sourceUrl: data.sourceUrl ?? null,
        inferenceMeta: data.inferenceMeta ?? {},
      })
      .returning({ id: brandKits.id });
    if (!inserted) badRequest("failed to insert brand kit");

    // Back-fill companies.brand_kit_id so /workspace + /settings can
    // surface the active kit without a JOIN.
    await tx
      .update(companies)
      .set({ brandKitId: inserted.id, updatedAt: new Date() })
      .where(eq(companies.id, companyId));

    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "brand_kit.created",
      details: { sourceUrl: data.sourceUrl, brandKitId: inserted.id },
    });

    return { id: inserted.id, action: "created" as const };
  });

  return ok({ companyId, ...result });
});
