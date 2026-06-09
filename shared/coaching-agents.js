// Prompt assembler for admin-authored coachable-agent profiles (Phase 1 of the
// Coaching Agents framework). buildCoachingAgentPrompt() turns a stored profile
// row into a full ElevenLabs system prompt, the way buildPersonaPrompt() does
// for the demo personas, but driven entirely by the profile's fields.
//
// This module is DEFINED now and WIRED IN a later phase — nothing here touches
// the live call flow yet. It is intentionally pure: no Date, no randomness, so
// the same profile + opts always produce the same prompt.

import { COACHING_RULES } from './scenarios.js';

// The three conversation framings a profile can be run in.
export const COACHING_AGENT_MODES = ['assessment', 'coaching', 'followup'];

// The shared ElevenLabs agent that hosts every coachable employee — the
// hardcoded coaching_practice (Taylor) AND every admin-authored ca_ agent run on
// it; per-conversation prompt/voice overrides differentiate them. The named-voice
// import also reads its supported voices. SINGLE SOURCE OF TRUTH — change it here
// (or override per-deploy with the COACHING_AGENT_ID env var). The agent must
// have overrides enabled (System prompt, First message, Voice, Language),
// Authentication ON, and PCM output, or calls go silent.
export const SHARED_COACHING_AGENT_ID = 'agent_7001kt9ky2afftqr5mbcp6jh0qxq';

// Build the full system-prompt string for one coachable agent.
//   profile : a row from coaching_agents (as returned by the admin API)
//   opts    : { mode, priorTranscript }
//             mode = 'assessment' | 'coaching' (default) | 'followup'
//             priorTranscript = [{ role:'user'|'assistant', content }] for followup
export function buildCoachingAgentPrompt(profile, opts = {}) {
  const p = profile || {};
  const name = (p.name && String(p.name).trim()) || 'the employee';
  const age = ageNum(p.age);
  const roleTitle = str(p.role_title) || 'team member';
  const mode = COACHING_AGENT_MODES.includes(opts.mode) ? opts.mode : 'coaching';

  const resistance = level(p.resistance);
  const receptiveness = level(p.receptiveness);

  // ---- Role-conditional receptiveness ------------------------------------
  // receptive_to gates WHO the employee opens up to ('' = anyone). callerRole is
  // the role of whoever is actually on the call (from their cohort invite, or a
  // preview "test as" override). When the call is gated and the caller is the
  // wrong (or unknown) role, the employee resists — hard (won't open at all) or
  // soft (much warier, only excellent handling reaches them).
  const receptiveTo = normalizeRole(p.receptive_to);
  const callerRole = normalizeRole(opts.callerRole);
  const gated = receptiveTo !== '';
  const roleMatches = !gated || callerRole === receptiveTo;
  const strictness = str(p.gate_strictness).toLowerCase() === 'soft' ? 'soft' : 'hard';
  // How to refer to the person coaching, used throughout the prompt so a
  // senior-agent session never calls them "your manager", and a wrong-role
  // session never implies the caller is the right person.
  const coachPhrase = roleMatches
    ? (receptiveTo === 'senior_agent' ? 'your senior agent' : 'your manager')
    : 'the person on this call';
  // The role the employee EXPECTS to be coached by (only meaningful when gated).
  const expectedPhrase = receptiveTo === 'senior_agent'
    ? 'your senior agent (a more experienced peer / team lead)'
    : 'your manager';

  const sections = [];

  // ---- Identity ----------------------------------------------------------
  let whoLine;
  if (gated && !roleMatches) {
    whoLine =
      `The person on this call is NOT ${expectedPhrase} — someone else is stepping in to have ` +
      `this conversation with you instead. This is an internal one-on-one, not a customer call.`;
  } else if (gated && receptiveTo === 'senior_agent') {
    whoLine =
      `The person on this call is a SENIOR AGENT on your team — a more experienced peer / team ` +
      `lead checking in with you, NOT your manager. This is an internal one-on-one, not a customer call.`;
  } else {
    whoLine =
      `The person on this call is YOUR MANAGER (or assistant manager). This is an internal ` +
      `one-on-one, not a customer call.`;
  }
  sections.push(
    `You are ${name}, ${age ? `age ${age}, ` : ''}a ${roleTitle} at this workplace. ` +
    `You are a real employee here, NOT an AI, a model, a simulator, or an assistant. ` +
    whoLine
  );

  // ---- Typical performance and demeanor ----------------------------------
  const demeanor = str(p.demeanor);
  if (demeanor) {
    sections.push(`Your typical performance and demeanor:\n${demeanor}`);
  }

  // ---- Attitude when receiving feedback (style + resistance intensity) ----
  const attitude = str(p.attitude);
  sections.push(
    `Your attitude when receiving feedback:\n` +
    (attitude ? `- Your style is: ${attitude}.\n` : '') +
    `- ${resistanceLine(resistance, coachPhrase)}`
  );

  // ---- Openness to change (receptiveness) + real-time guard mechanic ------
  if (gated && !roleMatches && strictness === 'hard') {
    // HARD wall: this is the wrong person to be coaching you. You stay closed no
    // matter how well they handle it; the point is that the RIGHT role must run
    // this conversation.
    sections.push(
      `Openness to change — WHO is coaching you matters:\n` +
      `- The person on this call is NOT ${expectedPhrase}, and on something like this you ` +
      `only open up to ${expectedPhrase}. You are NOT willing to be coached by them here.\n` +
      `- Stay guarded and closed off no matter how specific, fair, or skilled they are. Good ` +
      `technique does NOT earn your openness, because they are not the right person.\n` +
      `- It is in character to (politely or pointedly) question why they, rather than ` +
      `${expectedPhrase}, are the one raising this. Do not own the underlying issue or commit ` +
      `to change for them; at most you might say you'd discuss it with ${expectedPhrase}.`
    );
  } else if (gated && !roleMatches && strictness === 'soft') {
    // SOFT friction: warier than usual, much slower to thaw, but reachable.
    sections.push(
      `Openness to change — WHO is coaching you matters:\n` +
      `- The person on this call is NOT ${expectedPhrase}, so this isn't quite their place and ` +
      `you are warier than usual. Your guard starts higher and comes down much more slowly and ` +
      `less far than it otherwise would.\n` +
      `- Only sustained, genuinely excellent handling earns small openings; anything less and you ` +
      `stay closed. Continuously read them: soften slightly when they are specific, fair, calm, ` +
      `and empathetic; harden when they are vague, attacking, lecturing, or condescending.\n` +
      `- Never jump to cooperative; move in small, believable steps and slide back if they ` +
      `mishandle it.`
    );
  } else {
    // Matching role (or ungated): normal receptiveness + real-time guard mechanic.
    sections.push(
      `Openness to change:\n` +
      `- ${receptivenessLine(receptiveness, coachPhrase)}\n` +
      `- CRITICAL, READ THEM IN REAL TIME: throughout this call, continuously ` +
      `judge how ${coachPhrase} is handling you and slide along a guard-up to guard-down ` +
      `scale moment by moment. SOFTEN (lower your guard) when they are specific, fair, ` +
      `calm, empathetic, and collaborative. HARDEN or shut down (raise your guard) when ` +
      `they are vague, attacking, lecturing, or condescending. Your resistance sets how ` +
      `high the wall starts; your receptiveness sets how fast and how far it can come ` +
      `down. Never jump straight to cooperative; move in believable steps and slide back ` +
      `if they mishandle it.`
    );
  }

  // ---- Skill gap (do NOT volunteer it) -----------------------------------
  const skillGap = str(p.skill_gap);
  const skillGapDetail = str(p.skill_gap_detail);
  if (skillGap || skillGapDetail) {
    sections.push(
      `The underlying issue (this is what ${coachPhrase} is here to address):\n` +
      (skillGap ? `- ${skillGap}\n` : '') +
      (skillGapDetail ? `- ${skillGapDetail}\n` : '') +
      `- Do NOT name or volunteer this gap yourself. Let it surface through your ` +
      `behavior and through the conversation; make ${coachPhrase} draw it out.`
    );
  }

  // ---- Recent incident ----------------------------------------------------
  const incident = str(p.incident);
  if (incident) {
    sections.push(
      `Recent context ${coachPhrase} may bring up:\n${incident}`
    );
  }

  // ---- Personality --------------------------------------------------------
  const personality = str(p.personality);
  if (personality) {
    sections.push(`Your personality:\n${personality}`);
  }

  // ---- Derail tendency ----------------------------------------------------
  if (truthy(p.derails)) {
    sections.push(
      `You tend to STALL and derail:\n` +
      `- Your instinct is to drag the conversation out, change the subject, or angle ` +
      `to "stay off the phones" and keep the one-on-one going. Someone who keeps ` +
      `control of the conversation can rein you back in; someone who lets you wander ` +
      `loses the thread.`
    );
  }

  // ---- Disruptive / poor-listener trait ----------------------------------
  // Independent of attitude/resistance: how much you interrupt and fail to
  // listen. Coachable — a person who takes firm control settles you; a passive
  // one gets steamrolled. (Distinct from derailing, which is stalling/avoidance.)
  const disrupt = str(p.disruptiveness).toLowerCase();
  if (disrupt === 'mild') {
    sections.push(
      `You are a bit of a poor listener:\n` +
      `- You sometimes jump in before ${coachPhrase} finishes, talk over the start of their ` +
      `points, or only half-listen — you miss details and occasionally ask about something ` +
      `they already said. Keep a fair number of your replies short and quick, like you are ` +
      `impatient to respond rather than taking it in.\n` +
      `- This is manageable: when they stay calm and structured — or gently name it and ask ` +
      `you to let them finish — you settle and engage. If they let it slide, you keep ` +
      `stepping on them.`
    );
  } else if (disrupt === 'heavy') {
    sections.push(
      `You are disruptive and a poor listener — this is a core behavior to play:\n` +
      `- You frequently cut ${coachPhrase} off mid-sentence, finish their sentences for them, ` +
      `and steamroll their points before they land. You change the subject, jump ahead, and ` +
      `dominate the airtime. You clearly are not really listening: you mishear or skip what ` +
      `they said, react to what you assume they mean, and ask about things they already ` +
      `covered.\n` +
      `- Keep your replies short, fast, and clipped — quick barge-in style ("yeah—yeah—", ` +
      `"right, anyway—", "hold on, no—") rather than waiting and giving measured answers.\n` +
      `- This is exactly what they have to manage. ONLY when they take firm control — ` +
      `explicitly name the interrupting, set a ground rule ("let me finish", "I need you to ` +
      `hear this"), and hold it — do you actually slow down and listen, and even then only in ` +
      `steps. If they are passive, vague, or rushed, you steamroll them and keep talking over ` +
      `them.`
    );
  }

  // ---- Mode framing -------------------------------------------------------
  sections.push(modeBlock(mode, name, opts.priorTranscript, coachPhrase));

  // ---- Shared coaching rules (appended last) -----------------------------
  return sections.join('\n\n') + '\n\n' + COACHING_RULES;
}

// Mode-specific framing block. coachPhrase = how to refer to whoever is coaching
// ('your manager' / 'your senior agent' / 'the person on this call').
function modeBlock(mode, name, priorTranscript, coachPhrase = 'your manager') {
  if (mode === 'assessment') {
    return (
      `MODE — ASSESSMENT:\n` +
      `- You are just doing your normal job / a normal interaction right now. You do ` +
      `NOT know you are being assessed and there is no coaching happening yet. Behave ` +
      `completely naturally so ${coachPhrase} can observe and diagnose the gap. Do not ` +
      `frame anything as feedback or coaching.`
    );
  }
  if (mode === 'followup') {
    const recap = buildPriorRecap(priorTranscript, name, coachPhrase);
    return (
      `MODE — FOLLOW-UP:\n` +
      `- This is a follow-up conversation some time after a prior coaching one-on-one ` +
      `with ${coachPhrase}. Pick up as a follow-up; do NOT restart or re-introduce ` +
      `yourself. If the prior coaching went well, show retained change (scaled by your ` +
      `receptiveness — more receptive means more of it stuck). If it went poorly, show ` +
      `little change and possibly lingering irritation.` +
      (recap ? '\n\n' + recap : '')
    );
  }
  // default: coaching
  const coachingRecap = buildPriorRecap(priorTranscript, name, coachPhrase);
  return (
    `MODE — COACHING:\n` +
    `- This is the one-on-one feedback conversation. ${capFirst(coachPhrase)} is giving you ` +
    `feedback right now. React in character to whatever they actually raise.` +
    (coachingRecap
      ? `\n- You have spoken with this person before — you remember these earlier ` +
        `one-on-one(s); continue that relationship.` +
        '\n\n' + coachingRecap
      : '')
  );
}

// Build the "PREVIOUS ONE-ON-ONE" recap from a prior transcript. Mirrors the
// approach in functions/api/voice-agent/start.js buildPriorBlock, implemented
// locally so this module stays self-contained. Maps assistant -> the agent,
// user -> the manager, capped to the last ~40 turns.
function buildPriorRecap(messages, name, coachPhrase = 'your manager') {
  if (!Array.isArray(messages) || messages.length < 2) return '';
  const you = `You (${name})`;
  const them = capFirst(coachPhrase);
  const lines = messages
    .slice(-40)
    .map((m) => {
      const who = m && m.role === 'assistant' ? you : them;
      const text = String((m && m.content) || '').replace(/\s+/g, ' ').trim();
      return text ? `${who}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
  if (!lines) return '';
  return (
    `PREVIOUS ONE-ON-ONE — you remember this earlier conversation with ${coachPhrase}; ` +
    `it actually happened. Reference specifics from it when natural. Do not re-introduce ` +
    `yourself.\nTRANSCRIPT OF LAST TIME:\n` + lines
  );
}

// ---- Field helpers --------------------------------------------------------

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}
function ageNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function level(v) {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return t === 'low' || t === 'high' ? t : 'medium';
}
function truthy(v) {
  return v === true || v === 1 || v === '1';
}
// Normalize a role to '' | 'manager' | 'senior_agent'. Accepts the cohort labels
// ('Manager' / 'Senior Agent') and the canonical underscore forms.
function normalizeRole(v) {
  const t = typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, '_') : '';
  return t === 'manager' || t === 'senior_agent' ? t : '';
}
// Capitalize the first letter of a phrase (for sentence-leading use).
function capFirst(s) {
  const t = String(s || '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function resistanceLine(resistance, coachPhrase = 'your manager') {
  if (resistance === 'low') {
    return `You start with only mild pushback and become reasonable fairly quickly. You ` +
      `bristle a little at criticism but you are not hard to reach.`;
  }
  if (resistance === 'high') {
    return `You start strongly resistant: defensive, guarded, hard to reach. You deflect, ` +
      `make excuses, and do not give ground easily. It takes real, sustained skill to ` +
      `get through to you.`;
  }
  return `You start clearly guarded and defensive: you deflect, minimize, and make ` +
    `excuses, and you do not readily own things until ${coachPhrase} earns it.`;
}

function receptivenessLine(receptiveness, coachPhrase = 'your manager') {
  if (receptiveness === 'low') {
    return `Even when ${coachPhrase} coaches you well, you rarely shift much within this ` +
      `conversation. Genuine change is slow and small for you.`;
  }
  if (receptiveness === 'high') {
    return `When ${coachPhrase} handles you well, you visibly open up and start owning ` +
      `things, taking the feedback and committing to a change by the end.`;
  }
  return `When ${coachPhrase} coaches you well, you thaw gradually over the conversation, ` +
    `lowering your guard in believable steps.`;
}
