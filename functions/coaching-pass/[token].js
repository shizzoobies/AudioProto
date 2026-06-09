// Public landing for the token-gated coaching-admin / Scenarios-editor link.
// Admins generate URLs like /coaching-pass/<token>; this validates the token
// against the invites table, confirms it's the coaching-admin sentinel row,
// issues a cs_coaching_admin cookie scoped to that invite_id (carrying the
// current token_hash), bumps the click counter, and redirects to /admin-coaching
// — where the SPA detects the scoped-editor scope and renders the Scenarios +
// Voices editing page only.
//
// Not under /api, so the API middleware does not gate it. This is the public,
// no-password entry point for the scoped Scenarios editor.

import { signToken, sha256Hex, COACHING_ADMIN_RECIPIENT_EMAIL, COACHING_FULL_RECIPIENT_EMAIL } from '../../shared/auth.js';

const COOKIE_TTL_SECONDS = 8 * 60 * 60;

export async function onRequest({ request, env, params }) {
  const token = String(params?.token || '');
  if (!token || !env.SESSION_SECRET || !env.DB) {
    return errorPage();
  }

  const tokenHash = await sha256Hex(token);
  const row = await env.DB
    .prepare(
      `SELECT id, recipient_email, expires_at, mode FROM invites
       WHERE token_hash = ? AND revoked = 0 LIMIT 1`
    )
    .bind(tokenHash)
    .first();

  if (!row) return errorPage();
  // Accept the scenarios-tier links (shared sentinel or mode='coaching_editor')
  // AND the full-tier links (full sentinel or mode='coaching_full_editor'). All
  // four open the coaching admin page; getCoachingAdminScope decides the tier.
  const isEditorLink =
    row.recipient_email === COACHING_ADMIN_RECIPIENT_EMAIL ||
    row.recipient_email === COACHING_FULL_RECIPIENT_EMAIL ||
    row.mode === 'coaching_editor' ||
    row.mode === 'coaching_full_editor';
  if (!isEditorLink) return errorPage();
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) return errorPage();

  try {
    await env.DB
      .prepare(`UPDATE invites SET last_click_at = ? WHERE id = ?`)
      .bind(now, row.id)
      .run();
  } catch {
    // ignore
  }

  const exp = now + COOKIE_TTL_SECONDS;
  const cookie = await signToken(
    { scope: 'coaching_admin', invite_id: row.id, h: tokenHash, iat: now, exp },
    env.SESSION_SECRET
  );

  const isHttps = new URL(request.url).protocol === 'https:';
  const headers = new Headers();
  headers.set('Location', '/admin-coaching');
  headers.set('Cache-Control', 'no-store');
  headers.append('Set-Cookie', buildCookie('cs_coaching_admin', cookie, COOKIE_TTL_SECONDS, isHttps));
  return new Response('', { status: 302, headers });
}

function buildCookie(name, value, maxAge, isHttps) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function errorPage() {
  const html = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>Link inactive</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html,body{margin:0;padding:0;background:#FAF8F3;color:#1A2332;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:grid;place-items:center}
    main{max-width:520px;padding:32px;text-align:center}
    h1{font-weight:600;letter-spacing:-0.02em;font-size:24px;margin:0 0 12px}
    p{margin:0;color:#6B6256;line-height:1.55}
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
