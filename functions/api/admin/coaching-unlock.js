// Admin: set a participant's progression gate for one scenario — how many stages
// (calls) in the journey they may start. Default is 1 (only the first call);
// the admin raises it to release each next call after delivering lessons.
// UPSERTs coaching_progress so it works even before the first call. Memory
// (transcript + per-mode done flags) is never touched. Full-admin only.
//
// POST { invite_id, scenario_id, unlocked_stage } -> { ok, unlocked_stage }

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

  const inviteId = typeof body?.invite_id === 'string' ? body.invite_id.trim() : '';
  const scenarioId = typeof body?.scenario_id === 'string' ? body.scenario_id.trim() : '';
  if (!inviteId) return jsonError('invite_id_required', 400);
  if (!scenarioId) return jsonError('scenario_id_required', 400);
  let stage = parseInt(body?.unlocked_stage, 10);
  if (!Number.isFinite(stage)) return jsonError('unlocked_stage_required', 400);
  stage = Math.max(1, Math.min(3, stage));

  try {
    await ensureProgress(env);
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(
        `INSERT INTO coaching_progress (invite_id, scenario_id, unlocked_stage, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(invite_id, scenario_id) DO UPDATE SET unlocked_stage = excluded.unlocked_stage`
      )
      .bind(inviteId, scenarioId, stage, now)
      .run();
    return json({ ok: true, unlocked_stage: stage });
  } catch (e) {
    return jsonError('unlock_failed', 500, String(e?.message || e));
  }
}

async function ensureProgress(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS coaching_progress (
         invite_id       TEXT NOT NULL,
         scenario_id     TEXT NOT NULL,
         transcript      TEXT,
         call_count      INTEGER NOT NULL DEFAULT 0,
         assessment_done INTEGER NOT NULL DEFAULT 0,
         coaching_done   INTEGER NOT NULL DEFAULT 0,
         followup_done   INTEGER NOT NULL DEFAULT 0,
         unlocked_stage  INTEGER DEFAULT 1,
         updated_at      INTEGER,
         PRIMARY KEY (invite_id, scenario_id)
       )`
    ).run();
  } catch {
    // already present
  }
  try {
    await env.DB.prepare(`ALTER TABLE coaching_progress ADD COLUMN unlocked_stage INTEGER DEFAULT 1`).run();
  } catch {
    // column already present
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
