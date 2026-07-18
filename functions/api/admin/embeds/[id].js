// Per-token admin edits for Rise/Reach course embeds. cs_admin-gated by the
// /api/admin/* middleware prefix rule.
//
// PATCH /api/admin/embeds/<id>  { daily_cap?, revoked? }
//   - revoked: true flips the kill switch (every embed request checks it);
//     false reactivates. No hard delete: usage history stays joinable.

import { ensureEmbedTables } from '../../../../shared/embed-auth.js';

export async function onRequestPatch({ request, env, params }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  await ensureEmbedTables(env);

  const id = String(params?.id || '');
  if (!id) return jsonError('missing_id', 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const row = await env.DB.prepare(`SELECT id FROM embed_tokens WHERE id = ?`).bind(id).first();
  if (!row) return jsonError('not_found', 404);

  const sets = [];
  const binds = [];

  if (body?.daily_cap !== undefined) {
    const cap = Number(body.daily_cap);
    if (!Number.isFinite(cap)) return jsonError('invalid_cap', 400);
    sets.push('daily_cap = ?');
    binds.push(Math.max(0, Math.min(10000, Math.round(cap))));
  }

  if (body?.revoked !== undefined) {
    const revoked = body.revoked ? 1 : 0;
    sets.push('revoked = ?', 'revoked_at = ?');
    binds.push(revoked, revoked ? Math.floor(Date.now() / 1000) : null);
  }

  if (!sets.length) return jsonError('nothing_to_update', 400);

  try {
    await env.DB
      .prepare(`UPDATE embed_tokens SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  } catch (e) {
    return jsonError('update_failed', 500, String(e?.message || e));
  }

  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
