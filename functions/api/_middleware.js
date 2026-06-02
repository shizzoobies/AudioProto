import {
  verifyToken,
  tokenFingerprint,
  getAdminScope,
  getInviteScope,
  getReviewScope,
} from '../../shared/auth.js';

// Scoped review-editor links (cs_review) may reach ONLY these admin endpoints —
// the rubric itself and the identity probe. Everything else under /api/admin/*
// stays cs_admin-only.
const REVIEW_ALLOWED_PATHS = new Set([
  '/api/admin/rubric',
  '/api/admin/review-session',
]);

// Public paths skip auth entirely.
//   /api/auth          - agent login (you can't be authed before you log in)
//   /api/magic-status  - kiosk frontend probes for a valid cs_magic on boot
//   /api/me/status     - recipient frontend probes for a valid cs_me on boot
//   /api/admin/login   - admin login (same logic as agent auth)
const PUBLIC_PATHS = new Set([
  '/api/auth',
  '/api/magic-status',
  '/api/me/status',
  '/api/admin/login',
]);

// /api/admin/* (except login) require cs_admin SPECIFICALLY. An agent session,
// magic cookie, or invite cookie does not grant access to admin endpoints.
const ADMIN_API_PREFIX = '/api/admin/';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) {
    return next();
  }

  // Admin routes: strict cs_admin gate. The ONLY exception is a scoped review
  // editor (cs_review), which may reach the rubric + review-session endpoints.
  if (url.pathname.startsWith(ADMIN_API_PREFIX)) {
    const admin = await getAdminScope(request, env);
    if (admin) return next();
    if (REVIEW_ALLOWED_PATHS.has(url.pathname)) {
      const review = await getReviewScope(request, env);
      if (review) return next();
    }
    return jsonError('unauthorized', 401);
  }

  const cookies = parseCookies(request.headers.get('Cookie') || '');

  // Normal session: the gate for agents who logged in with APP_PASSWORD.
  if (cookies.session) {
    try {
      await verifyToken(cookies.session, env.SESSION_SECRET);
      return next();
    } catch {
      // Bad/expired session - fall through.
    }
  }

  // Admins can read any /api/* endpoint (not just /api/admin/*) - they need
  // /api/scenarios to populate the dashboard, for instance. The strict gate
  // above already prevents non-admins from hitting /api/admin/* routes.
  if (cookies.cs_admin) {
    const admin = await getAdminScope(request, env);
    if (admin) return next();
  }

  // Legacy magic-link visitors (single global env-var token, single scenario).
  // Cookie fingerprint must still match the env, so rotating the secret in the
  // dashboard invalidates every existing cookie on the next request.
  if (cookies.cs_magic && env.SESSION_SECRET && env.MAGIC_LINK_TOKEN) {
    try {
      const payload = await verifyToken(cookies.cs_magic, env.SESSION_SECRET);
      if (payload?.magic) {
        const fp = await tokenFingerprint(env.MAGIC_LINK_TOKEN);
        if (payload.h === fp) return next();
      }
    } catch {
      // fall through
    }
  }

  // Invite recipients (D1-backed, per-recipient links). getInviteScope re-reads
  // the row on every request so revocation, expiry, and admin-side token
  // rotation all take effect immediately.
  if (cookies.cs_me) {
    const scope = await getInviteScope(request, env);
    if (scope) return next();
  }

  return jsonError('unauthorized', 401);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
