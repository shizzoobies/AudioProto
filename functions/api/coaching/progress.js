// Manager-facing per-scenario call progress for admin-authored (ca_) coaching
// scenarios. This is NOT under /api/admin, so the middleware does NOT gate it —
// it authenticates itself via the manager's cs_me invite cookie (getInviteScope)
// and only ever touches scenarios that invite is actually granted.
//
// POST  body { scenario_id, messages:[{role,content}] }
//   - appends the call's messages to the saved transcript for
//     (invite_id, scenario_id), caps it, bumps call_count, and returns
//     { ok:true, call_count }.
//
// The saved transcript is what start.js replays into the agent prompt so the
// agent "remembers" every prior call this manager took in this scenario. It is
// keyed to the invite link, so it survives browser/device changes.
//
// The table self-bootstraps at runtime (ensureProgressTable) so it exists on
// Cloudflare without a manual migration step.

import { getInviteScope } from '../../../shared/auth.js';

const TRANSCRIPT_CAP = 120; // keep only the most recent N turns

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const scenarioId = typeof body?.scenario_id === 'string' ? body.scenario_id.trim() : '';
  if (!scenarioId) return jsonError('scenario_id_required', 400);
  if (!scenarioId.startsWith('ca_')) return jsonError('not_an_authored_scenario', 400);

  const scope = await getInviteScope(request, env);
  if (!scope) return jsonError('unauthorized', 401);
  if (!scope.scenarios.has(scenarioId)) return jsonError('forbidden', 403);

  // Normalize the incoming messages to {role:'user'|'assistant', content}, drop
  // empty content. assistant/customer -> assistant; everything else -> user.
  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  const newMessages = incoming
    .map((m) => {
      const role = m && (m.role === 'assistant' || m.role === 'customer') ? 'assistant' : 'user';
      const content = String((m && m.content) || '').trim();
      return content ? { role, content } : null;
    })
    .filter(Boolean);

  try {
    await ensureProgressTable(env);

    // Load the existing row (transcript + call_count) for this manager+scenario.
    const existing = await env.DB
      .prepare(`SELECT transcript, call_count FROM coaching_progress WHERE invite_id = ? AND scenario_id = ?`)
      .bind(scope.invite_id, scenarioId)
      .first();

    let priorTranscript = [];
    if (existing?.transcript) {
      try {
        const parsed = JSON.parse(existing.transcript);
        if (Array.isArray(parsed)) priorTranscript = parsed;
      } catch {
        priorTranscript = [];
      }
    }

    const merged = priorTranscript.concat(newMessages).slice(-TRANSCRIPT_CAP);
    const callCount = (Number(existing?.call_count) || 0) + 1;
    const now = Math.floor(Date.now() / 1000);
    const transcriptJson = JSON.stringify(merged);

    if (existing) {
      await env.DB
        .prepare(
          `UPDATE coaching_progress SET transcript = ?, call_count = ?, updated_at = ?
             WHERE invite_id = ? AND scenario_id = ?`
        )
        .bind(transcriptJson, callCount, now, scope.invite_id, scenarioId)
        .run();
    } else {
      await env.DB
        .prepare(
          `INSERT INTO coaching_progress (invite_id, scenario_id, transcript, call_count, updated_at)
             VALUES (?, ?, ?, ?, ?)`
        )
        .bind(scope.invite_id, scenarioId, transcriptJson, callCount, now)
        .run();
    }

    return json({ ok: true, call_count: callCount });
  } catch (e) {
    return jsonError('save_failed', 500, String(e?.message || e));
  }
}

// Runtime self-bootstrap: create the progress table if it does not exist yet.
// Mirrors the ensure... pattern used in admin/coaching-agents.js.
async function ensureProgressTable(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS coaching_progress (
         invite_id    TEXT NOT NULL,
         scenario_id  TEXT NOT NULL,
         transcript   TEXT,
         call_count   INTEGER NOT NULL DEFAULT 0,
         updated_at   INTEGER,
         PRIMARY KEY (invite_id, scenario_id)
       )`
    ).run();
  } catch {
    // table already present or a benign race — safe to ignore
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
