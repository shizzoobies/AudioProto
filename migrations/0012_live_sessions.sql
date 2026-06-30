-- Instructor Live Mode: paired live practice sessions (no AI / no paid API).
-- A single row pairs a trainee link and an instructor link to one session id.
-- The trainee drives the sales POS; their state snapshot is POSTed here ~1s and
-- the instructor view polls it. No transcript, no AI report.
--
-- Run once in the D1 Console for call-simulator-preview-db. The live API also
-- self-bootstraps this table at runtime (shared/live.js ensureLiveTable), so a
-- manual migration is optional and this file is just the canonical reference.

CREATE TABLE IF NOT EXISTS live_sessions (
  id                     TEXT PRIMARY KEY,            -- session id (randomId)
  created_at             INTEGER NOT NULL,            -- unix seconds
  updated_at             INTEGER NOT NULL,            -- unix seconds (last trainee write)
  scenario_id            TEXT NOT NULL DEFAULT 'demo_sales',
  label                  TEXT,                        -- admin free-text label
  trainee_token_hash     TEXT NOT NULL,               -- sha256 of the trainee URL token
  instructor_token_hash  TEXT NOT NULL,               -- sha256 of the instructor URL token
  trainee_token_plain    TEXT,                        -- recoverable token so admin can re-copy the link
  instructor_token_plain TEXT,                        -- recoverable token so admin can re-copy the link
  trainee_state          TEXT,                        -- JSON snapshot of the POS (card masked to last 4)
  instructor_meta        TEXT,                        -- JSON: end-of-session checklist + notes
  active                 INTEGER NOT NULL DEFAULT 1,  -- 0 = ended / revoked
  ended_at               INTEGER,                     -- unix seconds when ended
  expires_at             INTEGER,                     -- unix seconds; NULL = no hard expiry
  created_by             TEXT                         -- admin email that created it
);

CREATE INDEX IF NOT EXISTS idx_live_trainee_hash
  ON live_sessions(trainee_token_hash);

CREATE INDEX IF NOT EXISTS idx_live_instructor_hash
  ON live_sessions(instructor_token_hash);

CREATE INDEX IF NOT EXISTS idx_live_active
  ON live_sessions(active, created_at);
