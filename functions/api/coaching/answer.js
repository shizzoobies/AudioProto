// POST /api/coaching/answer — autosave a single fillable Development-Plan field
// for the manager behind the cs_me invite cookie. NOT under /api/admin, so the
// middleware passes it through; this endpoint authenticates itself via
// getInviteScope (401 if none) and keys every write to that invite link.
//
// Body { field_key, value }: field_key is the stable '${section_key}__${position}'
// key returned by GET /api/coaching/dashboard; value is the manager's text
// (coerced to a string, capped). UPSERTs into dashboard_answers. Returns { ok:true }.

import { getInviteScope } from '../../../shared/auth.js';
import { ensureDashboardTables } from '../../../shared/dashboard-store.js';

const VALUE_CAP = 8000;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);

  const scope = await getInviteScope(request, env);
  if (!scope) return jsonError('unauthorized', 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const fieldKey = typeof body?.field_key === 'string' ? body.field_key.trim() : '';
  if (!fieldKey) return jsonError('field_key_required', 400);

  const value = String(body?.value == null ? '' : body.value).slice(0, VALUE_CAP);
  const now = Math.floor(Date.now() / 1000);

  try {
    await ensureDashboardTables(env);
    await env.DB
      .prepare(
        `INSERT INTO dashboard_answers (invite_id, field_key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (invite_id, field_key)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(scope.invite_id, fieldKey, value, now)
      .run();
    return json({ ok: true });
  } catch (e) {
    return jsonError('save_failed', 500, String(e?.message || e));
  }
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
