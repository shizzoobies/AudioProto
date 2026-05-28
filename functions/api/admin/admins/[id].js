// Owner-only revoke for a named admin. We revoke (set revoked=1) rather than
// hard-delete so the audit trail (who created which invite) survives. The
// middleware only checks "is some admin", so this handler re-checks
// getAdminScope().is_owner and 403s otherwise.
//
// Idempotent: revoking an already-revoked admin returns ok:true, revoked:false.
// The 'owner' pseudo-id has no DB row, so revoking it just no-ops (revoked:false).

import { getAdminScope } from '../../../../shared/auth.js';

export async function onRequestDelete({ request, env, params }) {
  const a = await getAdminScope(request, env);
  if (!a?.is_owner) return jsonError('forbidden', 403);
  if (!env.DB) return jsonError('db_not_configured', 500);

  const id = typeof params?.id === 'string' ? params.id : '';
  if (!id) return jsonError('id_required', 400);

  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB
    .prepare(`UPDATE admins SET revoked = 1, revoked_at = ? WHERE id = ? AND revoked = 0`)
    .bind(now, id)
    .run();
  const changes = res?.meta?.changes ?? 0;
  return new Response(JSON.stringify({ ok: true, revoked: changes > 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
