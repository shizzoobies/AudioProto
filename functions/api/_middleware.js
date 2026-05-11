import { verifyToken } from '../../shared/auth.js';

const PUBLIC_PATHS = new Set(['/api/auth']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) {
    return next();
  }

  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies.session;

  if (!token) {
    return jsonError('unauthorized', 401);
  }

  try {
    await verifyToken(token, env.SESSION_SECRET);
  } catch {
    return jsonError('invalid_or_expired_session', 401);
  }

  return next();
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
