// Magic-link landing. The owner shares a URL like /m/<MAGIC_LINK_TOKEN>; this
// route validates the token, issues a scoped cs_magic cookie locked to a
// single scenario (MAGIC_LINK_SCENARIO, default sales_walter), and redirects
// the visitor into the app in kiosk mode. The cookie carries a fingerprint of
// MAGIC_LINK_TOKEN, so when the owner rotates that secret in the Cloudflare
// dashboard every existing cookie is rejected on the next request - the
// off-switch is effectively instant, not just "no new clicks."

import { signToken, tokenFingerprint } from '../../shared/auth.js';

const MAGIC_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_SCENARIO = 'sales_walter';

export async function onRequest({ request, env, params }) {
  const token = String(params?.token || '');
  const expected = env.MAGIC_LINK_TOKEN || '';
  const secret = env.SESSION_SECRET || '';

  // Same response for every failure mode (missing config, wrong token) so a
  // probing visitor can't tell whether MAGIC_LINK_TOKEN is set.
  if (!secret || !expected || !constantTimeEqual(token, expected)) {
    return errorPage();
  }

  const scenario = env.MAGIC_LINK_SCENARIO || DEFAULT_SCENARIO;
  const fp = await tokenFingerprint(expected);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + MAGIC_TTL_SECONDS;
  const cookie = await signToken({ magic: true, scenario, h: fp, iat: now, exp }, secret);

  const isHttps = new URL(request.url).protocol === 'https:';
  const headers = new Headers();
  headers.set('Location', '/app');
  headers.set('Cache-Control', 'no-store');
  headers.append('Set-Cookie', buildCookie('cs_magic', cookie, MAGIC_TTL_SECONDS, isHttps));
  return new Response('', { status: 302, headers });
}

// cs_magic uses SameSite=Lax (not Strict like the session cookie) because the
// magic link is usually clicked from email or a chat app, which is a top-level
// cross-site navigation - Strict would block the cookie on that first hop.
function buildCookie(name, value, maxAge, isHttps) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

const COMPARE_BUDGET = 256;
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < COMPARE_BUDGET; i++) {
    const ac = i < a.length ? a.charCodeAt(i) : 0;
    const bc = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ac ^ bc;
  }
  return diff === 0;
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
  <p>Please contact whoever sent you this link.</p>
</main></body></html>`;
  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
