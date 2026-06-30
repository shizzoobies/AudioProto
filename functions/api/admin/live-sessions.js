// Admin CRUD for Instructor Live Mode sessions. Backed by D1 (env.DB). The /api
// middleware enforces cs_admin on every method here, so no extra auth check.
//
// GET  - list sessions (active first) with their re-copyable trainee + instructor
//        links (we retain token_plain, like invites, for passwordless re-copy).
// POST - { label? } create a session: mint a paired trainee/instructor token,
//        store the hashes, return both share links.
// POST - { action: 'end', id } end a session (active = 0). { action: 'delete', id }
//        removes the row entirely.

import {
  ensureLiveTable,
  mintLiveTokens,
  LIVE_SCENARIO_ID,
} from '../../../shared/live.js';
import { randomId, getAdminScope } from '../../../shared/auth.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'db_not_configured' }, 500);
  try {
    await ensureLiveTable(env);
    const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
    const res = await env.DB
      .prepare(
        `SELECT id, label, scenario_id, created_at, updated_at, active, ended_at,
                trainee_token_plain, instructor_token_plain
         FROM live_sessions
         ORDER BY active DESC, created_at DESC
         LIMIT 100`
      )
      .all();
    const sessions = (res?.results || []).map((r) => ({
      id: r.id,
      label: r.label || '',
      scenario_id: r.scenario_id || LIVE_SCENARIO_ID,
      created_at: r.created_at,
      updated_at: r.updated_at,
      active: !!r.active,
      ended_at: r.ended_at,
      trainee_url: r.trainee_token_plain ? `${origin}/live/${r.trainee_token_plain}` : null,
      instructor_url: r.instructor_token_plain ? `${origin}/live/${r.instructor_token_plain}` : null,
    }));
    return json({ sessions });
  } catch (e) {
    return json({ error: 'list_failed', detail: String(e?.message || e) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'db_not_configured' }, 500);
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    await ensureLiveTable(env);

    // Lifecycle actions on an existing session.
    if (body?.action === 'end' || body?.action === 'delete') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) return json({ error: 'id_required' }, 400);
      if (body.action === 'delete') {
        await env.DB.prepare(`DELETE FROM live_sessions WHERE id = ?`).bind(id).run();
        return json({ ok: true, deleted: true });
      }
      const now = Math.floor(Date.now() / 1000);
      await env.DB
        .prepare(`UPDATE live_sessions SET active = 0, ended_at = ? WHERE id = ?`)
        .bind(now, id)
        .run();
      return json({ ok: true, ended: true });
    }

    // Default: create a new session.
    const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 120) : '';
    const id = randomId();
    const now = Math.floor(Date.now() / 1000);
    const { traineeToken, instructorToken, traineeHash, instructorHash } = await mintLiveTokens();
    const actor = await getAdminScope(request, env);
    const createdBy = actor?.email || null;

    await env.DB
      .prepare(
        `INSERT INTO live_sessions
           (id, created_at, updated_at, scenario_id, label,
            trainee_token_hash, instructor_token_hash,
            trainee_token_plain, instructor_token_plain,
            active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .bind(
        id, now, now, LIVE_SCENARIO_ID, label,
        traineeHash, instructorHash,
        traineeToken, instructorToken,
        createdBy
      )
      .run();

    const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
    return json(
      {
        id,
        label,
        scenario_id: LIVE_SCENARIO_ID,
        created_at: now,
        active: true,
        trainee_url: `${origin}/live/${traineeToken}`,
        instructor_url: `${origin}/live/${instructorToken}`,
      },
      201
    );
  } catch (e) {
    return json({ error: 'create_failed', detail: String(e?.message || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
