// Admin endpoint for the single token-gated "review editor" link. Backed by the
// invites table (no migration): the review link is the invites row whose
// recipient_email is the REVIEW_RECIPIENT_EMAIL sentinel. It carries no scenario
// assignments — its cs_review cookie unlocks ONLY the Call Review rubric editor.
// Middleware enforces cs_admin on every method here (this manages the link;
// reviewers themselves cannot reach it).
//
// GET    - status: { active, created_at, last_click_at }
// POST   - create-or-refresh, rotate the token, return { url } (token shown once)
// DELETE - revoke the review link (idempotent)

import { sha256Hex, randomId, randomToken, REVIEW_RECIPIENT_EMAIL } from '../../../shared/auth.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    const row = await findReviewLink(env);
    return json({
      active: !!(row && !row.revoked),
      created_at: row?.created_at ?? null,
      last_click_at: row?.last_click_at ?? null,
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
      .bind(now, REVIEW_RECIPIENT_EMAIL)
      .run();
    const changes = res?.meta?.changes ?? 0;
    return json({ ok: true, revoked: changes > 0 });
  } catch (e) {
    return jsonError('revoke_failed', 500, String(e?.message || e));
  }
}

async function findReviewLink(env) {
  return env.DB
    .prepare(
      `SELECT id, created_at, last_click_at, revoked FROM invites
       WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1`
    )
    .bind(REVIEW_RECIPIENT_EMAIL)
    .first();
}

async function createOrRefresh(request, env) {
  const now = Math.floor(Date.now() / 1000);
  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  const existing = await findReviewLink(env);
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
      .bind(randomId(), tokenHash, REVIEW_RECIPIENT_EMAIL, 'Review editor', now)
      .run();
  }

  const url = `${origin}/review-pass/${token}`;
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
