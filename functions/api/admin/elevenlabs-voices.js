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

export async function onRequestGet({ env }) {
  // Coaching lives on its own ElevenLabs account — use the coaching key when set.
  const apiKey = env.COACHING_ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY;
  if (!apiKey) return jsonError('elevenlabs_key_missing', 500);
  try {
    const agentId = env.COACHING_AGENT_ID || SHARED_COACHING_AGENT_ID;
    const r = await fetch(`${AGENT_ENDPOINT}${agentId}`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!r.ok) {
      const t = await safeText(r);
      return jsonError('agent_fetch_failed', 502, `${r.status} ${t.slice(0, 200)}`);
    }
    const data = await r.json().catch(() => null);
    const tts = data?.conversational_config?.tts || {};
    const supported = Array.isArray(tts.supported_voices) ? tts.supported_voices : [];

    const voices = [];
    const seen = new Set();
    // The agent's default single voice first (if any), so a single-voice agent
    // still imports something useful.
    if (tts.voice_id && !seen.has(tts.voice_id)) {
      voices.push({ label: 'Agent default voice', voice_id: String(tts.voice_id) });
      seen.add(tts.voice_id);
    }
    for (const v of supported) {
      if (!v || !v.voice_id || seen.has(v.voice_id)) continue;
      voices.push({ label: String(v.label || '').trim() || 'Unnamed voice', voice_id: String(v.voice_id) });
      seen.add(v.voice_id);
    }

    return json({ voices });
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
