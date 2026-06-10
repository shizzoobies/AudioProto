// Returns the labeled voices configured on the shared coaching ElevenLabs agent,
// so admins can import them by NAME (the agent's "Voice label") instead of
// hunting raw voice ids. The per-conversation override still needs the raw
// voice_id, so we resolve label -> voice_id here from the agent's config.
//
// ElevenLabs reference: GET /v1/convai/agents/{agent_id} ->
//   conversational_config.tts.supported_voices[] = [{ voice_id, label, ... }]
//   conversational_config.tts.voice_id           = the agent's default voice
//
// GET - { voices: [ { label, voice_id } ] }
// Middleware (functions/api/_middleware.js) enforces the cs_admin cookie.

import { SHARED_COACHING_AGENT_ID } from '../../../shared/coaching-agents.js';

const AGENT_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/agents/';
// Mirrors DEFAULT_AGENT_ID in functions/api/voice-agent/start.js — the demo
// personas (Robert/Greg) run on this ElevenLabs agent on the main account.
const DEMO_AGENT_ID = 'agent_3501kt4nqd7rfqtrdbd0sbw69n0x';

export async function onRequestGet({ request, env }) {
  // ?account=demo pulls the labeled voices off the DEMO agent (main EL account);
  // any other value (or none) keeps the original COACHING behavior exactly.
  const account = (new URL(request.url).searchParams.get('account') || '').trim();
  const isDemo = account === 'demo';

  // Coaching lives on its own ElevenLabs account — use the coaching key when set.
  // The demo agent lives on the main account, so it uses the main key only.
  const apiKey = isDemo
    ? env.ELEVENLABS_API_KEY
    : (env.COACHING_ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY);
  if (!apiKey) return jsonError('elevenlabs_key_missing', 500);
  try {
    const agentId = isDemo
      ? (env.ELEVENLABS_AGENT_ID || DEMO_AGENT_ID)
      : (env.COACHING_AGENT_ID || SHARED_COACHING_AGENT_ID);
    const r = await fetch(`${AGENT_ENDPOINT}${agentId}`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!r.ok) {
      const t = await safeText(r);
      return jsonError('agent_fetch_failed', 502, `${r.status} ${t.slice(0, 200)}`);
    }
    const data = await r.json().catch(() => null);
    // ElevenLabs has used both `conversation_config` and `conversational_config`
    // (and sometimes nests under `agent`), so probe all known shapes.
    const cfg = data?.conversation_config
      || data?.conversational_config
      || data?.agent?.conversation_config
      || data?.agent?.conversational_config
      || {};
    const tts = cfg?.tts || {};
    const supported = Array.isArray(tts.supported_voices) ? tts.supported_voices : [];

    const voices = [];
    const seen = new Set();
    const pushVoice = (id, label) => {
      if (!id || seen.has(id)) return;
      voices.push({ label: String(label || '').trim() || 'Unnamed voice', voice_id: String(id) });
      seen.add(id);
    };
    // The agent's default/primary voice first (field name varies), then the
    // multi-voice "supported voices" list (each may use label or name).
    pushVoice(tts.voice_id || tts.default_voice_id, 'Agent default voice');
    for (const v of supported) {
      if (!v) continue;
      pushVoice(v.voice_id || v.id, v.label || v.name || v.voice_name);
    }

    const payload = { voices };
    // If we still found nothing, return a small shape diagnostic so we can see
    // exactly where ElevenLabs put the voices.
    if (!voices.length) {
      payload._diag = {
        topKeys: data && typeof data === 'object' ? Object.keys(data) : [],
        cfgKeys: cfg && typeof cfg === 'object' ? Object.keys(cfg) : [],
        ttsKeys: tts && typeof tts === 'object' ? Object.keys(tts) : [],
      };
    }
    return json(payload);
  } catch (e) {
    return jsonError('upstream_unreachable', 502, String(e?.message || e));
  }
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
