// Course-token auth + usage tables for the Rise/Reach embed.
//
// The embed runs inside a third-party iframe, so cookies (SameSite) are
// unusable by design: every /api/embed/* request carries the course token
// (`ct`) instead and is validated here per-request. Storage follows the
// invites discipline (functions/api/admin/demo.js): only the SHA-256 hash of
// the token is stored, the plaintext is shown once at creation, and revocation
// is a flag re-checked on EVERY request so it acts as an instant kill switch.

import { sha256Hex } from './auth.js';

// Runtime self-bootstrap, mirroring the ensure... pattern in
// functions/api/admin/coaching-agents.js: cheap to call at the top of every
// handler; CREATE TABLE IF NOT EXISTS is a no-op once present.
export async function ensureEmbedTables(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS embed_tokens (
         id          TEXT PRIMARY KEY,
         label       TEXT NOT NULL,
         token_hash  TEXT NOT NULL,
         scenarios   TEXT NOT NULL DEFAULT 'demo_sales',
         daily_cap   INTEGER NOT NULL DEFAULT 50,
         created_at  INTEGER NOT NULL,
         revoked     INTEGER NOT NULL DEFAULT 0,
         revoked_at  INTEGER
       )`
    ).run();
  } catch {
    // table already present or a benign race - safe to ignore
  }
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS embed_usage (
         id              TEXT PRIMARY KEY,
         token_id        TEXT NOT NULL,
         learner         TEXT,
         scenario_id     TEXT NOT NULL,
         started_at      INTEGER NOT NULL,
         ended_at        INTEGER,
         duration        INTEGER,
         score           REAL,
         conversation_id TEXT
       )`
    ).run();
  } catch {
    // ignore
  }
  try {
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_embed_usage_token_started
       ON embed_usage (token_id, started_at)`
    ).run();
  } catch {
    // ignore
  }
}

// Validates a course token. Returns the embed_tokens row (id, label, scenarios,
// daily_cap, ...) or null when the token is missing, unknown, or revoked.
// Re-reads D1 every call so revoke takes effect immediately.
export async function getEmbedScope(env, ct) {
  const token = typeof ct === 'string' ? ct.trim() : '';
  if (!token || !env.DB) return null;
  try {
    const hash = await sha256Hex(token);
    const row = await env.DB
      .prepare(`SELECT * FROM embed_tokens WHERE token_hash = ? AND revoked = 0 LIMIT 1`)
      .bind(hash)
      .first();
    return row || null;
  } catch {
    return null;
  }
}

// The token's scenarios column is a comma-separated allowlist of scenario ids.
export function tokenAllowsScenario(row, sid) {
  if (!row || typeof sid !== 'string' || !sid) return false;
  const list = String(row.scenarios || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(sid);
}

// Calls started on this token in the trailing 24 hours - the daily-cap counter.
export async function countCallsLastDay(env, tokenId, nowSec = Math.floor(Date.now() / 1000)) {
  try {
    const r = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM embed_usage WHERE token_id = ? AND started_at > ?`)
      .bind(tokenId, nowSec - 86400)
      .first();
    return Number(r?.n || 0);
  } catch {
    return 0;
  }
}
