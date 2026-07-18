// Scores a Rise-embed call transcript. POST /api/embed/coach
// { ct, sid, usage_id, transcript } - course-token authenticated. Runs the
// exact same scoring pipeline as /api/coach (shared/coach-core.js) and then
// writes the SERVER-derived overall_score onto the embed_usage row, so the
// score the LMS and the admin dashboard see can never be client-claimed.

import { getScenario } from '../../../shared/scenarios.js';
import { runCoach } from '../../../shared/coach-core.js';
import { ensureEmbedTables, getEmbedScope, tokenAllowsScenario } from '../../../shared/embed-auth.js';
import { EMBED_VOICE_SCENARIOS } from './start.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonError('db_not_configured', 500);
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

  // Anthropic-spend guardrail: scoring must be tied to a real, recent, not yet
  // scored call on THIS token. A leaked course token alone cannot farm the
  // coach; it would first have to burn a capped /api/embed/start mint per
  // report, and re-scoring the same call is refused outright.
  const usageId = typeof body?.usage_id === 'string' ? body.usage_id : '';
  if (!usageId) return jsonError('missing_usage_id', 400);
  const usageRow = await env.DB
    .prepare(`SELECT id, started_at, score FROM embed_usage WHERE id = ? AND token_id = ?`)
    .bind(usageId, scope.id)
    .first();
  if (!usageRow) return jsonError('unknown_call', 403);
  if (usageRow.score != null) return jsonError('already_scored', 409);
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - Number(usageRow.started_at || 0) > 4 * 3600) {
    return jsonError('call_expired', 403);
  }

  const result = await runCoach(context, env, {
    scenario,
    transcript: body?.transcript,
    endpoint: 'embed_coach',
  });

  if (!result.ok) {
    if (result.code === 'upstream_error') {
      return new Response(
        JSON.stringify({ error: 'upstream_error', status: result.upstreamStatus, detail: result.detail }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return jsonError(result.code, result.status);
  }

  // Persist the server-derived score onto this call's usage row. Scoped to the
  // token so one course's token can never write another course's rows.
  const score = Number(result.body?.overall_score);
  if (Number.isFinite(score)) {
    try {
      await env.DB
        .prepare(`UPDATE embed_usage SET score = ? WHERE id = ? AND token_id = ?`)
        .bind(score, usageId, scope.id)
        .run();
    } catch {
      // The report still goes back to the learner; the row just lacks a score.
    }
  }

  return new Response(JSON.stringify(result.body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
