-- Phase 1 of the per-manager coaching dashboard: cohorts + their members. A
-- cohort groups managers under one admin-controlled progression gate
-- (unlocked_stage); each member row pins an invite to the cohort and to the
-- coaching agent (scenario) that manager practices on. Managers NOT in any
-- cohort are treated as ad-hoc (everything unlocked) by the dashboard endpoint.
--
-- Run once in the D1 Console for call-simulator-preview-db. The dashboard API
-- also self-bootstraps these tables at runtime (ensureDashboardTables), so a
-- manual migration is optional.

CREATE TABLE IF NOT EXISTS cohorts (
  id              TEXT PRIMARY KEY,            -- short random id
  name            TEXT,                        -- admin-chosen label
  unlocked_stage  INTEGER NOT NULL DEFAULT 1,  -- highest stage members may reach
  created_at      INTEGER NOT NULL,            -- unix seconds
  created_by      TEXT                         -- admin id/email, or NULL
);

CREATE TABLE IF NOT EXISTS cohort_members (
  cohort_id     TEXT NOT NULL,                 -- cohorts.id
  invite_id     TEXT NOT NULL,                 -- invites.id of this manager
  scenario_id   TEXT,                          -- 'ca_' agent this manager practices on
  member_name   TEXT,
  member_email  TEXT,
  created_at    INTEGER NOT NULL,              -- unix seconds
  PRIMARY KEY (cohort_id, invite_id)
);

CREATE INDEX IF NOT EXISTS idx_cohort_members_invite ON cohort_members(invite_id);
