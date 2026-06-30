// Instructor Live Mode: shared helpers for the no-API two-screen practice mode.
//
// One live_sessions row pairs a trainee link and an instructor link to a single
// session id. The trainee drives the sales POS (demo_sales) and POSTs a state
// snapshot ~1s; the instructor view polls it read-only and role-plays the
// customer live. No voice agent, no transcript, no AI report.
//
// This module mirrors the invites pattern: tables are self-bootstrapped at
// runtime (this project cannot run D1 migrations), and the scope helper re-reads
// D1 on every request so revoking/ending a session cuts access instantly.

import {
  signToken,
  verifyToken,
  sha256Hex,
  randomId,
  randomToken,
  parseCookieHeader,
} from './auth.js';

// The only scenario live mode supports for now. Sales (Robert / demo_sales).
export const LIVE_SCENARIO_ID = 'demo_sales';

// cs_live cookie lifetime. Matches the demo cookie (8h) so a practice session
// link stays usable through a normal working block, then quietly lapses.
export const LIVE_COOKIE_TTL_SECONDS = 8 * 60 * 60;

// Create the live_sessions table if it does not exist yet. Best-effort and
// idempotent: CREATE TABLE / INDEX IF NOT EXISTS, every statement wrapped so a
// transient error never breaks the request. Cheap to call before any read/write.
export async function ensureLiveTable(env) {
  if (!env?.DB) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS live_sessions (
       id                     TEXT PRIMARY KEY,
       created_at             INTEGER NOT NULL,
       updated_at             INTEGER NOT NULL,
       scenario_id            TEXT NOT NULL DEFAULT 'demo_sales',
       label                  TEXT,
       trainee_token_hash     TEXT NOT NULL,
       instructor_token_hash  TEXT NOT NULL,
       trainee_token_plain    TEXT,
       instructor_token_plain TEXT,
       trainee_state          TEXT,
       instructor_meta        TEXT,
       active                 INTEGER NOT NULL DEFAULT 1,
       ended_at               INTEGER,
       expires_at             INTEGER,
       created_by             TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_live_trainee_hash ON live_sessions(trainee_token_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_live_instructor_hash ON live_sessions(instructor_token_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_live_active ON live_sessions(active, created_at)`,
  ];
  for (const sql of statements) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
      // table/index already present, or transient — safe to ignore
    }
  }
}

// Mint a paired set of secret URL tokens for a new session. Returns the plain
// tokens (to embed in the links and store as token_plain for re-copy) plus their
// sha256 hashes (stored as the canonical credential the cookie is checked against).
export async function mintLiveTokens() {
  const traineeToken = randomToken();
  const instructorToken = randomToken();
  const [traineeHash, instructorHash] = await Promise.all([
    sha256Hex(traineeToken),
    sha256Hex(instructorToken),
  ]);
  return { traineeToken, instructorToken, traineeHash, instructorHash };
}

// Issue the cs_live cookie value for a resolved (session, role). The cookie
// carries the role-appropriate token hash so rotating/ending the session
// invalidates it on the next request (re-checked in getLiveScope).
export async function signLiveCookie({ sessionId, role, tokenHash, env }) {
  const now = Math.floor(Date.now() / 1000);
  return signToken(
    { scope: 'live', session_id: sessionId, role, h: tokenHash, iat: now, exp: now + LIVE_COOKIE_TTL_SECONDS },
    env.SESSION_SECRET
  );
}

// Build a Set-Cookie header value for cs_live. SameSite=Lax because the entry
// path is a top-level navigation from a shared link.
export function buildLiveCookie(value, isHttps, maxAge = LIVE_COOKIE_TTL_SECONDS) {
  const parts = [`cs_live=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

// Resolve the live session behind this request's cs_live cookie, or null.
// Re-reads the live_sessions row every call so ending/revoking the session (or
// the cookie expiring) cuts access immediately. The role is taken from the
// signed cookie and re-confirmed against the matching token hash in the row.
//   returns { session_id, role, scenario_id, active, label, expires_at }
export async function getLiveScope(request, env) {
  if (!env?.SESSION_SECRET || !env?.DB) return null;
  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  const t = cookies.cs_live;
  if (!t) return null;

  let payload;
  try {
    payload = await verifyToken(t, env.SESSION_SECRET);
  } catch {
    return null;
  }
  if (payload?.scope !== 'live' || !payload?.session_id || !payload?.h) return null;
  const role = payload.role === 'instructor' ? 'instructor' : 'trainee';

  await ensureLiveTable(env);
  const row = await env.DB
    .prepare(
      `SELECT id, scenario_id, label, active, expires_at,
              trainee_token_hash, instructor_token_hash
       FROM live_sessions WHERE id = ? LIMIT 1`
    )
    .bind(payload.session_id)
    .first();
  if (!row) return null;

  const expectedHash = role === 'instructor' ? row.instructor_token_hash : row.trainee_token_hash;
  if (!expectedHash || expectedHash !== payload.h) return null;

  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) return null;

  return {
    session_id: row.id,
    role,
    scenario_id: row.scenario_id || LIVE_SCENARIO_ID,
    active: !!row.active,
    label: row.label || '',
    expires_at: row.expires_at,
  };
}

// Defensive card masking. The trainee already masks before sending, but never
// trust the client: reduce any card number to its last 4 digits and drop the
// CVV before the snapshot is persisted. Mutates and returns a plain object.
export function maskTraineeState(state) {
  if (!state || typeof state !== 'object') return state;
  const out = { ...state };
  const fields = out.fields && typeof out.fields === 'object' ? { ...out.fields } : null;
  if (fields) {
    for (const key of Object.keys(fields)) {
      const lower = key.toLowerCase();
      const val = fields[key];
      if (typeof val !== 'string') continue;
      if (lower.includes('card') && lower.includes('num')) {
        const digits = val.replace(/\D/g, '');
        fields[key] = digits ? `•••• ${digits.slice(-4)}` : '';
      } else if (lower.includes('cvv') || lower.includes('cvc') || lower.includes('cid')) {
        fields[key] = val ? '•••' : '';
      }
    }
    out.fields = fields;
  }
  return out;
}
