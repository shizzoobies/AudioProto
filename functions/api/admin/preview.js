// Admin endpoint for the single open "full library preview" link. Backed by the
// existing invites table (no migration): the preview link is the invites row
// whose recipient_email is the PREVIEW_RECIPIENT_EMAIL sentinel, assigned EVERY
// real scenario so its cs_me cookie unlocks the whole trainee library with no
// password. The placeholder demo scenarios (not in any scenario type) and the
// /charts page are not part of it. Middleware enforces cs_admin on every method.
//
// GET    - status: { active, created_at, last_click_at, scenario_count }
// POST   - create-or-refresh, rotate the token, re-sync the full scenario set,
//          return { url } (token shown once)
// DELETE - revoke the preview link (idempotent)

import { sha256Hex, randomId, randomToken, PREVIEW_RECIPIENT_EMAIL } from '../../../shared/auth.js';
import { listScenarioTypesForDisplay } from '../../../shared/scenarios.js';

// Every playable persona id across the displayed scenario types. This is "the
// whole library": it excludes the two placeholder demo scenarios (which live in
// no scenario type) automatically.
function allRealScenarioIds() {
  const ids = [];
  for (const t of listScenarioTypesForDisplay()) {
    for (const p of t.personas || []) ids.push(p.id);
  }
  return [...new Set(ids)];
}

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    const row = await findPreviewLink(env);
    return json({
      active: !!(row && !row.revoked),
      created_at: row?.created_at ?? null,
      last_click_at: row?.last_click_at ?? null,
      scenario_count: allRealScenarioIds().length,
    });
  } catch (e) {
    return jsonError('status_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    return await createOrRefresh(request, env);
  } catch (e) {
    return jsonError('create_failed', 500, String(e?.message || e));
  }
}

export async function onRequestDelete({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    const now = Math.floor(Date.now() / 1000);
    const res = await env.DB
      .prepare(`UPDATE invites SET revoked = 1, revoked_at = ? WHERE recipient_email = ? AND revoked = 0`)
      .bind(now, PREVIEW_RECIPIENT_EMAIL)
      .run();
    const changes = res?.meta?.changes ?? 0;
    return json({ ok: true, revoked: changes > 0 });
  } catch (e) {
    return jsonError('revoke_failed', 500, String(e?.message || e));
  }
}

async function findPreviewLink(env) {
  return env.DB
    .prepare(
      `SELECT id, created_at, last_click_at, revoked FROM invites
       WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1`
    )
    .bind(PREVIEW_RECIPIENT_EMAIL)
    .first();
}

async function createOrRefresh(request, env) {
  const now = Math.floor(Date.now() / 1000);
  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  const existing = await findPreviewLink(env);
  let inviteId;
  if (existing) {
    inviteId = existing.id;
    await env.DB
      .prepare(`UPDATE invites
                SET token_hash = ?, revoked = 0, revoked_at = NULL, expires_at = NULL
                WHERE id = ?`)
      .bind(tokenHash, inviteId)
      .run();
  } else {
    inviteId = randomId();
    await env.DB
      .prepare(`INSERT INTO invites
                (id, token_hash, recipient_email, recipient_name, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, NULL)`)
      .bind(inviteId, tokenHash, PREVIEW_RECIPIENT_EMAIL, 'Preview', now)
      .run();
  }

  // Re-sync the full scenario set on every (re)generate. PRIMARY KEY
  // (invite_id, scenario_id) makes INSERT OR IGNORE idempotent, so this keeps
  // newly added scenarios covered without disturbing the rest.
  for (const sid of allRealScenarioIds()) {
    await env.DB
      .prepare(`INSERT OR IGNORE INTO invite_scenarios (invite_id, scenario_id) VALUES (?, ?)`)
      .bind(inviteId, sid)
      .run();
  }

  const url = `${origin}/preview/${token}`;
  return json({ url }, 201);
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
