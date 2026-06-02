-- Migration 0006: Call Review editor activity log.
-- Records who opened the shared review link and every rubric change (admin or
-- scoped reviewer). The logger (shared/rubric-audit.js) self-creates this table
-- on first use, so running this by hand is optional.

CREATE TABLE IF NOT EXISTS rubric_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,          -- unix seconds
  actor      TEXT NOT NULL,             -- admin email / 'Owner' / 'Review link'
  actor_kind TEXT NOT NULL,             -- 'admin' | 'reviewer'
  action     TEXT NOT NULL,             -- 'opened' | 'enable' | 'disable' | 'add' | 'edit' | 'delete'
  item_key   TEXT,                      -- affected rubric item (null for 'opened')
  detail     TEXT                       -- short human description
);

CREATE INDEX IF NOT EXISTS idx_rubric_audit_ts ON rubric_audit(id DESC);
