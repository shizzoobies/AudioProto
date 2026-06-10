// Per-scenario voice override store for the DEMO callers (Robert = demo_sales,
// Lauren = demo_service). The admin picks a labeled voice from the demo ElevenLabs
// agent; we persist the raw voice_id here so the live call can resolve the
// override. With no row, the call falls back to the persona's hardcoded
// voice_id (the `defaults` below). This mirrors how the coaching framework lets
// admins pick a voice by label, but here it's a single override per demo caller.
//
// GET  - { assignments: { <scenario_id>: { voice_id, label } }, defaults: {...} }
// POST - { scenario_id, voice_id, label }: empty voice_id clears (revert to
//        default); otherwise UPSERT. Returns { ok:true } (or { ok:true, cleared:true }).
//
// Middleware (functions/api/_middleware.js) already enforces the cs_admin cookie
// on every /api/admin/* route. The table self-bootstraps (ensureScenarioVoicesTable).

import { getScenario } from '../../../shared/scenarios.js';

const DEMO_SCENARIO_IDS = ['demo_sales', 'demo_service'];

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureScenarioVoicesTable(env);
    const res = await env.DB
      .prepare(`SELECT scenario_id, voice_id, label FROM scenario_voices`)
      .all();
    const rows = res?.results || [];
    const assignments = {};
    for (const r of rows) {
      if (r && r.scenario_id) {
        assignments[r.scenario_id] = { voice_id: r.voice_id || '', label: r.label || '' };
      }
    }
    // Hardcoded persona voices — the fallback when no override row exists.
    const defaults = {
      demo_sales: getScenario('demo_sales')?.voice_id || '',
      demo_service: getScenario('demo_service')?.voice_id || '',
    };
    return json({ assignments, defaults });
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureScenarioVoicesTable(env);

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('invalid_request', 400);
    }

    const scenarioId = typeof body?.scenario_id === 'string' ? body.scenario_id.trim() : '';
    if (!DEMO_SCENARIO_IDS.includes(scenarioId)) return jsonError('invalid_scenario', 400);

    const voiceId = typeof body?.voice_id === 'string' ? body.voice_id.trim() : '';

    // Empty voice_id means "revert to the built-in default": drop the row.
    if (!voiceId) {
      await env.DB
        .prepare(`DELETE FROM scenario_voices WHERE scenario_id = ?`)
        .bind(scenarioId)
        .run();
      return json({ ok: true, cleared: true });
    }

    const label = (typeof body?.label === 'string' ? body.label.trim() : '').slice(0, 120);
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(`INSERT OR REPLACE INTO scenario_voices (scenario_id, voice_id, label, updated_at) VALUES (?, ?, ?, ?)`)
      .bind(scenarioId, voiceId, label, now)
      .run();
    return json({ ok: true });
  } catch (e) {
    return jsonError('save_failed', 500, String(e?.message || e));
  }
}

// Runtime self-bootstrap: create the table if it does not exist yet. Cheap to
// call at the top of every handler; CREATE TABLE IF NOT EXISTS is a no-op once
// the table is present. Mirrors the ensure... pattern used elsewhere in admin/.
async function ensureScenarioVoicesTable(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS scenario_voices (
         scenario_id TEXT PRIMARY KEY,
         voice_id    TEXT,
         label       TEXT,
         updated_at  INTEGER
       )`
    ).run();
  } catch {
    // table already present or a benign race — safe to ignore
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
