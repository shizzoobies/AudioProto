const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const STT_MODEL = 'scribe_v1';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  if (!env.ELEVENLABS_API_KEY) {
    return jsonError('elevenlabs_key_missing', 500);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonError('invalid_multipart', 400);
  }

  const audio = form.get('audio');
  if (!audio || typeof audio === 'string') {
    return jsonError('audio_required', 400);
  }
  if (typeof audio.size === 'number' && audio.size === 0) {
    return jsonError('audio_empty', 400);
  }
  if (typeof audio.size === 'number' && audio.size > MAX_AUDIO_BYTES) {
    return jsonError('audio_too_large', 413);
  }

  const upstreamForm = new FormData();
  const filename = audio.name && /\.[a-z0-9]+$/i.test(audio.name) ? audio.name : 'recording.webm';
  upstreamForm.append('file', audio, filename);
  upstreamForm.append('model_id', STT_MODEL);

  let upstream;
  try {
    upstream = await fetch(ELEVENLABS_URL, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
      body: upstreamForm,
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

  let result;
  try {
    result = await upstream.json();
  } catch {
    return jsonError('upstream_malformed', 502);
  }

  const transcript = typeof result?.text === 'string' ? result.text.trim() : '';
  return new Response(JSON.stringify({ transcript }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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
