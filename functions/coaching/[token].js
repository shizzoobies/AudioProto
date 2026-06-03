// Public landing for the open coaching link. Admins generate URLs like
// /coaching/<token>; this route validates the token against the invites table
// (sha256 hash lookup), confirms the row is the coaching sentinel for safety,
// issues the exact same cs_me cookie /me/[token].js issues (scoped to the
// invite_id, carrying the current token_hash), bumps the click counter, and
// redirects into /app. Because the cookie is a normal cs_me cookie and the row
// carries mode='coaching' plus the coaching_practice scenario, /api/me/status
// returns is_coaching=true and app.js renders the cinematic Coaching Test page -
// no extra wiring needed.
//
// This is NOT under /api, so the API middleware does not gate it. It is the
// public, no-password entry point for the coaching test.

import { signToken, sha256Hex, COACHING_RECIPIENT_EMAIL } from '../../shared/auth.js';

const COOKIE_TTL_SECONDS = 8 * 60 * 60;

export async function onRequest({ request, env, params }) {
  const token = String(params?.token || '');
  if (!token || !env.SESSION_SECRET || !env.DB) {
    return errorPage();
  }

  const tokenHash = await sha256Hex(token);
  const row = await env.DB
    .prepare(
      `SELECT id, recipient_email, expires_at FROM invites
       WHERE token_hash = ? AND revoked = 0 LIMIT 1`
    )
    .bind(tokenHash)
    .first();

  if (!row) return errorPage();
  // Safety: only the coaching sentinel row may be entered through /coaching/*. A
  // normal recipient invite token must not be honored here.
  if (row.recipient_email !== COACHING_RECIPIENT_EMAIL) return errorPage();
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) return errorPage();

  // Bump click stat. Best-effort - never block the redirect on this.
  try {
    await env.DB
      .prepare(`UPDATE invites SET last_click_at = ? WHERE id = ?`)
      .bind(now, row.id)
      .run();
  } catch {
    // ignore
  }

  // Same cs_me cookie shape as /me/[token].js: the tokenHash check on every
  // request fails the instant the admin revokes or regenerates the coaching invite.
  const exp = now + COOKIE_TTL_SECONDS;
  const cookie = await signToken(
    { scope: 'me', invite_id: row.id, h: tokenHash, iat: now, exp },
    env.SESSION_SECRET
  );

  const isHttps = new URL(request.url).protocol === 'https:';
  const headers = new Headers();
  headers.set('Location', '/app');
  headers.set('Cache-Control', 'no-store');
  headers.append('Set-Cookie', buildCookie('cs_me', cookie, COOKIE_TTL_SECONDS, isHttps));
  return new Response('', { status: 302, headers });
}

// SameSite=Lax (not Strict) because the typical entry path is a click from a
// shared link - a top-level cross-site navigation that Strict would block.
function buildCookie(name, value, maxAge, isHttps) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function errorPage() {
  const html = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>Link inactive - Call Simulator</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html,body{margin:0;padding:0;background:#0a0a0b;color:#e4e4e7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:grid;place-items:center}
    main{max-width:520px;padding:32px;text-align:center}
    h1{font-weight:600;letter-spacing:-0.02em;font-size:24px;margin:0 0 12px}
    p{margin:0;color:#a1a1aa;line-height:1.55}
  </style>
</head><body><main>
  <h1>This link isn't active.</h1>
  <p>It may have expired or been revoked. Please contact whoever sent you this link.</p>
</main></body></html>`;
  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
