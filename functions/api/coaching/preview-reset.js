// Self-service reset for a SCENARIO PREVIEW sandbox. A preview link is a coaching
// invite on a __cvprev__<scenario_id> sentinel email (minted by
// /api/admin/coaching-agent-preview). The builder testing a scenario hits this to
// wipe THIS preview's accumulated memory + recordings so the next test starts
// clean and doesn't get confused by an earlier run.
//
// Security: authenticates via the visitor's own cs_me invite cookie
// (getInviteScope) and ONLY ever deletes rows for that invite_id — and only when
// that invite is a preview sentinel. A real participant's cs_me can never reach a
// destructive path here because the recipient_email guard rejects them.
//
// POST (no body) -> { ok: true }

import { getInviteScope } from '../../../shared/auth.js';

const PREVIEW_PREFIX = '__cvprev__';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);

  const scope = await getInviteScope(request, env);
  if (!scope) return jsonError('unauthorized', 401);

  // Only a preview sentinel invite may self-reset. Anything else (a real
  // participant link) is forbidden so this can never wipe live progress.
  const email = typeof scope.recipient_email === 'string' ? scope.recipient_email : '';
  if (!email.startsWith(PREVIEW_PREFIX)) return jsonError('not_a_preview', 403);

  // Clear everything keyed to this preview invite. Each delete is wrapped so a
  // table that doesn't exist yet (fresh DB) can't fail the reset.
  for (const sql of [
    `DELETE FROM coaching_progress WHERE invite_id = ?`,
    `DELETE FROM dashboard_calls WHERE invite_id = ?`,
    `DELETE FROM dashboard_answers WHERE invite_id = ?`,
  ]) {
    try {
      await env.DB.prepare(sql).bind(scope.invite_id).run();
    } catch {
      // table absent or already empty — ignore
    }
  }

  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
