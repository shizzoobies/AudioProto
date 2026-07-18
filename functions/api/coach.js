import { getScenario } from '../../shared/scenarios.js';
import { getMagicScope, getInviteScope } from '../../shared/auth.js';
import { runCoach } from '../../shared/coach-core.js';

// The scoring pipeline itself (Anthropic call, rubric, sanitization, usage
// recording) lives in shared/coach-core.js so the Rise embed route scores
// identically behind its own course-token gate. This route keeps the cookie
// auth + scenario-scope checks it has always had.

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const scenario = getScenario(body?.scenario_id);
  if (!scenario) {
    return jsonError('unknown_scenario', 400);
  }

  // Magic-link visitors can only coach the scenario their cookie is scoped to.
  const lockedScenario = await getMagicScope(request, env);
  if (lockedScenario && lockedScenario !== body.scenario_id) {
    return jsonError('forbidden_scenario', 403);
  }
  // Invite recipients can only coach scenarios in their assigned set.
  const inviteScope = await getInviteScope(request, env);
  if (inviteScope && !inviteScope.scenarios.has(body.scenario_id)) {
    return jsonError('forbidden_scenario', 403);
  }

  const result = await runCoach(context, env, {
    scenario,
    transcript: body?.transcript,
    endpoint: 'coach',
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

  return new Response(JSON.stringify(result.body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
