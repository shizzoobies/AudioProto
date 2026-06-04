// Admin CRUD for the named-voice catalogue used by the Coaching Agents
// framework. Admins add a voice once (friendly name + raw ElevenLabs voice id)
// so agent authors can pick by name instead of pasting raw ids. The raw
// voice_id is still stored on each coaching_agent row — this table is a
// named catalogue only.
//
// GET    - { voices: [ ...all rows, ordered by name COLLATE NOCASE ASC ] }
// POST   - create one entry; returns { voice: {id,name,voice_id,created_at} }, 201
// DELETE - remove by ?id= or JSON body { id }; returns { ok, deleted }
//
// Middleware (functions/api/_middleware.js) already enforces the cs_admin
// cookie on every /api/admin/* route, so no auth check is needed here.
// The table self-bootstraps at runtime (ensureCoachingVoicesTable).

import { randomId, getAdminScope } from '../../../shared/auth.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureCoachingVoicesTable(env);
    const res = await env.DB
      .prepare(`SELECT id, name, voice_id, created_at FROM coaching_voices ORDER BY name COLLATE NOCASE ASC, created_at ASC`)
      .all();
    const voices = res?.results || [];
    return json({ voices });
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureCoachingVoicesTable(env);

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('invalid_request', 400);
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const voice_id = typeof body?.voice_id === 'string' ? body.voice_id.trim() : '';
    if (!name || !voice_id) return jsonError('name_and_voice_required', 400);

    const now = Math.floor(Date.now() / 1000);
    const id = 'cv_' + randomId();

    let createdBy = null;
    try {
      const scope = await getAdminScope(request, env);
      createdBy = scope ? (scope.email || scope.admin_id || null) : null;
    } catch {
      createdBy = null;
    }

    await env.DB
      .prepare(`INSERT INTO coaching_voices (id, name, voice_id, created_at, created_by) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, name, voice_id, now, createdBy)
      .run();

    const row = await env.DB
      .prepare(`SELECT id, name, voice_id, created_at FROM coaching_voices WHERE id = ?`)
      .bind(id)
      .first();

    return json({ voice: row }, 201);
  } catch (e) {
    return jsonError('save_failed', 500, String(e?.message || e));
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureCoachingVoicesTable(env);

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
      .prepare(`DELETE FROM coaching_voices WHERE id = ?`)
      .bind(id)
      .run();
    const changes = res?.meta?.changes ?? 0;
    return json({ ok: true, deleted: changes > 0 });
  } catch (e) {
    return jsonError('delete_failed', 500, String(e?.message || e));
  }
}

// Runtime self-bootstrap: create the table if it does not exist yet. Cheap to
// call at the top of every handler; CREATE TABLE IF NOT EXISTS is a no-op once
// the table is present. Mirrors the ensure... pattern used elsewhere in admin/.
async function ensureCoachingVoicesTable(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS coaching_voices (
         id         TEXT PRIMARY KEY,
         name       TEXT NOT NULL,
         voice_id   TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         created_by TEXT
       )`
    ).run();
  } catch {
    // table already present or a benign race — safe to ignore
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
