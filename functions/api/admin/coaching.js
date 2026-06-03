// Admin endpoint for the single open "coaching" link — the open-link sibling of
// the per-email coaching invites. Backed by the existing invites table: the
// coaching link is the invites row whose recipient_email is the
// COACHING_RECIPIENT_EMAIL sentinel, with mode='coaching' and the single
// coaching_practice scenario assigned. There is at most one active coaching
// invite. Middleware enforces cs_admin on every method here.
//
// GET    - status WITHOUT any token: { active, created_at }
// POST   - create-or-refresh the coaching invite, rotate its token, return { url } (token shown once)
// DELETE - revoke the coaching invite (idempotent)

import { sha256Hex, randomId, randomToken, COACHING_RECIPIENT_EMAIL } from '../../../shared/auth.js';
import { COACHING_SCENARIO_ID } from '../../../shared/scenarios.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    const row = await findCoachingInvite(env);
    const active = !!(row && !row.revoked);
    return json({
      active,
      created_at: row?.created_at ?? null,
    });
  } catch (e) {
    return jsonError('status_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    return await createOrRefreshCoaching(request, env);
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
      .bind(now, COACHING_RECIPIENT_EMAIL)
      .run();
    const changes = res?.meta?.changes ?? 0;
    return json({ ok: true, revoked: changes > 0 });
  } catch (e) {
    return jsonError('revoke_failed', 500, String(e?.message || e));
  }
}

// Self-bootstrap the `mode` column (mirrors invites.js ensureInviteModeColumn).
// Swallow the "duplicate column" error if it already exists. Cheap to call
// before writing a coaching invite.
async function ensureInviteModeColumn(env) {
  try {
    await env.DB.prepare(`ALTER TABLE invites ADD COLUMN mode TEXT`).run();
  } catch {
    // column already present
  }
}

// The coaching invite, revoked or not, or null. There is at most one row with
// the sentinel email; if a stale revoked row exists alongside reuse logic we
// prefer the most recent.
async function findCoachingInvite(env) {
  return env.DB
    .prepare(
      `SELECT id, created_at, revoked FROM invites
       WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1`
    )
    .bind(COACHING_RECIPIENT_EMAIL)
    .first();
}

async function createOrRefreshCoaching(request, env) {
  const now = Math.floor(Date.now() / 1000);
  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  await ensureInviteModeColumn(env);

  const existing = await findCoachingInvite(env);
  let inviteId;
  if (existing) {
    // Rotate the token and clear any prior revocation so a single sentinel row
    // is reused (no plaintext token stored, never expires). Re-assert mode in
    // case the row predates the column.
    inviteId = existing.id;
    await env.DB
      .prepare(`UPDATE invites
                SET token_hash = ?, revoked = 0, revoked_at = NULL, expires_at = NULL, mode = 'coaching'
                WHERE id = ?`)
      .bind(tokenHash, inviteId)
      .run();
  } else {
    inviteId = randomId();
    await env.DB
      .prepare(`INSERT INTO invites
                (id, token_hash, recipient_email, recipient_name, created_at, expires_at, mode)
                VALUES (?, ?, ?, ?, ?, NULL, 'coaching')`)
      .bind(inviteId, tokenHash, COACHING_RECIPIENT_EMAIL, 'Coaching', now)
      .run();
  }

  // Ensure the coaching scenario is assigned. PRIMARY KEY (invite_id, scenario_id)
  // makes this safe to repeat.
  await env.DB
    .prepare(`INSERT OR IGNORE INTO invite_scenarios (invite_id, scenario_id) VALUES (?, ?)`)
    .bind(inviteId, COACHING_SCENARIO_ID)
    .run();

  // Token is shown once; only its hash is stored.
  const url = `${origin}/coaching/${token}`;
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
