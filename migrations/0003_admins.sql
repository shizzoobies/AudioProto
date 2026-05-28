-- Migration 0003: named admins + invite attribution.
-- Run once in the D1 Console (call-simulator-preview-db) after deploying the
-- multi-admin feature. Adds the admins table (named admins onboarded via emailed
-- magic links) and an invites.created_by column attributing each invite to the
-- admin who sent it. The ALTER is safe on existing rows — they get NULL.

CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  token_hash    TEXT NOT NULL UNIQUE,   -- sha256 of the magic-link token
  created_at    INTEGER NOT NULL,
  created_by    TEXT,                   -- email/label of the admin who added them
  last_login_at INTEGER,
  revoked       INTEGER NOT NULL DEFAULT 0,
  revoked_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);

ALTER TABLE invites ADD COLUMN created_by TEXT;
