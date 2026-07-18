// Mints the ElevenLabs signed URL for a Rise-embed call. POST /api/embed/start
// { ct, sid, learner } - course-token authenticated on every request (never
// cookies: third-party iframe context). Mints exactly like
// /api/voice-agent/start's demo branch via shared/voice-mint.js, logs the call
// start to embed_usage, and enforces the per-token daily cap HERE because the
// mint is the expensive action a leaked token could abuse.

import { getScenario, DEMO_SCENARIO_IDS, REEL_SCENARIO_IDS } from '../../../shared/scenarios.js';
import { randomId } from '../../../shared/auth.js';
import {
  ensureEmbedTables,
  getEmbedScope,
  tokenAllowsScenario,
  countCallsLastDay,
} from '../../../shared/embed-auth.js';
import {
  DEMO_AGENT_ID,
  mintSignedUrl,
  buildDemoOverrides,
  getScenarioVoiceOverride,
} from '../../../shared/voice-mint.js';

// Customer personas the embed may run: the demo personas + the reel personas.
// Coaching ids are excluded by construction (different agent, different gate).
export const EMBED_VOICE_SCENARIOS = new Set([...DEMO_SCENARIO_IDS, ...REEL_SCENARIO_IDS]);

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  if (!env.ELEVENLABS_API_KEY) return jsonError('elevenlabs_key_missing', 500);
  await ensureEmbedTables(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const scope = await getEmbedScope(env, body?.ct);
  if (!scope) return jsonError('invalid_token', 403);

  const sid = typeof body?.sid === 'string' ? body.sid : '';
  const scenario = getScenario(sid);
  if (!scenario || !tokenAllowsScenario(scope, sid) || !EMBED_VOICE_SCENARIOS.has(sid)) {
    return jsonError('forbidden_scenario', 403);
  }

  // Budget guardrail: per-token trailing-24h call cap. Counted at mint time so
  // a leaked embed URL cannot drain ElevenLabs minutes past the cap.
  const now = Math.floor(Date.now() / 1000);
  const cap = Number(scope.daily_cap || 0);
  if (cap > 0) {
    const used = await countCallsLastDay(env, scope.id, now);
    if (used >= cap) return jsonError('limit_reached', 429);
  }

  const mint = await mintSignedUrl(DEMO_AGENT_ID, env.ELEVENLABS_API_KEY);
  if (mint.error) return jsonError(mint.error.code, mint.error.status, mint.error.detail);

  const voiceOverride = await getScenarioVoiceOverride(env, sid);
  const overrides = buildDemoOverrides(scenario, { voiceOverride, now: new Date() });

  // Learner identity, as provided by the course wrapper (xAPI actor name) or
  // 'anonymous' outside Reach. Attribution only - never trusted for auth.
  const learner = String(body?.learner || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'anonymous';

  const usageId = 'eu_' + randomId();
  try {
    await env.DB
      .prepare(
        `INSERT INTO embed_usage (id, token_id, learner, scenario_id, started_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(usageId, scope.id, learner, sid, now)
      .run();
  } catch (e) {
    return jsonError('usage_log_failed', 500, String(e?.message || e));
  }

  return json({
    signed_url: mint.signedUrl,
    usage_id: usageId,
    user_id: learner,
    overrides,
    scenario: {
      id: sid,
      customer_name: scenario.customer_name || '',
    },
  });
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
