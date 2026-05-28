// Admin auth gate for the dashboard. Separate from the trainee app password:
// only the admin who provisions ADMIN_PASSWORD in the Pages dashboard can mint
// cs_admin cookies, which in turn unlock /admin and /api/admin/*. The cookie
// is HMAC-signed with the same SESSION_SECRET we use for other cookies (one
// secret, multiple claims), 8h TTL, SameSite=Strict because admins always
// navigate same-site.

import { signToken, constantTimeEqual } from '../../../shared/auth.js';

const SESSION_TTL_SECONDS = 8 * 60 * 60;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'POST') return handleLogin(request, env);
  if (request.method === 'DELETE') return handleLogout(request);
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST, DELETE' },
  });
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const password = typeof body?.password === 'string' ? body.password : '';
  const expected = env.ADMIN_PASSWORD;
  const secret = env.SESSION_SECRET;

  if (!expected || !secret) {
    return jsonError('server_misconfigured', 500);
  }

  if (!constantTimeEqual(password, expected)) {
    return jsonError('invalid_password', 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SECONDS;
  const token = await signToken({ role: 'admin', iat: now, exp }, secret);

  const isHttps = new URL(request.url).protocol === 'https:';
  return new Response(JSON.stringify({ ok: true, expires_at: exp }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildCookie('cs_admin', token, SESSION_TTL_SECONDS, isHttps),
    },
  });
}

function handleLogout(request) {
  const isHttps = new URL(request.url).protocol === 'https:';
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildCookie('cs_admin', '', 0, isHttps),
    },
  });
}

function buildCookie(name, value, maxAge, isHttps) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
