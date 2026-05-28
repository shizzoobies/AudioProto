-- Phase 1 schema: invites + their assigned scenarios.
-- Run once in the D1 Console for call-simulator-preview-db.

CREATE TABLE IF NOT EXISTS invites (
  id              TEXT PRIMARY KEY,           -- short random id (e.g. nanoid)
  token_hash      TEXT NOT NULL UNIQUE,       -- sha256 of the secret URL token
  recipient_email TEXT NOT NULL,
  recipient_name  TEXT,
  created_at      INTEGER NOT NULL,           -- unix seconds
  expires_at      INTEGER,                    -- unix seconds; NULL = never expires
  revoked         INTEGER NOT NULL DEFAULT 0, -- 0 or 1
  revoked_at      INTEGER,
  last_click_at   INTEGER,                    -- last time /me/<token> was visited
  last_call_at    INTEGER,                    -- last time a call actually started
  total_calls     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invite_scenarios (
  invite_id   TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  PRIMARY KEY (invite_id, scenario_id),
  FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invites_email
  ON invites(recipient_email);

CREATE INDEX IF NOT EXISTS idx_invites_active
  ON invites(revoked, expires_at);

CREATE INDEX IF NOT EXISTS idx_invite_scenarios_scenario
  ON invite_scenarios(scenario_id);
