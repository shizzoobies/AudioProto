-- Migration 0002: API usage / prompt-caching stats.
-- Run once in the D1 Console (call-simulator-preview-db) after deploying the
-- cache-stats feature. Captures per-call Anthropic token usage so the admin
-- dashboard can show aggregate cache hit rates and estimated savings.

CREATE TABLE IF NOT EXISTS call_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,                          -- unix seconds
  endpoint TEXT NOT NULL,                               -- 'chat' | 'coach'
  scenario_id TEXT,                                     -- persona id, null if unknown
  model TEXT NOT NULL,                                  -- 'claude-sonnet-4-6' etc
  input_tokens INTEGER NOT NULL DEFAULT 0,              -- uncached input
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,  -- cache writes
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,      -- cache hits
  output_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_call_usage_created_at ON call_usage(created_at DESC);
