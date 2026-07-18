// Marks a Rise-embed call finished. POST /api/embed/complete
// { ct, usage_id, duration_s, conversation_id } - course-token authenticated.
// usage_id is the join key the start route returned; conversation_id is stored
// purely for cross-referencing the ElevenLabs dashboard. Duration is
// client-reported (clamped) - the score, the value that matters, is written
// server-side by /api/embed/coach.

import { ensureEmbedTables, getEmbedScope } from '../../../shared/embed-auth.js';

const MAX_DURATION_S = 14400; // 4 hours - anything longer is a client bug

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  await ensureEmbedTables(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const scope = await getEmbedScope(env, body?.ct);
  if (!scope) return jsonError('invalid_token', 403);

  const usageId = typeof body?.usage_id === 'string' ? body.usage_id : '';
  if (!usageId) return jsonError('missing_usage_id', 400);

  const now = Math.floor(Date.now() / 1000);
  const duration = Math.max(0, Math.min(MAX_DURATION_S, Math.round(Number(body?.duration_s) || 0)));
  const conversationId = typeof body?.conversation_id === 'string'
    ? body.conversation_id.slice(0, 120)
    : null;

  try {
    await env.DB
      .prepare(
        `UPDATE embed_usage SET ended_at = ?, duration = ?, conversation_id = ?
         WHERE id = ? AND token_id = ?`
      )
      .bind(now, duration, conversationId, usageId, scope.id)
      .run();
  } catch (e) {
    return jsonError('usage_log_failed', 500);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
