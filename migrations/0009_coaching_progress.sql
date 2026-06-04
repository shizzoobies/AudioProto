-- Phase 3 of the Coaching framework: server-side per-manager call progress for
-- admin-authored (ca_) scenarios. Keyed to the manager's invite link so it
-- survives browser/device changes and accumulates across calls — the agent
-- remembers every prior call that manager took in that scenario.
--
-- The legacy hardcoded coaching_practice (Taylor) is NOT stored here; it keeps
-- its existing client-localStorage follow-up memory.
--
-- Run once in the D1 Console for call-simulator-preview-db. The
-- /api/coaching/progress endpoint and /api/me/status also self-bootstrap this
-- table at runtime, so a manual migration is optional.

CREATE TABLE IF NOT EXISTS coaching_progress (
  invite_id    TEXT NOT NULL,                 -- invites.id this progress belongs to
  scenario_id  TEXT NOT NULL,                 -- 'ca_' authored scenario id
  transcript   TEXT,                          -- JSON array string of {role:'user'|'assistant', content}
  call_count   INTEGER NOT NULL DEFAULT 0,    -- how many calls this manager has taken in this scenario
  updated_at   INTEGER,                       -- unix seconds
  PRIMARY KEY (invite_id, scenario_id)
);
