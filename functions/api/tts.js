import { getScenario } from '../../shared/scenarios.js';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const TTS_MODEL = 'eleven_turbo_v2_5';
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

  let voiceId = null;
  let voiceSettings = DEFAULT_VOICE_SETTINGS;

  if (body?.scenario_id) {
    const scenario = getScenario(body.scenario_id);
    if (!scenario) return jsonError('unknown_scenario', 400);
    voiceId = scenario.voice_id;
    if (scenario.voice_settings) {
      voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...scenario.voice_settings };
    }
  } else if (typeof body?.voice_id === 'string') {
    if (!/^[A-Za-z0-9]{12,}$/.test(body.voice_id)) {
      return jsonError('invalid_voice_id', 400);
    }
    voiceId = body.voice_id;
  } else {
    return jsonError('scenario_id_or_voice_id_required', 400);
  }

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
        text,
        model_id: TTS_MODEL,
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
    },
  });
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
