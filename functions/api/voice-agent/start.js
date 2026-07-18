// Mints a short-lived signed WebSocket URL for the ElevenLabs voice agent and
// returns the per-conversation overrides (system prompt, first message, voice)
// drawn from the chosen demo persona. The API key stays server-side; the browser
// only ever sees the one-time signed URL.
//
// Demo-only and behind the same cookie gate as /api/chat (the middleware already
// requires a valid session/invite cookie; we further restrict to demo scenarios
// and the visitor's scope).

import { getScenario, DEMO_SCENARIO_IDS, REEL_SCENARIO_IDS } from '../../../shared/scenarios.js';
import { getMagicScope, getInviteScope } from '../../../shared/auth.js';
import { buildCoachingAgentPrompt, COACHING_AGENT_MODES, SHARED_COACHING_AGENT_ID } from '../../../shared/coaching-agents.js';
import { stageForMode } from '../../../shared/coaching-dashboard.js';
import { resolveManagerStage } from '../../../shared/dashboard-store.js';
// Mint core + demo override pieces are shared with the Rise embed routes
// (shared/voice-mint.js) so both surfaces mint identically.
import {
  DEMO_AGENT_ID,
  CUSTOMER_TURN_TAKING,
  demoDateBlock,
  mintSignedUrl,
  getScenarioVoiceOverride,
} from '../../../shared/voice-mint.js';

const DEFAULT_AGENT_ID = DEMO_AGENT_ID;
// Scenarios allowed on the real-time voice agent: the demo personas, the five
// back-to-back reel personas, and coaching. The reel ids overlap demo_sales;
// Set dedupes. Adding the four library reel personas here lets start.js mint
// signed URLs for them so they run on the voice agent (they were turn-based
// before). Their existing system_prompt + voice_id drive the call unchanged.
const VOICE_AGENT_SCENARIOS = new Set([...DEMO_SCENARIO_IDS, ...REEL_SCENARIO_IDS, 'coaching_practice']);

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const scenarioId = body?.scenario_id;
  // Any id starting with ca_ is an admin-authored coaching agent (Phase 2).
  // These don't live in the hardcoded SCENARIOS map; they're loaded from D1.
  const isCoachingAgent = typeof scenarioId === 'string' && scenarioId.startsWith('ca_');

  // Resolve an authored agent's profile up front (so the gate can verify it
  // exists + is active before minting anything).
  let agentProfile = null;
  if (isCoachingAgent) {
    try {
      agentProfile = await env.DB
        .prepare('SELECT * FROM coaching_agents WHERE id = ? AND active = 1')
        .bind(scenarioId)
        .first();
    } catch {
      agentProfile = null;
    }
    if (!agentProfile) return jsonError('unknown_scenario', 400);
  }

  // Hardcoded scenarios (demo personas + coaching_practice) resolve from the
  // SCENARIOS map. Authored agents don't — they're gated separately above.
  const scenario = isCoachingAgent ? null : getScenario(scenarioId);
  if (!isCoachingAgent && !scenario) return jsonError('unknown_scenario', 400);
  if (!isCoachingAgent && !VOICE_AGENT_SCENARIOS.has(scenarioId)) {
    return jsonError('not_a_voice_agent_scenario', 403);
  }

  // Pick the agent: coaching_practice (Taylor) + every authored ca_ agent run on
  // the shared coaching agent (env override wins). Demo personas are pinned in
  // code to the Pro-tier demo agent (DEFAULT_AGENT_ID) so a stale ELEVENLABS_AGENT_ID
  // env var can never misroute the live demo onto the wrong account/agent. To move
  // the demo to a different agent, change DEFAULT_AGENT_ID and redeploy.
  const isAnyCoaching = isCoachingAgent || scenarioId === 'coaching_practice';
  const agentId = isAnyCoaching
    ? (env.COACHING_AGENT_ID || SHARED_COACHING_AGENT_ID)
    : DEFAULT_AGENT_ID;

  // Coaching runs on its own ElevenLabs account, so it uses a separate API key
  // when one is configured; demos + the turn-based pipeline keep the main key.
  const elevenLabsKey = isAnyCoaching
    ? (env.COACHING_ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY)
    : env.ELEVENLABS_API_KEY;
  if (!elevenLabsKey) return jsonError('elevenlabs_key_missing', 500);

  // Same scope checks as /api/chat: magic-link + invite recipients are limited to
  // their assigned scenarios. (Agent/owner sessions pass through.) getInviteScope
  // expands an __all_coaching__ invite into concrete ca_ ids, so a recipient
  // granted "all coaching agents" passes this check for any active ca_ id.
  const lockedScenario = await getMagicScope(request, env);
  if (lockedScenario && lockedScenario !== scenarioId) return jsonError('forbidden_scenario', 403);
  const inviteScope = await getInviteScope(request, env);
  if (inviteScope && !inviteScope.scenarios.has(scenarioId)) return jsonError('forbidden_scenario', 403);

  // Coaching dashboard gate: a cohort manager may only START a call whose section
  // is unlocked for their cohort's stage (assessment=1, coaching=3, followup=4).
  // The client greys locked sections, but enforce it here too so a locked call
  // can never actually run (legacy picker, stale view, or a direct request).
  // Ad-hoc (non-cohort) managers resolve to MAX_STAGE and are ungated.
  if (isCoachingAgent && inviteScope) {
    const reqMode = COACHING_AGENT_MODES.includes(body?.mode) ? body.mode : 'coaching';
    const effStage = await resolveManagerStage(env, inviteScope.invite_id);
    if (effStage < stageForMode(reqMode)) return jsonError('call_locked', 403);
  }

  // Mint the signed wss URL with the API key (never exposed to the browser).
  const mint = await mintSignedUrl(agentId, elevenLabsKey);
  if (mint.error) return jsonError(mint.error.code, mint.error.status, mint.error.detail);
  const signedUrl = mint.signedUrl;

  // Voice-call turn-taking: the trainee (CS agent) answers the phone and greets
  // FIRST, so the customer (the agent) must NOT speak first. An empty
  // first_message makes the ElevenLabs agent wait for the trainee, and we append
  // an explicit directive that overrides the persona prompt's "you already
  // greeted" note (written for the old turn-based flow).
  const isCoaching = scenarioId === 'coaching_practice';
  // Coaching supports a follow-up mode: the client sends the prior call's
  // transcript so Taylor "remembers" the last one-on-one and continues in
  // character. A fresh call sends none.
  const mode = body?.mode === 'followup' ? 'followup' : 'fresh';
  const priorTranscript = Array.isArray(body?.prior_transcript) ? body.prior_transcript : [];
  const isFollowup = isCoaching && mode === 'followup' && priorTranscript.length >= 2;
  const priorBlock = isFollowup ? buildPriorBlock(priorTranscript) : '';

  // Attribution for the ElevenLabs recording: tag the conversation with WHO made
  // it so the dashboard "Conversations" list is identifiable per user. Prefer the
  // name the participant typed (the only signal that distinguishes individuals on
  // the shared coaching link); fall back to the invite identity. ElevenLabs
  // records audio + transcript automatically — this only labels them. Computed
  // before the authored-agent branch so ca_ agents are attributed too.
  const participantName = typeof body?.participant === 'string' ? body.participant.trim().slice(0, 60) : '';
  const inviteWho = inviteScope ? (inviteScope.recipient_name || inviteScope.recipient_email || '') : '';
  const userId = (participantName || inviteWho || 'guest').replace(/\s+/g, ' ').slice(0, 120);

  // ---- Authored coaching agent (ca_) -------------------------------------
  // Resolve the profile into the assembler's expected shape and build the
  // full prompt + overrides from D1, then return early. The hardcoded
  // coaching_practice and demo branches below are left untouched.
  if (isCoachingAgent) {
    const agentMode = COACHING_AGENT_MODES.includes(body?.mode) ? body.mode : 'coaching';

    // Caller role drives role-conditional receptiveness (receptive_to gate).
    // Normally it's the role assigned on the cohort invite ('Manager' / 'Senior
    // Agent'). For a PREVIEW link ONLY (a __cvprev__ sentinel), honor a
    // client-supplied as_role so a scenario builder can test both the matching
    // and the wrong-role behavior. Real participants can never spoof their role.
    let callerRole = (inviteScope && inviteScope.recipient_role) || '';
    const isPreviewInvite =
      typeof inviteScope?.recipient_email === 'string' &&
      inviteScope.recipient_email.startsWith('__cvprev__');
    if (isPreviewInvite && typeof body?.as_role === 'string' && body.as_role.trim()) {
      callerRole = body.as_role.trim();
    }

    // Server-side memory: IGNORE any client-sent prior_transcript. Load the saved
    // transcript for THIS manager (invite link) in THIS scenario from
    // coaching_progress, so the agent remembers every prior call regardless of
    // browser/device. Assessment mode never gets a recap; coaching + followup do.
    // No invite scope (owner/agent session testing) -> no saved memory.
    let agentPriorTranscript = [];
    if (inviteScope && agentMode !== 'assessment') {
      try {
        const prog = await env.DB
          .prepare('SELECT transcript FROM coaching_progress WHERE invite_id = ? AND scenario_id = ?')
          .bind(inviteScope.invite_id, scenarioId)
          .first();
        if (prog?.transcript) {
          const parsed = JSON.parse(prog.transcript);
          if (Array.isArray(parsed)) agentPriorTranscript = parsed;
        }
      } catch {
        agentPriorTranscript = [];
      }
    }

    let openingLines = [];
    if (agentProfile.opening_lines) {
      try {
        const parsed = JSON.parse(agentProfile.opening_lines);
        if (Array.isArray(parsed)) openingLines = parsed;
      } catch {
        openingLines = [];
      }
    }

    // The assembler accepts 0/1 too, but coerce the bit columns to booleans so
    // the profile object is clean.
    const profileObj = {
      ...agentProfile,
      opening_lines: openingLines,
      derails: !!agentProfile.derails,
      mode_assessment: !!agentProfile.mode_assessment,
      mode_coaching: !!agentProfile.mode_coaching,
      mode_followup: !!agentProfile.mode_followup,
    };

    // Voice-call turn-taking: the agent WAITS to be greeted (empty first message)
    // instead of blurting its opening line - the manager speaks first, like a real
    // one-on-one. An authored opening line, if any, is offered as a natural first
    // REPLY (after the greeting), never a cold open.
    const turnTaking =
      '\n\nVOICE CALL TURN-TAKING (this overrides any earlier note about greeting first): ' +
      'This is a one-on-one that the other person called you into. WAIT for them to speak first - ' +
      'stay completely silent until they greet or address you. Do NOT blurt anything out or open with a ' +
      'scripted line. The moment they speak, respond in character (in line with your attitude and how ' +
      'they handle you), keeping your replies conversational and fairly short.';
    const openingHint = openingLines.length
      ? ' You have characteristic reactions to this situation, such as: ' +
        openingLines.slice(0, 5).map((l) => '"' + String(l).replace(/"/g, "'").slice(0, 160) + '"').join('; ') +
        '. Use a line like these ONLY when it genuinely fits the moment - usually once the conversation turns to why you were called in or what actually happened - never as a forced or cold opening. It is perfectly fine to answer their greeting plainly and let such a reaction surface naturally when the topic comes up. Stay context-aware: a defensive line like that should be a reaction to what they raise, not something you say out of nowhere.'
      : '';
    const prompt = buildCoachingAgentPrompt(profileObj, {
      mode: agentMode,
      priorTranscript: agentPriorTranscript,
      callerRole,
    }) + turnTaking + openingHint;
    // Empty => the ElevenLabs agent stays quiet until the manager speaks first.
    const firstMessage = '';

    return json({
      signed_url: signedUrl,
      user_id: userId,
      overrides: {
        prompt,
        first_message: firstMessage,
        language: 'en',
        // Authored agents may carry their own voice — use it when set (NOT
        // null-forced like coaching_practice, which relies on its agent's voice).
        voice_id: agentProfile.voice_id || null,
      },
      scenario: {
        id: scenarioId,
        customer_name: agentProfile.name || '',
      },
    });
  }

  const turnTaking = isCoaching
    ? '\n\nVOICE CALL TURN-TAKING (this overrides any earlier note about who greeted): You are Taylor, just called into a one-on-one with your manager. You speak FIRST with a short, guarded greeting (your first message), then let your manager talk. Respond in character to whatever feedback they give - guarded and a little defensive. Keep replies short; do not give speeches.'
    : CUSTOMER_TURN_TAKING;

  // Robert's move date stays current (about two weekends out), computed now.
  const dateBlock = demoDateBlock(scenarioId, new Date());

  // Demo voice override: the admin may have picked a labeled ElevenLabs voice for
  // this demo caller (scenario_voices table). Read-only here — if the table is
  // missing or has no row, we silently fall back to the persona's hardcoded
  // voice_id. Coaching never hits this (it returns above / uses its agent voice).
  const demoVoiceOverride = await getScenarioVoiceOverride(env, scenarioId);

  return json({
    signed_url: signedUrl,
    user_id: userId,
    overrides: {
      prompt: (scenario.system_prompt || '') + dateBlock + turnTaking + priorBlock,
      // Coaching: Taylor opens (you hear her immediately). A follow-up opens by
      // acknowledging the earlier conversation. Demo: empty so the trainee greets.
      first_message: isCoaching
        ? (isFollowup ? 'Hey... you wanted to talk again?' : 'Hey... you wanted to see me?')
        : '',
      language: 'en',
      // Coaching uses its own dedicated agent — let that agent's configured voice
      // play (no override). Demo personas use the admin-picked override if set,
      // else fall back to their hardcoded persona voice.
      voice_id: scenarioId === 'coaching_practice' ? null : (demoVoiceOverride || scenario.voice_id || null),
    },
    scenario: {
      id: scenarioId,
      customer_name: scenario.customer_name || '',
    },
  });
}

// Builds the "you remember last time" block for a coaching follow-up call from
// the prior transcript ({role:'user'|'assistant', content}). Capped to the last
// ~40 turns so the prompt stays bounded.
function buildPriorBlock(messages) {
  const lines = messages
    .slice(-40)
    .map((m) => {
      const who = m && m.role === 'assistant' ? 'You (Taylor)' : 'Your manager';
      const text = String((m && m.content) || '').replace(/\s+/g, ' ').trim();
      return text ? `${who}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
  if (!lines) return '';
  return '\n\nPREVIOUS ONE-ON-ONE: you remember this earlier conversation with your manager; it actually happened. THIS CALL IS A FOLLOW-UP. Do not restart or re-introduce yourself; pick up as if some time has passed since then. React based on how it went: if your manager coached you well last time you can be a little less guarded now; if it went poorly you may still be irritated or skeptical. Reference specifics from last time when it is natural. Stay in character as Taylor.\nTRANSCRIPT OF LAST TIME:\n' + lines;
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
