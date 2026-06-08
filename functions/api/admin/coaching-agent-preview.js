// Admin: mint a throwaway PREVIEW link for one scenario so a scenario author can
// test it live (any mode, nothing saved) without assigning it to a cohort. The
// link is a coaching invite on a per-scenario sentinel email (__cvprev__<id>);
// me/status detects the sentinel and renders the journey in preview mode (every
// mode directly launchable). Reachable by full admins AND the scoped Scenarios
// editor (added to the middleware allow-list).
//
// POST { scenario_id } -> { url }

import { sha256Hex, randomId, randomToken } from '../../../shared/auth.js';

export const PREVIEW_PREFIX = '__cvprev__';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

  const scenarioId = typeof body?.scenario_id === 'string' ? body.scenario_id.trim() : '';
  if (!scenarioId.startsWith('ca_')) return jsonError('scenario_id_required', 400);

  try {
    const exists = await env.DB
      .prepare(`SELECT id FROM coaching_agents WHERE id = ? AND active = 1`)
      .bind(scenarioId)
      .first();
    if (!exists) return jsonError('unknown_or_inactive_scenario', 400);
  } catch {
    return jsonError('unknown_or_inactive_scenario', 400);
  }

  try {
    await ensureModeColumn(env);
    const sentinelEmail = `${PREVIEW_PREFIX}${scenarioId}@simulation.local`;
    const now = Math.floor(Date.now() / 1000);
    const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
    const token = randomToken();
    const tokenHash = await sha256Hex(token);

    const existing = await env.DB
      .prepare(`SELECT id FROM invites WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(sentinelEmail)
      .first();

    let inviteId;
    if (existing) {
      inviteId = existing.id;
      // Rotate the token + clear any revocation so the link is fresh each time.
      await env.DB
        .prepare(`UPDATE invites SET token_hash = ?, revoked = 0, revoked_at = NULL, expires_at = NULL, mode = 'coaching' WHERE id = ?`)
        .bind(tokenHash, inviteId)
        .run();
    } else {
      inviteId = randomId();
      await env.DB
        .prepare(`INSERT INTO invites (id, token_hash, recipient_email, recipient_name, created_at, expires_at, mode)
                  VALUES (?, ?, ?, ?, ?, NULL, 'coaching')`)
        .bind(inviteId, tokenHash, sentinelEmail, 'Preview', now)
        .run();
    }
    // Scope this preview invite to exactly the one scenario.
    await env.DB
      .prepare(`INSERT OR IGNORE INTO invite_scenarios (invite_id, scenario_id) VALUES (?, ?)`)
      .bind(inviteId, scenarioId)
      .run();

    return json({ url: `${origin}/me/${token}` }, 201);
  } catch (e) {
    return jsonError('preview_failed', 500, String(e?.message || e));
  }
}

async function ensureModeColumn(env) {
  try { await env.DB.prepare(`ALTER TABLE invites ADD COLUMN mode TEXT`).run(); } catch {}
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
