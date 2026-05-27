// "Do I have a real password-based session?" The middleware also lets
// cs_magic visitors through, but they DON'T have a session - so this route
// has to verify the session cookie itself. Returning 200 here is what tells
// app.js to go to the normal home; returning 401 lets it fall through to the
// magic-status check, which routes magic-link recipients into kiosk mode.

import { verifyToken, parseCookieHeader } from '../../shared/auth.js';

export async function onRequestGet({ request, env }) {
  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  if (!cookies.session || !env.SESSION_SECRET) {
    return jsonError('unauthorized', 401);
  }
  try {
    await verifyToken(cookies.session, env.SESSION_SECRET);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return jsonError('unauthorized', 401);
  }
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
