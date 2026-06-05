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
  const agentModes = new Map(); // id -> [{ mode, label }] enabled, in arc order
  try {
    const ar = await env.DB.prepare(`SELECT id, name, scenario_name, mode_assessment, mode_coaching, mode_followup FROM coaching_agents`).all();
    for (const a of ar?.results || []) {
      agentLabels.set(a.id, (a.scenario_name && a.scenario_name.trim()) || a.name || a.id);
      const stages = [];
      if (a.mode_assessment) stages.push({ mode: 'assessment', label: 'Assessment' });
      if (a.mode_coaching) stages.push({ mode: 'coaching', label: 'Coaching' });
      if (a.mode_followup) stages.push({ mode: 'followup', label: 'Follow-up' });
      agentModes.set(a.id, stages);
    }
  } catch {
    // coaching_agents not bootstrapped yet — fall back to raw ids below
  }

  // Per-participant progress, per scenario: the roster shows total calls + last
  // activity AND a per-scenario list (each row gets its own Reset). The progress
  // table may not exist yet.
  const progress = new Map(); // invite_id -> { calls, last }
  const progressByInvite = new Map(); // invite_id -> [{ scenario_id, call_count, last_activity }]
  try {
    const pr = await env.DB
      .prepare(`SELECT invite_id, scenario_id, call_count, updated_at, assessment_done, coaching_done, followup_done, unlocked_stage FROM coaching_progress WHERE invite_id IN (${ph})`)
      .bind(...ids)
      .all();
    for (const p of pr?.results || []) {
      const calls = Number(p.call_count) || 0;
      const cur = progress.get(p.invite_id) || { calls: 0, last: null };
      cur.calls += calls;
      if (p.updated_at && (cur.last === null || p.updated_at > cur.last)) cur.last = p.updated_at;
      progress.set(p.invite_id, cur);

      const list = progressByInvite.get(p.invite_id) || [];
      list.push({
        scenario_id: p.scenario_id,
        call_count: calls,
        last_activity: p.updated_at ?? null,
        done: { assessment: !!p.assessment_done, coaching: !!p.coaching_done, followup: !!p.followup_done },
        unlocked_stage: Number.isFinite(Number(p.unlocked_stage)) ? Number(p.unlocked_stage) : 1,
      });
      progressByInvite.set(p.invite_id, list);
    }
  } catch {
    // coaching_progress not bootstrapped yet — counts default to 0
  }

  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;

  const participants = rows.map((r) => {
    // Show ONLY real authored coaching scenarios (ca_ ids) and the "all" grant.
    // Excluded: the legacy `coaching_practice` (Taylor) holdover, which is no
    // longer used, and any sales-library ids inherited from an old standard
    // invite on the same email (rows are email-keyed and assignments accumulate).
    const sids = (byInvite.get(r.id) || []).filter(
      (sid) => sid === '__all_coaching__' || (typeof sid === 'string' && sid.startsWith('ca_'))
    );
    const scenarios = sids.map((sid) => {
      if (sid === '__all_coaching__') return { id: sid, label: 'All scenarios', all: true };
      return { id: sid, label: agentLabels.get(sid) || sid, all: false };
    });
    const prog = progress.get(r.id) || { calls: 0, last: null };
    const hasLink = !!r.token_plain;
    // Per-scenario progress rows (for the Reset buttons), labelled like the chips.
    const progressScenarios = (progressByInvite.get(r.id) || []).map((ps) => {
      const modeStages = agentModes.get(ps.scenario_id) || [];
      const done = ps.done || {};
      const stages = modeStages.map((st) => ({ mode: st.mode, label: st.label, done: !!done[st.mode] }));
      return {
        scenario_id: ps.scenario_id,
        label: agentLabels.get(ps.scenario_id) || ps.scenario_id,
        call_count: ps.call_count,
        last_activity: ps.last_activity,
        stages,
        stage_count: stages.length,
        unlocked_stage: ps.unlocked_stage || 1,
      };
    });
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
      progress_scenarios: progressScenarios,
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
