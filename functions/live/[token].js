// Public landing for an Instructor Live Mode link. Admins generate two URLs per
// session: /live/<traineeToken> and /live/<instructorToken>. This route hashes
// the token, finds the matching live_sessions row, infers the role from WHICH
// hash matched, issues a role-scoped cs_live cookie, and redirects:
//   trainee    -> /app?live=1        (drives the sales POS, AI fully skipped)
//   instructor -> /instructor-live   (read-only mirror + customer dossier)
//
// Not under /api, so the API middleware does not gate it. The cs_live cookie is
// re-checked against D1 on every state call, so ending/expiring a session cuts
// access instantly.

import { sha256Hex } from '../../shared/auth.js';
import {
  ensureLiveTable,
  signLiveCookie,
  buildLiveCookie,
  LIVE_COOKIE_TTL_SECONDS,
} from '../../shared/live.js';

export async function onRequest({ request, env, params }) {
  const token = String(params?.token || '');
  if (!token || !env.SESSION_SECRET || !env.DB) return errorPage();

  await ensureLiveTable(env);
  const tokenHash = await sha256Hex(token);
  const row = await env.DB
    .prepare(
      `SELECT id, active, expires_at, trainee_token_hash, instructor_token_hash
       FROM live_sessions
       WHERE trainee_token_hash = ? OR instructor_token_hash = ?
       LIMIT 1`
    )
    .bind(tokenHash, tokenHash)
    .first();
  if (!row) return errorPage();

  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at < now) return errorPage();
  if (!row.active) return errorPage('This practice session has ended.');

  const role = row.instructor_token_hash === tokenHash ? 'instructor' : 'trainee';
  const cookieValue = await signLiveCookie({
    sessionId: row.id,
    role,
    tokenHash,
    env,
  });

  const isHttps = new URL(request.url).protocol === 'https:';
  const headers = new Headers();
  headers.set('Location', role === 'instructor' ? '/instructor-live' : '/app?live=1');
  headers.set('Cache-Control', 'no-store');
  headers.append('Set-Cookie', buildLiveCookie(cookieValue, isHttps, LIVE_COOKIE_TTL_SECONDS));
  return new Response('', { status: 302, headers });
}

function errorPage(message) {
  const body = message || 'It may have expired or been revoked. Please contact whoever sent you this link.';
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
  <p>${escapeHtml(body)}</p>
</main></body></html>`;
  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
