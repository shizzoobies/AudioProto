// Admin endpoint for the single token-gated "coaching admin / Scenarios editor"
// link. Backed by the invites table (no migration): the link is the invites row
// whose recipient_email is the COACHING_ADMIN_RECIPIENT_EMAIL sentinel. It
// carries no scenario assignments — its cs_coaching_admin cookie unlocks ONLY
// the coaching Scenarios admin page (create/manage scenarios + voices), not the
// rest of the admin panel. Middleware enforces cs_admin on every method here
// (this manages the link; scoped editors themselves cannot reach it).
//
// GET    - status: { active, created_at, last_click_at }
// POST   - create-or-refresh, rotate the token, return { url } (token shown once)
// DELETE - revoke the link (idempotent)

import { sha256Hex, randomId, randomToken, COACHING_ADMIN_RECIPIENT_EMAIL, COACHING_FULL_RECIPIENT_EMAIL } from '../../../shared/auth.js';

// Two shareable editor links live in this one endpoint, keyed by `kind`:
//   'scenarios' (default) — opens the Scenarios + Voices editor only
//   'full'                — opens the ENTIRE coaching admin surface
// Each is one invites row on its own sentinel recipient_email.
const SENTINEL = {
  scenarios: COACHING_ADMIN_RECIPIENT_EMAIL,
  full: COACHING_FULL_RECIPIENT_EMAIL,
};
const LABEL = { scenarios: 'Scenarios editor', full: 'Full coaching editor' };

function kindOf(v) {
  return v === 'full' ? 'full' : 'scenarios';
}

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    // Return BOTH links' status so the admin UI can render them in one round trip.
    const out = {};
    for (const kind of ['scenarios', 'full']) {
      const row = await findCoachingAccessLink(env, kind);
      out[kind] = {
        active: !!(row && !row.revoked),
        created_at: row?.created_at ?? null,
        last_click_at: row?.last_click_at ?? null,
      };
    }
    // Back-compat: also expose the scenarios link's status at the top level, the
    // shape older callers expect.
    return json({ ...out.scenarios, links: out });
  } catch (e) {
    return jsonError('status_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    let kind = 'scenarios';
    try {
      const body = await request.json();
      kind = kindOf(body?.kind);
    } catch {
      // no body — default to the scenarios link
    }
    return await createOrRefresh(request, env, kind);
  } catch (e) {
    return jsonError('create_failed', 500, String(e?.message || e));
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    const kind = kindOf(new URL(request.url).searchParams.get('kind'));
    const now = Math.floor(Date.now() / 1000);
    const res = await env.DB
      .prepare(`UPDATE invites SET revoked = 1, revoked_at = ? WHERE recipient_email = ? AND revoked = 0`)
      .bind(now, SENTINEL[kind])
      .run();
    const changes = res?.meta?.changes ?? 0;
    return json({ ok: true, revoked: changes > 0, kind });
  } catch (e) {
    return jsonError('revoke_failed', 500, String(e?.message || e));
  }
}

async function findCoachingAccessLink(env, kind) {
  return env.DB
    .prepare(
      `SELECT id, created_at, last_click_at, revoked FROM invites
       WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1`
    )
    .bind(SENTINEL[kind])
    .first();
}

async function createOrRefresh(request, env, kind) {
  const now = Math.floor(Date.now() / 1000);
  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  const existing = await findCoachingAccessLink(env, kind);
  if (existing) {
    await env.DB
      .prepare(`UPDATE invites
                SET token_hash = ?, revoked = 0, revoked_at = NULL, expires_at = NULL
                WHERE id = ?`)
      .bind(tokenHash, existing.id)
      .run();
  } else {
    await env.DB
      .prepare(`INSERT INTO invites
                (id, token_hash, recipient_email, recipient_name, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, NULL)`)
      .bind(randomId(), tokenHash, SENTINEL[kind], LABEL[kind], now)
      .run();
  }

  const url = `${origin}/coaching-pass/${token}`;
  return json({ url, kind }, 201);
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
