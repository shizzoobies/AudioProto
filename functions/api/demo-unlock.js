import { signToken } from '../../shared/auth.js';

const DEMO_TTL_SECONDS = 8 * 60 * 60;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'POST') return handleUnlock(request, env);
  if (request.method === 'DELETE') return handleClear(request);

  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST, DELETE' },
  });
}

async function handleUnlock(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const password = typeof body?.password === 'string' ? body.password : '';
  const expected = env.DEMO_PASSWORD;
  const secret = env.SESSION_SECRET;

  if (!expected || !secret) {
    return jsonError('demo_not_configured', 500);
  }

  if (!constantTimeEqual(password, expected)) {
    return jsonError('invalid_password', 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + DEMO_TTL_SECONDS;
  const token = await signToken({ demo: true, iat: now, exp }, secret);

  const isHttps = new URL(request.url).protocol === 'https:';
  return new Response(JSON.stringify({ ok: true, expires_at: exp }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildCookie('cs_demo', token, DEMO_TTL_SECONDS, isHttps),
    },
  });
}

function handleClear(request) {
  const isHttps = new URL(request.url).protocol === 'https:';
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildCookie('cs_demo', '', 0, isHttps),
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

const PASSWORD_COMPARE_BUDGET = 256;
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < PASSWORD_COMPARE_BUDGET; i++) {
    const ac = i < a.length ? a.charCodeAt(i) : 0;
    const bc = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ac ^ bc;
  }
  return diff === 0;
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
