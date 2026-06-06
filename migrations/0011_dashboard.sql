-- Phase 1 of the per-manager coaching dashboard: the manager's saved state. Per
-- invite link (so it survives browser/device changes):
--   dashboard_answers — autosaved Development-Plan field values.
--   dashboard_calls   — one-try call record + the ElevenLabs conversation_id
--                       used to fetch the call recording.
--   dashboard_fields  — the editable Development-Plan questions (seeded from
--                       DEFAULT_DASHBOARD_FIELDS by ensureDashboardTables).
--
-- Run once in the D1 Console for call-simulator-preview-db. The dashboard API
-- also self-bootstraps these tables at runtime, so a manual migration is optional.

CREATE TABLE IF NOT EXISTS dashboard_answers (
  invite_id   TEXT NOT NULL,                 -- invites.id this answer belongs to
  field_key   TEXT NOT NULL,                 -- '${section_key}__${position}'
  value       TEXT,                          -- the manager's saved text
  updated_at  INTEGER,                       -- unix seconds
  PRIMARY KEY (invite_id, field_key)
);

CREATE TABLE IF NOT EXISTS dashboard_calls (
  invite_id       TEXT NOT NULL,             -- invites.id this call belongs to
  mode            TEXT NOT NULL,             -- 'assessment' | 'coaching' | 'followup'
  conversation_id TEXT,                      -- ElevenLabs conversation id (for the recording)
  taken_by        TEXT,                      -- participant label that took the call
  completed_at    INTEGER,                   -- unix seconds
  PRIMARY KEY (invite_id, mode)
);

CREATE TABLE IF NOT EXISTS dashboard_fields (
  id          TEXT PRIMARY KEY,              -- 'df_' + short random id
  section_key TEXT NOT NULL,                 -- 'devplan1' | 'devplan2' | 'devplan3'
  label       TEXT NOT NULL,                 -- the question shown to the manager
  type        TEXT NOT NULL DEFAULT 'textarea',
  position    INTEGER NOT NULL DEFAULT 0,    -- order within the section
  active      INTEGER NOT NULL DEFAULT 1,    -- 0/1
  created_at  INTEGER NOT NULL               -- unix seconds
);
