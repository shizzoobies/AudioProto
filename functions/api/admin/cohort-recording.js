// GET /api/admin/cohort-recording?invite_id=...&mode=assessment|coaching|followup[&download=1]
// Admin review of a cohort member's recorded coaching call. Looks up the
// conversation_id stored for (invite_id, mode) in dashboard_calls, then proxies
// GET /v1/convai/conversations/{id}/audio back as audio/mpeg so the ElevenLabs
// API key never reaches the browser. Returns 202 'not_ready' while the audio is
// still processing. Middleware enforces the full cs_admin cookie on every
// /api/admin/* route, and this path is NOT in the cs_coaching_admin allow-list,
// so only full admins can review recordings. With &download=1 it's an attachment.

import { CALL_MODES } from '../../../shared/coaching-dashboard.js';
import { ensureDashboardTables } from '../../../shared/dashboard-store.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);

  const url = new URL(request.url);
  const inviteId = (url.searchParams.get('invite_id') || '').trim();
  const mode = url.searchParams.get('mode') || '';
  if (!inviteId) return jsonError('invite_id_required', 400);
  if (!CALL_MODES.includes(mode)) return jsonError('invalid_mode', 400);
  const download = url.searchParams.get('download') === '1';

  try {
    await ensureDashboardTables(env);

    const row = await env.DB
      .prepare(`SELECT conversation_id FROM dashboard_calls WHERE invite_id = ? AND mode = ?`)
      .bind(inviteId, mode)
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

    // Non-200 means the audio is still processing (conversation not 'done' / no
    // has_audio yet). Tell the client to retry shortly.
    if (!upstream.ok) return jsonError('not_ready', 202);

    const headers = {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, max-age=600',
    };
    if (download) {
      headers['Content-Disposition'] = `attachment; filename="coaching-${mode}-${inviteId}.mp3"`;
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
