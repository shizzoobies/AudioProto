// Streams a short sample of an ElevenLabs voice so admins can LISTEN before
// picking it. We look up the voice's preview_url (GET /v1/voices/{id}) with the
// coaching account key, then proxy the mp3 back from our own origin so it plays
// under the admin page's CSP (same-origin media) — the raw ElevenLabs/CDN URL is
// never exposed to the browser and no extra TTS credits are spent.
//
// GET /api/admin/voice-preview?voice_id=...  -> audio/mpeg (the voice sample)
// Middleware (functions/api/_middleware.js) enforces the cs_admin cookie.

const VOICE_ENDPOINT = 'https://api.elevenlabs.io/v1/voices/';

export async function onRequestGet({ request, env }) {
  const apiKey = env.COACHING_ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY;
  if (!apiKey) return jsonError('elevenlabs_key_missing', 500);

  const voiceId = (new URL(request.url).searchParams.get('voice_id') || '').trim();
  if (!voiceId) return jsonError('voice_id_required', 400);

  try {
    // 1) Resolve the voice's preview sample URL.
    const vr = await fetch(`${VOICE_ENDPOINT}${encodeURIComponent(voiceId)}`, {
      headers: { 'xi-api-key': apiKey },
    });
    if (!vr.ok) {
      const t = await safeText(vr);
      return jsonError('voice_fetch_failed', 502, `${vr.status} ${t.slice(0, 200)}`);
    }
    const v = await vr.json().catch(() => null);
    const previewUrl = v?.preview_url;
    if (!previewUrl) return jsonError('no_preview', 404);

    // 2) Proxy the sample mp3 back from our origin (CSP-safe, cookies stay ours).
    const ar = await fetch(previewUrl);
    if (!ar.ok || !ar.body) return jsonError('preview_fetch_failed', 502, String(ar.status));
    return new Response(ar.body, {
      status: 200,
      headers: {
        'Content-Type': ar.headers.get('Content-Type') || 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e) {
    return jsonError('upstream_unreachable', 502, String(e?.message || e));
  }
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}
function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
