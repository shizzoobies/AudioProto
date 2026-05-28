import { getScenario } from '../../shared/scenarios.js';
import { verifyToken, getMagicScope, getInviteScope } from '../../shared/auth.js';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const STANDARD_TTS_MODEL = 'eleven_multilingual_v2';
const PREMIUM_TTS_MODEL = 'eleven_v3';
const SHOWCASE_PERSONA_PREFIX = 'showcase_';
const TTS_OUTPUT = 'mp3_44100_128';

const DEFAULT_VOICE_SETTINGS = {
  stability: 0.45,
  similarity_boost: 0.7,
  style: 0.2,
  use_speaker_boost: true,
};

export async function onRequestPost({ request, env }) {
  if (!env.ELEVENLABS_API_KEY) {
    return jsonError('elevenlabs_key_missing', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return jsonError('text_required', 400);
  if (text.length > 1500) return jsonError('text_too_long', 400);

  // Magic-link visitors are locked to one scenario. Reject any other scenario
  // and also raw voice_id calls (which would bypass the scenario check).
  const lockedScenario = await getMagicScope(request, env);
  if (lockedScenario && body?.scenario_id !== lockedScenario) {
    return jsonError('forbidden_scenario', 403);
  }
  const inviteScope = await getInviteScope(request, env);
  if (inviteScope && (!body?.scenario_id || !inviteScope.scenarios.has(body.scenario_id))) {
    return jsonError('forbidden_scenario', 403);
  }

  let voiceId = null;
  let voiceSettings = DEFAULT_VOICE_SETTINGS;
  let isShowcaseScenario = false;
  let isPremiumScenario = false;

  if (body?.scenario_id) {
    const scenario = getScenario(body.scenario_id);
    if (!scenario) return jsonError('unknown_scenario', 400);
    voiceId = scenario.voice_id;
    if (scenario.voice_settings) {
      voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...scenario.voice_settings };
    }
    isShowcaseScenario = String(body.scenario_id).startsWith(SHOWCASE_PERSONA_PREFIX);
    isPremiumScenario = !!scenario.premium;
  } else if (typeof body?.voice_id === 'string') {
    if (!/^[A-Za-z0-9]{12,}$/.test(body.voice_id)) {
      return jsonError('invalid_voice_id', 400);
    }
    voiceId = body.voice_id;
  } else {
    return jsonError('scenario_id_or_voice_id_required', 400);
  }

  // Premium personas always get the expressive v3 voice; the showcase persona
  // gets it when the demo is unlocked.
  const demoUnlocked = await isDemoUnlocked(request, env.SESSION_SECRET);
  const modelId = (isPremiumScenario || (isShowcaseScenario && demoUnlocked)) ? PREMIUM_TTS_MODEL : STANDARD_TTS_MODEL;

  // eleven_v3 performs square-bracket delivery tags ([sighs], [warmly]).
  // The standard model would speak them aloud, so strip them defensively
  // whenever we are not on the premium model.
  const speechText = modelId === PREMIUM_TTS_MODEL
    ? text
    : text.replace(/\[[^\]\n]+\]/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
  if (!speechText) return jsonError('text_required', 400);

  const url = `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}?output_format=${TTS_OUTPUT}`;

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: speechText,
        model_id: modelId,
        voice_settings: voiceSettings,
      }),
    });
  } catch {
    return jsonError('upstream_unreachable', 502);
  }

  if (!upstream.ok) {
    const detail = await safeReadText(upstream);
    return new Response(
      JSON.stringify({ error: 'upstream_error', status: upstream.status, detail: detail.slice(0, 500) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-TTS-Model': modelId,
    },
  });
}

async function isDemoUnlocked(request, secret) {
  if (!secret) return false;
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies.cs_demo;
  if (!token) return false;
  try {
    const payload = await verifyToken(token, secret);
    return !!payload?.demo;
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
