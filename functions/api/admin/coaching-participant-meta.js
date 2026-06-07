// Admin: update a coaching participant's cohort + role label WITHOUT rotating
// their link (so you can reorganize cohorts / fix a role without re-sending).
// Full-admin only (under /api/admin/, not in any scoped allow-list).
//
// POST { invite_id, cohort, role } -> { ok, cohort, role }

const ROLE_SET = new Set(['Manager', 'Senior Agent', '']);

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

  const inviteId = typeof body?.invite_id === 'string' ? body.invite_id.trim() : '';
  if (!inviteId) return jsonError('invite_id_required', 400);
  const cohort = typeof body?.cohort === 'string' ? body.cohort.trim().slice(0, 80) : '';
  const role = typeof body?.role === 'string' && ROLE_SET.has(body.role.trim()) ? body.role.trim() : '';

  try {
    for (const col of ['cohort TEXT', 'recipient_role TEXT']) {
      try { await env.DB.prepare(`ALTER TABLE invites ADD COLUMN ${col}`).run(); } catch {}
    }
    await env.DB
      .prepare(`UPDATE invites SET cohort = ?, recipient_role = ? WHERE id = ?`)
      .bind(cohort, role, inviteId)
      .run();
    return json({ ok: true, cohort, role });
  } catch (e) {
    return jsonError('update_failed', 500, String(e?.message || e));
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
