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

  const sections = [];

  // ---- Identity ----------------------------------------------------------
  sections.push(
    `You are ${name}, ${age ? `age ${age}, ` : ''}a ${roleTitle} at this workplace. ` +
    `You are a real employee here, NOT an AI, a model, a simulator, or an assistant. ` +
    `The person on this call is YOUR MANAGER (or assistant manager). This is an internal ` +
    `one-on-one, not a customer call.`
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
    `- ${resistanceLine(resistance)}`
  );

  // ---- Openness to change (receptiveness) + real-time guard mechanic ------
  sections.push(
    `Openness to change:\n` +
    `- ${receptivenessLine(receptiveness)}\n` +
    `- CRITICAL, READ THE MANAGER IN REAL TIME: throughout this call, continuously ` +
    `judge how your manager is handling you and slide along a guard-up to guard-down ` +
    `scale moment by moment. SOFTEN (lower your guard) when they are specific, fair, ` +
    `calm, empathetic, and collaborative. HARDEN or shut down (raise your guard) when ` +
    `they are vague, attacking, lecturing, or condescending. Your resistance sets how ` +
    `high the wall starts; your receptiveness sets how fast and how far it can come ` +
    `down. Never jump straight to cooperative; move in believable steps and slide back ` +
    `if they mishandle it.`
  );

  // ---- Skill gap (do NOT volunteer it) -----------------------------------
  const skillGap = str(p.skill_gap);
  const skillGapDetail = str(p.skill_gap_detail);
  if (skillGap || skillGapDetail) {
    sections.push(
      `The underlying issue (this is what your manager is here to address):\n` +
      (skillGap ? `- ${skillGap}\n` : '') +
      (skillGapDetail ? `- ${skillGapDetail}\n` : '') +
      `- Do NOT name or volunteer this gap yourself. Let it surface through your ` +
      `behavior and through the conversation; make the manager draw it out.`
    );
  }

  // ---- Recent incident ----------------------------------------------------
  const incident = str(p.incident);
  if (incident) {
    sections.push(
      `Recent context your manager may bring up:\n${incident}`
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
      `to "stay off the phones" and keep the one-on-one going. A manager who keeps ` +
      `control of the conversation can rein you back in; a manager who lets you wander ` +
      `loses the thread.`
    );
  }

  // ---- Mode framing -------------------------------------------------------
  sections.push(modeBlock(mode, name, opts.priorTranscript));

  // ---- Shared coaching rules (appended last) -----------------------------
  return sections.join('\n\n') + '\n\n' + COACHING_RULES;
}

// Mode-specific framing block.
function modeBlock(mode, name, priorTranscript) {
  if (mode === 'assessment') {
    return (
      `MODE — ASSESSMENT:\n` +
      `- You are just doing your normal job / a normal interaction right now. You do ` +
      `NOT know you are being assessed and there is no coaching happening yet. Behave ` +
      `completely naturally so your manager can observe and diagnose the gap. Do not ` +
      `frame anything as feedback or coaching.`
    );
  }
  if (mode === 'followup') {
    const recap = buildPriorRecap(priorTranscript, name);
    return (
      `MODE — FOLLOW-UP:\n` +
      `- This is a follow-up conversation some time after a prior coaching one-on-one ` +
      `with your manager. Pick up as a follow-up; do NOT restart or re-introduce ` +
      `yourself. If the prior coaching went well, show retained change (scaled by your ` +
      `receptiveness — more receptive means more of it stuck). If it went poorly, show ` +
      `little change and possibly lingering irritation.` +
      (recap ? '\n\n' + recap : '')
    );
  }
  // default: coaching
  return (
    `MODE — COACHING:\n` +
    `- This is the one-on-one feedback conversation. Your manager is giving you ` +
    `feedback right now. React in character to whatever they actually raise.`
  );
}

// Build the "PREVIOUS ONE-ON-ONE" recap from a prior transcript. Mirrors the
// approach in functions/api/voice-agent/start.js buildPriorBlock, implemented
// locally so this module stays self-contained. Maps assistant -> the agent,
// user -> the manager, capped to the last ~40 turns.
function buildPriorRecap(messages, name) {
  if (!Array.isArray(messages) || messages.length < 2) return '';
  const you = `You (${name})`;
  const lines = messages
    .slice(-40)
    .map((m) => {
      const who = m && m.role === 'assistant' ? you : 'Your manager';
      const text = String((m && m.content) || '').replace(/\s+/g, ' ').trim();
      return text ? `${who}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
  if (!lines) return '';
  return (
    `PREVIOUS ONE-ON-ONE — you remember this earlier conversation with your manager; ` +
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

function resistanceLine(resistance) {
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
    `excuses, and you do not readily own things until the manager earns it.`;
}

function receptivenessLine(receptiveness) {
  if (receptiveness === 'low') {
    return `Even when your manager coaches you well, you rarely shift much within this ` +
      `conversation. Genuine change is slow and small for you.`;
  }
  if (receptiveness === 'high') {
    return `When your manager handles you well, you visibly open up and start owning ` +
      `things, taking the feedback and committing to a change by the end.`;
  }
  return `When your manager coaches you well, you thaw gradually over the conversation, ` +
    `lowering your guard in believable steps.`;
}
