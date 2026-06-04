-- Named ElevenLabs voices for the Coaching Agents framework. Admins add a
-- voice once (friendly name + raw EL voice id) so agent authors can pick by
-- name instead of pasting raw ids. The raw voice_id is still stored on each
-- coaching_agent row — this table is purely a named catalogue.
-- The coaching-voices API also self-bootstraps this table at runtime.

CREATE TABLE IF NOT EXISTS coaching_voices (
  id         TEXT PRIMARY KEY,   -- 'cv_' + short random id
  name       TEXT NOT NULL,      -- friendly display name, e.g. "Taylor (US Female)"
  voice_id   TEXT NOT NULL,      -- raw ElevenLabs voice id
  created_at INTEGER NOT NULL,   -- unix seconds
  created_by TEXT                -- admin id/email that added it, or NULL
);
