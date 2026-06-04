// Admin CRUD for per-person Scenario EDITORS — the people allowed to author
// coaching scenarios. Parallel to coaching-participants (managers who take
// calls), but these get the scoped Scenarios-editor scope instead. Each editor
// is an invites row with mode='coaching_editor' and a /coaching-pass/<token>
// link that opens ONLY the Scenarios editor (see getCoachingAdminScope +
// functions/coaching-pass/[token].js). Full-admin only — this path is NOT in the
// middleware's COACHING_ADMIN_ALLOWED_PATHS, so an editor cannot invite editors.
//
// GET    - { editors: [ { id, recipient_email, recipient_name, url, has_link,
//            created_at, expires_at, last_click_at, revoked } ] }
// POST   - { email, name?, expires_days? } create-or-refresh one editor invite,
//          email the link, return { editor } (the fresh URL is included)
// DELETE - ?id= or { id }: revoke one editor invite

import {
  sha256Hex,
  randomId,
  randomToken,
  getAdminScope,
} from '../../../shared/auth.js';
import { sendCoachingEditorEmail } from '../../../shared/email.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EDITOR_MODE = 'coaching_editor';

// Self-bootstrap the columns we rely on (mirrors invites.js). Swallow dup-column.
async function ensureColumns(env) {
  for (const col of ['mode TEXT', 'token_plain TEXT']) {
    try {
      await env.DB.prepare(`ALTER TABLE invites ADD COLUMN ${col}`).run();
    } catch {
      // already present
    }
  }
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureColumns(env);
    const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
    const res = await env.DB
      .prepare(
        `SELECT id, recipient_email, recipient_name, created_at, expires_at,
                revoked, last_click_at, token_plain
         FROM invites WHERE mode = ? ORDER BY revoked ASC, created_at DESC`
      )
      .bind(EDITOR_MODE)
      .all();
    const editors = (res?.results || []).map((r) => ({
      id: r.id,
      recipient_email: r.recipient_email,
      recipient_name: r.recipient_name || null,
      url: r.token_plain ? `${origin}/coaching-pass/${r.token_plain}` : null,
      has_link: !!r.token_plain,
      created_at: r.created_at ?? null,
      expires_at: r.expires_at ?? null,
      last_click_at: r.last_click_at ?? null,
      revoked: !!r.revoked,
    }));
    return json({ editors });
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureColumns(env);

    let body;
    try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) return jsonError('invalid_email', 400);
    const name = typeof body?.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : null;

    // Expiry: default never (NULL). Accept an integer day count 1..365.
    let expiresAt = null;
    const rawDays = body?.expires_days;
    if (rawDays === null || rawDays === undefined || rawDays === 0 || rawDays === '0' || rawDays === 'never') {
      expiresAt = null;
    } else {
      const d = Number.isInteger(rawDays) ? rawDays : parseInt(rawDays, 10);
      if (!Number.isFinite(d) || d < 1 || d > 365) return jsonError('invalid_expires_days', 400);
      expiresAt = Math.floor(Date.now() / 1000) + d * 86400;
    }

    const now = Math.floor(Date.now() / 1000);
    const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
    const actor = await getAdminScope(request, env);
    const createdBy = actor?.email || null;

    const token = randomToken();
    const tokenHash = await sha256Hex(token);

    // Reuse this email's existing editor invite (rotate its link), else insert.
    const existing = await env.DB
      .prepare(`SELECT id FROM invites WHERE recipient_email = ? AND revoked = 0 AND mode = ? LIMIT 1`)
      .bind(email, EDITOR_MODE)
      .first();

    let inviteId;
    let reused = false;
    if (existing) {
      inviteId = existing.id;
      reused = true;
      await env.DB
        .prepare(`UPDATE invites
                  SET token_hash = ?, token_plain = ?, expires_at = ?,
                      recipient_name = COALESCE(?, recipient_name),
                      created_by = COALESCE(?, created_by), mode = ?
                  WHERE id = ?`)
        .bind(tokenHash, token, expiresAt, name, createdBy, EDITOR_MODE, inviteId)
        .run();
    } else {
      inviteId = randomId();
      await env.DB
        .prepare(`INSERT INTO invites
                  (id, token_hash, token_plain, recipient_email, recipient_name, created_at, expires_at, created_by, mode)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(inviteId, tokenHash, token, email, name, now, expiresAt, createdBy, EDITOR_MODE)
        .run();
    }

    const url = `${origin}/coaching-pass/${token}`;
    const emailResult = await sendCoachingEditorEmail(env, { to: email, name, url });

    const editor = {
      id: inviteId,
      email,
      name,
      url,
      reused,
      email_sent: emailResult.ok,
    };
    if (!emailResult.ok) {
      editor.email_error = emailResult.error;
      if (emailResult.detail) editor.email_error_detail = emailResult.detail;
    }
    return json({ editor }, 201);
  } catch (e) {
    return jsonError('create_failed', 500, String(e?.message || e));
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    let id = new URL(request.url).searchParams.get('id') || '';
    if (!id) {
      try { const b = await request.json(); if (typeof b?.id === 'string') id = b.id; } catch {}
    }
    id = (id || '').trim();
    if (!id) return jsonError('id_required', 400);

    const now = Math.floor(Date.now() / 1000);
    const res = await env.DB
      .prepare(`UPDATE invites SET revoked = 1, revoked_at = ? WHERE id = ? AND mode = ?`)
      .bind(now, id, EDITOR_MODE)
      .run();
    return json({ ok: true, revoked: (res?.meta?.changes ?? 0) > 0 });
  } catch (e) {
    return jsonError('revoke_failed', 500, String(e?.message || e));
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
