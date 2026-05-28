// "Am I logged in as admin, and who am I?" The middleware gates /api/admin/*
// with a strict cs_admin check, so if execution reaches this handler the answer
// to "logged in" is yes. We additionally call getAdminScope to return the
// caller's identity so the SPA can show "signed in as ..." and gate the
// owner-only Team section.

import { getAdminScope } from '../../../shared/auth.js';

export async function onRequestGet({ request, env }) {
  const a = await getAdminScope(request, env);
  if (!a) {
    // Shouldn't happen (middleware already gated), but fail closed.
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(
    JSON.stringify({
      ok: true,
      admin: { email: a.email, name: a.name, is_owner: !!a.is_owner },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
