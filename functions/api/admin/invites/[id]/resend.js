// POST /api/admin/invites/:id/resend
//
// Rotates the invite token (invalidating the old URL) and re-sends the email.
// Admin gate is enforced by _middleware.js (startsWith '/api/admin/').
//
// Returns { id, url, email_sent, email_error? }

import { sha256Hex, randomToken } from '../../../../../shared/auth.js';
import { sendInviteEmail } from '../../../../../shared/email.js';

export async function onRequestPost(ctx) {
  if (!ctx.env.DB) return jsonError('db_not_configured', 500);
  try {
    return await resendInvite(ctx);
  } catch (e) {
    return jsonError('resend_failed', 500, String(e?.message || e));
  }
}

async function resendInvite({ request, env, params }) {
  const id = params.id;
  if (!id) return jsonError('not_found', 404);

  // Look up the invite — must exist, not revoked, not expired.
  const invite = await env.DB
    .prepare(
      `SELECT id, recipient_email, recipient_name, expires_at, revoked
       FROM invites WHERE id = ? LIMIT 1`
    )
    .bind(id)
    .first();

  if (!invite) return jsonError('not_found', 404);
  if (invite.revoked) return jsonError('revoked', 410);

  const now = Math.floor(Date.now() / 1000);
  if (invite.expires_at && invite.expires_at < now) return jsonError('expired', 410);

  // Rotate the token so the previous URL stops working immediately.
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await env.DB
    .prepare(`UPDATE invites SET token_hash = ? WHERE id = ?`)
    .bind(tokenHash, id)
    .run();

  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  const url = `${origin}/me/${token}`;

  const emailResult = await sendInviteEmail(env, {
    to: invite.recipient_email,
    name: invite.recipient_name,
    url,
    expiresAt: invite.expires_at,
  });

  const response = {
    id,
    url,
    email_sent: emailResult.ok,
  };
  if (!emailResult.ok) {
    response.email_error = emailResult.error;
    if (emailResult.detail) response.email_error_detail = emailResult.detail;
  }

  return json(response);
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
