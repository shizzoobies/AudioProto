// Admin endpoint for Rise/Reach course embed tokens. cs_admin-gated by the
// /api/admin/* middleware prefix rule. Unlike the demo/reel sentinel links,
// courses get MANY named tokens (one per course), each with its own scenario
// allowlist and daily call cap, stored in embed_tokens (hash only, plaintext
// shown once - same discipline as functions/api/admin/demo.js).
//
// GET  - token list with usage aggregates from embed_usage
// POST - { label, scenarios?, daily_cap? } -> create, return { id, url } once
//
// Per-token revoke/cap edits live in embeds/[id].js (PATCH).

import { sha256Hex, randomId, randomToken } from '../../../shared/auth.js';
import { getScenario, DEMO_SCENARIO_IDS, REEL_SCENARIO_IDS } from '../../../shared/scenarios.js';
import { ensureEmbedTables } from '../../../shared/embed-auth.js';

const ALLOWED_SCENARIOS = new Set([...DEMO_SCENARIO_IDS, ...REEL_SCENARIO_IDS]);

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  await ensureEmbedTables(env);
  try {
    const res = await env.DB
      .prepare(
        `SELECT t.id, t.label, t.scenarios, t.daily_cap, t.created_at, t.revoked, t.revoked_at,
                COUNT(u.id) AS calls,
                COUNT(DISTINCT u.learner) AS learners,
                COALESCE(SUM(u.duration), 0) AS seconds,
                AVG(u.score) AS avg_score,
                MAX(u.started_at) AS last_call_at
         FROM embed_tokens t
         LEFT JOIN embed_usage u ON u.token_id = t.id
         GROUP BY t.id
         ORDER BY t.created_at DESC`
      )
      .all();
    const tokens = (res?.results || []).map((r) => ({
      id: r.id,
      label: r.label,
      scenarios: String(r.scenarios || '').split(',').map((s) => s.trim()).filter(Boolean),
      daily_cap: r.daily_cap,
      created_at: r.created_at,
      revoked: !!r.revoked,
      revoked_at: r.revoked_at ?? null,
      calls: r.calls || 0,
      learners: r.learners || 0,
      minutes: Math.round((r.seconds || 0) / 60),
      avg_score: r.avg_score != null ? Math.round(r.avg_score * 10) / 10 : null,
      last_call_at: r.last_call_at ?? null,
    }));
    return json({ tokens });
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  await ensureEmbedTables(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const label = String(body?.label || '').trim().slice(0, 120);
  if (!label) return jsonError('missing_label', 400);

  // Scenario allowlist: default Robert only; every id must be a known
  // voice-agent customer persona.
  let scenarios = Array.isArray(body?.scenarios) && body.scenarios.length
    ? body.scenarios.map((s) => String(s).trim()).filter(Boolean)
    : ['demo_sales'];
  scenarios = [...new Set(scenarios)];
  for (const sid of scenarios) {
    if (!ALLOWED_SCENARIOS.has(sid) || !getScenario(sid)) {
      return jsonError('invalid_scenario', 400, sid);
    }
  }

  const capRaw = Number(body?.daily_cap);
  const dailyCap = Number.isFinite(capRaw) ? Math.max(0, Math.min(10000, Math.round(capRaw))) : 50;

  const now = Math.floor(Date.now() / 1000);
  const id = 'et_' + randomId();
  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  try {
    await env.DB
      .prepare(
        `INSERT INTO embed_tokens (id, label, token_hash, scenarios, daily_cap, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, label, tokenHash, scenarios.join(','), dailyCap, now)
      .run();
  } catch (e) {
    return jsonError('create_failed', 500, String(e?.message || e));
  }

  // Token shown once; only its hash is stored.
  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  const url = `${origin}/embed/call?ct=${token}&sid=${encodeURIComponent(scenarios[0])}`;
  return json({ id, url }, 201);
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
