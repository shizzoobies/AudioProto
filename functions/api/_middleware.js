import { verifyToken, tokenFingerprint } from '../../shared/auth.js';

// /api/auth is public so login can happen unauthenticated. /api/magic-status
// is public because the kiosk frontend uses it to discover whether the
// visitor has a valid cs_magic cookie (and what scenario it locks them to)
// before any other call - it does not grant access on its own.
const PUBLIC_PATHS = new Set(['/api/auth', '/api/magic-status']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) {
    return next();
  }

  const cookies = parseCookies(request.headers.get('Cookie') || '');

  // Normal session: the gate for everyone who logs in with the app password.
  if (cookies.session) {
    try {
      await verifyToken(cookies.session, env.SESSION_SECRET);
      return next();
    } catch {
      // Bad/expired session - fall through and try the magic path.
    }
  }

  // Magic-link visitors. We require BOTH (a) the cookie's HMAC verifies and
  // (b) its tokenHash matches the current MAGIC_LINK_TOKEN fingerprint, so
  // rotating that secret in the Cloudflare dashboard invalidates every cookie
  // already in the wild on the next request. The per-scenario lock that keeps
  // them from calling other scenario_ids is enforced inside chat/tts/coach.
  if (cookies.cs_magic && env.SESSION_SECRET && env.MAGIC_LINK_TOKEN) {
    try {
      const payload = await verifyToken(cookies.cs_magic, env.SESSION_SECRET);
      if (payload?.magic) {
        const fp = await tokenFingerprint(env.MAGIC_LINK_TOKEN);
        if (payload.h === fp) return next();
      }
    } catch {
      // fall through to 401
    }
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
