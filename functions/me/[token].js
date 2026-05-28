// Recipient landing for invite URLs. Admins generate URLs like /me/<token>;
// this route validates the token against the invites table (sha256 hash
// lookup), issues a cs_me cookie scoped to the invite_id, bumps the click
// counter, and redirects into /app. App.js then detects cs_me on boot and
// renders the recipient's personal dashboard (their assigned scenarios).
//
// The cs_me cookie payload includes the invite's current token_hash so
// instant revocation / token rotation work the same way the MAGIC_LINK_TOKEN
// fingerprint works: the next request re-reads the row, and any mismatch
// rejects the cookie immediately.

import { signToken, sha256Hex } from '../../shared/auth.js';

const COOKIE_TTL_SECONDS = 8 * 60 * 60;

export async function onRequest({ request, env, params }) {
  const token = String(params?.token || '');
  if (!token || !env.SESSION_SECRET || !env.DB) {
    return errorPage();
  }

  const tokenHash = await sha256Hex(token);
  const row = await env.DB
    .prepare(
      `SELECT id, expires_at FROM invites
       WHERE token_hash = ? AND revoked = 0 LIMIT 1`
    )
    .bind(tokenHash)
    .first();

  if (!row) return errorPage();
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

  // The cs_me cookie outlives the click but never the invite itself, since the
  // tokenHash check on every request will fail the instant the admin revokes
  // or regenerates the invite.
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

// SameSite=Lax (not Strict) because the typical entry path is a click from
// email - a top-level cross-site navigation that Strict would block.
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
