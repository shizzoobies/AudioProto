// Revoke a specific invite. Idempotent - revoking an already-revoked invite
// returns ok:true, revoked:false (no change made). Middleware enforces cs_admin.

export async function onRequestDelete({ env, params }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  const id = typeof params?.id === 'string' ? params.id : '';
  if (!id) return jsonError('id_required', 400);

  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB
    .prepare(`UPDATE invites SET revoked = 1, revoked_at = ? WHERE id = ? AND revoked = 0`)
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
