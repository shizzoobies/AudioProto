// Admin roster for the coaching cohort. Lists every per-email coaching invite
// (mode='coaching') with the data the dashboard needs to manage a group of ~10
// managers: each participant's name/email, their LIVE copyable link (rebuilt
// from the stored token_plain), assigned scenario(s), how many calls they've
// taken, and when they were last active. Full-admin only — the middleware's
// ADMIN_API_PREFIX gate requires cs_admin, and this path is intentionally NOT in
// COACHING_ADMIN_ALLOWED_PATHS, so the scoped Scenarios-editor cannot see
// participant links.
//
// GET - { participants: [ { id, recipient_email, recipient_name, url, has_link,
//          created_at, expires_at, revoked, scenarios:[{id,label,all}],
//          call_count, last_activity } ] }

import {
  COACHING_RECIPIENT_EMAIL,
  DEMO_RECIPIENT_EMAIL,
  CHARTS_RECIPIENT_EMAIL,
  PREVIEW_RECIPIENT_EMAIL,
  REVIEW_RECIPIENT_EMAIL,
  COACHING_ADMIN_RECIPIENT_EMAIL,
} from '../../../shared/auth.js';
import { COACHING_SCENARIO_ID } from '../../../shared/scenarios.js';

// Every sentinel recipient_email that is a system link, not a real participant.
const SENTINELS = new Set([
  COACHING_RECIPIENT_EMAIL,
  DEMO_RECIPIENT_EMAIL,
  CHARTS_RECIPIENT_EMAIL,
  PREVIEW_RECIPIENT_EMAIL,
  REVIEW_RECIPIENT_EMAIL,
  COACHING_ADMIN_RECIPIENT_EMAIL,
]);

export async function onRequestGet({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    return await listParticipants(request, env);
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

// Self-bootstrap the columns the roster reads, in case no coaching invite has
// been written since these columns were introduced (invites.js adds them too).
// Swallow the duplicate-column error once present.
async function ensureColumns(env) {
  for (const col of ['mode TEXT', 'token_plain TEXT']) {
    try {
      await env.DB.prepare(`ALTER TABLE invites ADD COLUMN ${col}`).run();
    } catch {
      // already present
    }
  }
}

async function listParticipants(request, env) {
  await ensureColumns(env);

  const res = await env.DB.prepare(
    `SELECT id, recipient_email, recipient_name, created_at, expires_at,
            revoked, revoked_at, token_plain
     FROM invites
     WHERE mode = 'coaching'
     ORDER BY revoked ASC, created_at DESC`
  ).all();

  const rows = (res?.results || []).filter((r) => !SENTINELS.has(r.recipient_email));
  if (!rows.length) return json({ participants: [] });

  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');

  // Assigned scenarios for every listed invite, one round trip.
  const sceneRes = await env.DB
    .prepare(`SELECT invite_id, scenario_id FROM invite_scenarios WHERE invite_id IN (${ph})`)
    .bind(...ids)
    .all();
  const byInvite = new Map(ids.map((id) => [id, []]));
  for (const row of sceneRes?.results || []) {
    byInvite.get(row.invite_id)?.push(row.scenario_id);
  }

  // Scenario id -> friendly label. ca_ ids resolve to the authored scenario
  // name; the table may not exist yet, so guard.
  const agentLabels = new Map();
  try {
    const ar = await env.DB.prepare(`SELECT id, name, scenario_name FROM coaching_agents`).all();
    for (const a of ar?.results || []) {
      agentLabels.set(a.id, (a.scenario_name && a.scenario_name.trim()) || a.name || a.id);
    }
  } catch {
    // coaching_agents not bootstrapped yet — fall back to raw ids below
  }

  // Per-participant progress: sum the call counts across their scenarios and
  // take the most recent activity. coaching_progress may not exist yet.
  const progress = new Map(); // invite_id -> { calls, last }
  try {
    const pr = await env.DB
      .prepare(`SELECT invite_id, call_count, updated_at FROM coaching_progress WHERE invite_id IN (${ph})`)
      .bind(...ids)
      .all();
    for (const p of pr?.results || []) {
      const cur = progress.get(p.invite_id) || { calls: 0, last: null };
      cur.calls += Number(p.call_count) || 0;
      if (p.updated_at && (cur.last === null || p.updated_at > cur.last)) cur.last = p.updated_at;
      progress.set(p.invite_id, cur);
    }
  } catch {
    // coaching_progress not bootstrapped yet — counts default to 0
  }

  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;

  const participants = rows.map((r) => {
    // Show ONLY coaching scenarios. A coaching invite can inherit sales-library
    // assignments when its email previously held a standard invite (rows are
    // keyed by email and assignments accumulate); those are noise on this roster.
    const sids = (byInvite.get(r.id) || []).filter(
      (sid) => sid === '__all_coaching__' || sid === COACHING_SCENARIO_ID || (typeof sid === 'string' && sid.startsWith('ca_'))
    );
    const scenarios = sids.map((sid) => {
      if (sid === '__all_coaching__') return { id: sid, label: 'All scenarios', all: true };
      if (sid === COACHING_SCENARIO_ID) return { id: sid, label: 'Taylor (legacy)', all: false };
      return { id: sid, label: agentLabels.get(sid) || sid, all: false };
    });
    const prog = progress.get(r.id) || { calls: 0, last: null };
    const hasLink = !!r.token_plain;
    return {
      id: r.id,
      recipient_email: r.recipient_email,
      recipient_name: r.recipient_name || null,
      url: hasLink ? `${origin}/me/${r.token_plain}` : null,
      has_link: hasLink,
      created_at: r.created_at ?? null,
      expires_at: r.expires_at ?? null,
      revoked: !!r.revoked,
      scenarios,
      call_count: prog.calls,
      last_activity: prog.last,
    };
  });

  return json({ participants });
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
