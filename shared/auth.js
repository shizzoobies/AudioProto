const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// Sentinel recipient_email that marks the single open "demo" invite. Reusing
// the invites table (no new column / no migration) means the demo link is just
// an invites row whose recipient_email equals this constant and whose assigned
// scenarios are the two demo placeholders. Defined once here and imported by the
// admin demo endpoint, the /demo/[token] landing, and the invites list filter so
// the value can never drift.
export const DEMO_RECIPIENT_EMAIL = '__demo__@simulation.local';

// Sentinel recipient_email marking the single token-gated "charts" link. Like
// the demo, this reuses the invites table (no new table / no migration): the
// charts link is one invites row whose recipient_email equals this constant. It
// carries NO scenario assignments — it only gates the static /charts page via a
// dedicated cs_charts cookie (see getChartsScope + functions/charts/_middleware).
export const CHARTS_RECIPIENT_EMAIL = '__charts__@simulation.local';

// Sentinel recipient_email for the token-gated "Designing Growth" game link. One
// invites row whose recipient_email is this constant; its cs_game cookie releases
// ONLY the static /designing-growth page (and its data.json). It carries no
// scenario assignments and grants no app or admin access. See getGameScope, the
// /game-pass/[token] entry, and functions/designing-growth/_middleware.js.
export const GAME_RECIPIENT_EMAIL = '__game__@simulation.local';

// Sentinel recipient_email for the open "full library preview" link. Like the
// demo, it reuses the invites table: one row whose recipient_email is this
// constant, assigned EVERY real scenario so its cs_me cookie unlocks the whole
// trainee library (all tracks, random, the showcase) with no password. The two
// placeholder demo scenarios and the /charts page are intentionally NOT part of
// it. app.js routes this scope to the normal home/library instead of the sealed
// recipient list (see /api/me/status -> is_preview).
export const PREVIEW_RECIPIENT_EMAIL = '__preview__@simulation.local';

// Sentinel recipient_email for the scoped "review editor" link. One invites row
// whose recipient_email is this constant; its cs_review cookie grants access to
// ONLY the Call Review rubric endpoints (not the rest of the admin panel), so a
// reviewer can tune scoring without full admin access. See getReviewScope, the
// /review-pass/[token] entry, and the /api middleware allow-list.
export const REVIEW_RECIPIENT_EMAIL = '__review__@simulation.local';

// Sentinel recipient_email for the scoped "coaching admin / Scenarios editor"
// link. One invites row whose recipient_email is this constant; its
// cs_coaching_admin cookie grants access to ONLY the coaching Scenarios admin
// page (create/manage scenarios + voices), not the rest of the admin panel, so
// someone can author scenarios without full admin access. See
// getCoachingAdminScope, the /coaching-pass/[token] entry, and the /api
// middleware allow-list.
export const COACHING_ADMIN_RECIPIENT_EMAIL = '__coaching_admin__@simulation.local';

// Sentinel recipient_email for the FULL coaching-editor link. Same cs_coaching_admin
// cookie machinery, but getCoachingAdminScope returns level='full', which the
// middleware uses to allow the entire coaching admin surface (landing, cohorts,
// course config, link-minting, reset) — not just scenarios + voices. Distinct
// sentinel so the two share-links can be generated/revoked independently.
export const COACHING_FULL_RECIPIENT_EMAIL = '__coaching_full__@simulation.local';

// Sentinel recipient_email marking the single open "coaching" link — the
// open-link sibling of the per-email coaching invites. Like the demo, it reuses
// the invites table: one row whose recipient_email is this constant, with
// mode='coaching' and the coaching_practice scenario assigned, so its cs_me
// cookie opens the cinematic Coaching Test page. Defined once here and imported
// by the admin coaching endpoint and the /coaching/[token] landing so the value
// can never drift.
export const COACHING_RECIPIENT_EMAIL = '__coaching__@simulation.local';

// Sentinel recipient_email for the single open "Back-to-back demo reel" link.
// Like the demo, it reuses the invites table (no new table / no migration): one
// row whose recipient_email is this constant, assigned exactly the five reel
// scenario ids so its cs_me cookie authorizes each call in the sequence (both
// the /api/voice-agent/start scope check and the client). Defined once here and
// imported by the admin reel endpoint, the /reel/[token] landing, and
// /api/me/status so the value can never drift.
export const REEL_RECIPIENT_EMAIL = '__reel__@simulation.local';

function bytesToBase64Url(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stringToBase64Url(str) {
  return bytesToBase64Url(ENCODER.encode(str));
}

function base64UrlToBytes(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlToString(str) {
  return DECODER.decode(base64UrlToBytes(str));
}

async function getKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = stringToBase64Url(JSON.stringify(header));
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;

  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(data));
  const sigB64 = bytesToBase64Url(new Uint8Array(sig));

  return `${data}.${sigB64}`;
}

export async function verifyToken(token, secret) {
  if (typeof token !== 'string') {
    throw new Error('malformed_token');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('malformed_token');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;

  const key = await getKey(secret);
  const sigBytes = base64UrlToBytes(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, ENCODER.encode(data));
  if (!valid) {
    throw new Error('invalid_signature');
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlToString(payloadB64));
  } catch {
    throw new Error('malformed_payload');
  }

  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('expired');
  }

  return payload;
}

// Short hex fingerprint of a secret (first 16 bytes of SHA-256). We stash this
// in cs_magic cookies so rotating MAGIC_LINK_TOKEN in the dashboard invalidates
// every already-issued cookie immediately, not just future ones.
export async function tokenFingerprint(s) {
  const data = ENCODER.encode(String(s || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(digest)).slice(0, 16);
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// If the request is authenticated only by a valid cs_magic cookie (and the
// MAGIC_LINK_TOKEN fingerprint still matches what's currently configured),
// return the scenario_id the visitor is locked to. Returns null if the
// visitor has a normal session (no lock applies) or has no valid magic scope
// at all. Used by chat/tts/coach to refuse any scenario outside the lane.
export async function getMagicScope(request, env) {
  if (!env?.SESSION_SECRET || !env?.MAGIC_LINK_TOKEN) return null;
  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  if (cookies.session) {
    try {
      await verifyToken(cookies.session, env.SESSION_SECRET);
      return null;
    } catch {
      // fall through: session is bad, try magic
    }
  }
  const t = cookies.cs_magic;
  if (!t) return null;
  try {
    const payload = await verifyToken(t, env.SESSION_SECRET);
    if (!payload?.magic) return null;
    const fp = await tokenFingerprint(env.MAGIC_LINK_TOKEN);
    if (payload.h !== fp) return null;
    return typeof payload.scenario === 'string' ? payload.scenario : null;
  } catch {
    return null;
  }
}

export function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}

// Constant-time string compare. Same pattern as functions/api/auth.js, lifted
// to shared so admin login (and future password checks) can reuse it without
// duplicating timing-safe logic.
const COMPARE_BUDGET = 256;
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < COMPARE_BUDGET; i++) {
    const ac = i < a.length ? a.charCodeAt(i) : 0;
    const bc = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ac ^ bc;
  }
  return diff === 0;
}

// Full 64-char hex SHA-256, for storing token hashes in D1 where collisions
// across millions of rows must be impossible. tokenFingerprint() above uses
// the first 16 bytes; this returns all 32.
export async function sha256Hex(s) {
  const data = ENCODER.encode(String(s || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Short opaque ID for DB rows (24 hex chars / 96 bits of entropy is plenty).
export function randomId(bytes = 12) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// URL-safe random token (the secret half of a magic URL). 24 bytes -> 32 chars
// base64url. Matches the entropy of the MAGIC_LINK_TOKEN we generate by hand.
export function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Look up the recipient invite that owns this request's cs_me cookie. Returns
//   { invite_id, recipient_email, recipient_name, expires_at, scenarios: Set }
// or null if the cookie is missing, invalid, expired, revoked, or out of sync
// with the DB (e.g. the admin clicked "regenerate" and the token_hash rotated).
// Re-checks D1 on every call so revocation and rotation are instant. The
// scenario lock in chat/tts/coach reads `.scenarios` for the allow-set.
export async function getInviteScope(request, env) {
  if (!env?.SESSION_SECRET || !env?.DB) return null;
  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  const t = cookies.cs_me;
  if (!t) return null;
  let payload;
  try {
    payload = await verifyToken(t, env.SESSION_SECRET);
  } catch {
    return null;
  }
  if (payload?.scope !== 'me' || !payload?.invite_id || !payload?.h) return null;

  const row = await env.DB
    .prepare(
      `SELECT id, recipient_email, recipient_name, expires_at, token_hash
       FROM invites WHERE id = ? AND revoked = 0 LIMIT 1`
    )
    .bind(payload.invite_id)
    .first();
  if (!row) return null;
  if (row.token_hash !== payload.h) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) return null;

  const sceneRes = await env.DB
    .prepare(`SELECT scenario_id FROM invite_scenarios WHERE invite_id = ?`)
    .bind(payload.invite_id)
    .all();
  const scenarios = new Set((sceneRes?.results || []).map((r) => r.scenario_id));

  // The caller's role label, set when they were added to a cohort
  // ('Manager' / 'Senior Agent'). Read defensively in its own query so a DB that
  // predates the column (cohorts never used) can never break auth. Empty when
  // unset. Drives role-conditional receptiveness in the coaching prompt.
  let recipientRole = '';
  try {
    const rr = await env.DB
      .prepare(`SELECT recipient_role FROM invites WHERE id = ? LIMIT 1`)
      .bind(payload.invite_id)
      .first();
    if (rr && typeof rr.recipient_role === 'string') recipientRole = rr.recipient_role;
  } catch {
    recipientRole = '';
  }

  // Expand the "all coaching agents" sentinel into concrete ca_ ids so the
  // downstream access checks (voice-agent/start, me/status) see real agent ids
  // rather than the sentinel. Keep the sentinel in the set too (harmless). Must
  // never throw — if the coaching_agents table doesn't exist yet, just skip.
  if (scenarios.has('__all_coaching__')) {
    try {
      const r = await env.DB.prepare('SELECT id FROM coaching_agents WHERE active = 1').all();
      for (const row of r?.results || []) scenarios.add(row.id);
    } catch {}
  }

  return {
    invite_id: row.id,
    recipient_email: row.recipient_email,
    recipient_name: row.recipient_name,
    recipient_role: recipientRole,
    expires_at: row.expires_at,
    scenarios,
  };
}

// Validate a cs_charts cookie against the charts sentinel invites row. Returns
// { invite_id, expires_at } when the cookie is present, signed, scoped to
// 'charts', and still matches a non-revoked, non-expired charts row whose
// token_hash equals the cookie's. Re-reads D1 every call so revoke/regenerate
// is instant. Used only to gate the static /charts page; grants no app access.
export async function getChartsScope(request, env) {
  if (!env?.SESSION_SECRET || !env?.DB) return null;
  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  const t = cookies.cs_charts;
  if (!t) return null;
  let payload;
  try {
    payload = await verifyToken(t, env.SESSION_SECRET);
  } catch {
    return null;
  }
  if (payload?.scope !== 'charts' || !payload?.invite_id || !payload?.h) return null;

  const row = await env.DB
    .prepare(
      `SELECT id, recipient_email, expires_at, token_hash
       FROM invites WHERE id = ? AND revoked = 0 LIMIT 1`
    )
    .bind(payload.invite_id)
    .first();
  if (!row) return null;
  if (row.recipient_email !== CHARTS_RECIPIENT_EMAIL) return null;
  if (row.token_hash !== payload.h) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) return null;

  return { invite_id: row.id, expires_at: row.expires_at };
}

// Validate a cs_game cookie against the game sentinel invites row. Returns
// { invite_id, expires_at } when the cookie is present, signed, scoped to 'game',
// and still matches a non-revoked, non-expired game row whose token_hash equals
// the cookie's. Re-reads D1 every call so revoke/regenerate is instant. Used only
// to gate the static /designing-growth page; grants no app access.
export async function getGameScope(request, env) {
  if (!env?.SESSION_SECRET || !env?.DB) return null;
  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  const t = cookies.cs_game;
  if (!t) return null;
  let payload;
  try {
    payload = await verifyToken(t, env.SESSION_SECRET);
  } catch {
    return null;
  }
  if (payload?.scope !== 'game' || !payload?.invite_id || !payload?.h) return null;

  const row = await env.DB
    .prepare(
      `SELECT id, recipient_email, expires_at, token_hash
       FROM invites WHERE id = ? AND revoked = 0 LIMIT 1`
    )
    .bind(payload.invite_id)
    .first();
  if (!row) return null;
  if (row.recipient_email !== GAME_RECIPIENT_EMAIL) return null;
  if (row.token_hash !== payload.h) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) return null;

  return { invite_id: row.id, expires_at: row.expires_at };
}

// Validate a cs_review cookie against the review sentinel invites row. Returns
// { invite_id, expires_at } when the cookie is present, signed, scoped to
// 'review', and still matches a non-revoked, non-expired review row whose
// token_hash equals the cookie's. Re-reads D1 every call so revoke/regenerate is
// instant. Grants access to ONLY the Call Review rubric endpoints.
export async function getReviewScope(request, env) {
  if (!env?.SESSION_SECRET || !env?.DB) return null;
  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  const t = cookies.cs_review;
  if (!t) return null;
  let payload;
  try {
    payload = await verifyToken(t, env.SESSION_SECRET);
  } catch {
    return null;
  }
  if (payload?.scope !== 'review' || !payload?.invite_id || !payload?.h) return null;

  const row = await env.DB
    .prepare(
      `SELECT id, recipient_email, expires_at, token_hash
       FROM invites WHERE id = ? AND revoked = 0 LIMIT 1`
    )
    .bind(payload.invite_id)
    .first();
  if (!row) return null;
  if (row.recipient_email !== REVIEW_RECIPIENT_EMAIL) return null;
  if (row.token_hash !== payload.h) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) return null;

  return { invite_id: row.id, expires_at: row.expires_at };
}

// Validate a cs_coaching_admin cookie against the coaching-admin sentinel invites
// row. Returns { invite_id, expires_at } when the cookie is present, signed,
// scoped to 'coaching_admin', and still matches a non-revoked, non-expired row
// whose token_hash equals the cookie's. Re-reads D1 every call so revoke/regenerate
// is instant. Grants access to ONLY the coaching Scenarios admin endpoints.
export async function getCoachingAdminScope(request, env) {
  if (!env?.SESSION_SECRET || !env?.DB) return null;
  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  const t = cookies.cs_coaching_admin;
  if (!t) return null;
  let payload;
  try {
    payload = await verifyToken(t, env.SESSION_SECRET);
  } catch {
    return null;
  }
  if (payload?.scope !== 'coaching_admin' || !payload?.invite_id || !payload?.h) return null;

  const row = await env.DB
    .prepare(
      `SELECT id, recipient_email, expires_at, token_hash, mode
       FROM invites WHERE id = ? AND revoked = 0 LIMIT 1`
    )
    .bind(payload.invite_id)
    .first();
  if (!row) return null;
  // Two kinds of editor link grant the same scoped-editor scope: the single
  // shared sentinel link, and per-person editor invites (mode='coaching_editor').
  const isSharedEditor = row.recipient_email === COACHING_ADMIN_RECIPIENT_EMAIL;
  const isPersonalEditor = row.mode === 'coaching_editor';
  // FULL-tier editor links (shared sentinel or per-person mode) grant the whole
  // coaching admin surface; the scenarios-tier links grant scenarios + voices.
  const isSharedFull = row.recipient_email === COACHING_FULL_RECIPIENT_EMAIL;
  const isPersonalFull = row.mode === 'coaching_full_editor';
  if (!isSharedEditor && !isPersonalEditor && !isSharedFull && !isPersonalFull) return null;
  if (row.token_hash !== payload.h) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) return null;

  const level = (isSharedFull || isPersonalFull) ? 'full' : 'scenarios';
  return { invite_id: row.id, expires_at: row.expires_at, level };
}

// Resolves the identity behind a valid cs_admin cookie, or null. The cookie
// carries one of two payload shapes (one cookie, two shapes):
//
//   Owner   (password login): { role: 'admin', iat, exp }. No DB row; always
//           trusted if the HMAC verifies. Returns { is_owner: true, ... }.
//   Named   (magic link):      { scope: 'admin_user', admin_id, h, iat, exp }.
//           Re-checked against the admins row on EVERY request, so revoking an
//           admin (or rotating their token) takes effect on the next request.
//
// Both shapes return a truthy identity object, so the middleware gate (truthy =
// allowed) keeps working for owner and named admins alike. Owner-only routes
// must additionally check `.is_owner`. Used by the middleware for /api/admin/*
// and by admin routes that need the caller's identity.
export async function getAdminScope(request, env) {
  if (!env?.SESSION_SECRET) return null;
  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  if (!cookies.cs_admin) return null;

  let payload;
  try {
    payload = await verifyToken(cookies.cs_admin, env.SESSION_SECRET);
  } catch {
    return null; // invalid / expired
  }
  if (!payload) return null;

  // Owner: legacy password-login cookie. No admin_id / scope claim.
  if (payload.role === 'admin' && !payload.admin_id && !payload.scope) {
    return {
      is_owner: true,
      admin_id: 'owner',
      email: env.OWNER_EMAIL || 'owner',
      name: 'Owner',
    };
  }

  // Named admin: re-validate against the DB so revocation is instant.
  if (payload.scope === 'admin_user' && payload.admin_id && env?.DB) {
    const row = await env.DB
      .prepare(`SELECT id, email, name, token_hash, revoked FROM admins WHERE id = ?`)
      .bind(payload.admin_id)
      .first();
    if (!row || row.revoked) return null;
    if (payload.h && row.token_hash !== payload.h) return null;
    return {
      is_owner: false,
      admin_id: row.id,
      email: row.email,
      name: row.name,
    };
  }

  return null;
}
