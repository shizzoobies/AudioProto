// GET /api/coaching/recording?mode=assessment|coaching|followup[&download=1]
// Proxies the ElevenLabs call-audio for the manager's recorded coaching call so
// the browser never sees the API key. NOT under /api/admin, so the middleware
// passes it through; this endpoint authenticates itself via getInviteScope (401).
//
// Looks up the conversation_id recorded for (invite_id, mode) in dashboard_calls,
// then streams GET /v1/convai/conversations/{id}/audio back as audio/mpeg. If
// ElevenLabs returns non-200 the audio is not ready yet (the conversation must be
// 'done' with has_audio true), so we answer 202 'not_ready' and the client can
// retry shortly. With &download=1 the response is sent as an attachment.

import { getInviteScope } from '../../../shared/auth.js';
import { CALL_MODES } from '../../../shared/coaching-dashboard.js';
import { ensureDashboardTables } from '../../../shared/dashboard-store.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);

  const scope = await getInviteScope(request, env);
  if (!scope) return jsonError('unauthorized', 401);

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || '';
  if (!CALL_MODES.includes(mode)) return jsonError('invalid_mode', 400);
  const download = url.searchParams.get('download') === '1';

  try {
    await ensureDashboardTables(env);

    const row = await env.DB
      .prepare(`SELECT conversation_id FROM dashboard_calls WHERE invite_id = ? AND mode = ?`)
      .bind(scope.invite_id, mode)
      .first();
    const conversationId = row?.conversation_id;
    if (!conversationId) return jsonError('no_recording', 404);

    const apiKey = env.COACHING_ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY;
    if (!apiKey) return jsonError('elevenlabs_key_missing', 500);

    let upstream;
    try {
      upstream = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`,
        { headers: { 'xi-api-key': apiKey } }
      );
    } catch (e) {
      return jsonError('upstream_unreachable', 502, String(e?.message || e));
    }

    // Non-200 here means the audio is still processing (conversation not 'done'
    // or has_audio false yet). Tell the client to check back shortly.
    if (!upstream.ok) return jsonError('not_ready', 202);

    const headers = {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, max-age=600',
    };
    if (download) {
      headers['Content-Disposition'] = `attachment; filename="coaching-${mode}-recording.mp3"`;
    }
    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    return jsonError('recording_failed', 500, String(e?.message || e));
  }
}

function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
