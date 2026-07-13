// Admin endpoint for the single open "Back-to-back demo reel" link. Backed by
// the existing invites table (no migration, no new column): the reel link is the
// invites row whose recipient_email is the REEL_RECIPIENT_EMAIL sentinel,
// assigned to exactly the five reel scenarios (in sequence order). There is at
// most one active reel invite. Middleware enforces cs_admin on every method here.
// Mirrors functions/api/admin/demo.js.
//
// GET    - status WITHOUT any token: { active, scenarios:[{id,customer_name,tagline}], created_at }
// POST   - create-or-refresh the reel invite, rotate its token, return { url } (token shown once)
// DELETE - revoke the reel invite (idempotent)

import { sha256Hex, randomId, randomToken, REEL_RECIPIENT_EMAIL } from '../../../shared/auth.js';
import { REEL_SCENARIO_IDS, listReelScenariosForDisplay } from '../../../shared/scenarios.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    const row = await findReelInvite(env);
    const active = !!(row && !row.revoked);
    return json({
      active,
      created_at: row?.created_at ?? null,
      scenarios: listReelScenariosForDisplay().map((s) => ({
        id: s.id,
        customer_name: s.customer_name,
        tagline: s.tagline,
      })),
    });
  } catch (e) {
    return jsonError('status_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    return await createOrRefreshReel(request, env);
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
      .bind(now, REEL_RECIPIENT_EMAIL)
      .run();
    const changes = res?.meta?.changes ?? 0;
    return json({ ok: true, revoked: changes > 0 });
  } catch (e) {
    return jsonError('revoke_failed', 500, String(e?.message || e));
  }
}

// The reel invite, revoked or not, or null. There is at most one row with the
// sentinel email; prefer the most recent.
async function findReelInvite(env) {
  return env.DB
    .prepare(
      `SELECT id, created_at, revoked FROM invites
       WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1`
    )
    .bind(REEL_RECIPIENT_EMAIL)
    .first();
}

async function createOrRefreshReel(request, env) {
  const now = Math.floor(Date.now() / 1000);
  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  const existing = await findReelInvite(env);
  let inviteId;
  if (existing) {
    // Rotate the token and clear any prior revocation so a single sentinel row
    // is reused (no plaintext token stored, never expires).
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
      .bind(inviteId, tokenHash, REEL_RECIPIENT_EMAIL, 'Demo reel', now)
      .run();
  }

  // Ensure all five reel scenarios are assigned. PRIMARY KEY (invite_id,
  // scenario_id) makes this safe to repeat.
  for (const sid of REEL_SCENARIO_IDS) {
    await env.DB
      .prepare(`INSERT OR IGNORE INTO invite_scenarios (invite_id, scenario_id) VALUES (?, ?)`)
      .bind(inviteId, sid)
      .run();
  }

  // Token is shown once; only its hash is stored.
  const url = `${origin}/reel/${token}`;
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
