-- Phase 1 of the Coaching Agents framework: admin-authored coachable-agent
-- profiles. Each row is a coachable AI "employee" a manager practices on. This
-- is AUTHORING ONLY — these profiles are not yet wired into the live call flow.
-- Run once in the D1 Console for call-simulator-preview-db. The
-- coaching-agents API also self-bootstraps this table at runtime, so a manual
-- migration is optional.

CREATE TABLE IF NOT EXISTS coaching_agents (
  id               TEXT PRIMARY KEY,            -- 'ca_' + short random id
  scenario_name    TEXT,                        -- admin-chosen scenario label (optional)
  name             TEXT NOT NULL,
  age              INTEGER,
  role_title       TEXT,
  voice_id         TEXT,                        -- ElevenLabs voice id (enable on the shared agent)
  attitude         TEXT,                        -- feedback-reception style label
  resistance       TEXT,                        -- 'low' | 'medium' | 'high' — starting wall height
  receptiveness    TEXT,                        -- 'low' | 'medium' | 'high' — how far/fast they soften
  skill_gap        TEXT,                        -- the underlying issue the manager addresses
  skill_gap_detail TEXT,
  demeanor         TEXT,                        -- typical performance and demeanor
  incident         TEXT,                        -- recent context the manager may bring up
  personality      TEXT,
  derails          INTEGER NOT NULL DEFAULT 0,  -- 0/1: tends to stall / change the subject
  mode_assessment  INTEGER NOT NULL DEFAULT 0,  -- 0/1
  mode_coaching    INTEGER NOT NULL DEFAULT 1,  -- 0/1
  mode_followup    INTEGER NOT NULL DEFAULT 0,  -- 0/1
  opening_lines    TEXT,                        -- JSON array string of opening line options
  active           INTEGER NOT NULL DEFAULT 1,  -- 0/1
  photo            TEXT,                        -- agent portrait (data URL / asset ref) for the dashboard
  incident_image   TEXT,                        -- image illustrating the recent incident
  created_at       INTEGER NOT NULL,            -- unix seconds
  updated_at       INTEGER,                     -- unix seconds
  created_by       TEXT                         -- admin id/email that authored it, or NULL
);

CREATE INDEX IF NOT EXISTS idx_coaching_agents_active
  ON coaching_agents(active, created_at);
