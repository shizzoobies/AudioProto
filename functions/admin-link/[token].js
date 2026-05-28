// Named-admin magic-link landing. The owner emails a named admin a URL like
// /admin-link/<token>; this route validates the token against the admins table
// (sha256 hash lookup), bumps last_login_at, mints a cs_admin cookie scoped to
// the admin_id, and redirects into /admin. The dashboard then sees a valid
// cs_admin and renders normally.
//
// This route is deliberately NOT under /api so the middleware's strict cs_admin
// gate doesn't block the very first click (the visitor has no cookie yet). It
// mints the SAME cookie name (cs_admin) and signs with the SAME SESSION_SECRET
// the owner password login uses, so the middleware reads it identically.
//
// The cs_admin payload carries the admin's current token_hash; getAdminScope
// re-reads the row on every request, so revoking the admin (or rotating their
// token) fails the cookie immediately — instant revocation, same pattern as
// the cs_me invite cookie.

import { signToken, sha256Hex } from '../../shared/auth.js';

const COOKIE_TTL_SECONDS = 8 * 60 * 60;

export async function onRequest({ request, env, params }) {
  const token = String(params?.token || '');
  if (!token || !env.SESSION_SECRET || !env.DB) {
    return errorPage();
  }

  const tokenHash = await sha256Hex(token);
  const row = await env.DB
    .prepare(`SELECT id, token_hash FROM admins WHERE token_hash = ? AND revoked = 0 LIMIT 1`)
    .bind(tokenHash)
    .first();

  if (!row) return errorPage();

  const now = Math.floor(Date.now() / 1000);

  // Bump last-login stat. Best-effort — never block the redirect on this.
  try {
    await env.DB
      .prepare(`UPDATE admins SET last_login_at = ? WHERE id = ?`)
      .bind(now, row.id)
      .run();
  } catch {
    // ignore
  }

  const exp = now + COOKIE_TTL_SECONDS;
  const cookie = await signToken(
    { scope: 'admin_user', admin_id: row.id, h: tokenHash, iat: now, exp },
    env.SESSION_SECRET
  );

  const isHttps = new URL(request.url).protocol === 'https:';
  const headers = new Headers();
  headers.set('Location', '/admin');
  headers.set('Cache-Control', 'no-store');
  headers.append('Set-Cookie', buildCookie('cs_admin', cookie, COOKIE_TTL_SECONDS, isHttps));
  return new Response('', { status: 302, headers });
}

// SameSite=Lax (not Strict) because the typical entry path is a click from
// email — a top-level cross-site navigation that Strict would block. The owner
// password login uses Strict since admins always navigate same-site there.
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
  <p>It may have been revoked. Please contact whoever sent you this link.</p>
</main></body></html>`;
  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
