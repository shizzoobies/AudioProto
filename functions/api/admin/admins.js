// Owner-only CRUD for named admins. Backed by D1 (env.DB). The middleware gates
// /api/admin/* to "is some admin", but team management is OWNER-ONLY: every
// handler here re-checks getAdminScope().is_owner and 403s otherwise. Named
// admins can manage invites but not other admins.
//
// GET  - list all admins (token_hash never returned).
// POST - { email, name? } : create a new admin, or if one already exists for
//        that email and isn't revoked, refresh its token (re-issue the link)
//        rather than duplicate. Generates a magic-link token, stores its
//        sha256, emails the link, and returns the plaintext URL once (we don't
//        persist plaintext tokens).

import { getAdminScope } from '../../../shared/auth.js';
import { sha256Hex, randomId, randomToken } from '../../../shared/auth.js';
import { sendAdminInviteEmail } from '../../../shared/email.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestGet({ request, env }) {
  const a = await getAdminScope(request, env);
  if (!a?.is_owner) return jsonError('forbidden', 403);
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    return await listAdmins(env);
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

async function listAdmins(env) {
  const res = await env.DB.prepare(
    `SELECT id, email, name, created_at, created_by, last_login_at, revoked, revoked_at
     FROM admins
     ORDER BY revoked ASC, created_at DESC`
  ).all();
  const rows = res?.results || [];
  return json({
    admins: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      created_at: r.created_at,
      created_by: r.created_by,
      last_login_at: r.last_login_at,
      revoked: !!r.revoked,
    })),
  });
}

export async function onRequestPost({ request, env }) {
  const a = await getAdminScope(request, env);
  if (!a?.is_owner) return jsonError('forbidden', 403);
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    return await createAdmin(request, env, a);
  } catch (e) {
    return jsonError('create_failed', 500, String(e?.message || e));
  }
}

async function createAdmin(request, env, actor) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) return jsonError(`invalid_email:${email || '(blank)'}`, 400);
  const name = typeof body?.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 120)
    : null;

  const now = Math.floor(Date.now() / 1000);
  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  // Refresh an existing, non-revoked admin rather than creating a duplicate.
  const existing = await env.DB
    .prepare(`SELECT id FROM admins WHERE email = ? AND revoked = 0 LIMIT 1`)
    .bind(email)
    .first();

  let adminId;
  let reused = false;
  if (existing) {
    adminId = existing.id;
    reused = true;
    await env.DB
      .prepare(`UPDATE admins SET token_hash = ?, name = COALESCE(?, name) WHERE id = ?`)
      .bind(tokenHash, name, adminId)
      .run();
  } else {
    adminId = randomId();
    await env.DB
      .prepare(`INSERT INTO admins (id, email, name, token_hash, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(adminId, email, name, tokenHash, now, actor.email)
      .run();
  }

  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  const url = `${origin}/admin-link/${token}`;

  const emailResult = await sendAdminInviteEmail(env, { to: email, name, url });

  const response = {
    id: adminId,
    email,
    name,
    url,
    reused,
    email_sent: emailResult.ok,
  };
  if (!emailResult.ok) {
    response.email_error = emailResult.error;
    if (emailResult.detail) response.email_error_detail = emailResult.detail;
  }

  return json(response, existing ? 200 : 201);
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
