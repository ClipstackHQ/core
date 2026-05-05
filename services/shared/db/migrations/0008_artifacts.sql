-- 0008_artifacts.sql — Studio asset library.
--
-- Generated media (video / image / audio) lives here. One row per
-- render job, regardless of provider. The provider is recorded so
-- the cost-policy router can attribute spend; the status column
-- tracks the async lifecycle (queued → rendering → complete |
-- failed | archived).
--
-- The artifacts table is the substrate for:
--   - Hyperframes (HTML → MP4 via local CLI sidecar; cost = $0)
--   - Paid asset adapters (fal / Runway / Luma / Higgsfield etc.)
--   - The /studio surface that lists jobs + previews completed renders
--   - Channel adapters that pull media_url at publish time
--
-- Applies after 0007_alter_embedding_to_vector.sql.

-- ─── artifact_kind enum ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'artifact_kind') THEN
    CREATE TYPE artifact_kind AS ENUM ('video', 'image', 'audio');
  END IF;
END$$;

-- ─── artifact_status enum ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'artifact_status') THEN
    CREATE TYPE artifact_status AS ENUM (
      'queued',     -- accepted but not yet started
      'rendering',  -- worker is processing
      'complete',   -- media_url populated, ready for use
      'failed',     -- error_message populated, no media_url
      'archived'    -- soft-deleted by user
    );
  END IF;
END$$;

-- ─── artifacts table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Loose FK to drafts so an artifact can be associated with a draft
  -- (the brief that generated it) without enforcing a hard relationship —
  -- many artifacts are exploratory and never attach to a specific draft.
  draft_id            UUID REFERENCES drafts(id) ON DELETE SET NULL,
  kind                artifact_kind NOT NULL,
  -- Provider that generated the artifact: 'hyperframes', 'fal', 'runway',
  -- 'luma', 'higgsfield', 'motion', 'satori', etc. Free-form text so a
  -- new provider doesn't require enum migration on first use.
  source              TEXT NOT NULL,
  title               TEXT,
  -- The brief / prompt the user (or agent) wrote that drove this render.
  -- Length capped at 4000 to bound storage; longer briefs get truncated
  -- with an explicit ellipsis at the ingest layer.
  prompt              TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 4000),
  status              artifact_status NOT NULL DEFAULT 'queued',
  -- URL to the finished asset. Populated when status='complete'.
  -- Local renders write to /uploads/<source>/<id>.<ext>; remote providers
  -- write to their CDN URL.
  media_url           TEXT,
  -- MIME type — 'video/mp4', 'image/png', 'audio/mpeg' etc. Helps the UI
  -- pick the right player without sniffing the URL extension.
  media_mime_type     TEXT,
  -- Provider-specific metadata. Hyperframes records sceneCount + appliedStyleKey
  -- + durationSec; fal records modelId + jobId; Higgsfield records cameraMove +
  -- durationSec etc. Free-form jsonb so each provider can store what it needs.
  provider_meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Failure detail when status='failed'. Bounded to keep an exception
  -- payload from blowing up the row size; deeper diagnostics live in
  -- the audit_log row written when the failure fires.
  error_message       TEXT CHECK (error_message IS NULL OR char_length(error_message) <= 2000),
  -- Cost in USD for paid providers; 0 for free local renders. Stored
  -- redundantly with meter_events so the artifact row is self-contained
  -- for audit queries that don't want to join across tables.
  cost_usd            DOUBLE PRECISION NOT NULL DEFAULT 0
                      CHECK (cost_usd >= 0),
  -- Optional FK to the meter_events row that recorded the cost. Helps
  -- the operator trace artifact → meter event → CLIP rebate accrual.
  meter_event_id      UUID REFERENCES meter_events(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the common query: list this workspace's artifacts, newest first
CREATE INDEX IF NOT EXISTS idx_artifacts_company_created
  ON artifacts (company_id, created_at DESC);

-- Index for filtering by source (the Studio dashboard filters by provider)
CREATE INDEX IF NOT EXISTS idx_artifacts_company_source_created
  ON artifacts (company_id, source, created_at DESC);

-- Index for the polling case: "is this job done yet?"
CREATE INDEX IF NOT EXISTS idx_artifacts_status
  ON artifacts (status)
  WHERE status IN ('queued', 'rendering');

-- ─── RLS policy ──────────────────────────────────────────────────────────
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY artifacts_tenant_isolation ON artifacts
  USING      (app_company_matches(company_id))
  WITH CHECK (app_company_matches(company_id));

-- ─── updated_at trigger ──────────────────────────────────────────────────
-- Keeps updated_at fresh on every UPDATE without app-layer support.
-- Reuses the same touch_updated_at() function defined in 0001_init.sql.
DROP TRIGGER IF EXISTS trg_artifacts_updated_at ON artifacts;
CREATE TRIGGER trg_artifacts_updated_at
  BEFORE UPDATE ON artifacts
  FOR EACH ROW
  EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE artifacts IS
  'Generated media library. One row per render job. Source identifies the provider; status tracks the async lifecycle.';
