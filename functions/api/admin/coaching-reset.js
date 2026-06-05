// Admin-only: reset (wipe) ONE participant's progress in ONE coaching scenario.
// Deletes the coaching_progress row for (invite_id, scenario_id), which clears
// the accumulated memory + call_count + per-mode unlocks — so the manager
// restarts that scenario from Assessment. Full-admin only (under /api/admin/,
// not in the middleware's scoped allow-lists).
//
// POST { invite_id, scenario_id } -> { ok, reset: <bool> }

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

  const inviteId = typeof body?.invite_id === 'string' ? body.invite_id.trim() : '';
  const scenarioId = typeof body?.scenario_id === 'string' ? body.scenario_id.trim() : '';
  if (!inviteId) return jsonError('invite_id_required', 400);
  if (!scenarioId) return jsonError('scenario_id_required', 400);

  try {
    const res = await env.DB
      .prepare(`DELETE FROM coaching_progress WHERE invite_id = ? AND scenario_id = ?`)
      .bind(inviteId, scenarioId)
      .run();
    return json({ ok: true, reset: (res?.meta?.changes ?? 0) > 0 });
  } catch (e) {
    return jsonError('reset_failed', 500, String(e?.message || e));
  }
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
