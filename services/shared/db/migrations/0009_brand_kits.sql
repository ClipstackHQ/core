-- 0009_brand_kits.sql — workspace brand-identity composition.
--
-- Closes the explicit follow-up loop the /workspace + /settings pages
-- reference. Stores the per-workspace brand kit: palette, typography,
-- tone of voice, optional logo URL. companies.brand_kit_id has been
-- declared since 0001 but always pointed at NULL; this migration adds
-- the table it references.
--
-- The "brand in at nine" wedge from the pitch deck ships against this
-- table — paste your homepage URL → server fetches + extracts proposed
-- brand kit fields → user reviews + saves. Heuristic extraction is the
-- v1 path (regex on inline CSS for palette, font-family for typography);
-- LLM-driven extraction lights up when ANTHROPIC_API_KEY is configured.
--
-- Applies after 0008_artifacts.sql.

-- ─── brand_kits table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_kits (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Palette — three named slots that match the asset-adapter brand-kit
  -- contract (primary / secondary / accent). Hex codes (#RRGGBB) — DB
  -- CHECK enforces the format so a malformed value can't poison the
  -- Satori adapter at render time.
  primary_color       TEXT
                      CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color     TEXT
                      CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color        TEXT
                      CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  -- Typography — "Primary Font Name". Free-form so brands using
  -- non-Google Fonts custom typefaces aren't gated. Bounded length to
  -- prevent runaway concatenation from upstream extraction.
  font_primary        TEXT CHECK (font_primary IS NULL OR char_length(font_primary) <= 120),
  font_secondary      TEXT CHECK (font_secondary IS NULL OR char_length(font_secondary) <= 120),
  -- Tone-of-voice — short sentence describing the brand voice. The
  -- voice-scorer's per-workspace embedding corpus is the load-bearing
  -- voice signal; this column is human-readable summary used in the
  -- agent crew's system prompts and in /workspace's editorial-voice
  -- column for at-a-glance reading.
  tone_of_voice       TEXT CHECK (tone_of_voice IS NULL OR char_length(tone_of_voice) <= 1000),
  -- Logo URL — optional, public URL (CDN or workspace upload).
  logo_url            TEXT CHECK (logo_url IS NULL OR char_length(logo_url) <= 1000),
  -- The URL the brand kit was inferred from (when applicable). Lets
  -- /workspace surface "imported from clipstack.app" as provenance.
  source_url          TEXT CHECK (source_url IS NULL OR char_length(source_url) <= 1000),
  -- Free-form metadata — populated by the inference path with the
  -- raw extraction details (which CSS rules matched, which fonts were
  -- proposed before the user picked the primary). Lets a future
  -- "re-import" surface diff against the prior extraction.
  inference_meta      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active brand kit per company. Future "brand kit history" lands
-- as soft-deletion + a list view; v1 is a single live row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_kits_company
  ON brand_kits (company_id);

-- ─── RLS policy ──────────────────────────────────────────────────────────
ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_kits_tenant_isolation ON brand_kits
  USING      (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- ─── updated_at trigger ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_brand_kits_updated_at ON brand_kits;
CREATE TRIGGER trg_brand_kits_updated_at
  BEFORE UPDATE ON brand_kits
  FOR EACH ROW
  EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE brand_kits IS
  'Per-workspace brand identity. Palette + typography + tone-of-voice + logo. companies.brand_kit_id back-references the active kit.';
