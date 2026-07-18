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
  const usageId = typeof body?.usage_id === 'string' ? body.usage_id : '';
  const score = Number(result.body?.overall_score);
  if (usageId && Number.isFinite(score)) {
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
