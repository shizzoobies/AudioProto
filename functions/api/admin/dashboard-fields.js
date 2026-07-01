// Admin CRUD for the editable course questions (dashboard_fields). Full admins
// (and full-tier coaching editors) author the questions participants answer in
// each form section of the Development by Design course. The fields
// self-bootstrap + seed via ensureDashboardTables(env) (shared/dashboard-store).
//
// GET    - { fields: [ ...all rows ordered by section_key, position ] }
// POST   - upsert one field. Body { id?, section_key, label, type?, position?, active? }.
//          id present -> UPDATE; else INSERT id='df_'+randomId. Returns { field }.
// DELETE - by ?id= or JSON body { id }. Returns { ok, deleted }.
//
// Middleware (functions/api/_middleware.js) enforces cs_admin on every
// /api/admin/* route; this path is also in the FULL-tier coaching-editor
// allow-list, so a full coaching editor can reach it (a scenarios-tier editor
// gets a 401).

import { randomId } from '../../../shared/auth.js';
import { ensureDashboardTables } from '../../../shared/dashboard-store.js';
import { DASHBOARD_SECTIONS } from '../../../shared/coaching-dashboard.js';

// The valid section_keys are EXACTLY the course's form sections — derived from
// the single source of truth so they can never drift from the skeleton again.
const SECTION_KEYS = DASHBOARD_SECTIONS.filter((s) => s.type === 'form').map((s) => s.section_key);
const MAX_LABEL = 600;
const MAX_HINT = 4000;

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureDashboardTables(env);
    const res = await env.DB
      .prepare(`SELECT id, section_key, label, type, position, hint, part, grp, active, created_at
                FROM dashboard_fields
                ORDER BY section_key ASC, position ASC, created_at ASC`)
      .all();
    return json({ fields: res?.results || [] });
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureDashboardTables(env);

    let body;
    try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

    const id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : '';
    const section_key = typeof body?.section_key === 'string' ? body.section_key.trim() : '';
    if (!SECTION_KEYS.includes(section_key)) return jsonError('invalid_section_key', 400);

    const label = typeof body?.label === 'string' ? body.label.trim().slice(0, MAX_LABEL) : '';
    if (!label) return jsonError('label_required', 400);

    // active defaults to 1; only honor an explicit 0/1 (or boolean) in the body.
    let active = 1;
    if (body?.active === 0 || body?.active === false || body?.active === '0') active = 0;
    else if (body?.active === 1 || body?.active === true || body?.active === '1') active = 1;

    // Optional attributes: written ONLY when explicitly present in the body, so a
    // toggle or label-only edit never clobbers type/hint/position. hint = '' clears.
    const hasType = typeof body?.type === 'string' && !!body.type.trim();
    const type = hasType ? body.type.trim() : 'textarea';
    const hasHint = typeof body?.hint === 'string';
    const hint = hasHint ? body.hint.slice(0, MAX_HINT) : null;
    const hasPosition = Number.isInteger(body?.position);

    const now = Math.floor(Date.now() / 1000);

    if (id) {
      // UPDATE only the columns the caller actually sent (plus the always-safe
      // section_key/label/active). Preserves type/hint/part/grp otherwise.
      const sets = ['section_key = ?', 'label = ?', 'active = ?'];
      const binds = [section_key, label, active];
      if (hasType) { sets.push('type = ?'); binds.push(type); }
      if (hasHint) { sets.push('hint = ?'); binds.push(hint); }
      if (hasPosition) { sets.push('position = ?'); binds.push(body.position); }
      binds.push(id);
      await env.DB
        .prepare(`UPDATE dashboard_fields SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...binds)
        .run();
    } else {
      // INSERT a new field. Position defaults to MAX(position)+1 within section.
      let position;
      if (hasPosition) {
        position = body.position;
      } else {
        const row = await env.DB
          .prepare(`SELECT MAX(position) AS m FROM dashboard_fields WHERE section_key = ?`)
          .bind(section_key)
          .first();
        position = (row && row.m != null ? Number(row.m) : -1) + 1;
      }
      const newId = 'df_' + randomId();
      await env.DB
        .prepare(`INSERT INTO dashboard_fields (id, section_key, label, type, position, hint, active, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(newId, section_key, label, type, position, hint, active, now)
        .run();
      const field = await env.DB
        .prepare(`SELECT id, section_key, label, type, position, hint, part, grp, active, created_at FROM dashboard_fields WHERE id = ?`)
        .bind(newId)
        .first();
      return json({ field }, 201);
    }

    const field = await env.DB
      .prepare(`SELECT id, section_key, label, type, position, hint, part, grp, active, created_at FROM dashboard_fields WHERE id = ?`)
      .bind(id)
      .first();
    return json({ field });
  } catch (e) {
    return jsonError('save_failed', 500, String(e?.message || e));
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureDashboardTables(env);

    let id = new URL(request.url).searchParams.get('id') || '';
    if (!id) {
      try {
        const body = await request.json();
        if (typeof body?.id === 'string') id = body.id;
      } catch {
        // no body / not JSON — fall through to the missing-id check
      }
    }
    id = (id || '').trim();
    if (!id) return jsonError('id_required', 400);

    const res = await env.DB
      .prepare(`DELETE FROM dashboard_fields WHERE id = ?`)
      .bind(id)
      .run();
    const changes = res?.meta?.changes ?? 0;
    return json({ ok: true, deleted: changes > 0 });
  } catch (e) {
    return jsonError('delete_failed', 500, String(e?.message || e));
  }
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
