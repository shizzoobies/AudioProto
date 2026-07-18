// Shared ElevenLabs mint + demo-override assembly, factored out of
// functions/api/voice-agent/start.js so the Rise embed routes
// (functions/api/embed/*) mint the exact same way with a different auth gate.
// Behavior contract: /api/voice-agent/start responses must stay byte-identical
// after the refactor, and /api/embed/start must produce the same overrides for
// a demo persona (minus auth/attribution differences).

import { demoSalesDateBlock } from './scenarios.js';

// The Pro-tier demo agent (gpt-4o + eleven_v3). Pinned in code so a stale
// ELEVENLABS_AGENT_ID env var can never misroute the live demo onto the wrong
// account/agent. To move the demo to a different agent, change this and
// redeploy. (Moved verbatim from start.js.)
export const DEMO_AGENT_ID = 'agent_3501kt4nqd7rfqtrdbd0sbw69n0x';

const SIGNED_URL_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url';

// Voice-call turn-taking for CUSTOMER personas: the trainee (CS agent) answers
// the phone and greets FIRST, so the customer (the agent) must NOT speak first.
// Appended after the persona prompt; overrides the persona's "you already
// greeted" note (written for the old turn-based flow).
export const CUSTOMER_TURN_TAKING =
  '\n\nVOICE CALL TURN-TAKING (this overrides any earlier note about already greeting the agent): You are the customer calling in. The customer service agent answers the phone and greets you FIRST. Stay silent until they have greeted you. As soon as they greet you, respond naturally and explain why you are calling, in character.';

// Robert's move date stays current (about two weekends out), computed per
// request. Empty for every other scenario.
export function demoDateBlock(scenarioId, now = new Date()) {
  return scenarioId === 'demo_sales' ? '\n\n' + demoSalesDateBlock(now) : '';
}

// Mint the signed wss URL with the API key (never exposed to the browser).
// Returns { signedUrl } on success, or { error: { code, status, detail? } }
// matching the exact jsonError codes start.js has always returned.
export async function mintSignedUrl(agentId, elevenLabsKey) {
  let signed;
  try {
    const r = await fetch(`${SIGNED_URL_ENDPOINT}?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { 'xi-api-key': elevenLabsKey },
    });
    if (!r.ok) {
      const t = await safeText(r);
      return { error: { code: 'signed_url_failed', status: 502, detail: `${r.status} ${t.slice(0, 200)}` } };
    }
    signed = await r.json();
  } catch (e) {
    return { error: { code: 'upstream_unreachable', status: 502, detail: String(e?.message || e) } };
  }
  const signedUrl = signed?.signed_url;
  if (!signedUrl) return { error: { code: 'no_signed_url', status: 502 } };
  return { signedUrl };
}

// Demo voice override: the admin may have picked a labeled ElevenLabs voice for
// this demo caller (scenario_voices table). Read-only; if the table is missing
// or has no row, silently fall back (null). (Moved verbatim from start.js.)
export async function getScenarioVoiceOverride(env, scenarioId) {
  let demoVoiceOverride = null;
  if (env.DB) {
    try {
      const r = await env.DB.prepare(`SELECT voice_id FROM scenario_voices WHERE scenario_id = ?`).bind(scenarioId).first();
      if (r && r.voice_id) demoVoiceOverride = r.voice_id;
    } catch { /* table missing -> default */ }
  }
  return demoVoiceOverride;
}

// The per-conversation overrides for a DEMO customer persona (never coaching):
// same assembly as start.js's demo branch. voiceOverride comes from
// getScenarioVoiceOverride; now lets tests pin the date.
export function buildDemoOverrides(scenario, { voiceOverride = null, now = new Date() } = {}) {
  return {
    prompt: (scenario.system_prompt || '') + demoDateBlock(scenario.id, now) + CUSTOMER_TURN_TAKING,
    // Empty so the trainee greets first.
    first_message: '',
    language: 'en',
    voice_id: voiceOverride || scenario.voice_id || null,
  };
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}
