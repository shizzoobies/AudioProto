// Identity probe for a scoped coaching-admin visitor. The admin SPA calls this on
// boot when the full admin session check (and the review probe) fail: a valid
// cs_coaching_admin cookie means "render the Scenarios admin page only."
// Reachable by cs_coaching_admin (via the middleware allow-list) and by full
// admins. DELETE clears the cs_coaching_admin cookie (scoped-editor logout).

import { getCoachingAdminScope } from '../../../shared/auth.js';

export async function onRequestGet({ request, env }) {
  const scope = await getCoachingAdminScope(request, env);
  return json({ coaching_editor: !!scope });
}

export async function onRequestDelete({ request }) {
  const isHttps = new URL(request.url).protocol === 'https:';
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  const parts = ['cs_coaching_admin=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttps) parts.push('Secure');
  headers.append('Set-Cookie', parts.join('; '));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
