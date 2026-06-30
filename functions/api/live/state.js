// Instructor Live Mode state channel (no AI, no paid API).
//
// GET  /api/live/state  — both roles. Returns the session status, the launchable
//                         display scenario, the latest trainee POS snapshot, and
//                         the instructor checklist/meta. The trainee SPA calls
//                         this once on boot (?live=1) to launch; the instructor
//                         view polls it ~1s for the live mirror.
// POST /api/live/state  — trainee writes the POS snapshot (card masked server
//                         side); instructor writes the end-of-session checklist
//                         and/or ends the session. Role is taken from cs_live.
//
// Self-gated by the cs_live cookie (getLiveScope re-reads D1 each call so ending
// or expiring a session cuts access instantly). Listed in the /api PUBLIC_PATHS
// allow-list so the cs_admin/cs_me middleware does not 401 it first.

import { getLiveScope, ensureLiveTable, maskTraineeState, LIVE_SCENARIO_ID } from '../../../shared/live.js';
import { getScenario } from '../../../shared/scenarios.js';

const MAX_STATE_BYTES = 400 * 1024; // the snapshot now carries a full POS HTML clone

export async function onRequestGet({ request, env }) {
  const scope = await getLiveScope(request, env);
  if (!scope) return json({ active: false }, 401);

  const row = await env.DB
    .prepare(
      `SELECT id, scenario_id, label, trainee_state, instructor_meta,
              active, created_at, updated_at, ended_at
       FROM live_sessions WHERE id = ? LIMIT 1`
    )
    .bind(scope.session_id)
    .first();
  if (!row) return json({ active: false }, 404);

  const payload = {
    active: !!row.active,
    role: scope.role,
    session_id: row.id,
    scenario_id: row.scenario_id || LIVE_SCENARIO_ID,
    label: row.label || '',
    updated_at: row.updated_at || null,
    created_at: row.created_at || null,
    ended_at: row.ended_at || null,
    // Display-safe scenario for the trainee SPA to launch the POS without the
    // gated /api/scenarios call. No persona prompt fields leak here.
    scenario: liveScenario(row.scenario_id || LIVE_SCENARIO_ID),
    state: parseJson(row.trainee_state),
    instructor_meta: parseJson(row.instructor_meta),
  };
  return json(payload, 200);
}

export async function onRequestPost({ request, env }) {
  const scope = await getLiveScope(request, env);
  if (!scope) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  await ensureLiveTable(env);
  const now = Math.floor(Date.now() / 1000);

  if (scope.role === 'trainee') {
    // Trainee writes the POS snapshot. Ignore writes after the session ended.
    if (!scope.active) return json({ error: 'session_ended' }, 409);
    const raw = body?.state;
    if (!raw || typeof raw !== 'object') return json({ error: 'state_required' }, 400);
    const masked = maskTraineeState(raw);
    const serialized = JSON.stringify(masked);
    if (serialized.length > MAX_STATE_BYTES) return json({ error: 'state_too_large' }, 413);
    await env.DB
      .prepare(`UPDATE live_sessions SET trainee_state = ?, updated_at = ? WHERE id = ?`)
      .bind(serialized, now, scope.session_id)
      .run();
    return json({ ok: true, updated_at: now });
  }

  // Instructor: save the checklist/notes and/or end the session.
  const updates = [];
  const binds = [];
  if (body?.instructor_meta && typeof body.instructor_meta === 'object') {
    const serialized = JSON.stringify(body.instructor_meta);
    if (serialized.length > MAX_STATE_BYTES) return json({ error: 'meta_too_large' }, 413);
    updates.push('instructor_meta = ?');
    binds.push(serialized);
  }
  if (body?.end === true) {
    // COALESCE keeps the FIRST end time if an already-ended session is re-ended.
    updates.push('active = 0', 'ended_at = COALESCE(ended_at, ?)');
    binds.push(now);
  }
  if (!updates.length) return json({ error: 'nothing_to_update' }, 400);
  binds.push(scope.session_id);
  await env.DB
    .prepare(`UPDATE live_sessions SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  return json({ ok: true, ended: body?.end === true });
}

// Assemble a display-only scenario object the trainee SPA can hand to renderCall.
// Only fields the POS/header actually need; never the persona prompt/triggers.
function liveScenario(scenarioId) {
  const s = getScenario(scenarioId) || {};
  return {
    id: scenarioId,
    customer_name: s.customer_name || 'Customer',
    customer_short: s.customer_short || '',
    title: s.title || 'Reservation',
    tagline: s.tagline || '',
    phone: s.phone || '',
    location: s.location || null,
    blind: false,
    live: true,
  };
}

function parseJson(s) {
  if (!s || typeof s !== 'string') return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
