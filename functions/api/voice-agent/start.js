// Mints a short-lived signed WebSocket URL for the ElevenLabs voice agent and
// returns the per-conversation overrides (system prompt, first message, voice)
// drawn from the chosen demo persona. The API key stays server-side; the browser
// only ever sees the one-time signed URL.
//
// Demo-only and behind the same cookie gate as /api/chat (the middleware already
// requires a valid session/invite cookie; we further restrict to demo scenarios
// and the visitor's scope).

import { getScenario, DEMO_SCENARIO_IDS, demoSalesDateBlock } from '../../../shared/scenarios.js';
import { getMagicScope, getInviteScope } from '../../../shared/auth.js';

const DEFAULT_AGENT_ID = 'agent_3501kt4nqd7rfqtrdbd0sbw69n0x';
// Scenarios that run on their OWN dedicated ElevenLabs agent (otherwise the
// default demo agent is used). The coaching scenario has its own agent.
const AGENT_BY_SCENARIO = {
  coaching_practice: 'agent_2501kt72x065ff4r9f308xq1fsha',
};
const SIGNED_URL_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url';
// Scenarios allowed on the real-time voice agent: the demo personas + coaching.
const VOICE_AGENT_SCENARIOS = new Set([...DEMO_SCENARIO_IDS, 'coaching_practice']);

export async function onRequestPost({ request, env }) {
  if (!env.ELEVENLABS_API_KEY) return jsonError('elevenlabs_key_missing', 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const scenarioId = body?.scenario_id;
  const scenario = getScenario(scenarioId);
  if (!scenario) return jsonError('unknown_scenario', 400);
  if (!VOICE_AGENT_SCENARIOS.has(scenarioId)) return jsonError('not_a_voice_agent_scenario', 403);

  // Pick this scenario's dedicated agent (coaching) if it has one, else the
  // default demo agent (an env override still wins for the default).
  const agentId = AGENT_BY_SCENARIO[scenarioId] || env.ELEVENLABS_AGENT_ID || DEFAULT_AGENT_ID;

  // Same scope checks as /api/chat: magic-link + invite recipients are limited to
  // their assigned scenarios. (Agent/owner sessions pass through.)
  const lockedScenario = await getMagicScope(request, env);
  if (lockedScenario && lockedScenario !== scenarioId) return jsonError('forbidden_scenario', 403);
  const inviteScope = await getInviteScope(request, env);
  if (inviteScope && !inviteScope.scenarios.has(scenarioId)) return jsonError('forbidden_scenario', 403);

  // Mint the signed wss URL with the API key (never exposed to the browser).
  let signed;
  try {
    const r = await fetch(`${SIGNED_URL_ENDPOINT}?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
    });
    if (!r.ok) {
      const t = await safeText(r);
      return jsonError('signed_url_failed', 502, `${r.status} ${t.slice(0, 200)}`);
    }
    signed = await r.json();
  } catch (e) {
    return jsonError('upstream_unreachable', 502, String(e?.message || e));
  }
  const signedUrl = signed?.signed_url;
  if (!signedUrl) return jsonError('no_signed_url', 502);

  // Voice-call turn-taking: the trainee (CS agent) answers the phone and greets
  // FIRST, so the customer (the agent) must NOT speak first. An empty
  // first_message makes the ElevenLabs agent wait for the trainee, and we append
  // an explicit directive that overrides the persona prompt's "you already
  // greeted" note (written for the old turn-based flow).
  const isCoaching = scenarioId === 'coaching_practice';
  const turnTaking = isCoaching
    ? '\n\nVOICE CALL TURN-TAKING (this overrides any earlier note about who greeted): You are Taylor, just called into a one-on-one with your manager. You speak FIRST with a short, guarded greeting (your first message), then let your manager talk. Respond in character to whatever feedback they give - guarded and a little defensive. Keep replies short; do not give speeches.'
    : '\n\nVOICE CALL TURN-TAKING (this overrides any earlier note about already greeting the agent): You are the customer calling in. The customer service agent answers the phone and greets you FIRST. Stay silent until they have greeted you. As soon as they greet you, respond naturally and explain why you are calling, in character.';

  // Robert's move date stays current (about two weekends out), computed now.
  const dateBlock = scenarioId === 'demo_sales' ? '\n\n' + demoSalesDateBlock(new Date()) : '';

  return json({
    signed_url: signedUrl,
    overrides: {
      prompt: (scenario.system_prompt || '') + dateBlock + turnTaking,
      // Coaching: Taylor opens (you hear her immediately). Demo: empty so the
      // trainee greets first.
      first_message: isCoaching ? 'Hey... you wanted to see me?' : '',
      language: 'en',
      // Coaching uses its own dedicated agent — let that agent's configured voice
      // play (no override). Demo personas still override to their persona voice.
      voice_id: scenarioId === 'coaching_practice' ? null : (scenario.voice_id || null),
    },
    scenario: {
      id: scenarioId,
      customer_name: scenario.customer_name || '',
    },
  });
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
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
