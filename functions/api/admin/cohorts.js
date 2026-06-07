// Admin CRUD for cohorts (study groups). A cohort is a named group of managers
// sharing one unlocked_stage gate. The admin creates a cohort, then "assigns
// managers": each manager is RANDOMLY drawn a scenario (coaching agent) from a
// chosen pool, gets a per-email coaching invite minted (mirroring invites.js),
// and is recorded in cohort_members. The minted recipient links are returned
// once (tokens aren't stored), for the admin to distribute manually.
//
// GET    - { cohorts: [ { id, name, unlocked_stage, created_at, members:[...] } ] }
// POST   - op-based: create | advance | set_stage | assign | remove_member.
// DELETE - ?id= -> delete the cohort + its cohort_members rows.
//
// Middleware enforces the FULL cs_admin cookie on every /api/admin/* route;
// these endpoints are NOT in the scoped cs_coaching_admin allow-list, so the
// scoped editor gets a 401.

import { randomId, randomToken, sha256Hex, getAdminScope } from '../../../shared/auth.js';
import { ensureDashboardTables } from '../../../shared/dashboard-store.js';
import { MAX_STAGE } from '../../../shared/coaching-dashboard.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestGet({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureDashboardTables(env);
    return await listCohorts(request, env);
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

async function listCohorts(request, env) {
  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  const cohortsRes = await env.DB
    .prepare(`SELECT id, name, unlocked_stage, created_at FROM cohorts ORDER BY created_at DESC`)
    .all();
  const cohorts = cohortsRes?.results || [];
  if (!cohorts.length) return json({ cohorts: [] });

  const membersRes = await env.DB
    .prepare(`SELECT cohort_id, invite_id, scenario_id, member_name, member_email, created_at
              FROM cohort_members ORDER BY created_at ASC`)
    .all();
  const members = membersRes?.results || [];

  // Resolve scenario (coaching agent) display names in one pass.
  const scenarioNames = new Map();
  try {
    const agentsRes = await env.DB
      .prepare(`SELECT id, scenario_name, name FROM coaching_agents`)
      .all();
    for (const a of agentsRes?.results || []) {
      const label = (a.scenario_name && String(a.scenario_name).trim()) || a.name || a.id;
      scenarioNames.set(a.id, label);
    }
  } catch {
    // coaching_agents missing — leave names unresolved (fall back to id)
  }

  // Per-member call/recording state, keyed by invite_id then mode (so the admin
  // roster can surface each manager's recordings for review).
  const callsByInvite = new Map();
  try {
    const callsRes = await env.DB
      .prepare(`SELECT invite_id, mode, conversation_id, taken_by, completed_at FROM dashboard_calls`)
      .all();
    for (const c of callsRes?.results || []) {
      if (!callsByInvite.has(c.invite_id)) callsByInvite.set(c.invite_id, {});
      callsByInvite.get(c.invite_id)[c.mode] = {
        completed: !!(c.completed_at || c.conversation_id),
        has_recording: !!c.conversation_id,
        taken_by: c.taken_by || null,
      };
    }
  } catch {
    // dashboard_calls missing — members simply carry no call info
  }

  // The recipient link for each member, rebuilt from the stored token_plain
  // (assign persists it). Revoked invites yield no link.
  const linkByInvite = new Map();
  const inviteIds = members.map((m) => m.invite_id).filter(Boolean);
  if (inviteIds.length) {
    try {
      const ph = inviteIds.map(() => '?').join(',');
      const inv = await env.DB
        .prepare(`SELECT id, token_plain, revoked, recipient_role FROM invites WHERE id IN (${ph})`)
        .bind(...inviteIds)
        .all();
      for (const r of inv?.results || []) linkByInvite.set(r.id, r);
    } catch {
      // token_plain column absent on an old DB — links just stay null
    }
  }

  const byCohort = new Map(cohorts.map((c) => [c.id, []]));
  for (const m of members) {
    const link = linkByInvite.get(m.invite_id);
    const url = link && link.token_plain && !link.revoked ? `${origin}/me/${link.token_plain}` : null;
    byCohort.get(m.cohort_id)?.push({
      invite_id: m.invite_id,
      scenario_id: m.scenario_id,
      scenario_name: scenarioNames.get(m.scenario_id) || m.scenario_id || null,
      member_name: m.member_name || null,
      member_email: m.member_email || null,
      role: link && link.recipient_role ? link.recipient_role : '',
      calls: callsByInvite.get(m.invite_id) || {},
      url,
    });
  }

  return json({
    cohorts: cohorts.map((c) => ({
      id: c.id,
      name: c.name,
      unlocked_stage: c.unlocked_stage,
      created_at: c.created_at,
      members: byCohort.get(c.id) || [],
    })),
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureDashboardTables(env);

    let body;
    try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

    const op = typeof body?.op === 'string' ? body.op : '';
    switch (op) {
      case 'create': return await createCohort(body, request, env);
      case 'advance': return await advanceCohort(body, env);
      case 'set_stage': return await setStage(body, env);
      case 'assign': return await assignManagers(body, request, env);
      case 'set_role': return await setMemberRole(body, env);
      case 'remove_member': return await removeMember(body, env);
      default: return jsonError('invalid_op', 400);
    }
  } catch (e) {
    return jsonError('save_failed', 500, String(e?.message || e));
  }
}

async function createCohort(body, request, env) {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : '';
  if (!name) return jsonError('name_required', 400);
  const now = Math.floor(Date.now() / 1000);
  const id = 'co_' + randomId();
  let createdBy = null;
  try {
    const scope = await getAdminScope(request, env);
    createdBy = scope ? (scope.email || scope.admin_id || null) : null;
  } catch {
    createdBy = null;
  }
  await env.DB
    .prepare(`INSERT INTO cohorts (id, name, unlocked_stage, created_at, created_by) VALUES (?, ?, 1, ?, ?)`)
    .bind(id, name, now, createdBy)
    .run();
  const cohort = await env.DB
    .prepare(`SELECT id, name, unlocked_stage, created_at FROM cohorts WHERE id = ?`)
    .bind(id)
    .first();
  return json({ cohort: { ...cohort, members: [] } }, 201);
}

async function advanceCohort(body, env) {
  const cohortId = typeof body?.cohort_id === 'string' ? body.cohort_id.trim() : '';
  if (!cohortId) return jsonError('cohort_id_required', 400);
  const row = await env.DB
    .prepare(`SELECT unlocked_stage FROM cohorts WHERE id = ?`)
    .bind(cohortId)
    .first();
  if (!row) return jsonError('cohort_not_found', 404);
  const next = Math.min(Number(row.unlocked_stage || 1) + 1, MAX_STAGE);
  await env.DB
    .prepare(`UPDATE cohorts SET unlocked_stage = ? WHERE id = ?`)
    .bind(next, cohortId)
    .run();
  await setCohortMembersStage(env, cohortId, next);
  return json({ unlocked_stage: next });
}

async function setStage(body, env) {
  const cohortId = typeof body?.cohort_id === 'string' ? body.cohort_id.trim() : '';
  if (!cohortId) return jsonError('cohort_id_required', 400);
  let stage = Number(body?.stage);
  if (!Number.isFinite(stage)) return jsonError('invalid_stage', 400);
  stage = Math.max(1, Math.min(Math.round(stage), MAX_STAGE));
  const exists = await env.DB.prepare(`SELECT id FROM cohorts WHERE id = ?`).bind(cohortId).first();
  if (!exists) return jsonError('cohort_not_found', 404);
  await env.DB
    .prepare(`UPDATE cohorts SET unlocked_stage = ? WHERE id = ?`)
    .bind(stage, cohortId)
    .run();
  await setCohortMembersStage(env, cohortId, stage);
  return json({ unlocked_stage: stage });
}

async function assignManagers(body, request, env) {
  const cohortId = typeof body?.cohort_id === 'string' ? body.cohort_id.trim() : '';
  if (!cohortId) return jsonError('cohort_id_required', 400);
  const cohort = await env.DB.prepare(`SELECT id, unlocked_stage FROM cohorts WHERE id = ?`).bind(cohortId).first();
  if (!cohort) return jsonError('cohort_not_found', 404);
  const cohortStage = Math.max(1, Number(cohort.unlocked_stage) || 1);
  await ensureProgress(env);
  try { await env.DB.prepare(`ALTER TABLE invites ADD COLUMN recipient_role TEXT`).run(); } catch {}

  // Role label applied to everyone in this assign batch (Manager / Senior Agent).
  const ROLE_SET = new Set(['Manager', 'Senior Agent']);
  const role = typeof body?.role === 'string' && ROLE_SET.has(body.role.trim()) ? body.role.trim() : '';

  // The pool of scenarios (coaching agents) to randomly draw from.
  const scenarioIds = Array.isArray(body?.scenario_ids)
    ? [...new Set(body.scenario_ids.filter((s) => typeof s === 'string' && s.startsWith('ca_')))]
    : [];
  if (!scenarioIds.length) return jsonError('scenario_ids_required', 400);

  // Members to assign. Skip blank emails; invalid emails are rejected.
  const rawMembers = Array.isArray(body?.members) ? body.members : [];
  const members = [];
  for (const m of rawMembers) {
    if (!m || typeof m !== 'object') continue;
    const email = typeof m.email === 'string' ? m.email.trim().toLowerCase() : '';
    if (!email) continue; // skip blank
    if (!EMAIL_RE.test(email)) return jsonError(`invalid_email:${email}`, 400);
    const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 120) : null;
    members.push({ email, name });
  }
  if (!members.length) return jsonError('members_required', 400);

  const now = Math.floor(Date.now() / 1000);
  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  let createdBy = null;
  try {
    const scope = await getAdminScope(request, env);
    createdBy = scope ? (scope.email || scope.admin_id || null) : null;
  } catch {
    createdBy = null;
  }

  // Resolve scenario display names for the response.
  const scenarioNames = new Map();
  try {
    const placeholders = scenarioIds.map(() => '?').join(',');
    const agentsRes = await env.DB
      .prepare(`SELECT id, scenario_name, name FROM coaching_agents WHERE id IN (${placeholders})`)
      .bind(...scenarioIds)
      .all();
    for (const a of agentsRes?.results || []) {
      const label = (a.scenario_name && String(a.scenario_name).trim()) || a.name || a.id;
      scenarioNames.set(a.id, label);
    }
  } catch {
    // leave unresolved
  }

  const assigned = [];
  for (const m of members) {
    // RANDOM-ASSIGN one scenario from the pool.
    const scenarioId = scenarioIds[Math.floor(Math.random() * scenarioIds.length)];

    // Mint a per-email COACHING invite (mirrors functions/api/admin/invites.js:
    // new id, token=randomToken(), token_hash=sha256Hex(token), mode='coaching').
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const inviteId = randomId();
    await env.DB
      .prepare(`INSERT INTO invites
                (id, token_hash, token_plain, recipient_email, recipient_name, created_at, expires_at, created_by, mode, recipient_role)
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'coaching', ?)`)
      .bind(inviteId, tokenHash, token, m.email, m.name, now, createdBy, role)
      .run();
    await env.DB
      .prepare(`INSERT OR IGNORE INTO invite_scenarios (invite_id, scenario_id) VALUES (?, ?)`)
      .bind(inviteId, scenarioId)
      .run();

    // Record the cohort membership.
    await env.DB
      .prepare(`INSERT OR REPLACE INTO cohort_members
                (cohort_id, invite_id, scenario_id, member_name, member_email, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(cohortId, inviteId, scenarioId, m.name, m.email, now)
      .run();

    // Sync the new member's real journey gate to the cohort's current stage.
    await env.DB
      .prepare(`INSERT INTO coaching_progress (invite_id, scenario_id, unlocked_stage, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(invite_id, scenario_id) DO UPDATE SET unlocked_stage = excluded.unlocked_stage`)
      .bind(inviteId, scenarioId, cohortStage, now)
      .run();

    // Build the recipient URL the SAME way invites.js does (line 258:
    // `const inviteUrl = `${origin}/me/${token}`;`).
    const url = `${origin}/me/${token}`;
    assigned.push({
      invite_id: inviteId,
      name: m.name,
      email: m.email,
      scenario_id: scenarioId,
      scenario_name: scenarioNames.get(scenarioId) || scenarioId,
      url,
    });
  }

  return json({ assigned });
}

// Change one member's role label after assignment (fix a mistake without
// re-creating them). Stored on the underlying invite; link is untouched.
async function setMemberRole(body, env) {
  const inviteId = typeof body?.invite_id === 'string' ? body.invite_id.trim() : '';
  if (!inviteId) return jsonError('invite_id_required', 400);
  const ROLE_SET = new Set(['Manager', 'Senior Agent', '']);
  const role = typeof body?.role === 'string' && ROLE_SET.has(body.role.trim()) ? body.role.trim() : '';
  try { await env.DB.prepare(`ALTER TABLE invites ADD COLUMN recipient_role TEXT`).run(); } catch {}
  await env.DB.prepare(`UPDATE invites SET recipient_role = ? WHERE id = ?`).bind(role, inviteId).run();
  return json({ ok: true, role });
}

async function removeMember(body, env) {
  const cohortId = typeof body?.cohort_id === 'string' ? body.cohort_id.trim() : '';
  const inviteId = typeof body?.invite_id === 'string' ? body.invite_id.trim() : '';
  if (!cohortId || !inviteId) return jsonError('cohort_id_and_invite_id_required', 400);
  await env.DB
    .prepare(`DELETE FROM cohort_members WHERE cohort_id = ? AND invite_id = ?`)
    .bind(cohortId, inviteId)
    .run();
  // Revoke the underlying invite so the manager's link stops working.
  try {
    await env.DB
      .prepare(`UPDATE invites SET revoked = 1 WHERE id = ?`)
      .bind(inviteId)
      .run();
  } catch {
    // revoked column / row absent — non-fatal
  }
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureDashboardTables(env);
    const id = (new URL(request.url).searchParams.get('id') || '').trim();
    if (!id) return jsonError('id_required', 400);
    await env.DB.prepare(`DELETE FROM cohort_members WHERE cohort_id = ?`).bind(id).run();
    const res = await env.DB.prepare(`DELETE FROM cohorts WHERE id = ?`).bind(id).run();
    const changes = res?.meta?.changes ?? 0;
    return json({ ok: true, deleted: changes > 0 });
  } catch (e) {
    return jsonError('delete_failed', 500, String(e?.message || e));
  }
}

// Ensure the coaching_progress table + the unlocked_stage column exist (normally
// created by functions/api/coaching/progress.js; ensured here so the cohort gate
// can write it before any participant has completed a call).
async function ensureProgress(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS coaching_progress (
         invite_id TEXT NOT NULL, scenario_id TEXT NOT NULL, transcript TEXT,
         call_count INTEGER NOT NULL DEFAULT 0,
         assessment_done INTEGER NOT NULL DEFAULT 0, coaching_done INTEGER NOT NULL DEFAULT 0,
         followup_done INTEGER NOT NULL DEFAULT 0, unlocked_stage INTEGER DEFAULT 1,
         updated_at INTEGER, PRIMARY KEY (invite_id, scenario_id))`
    ).run();
  } catch {
    // already present
  }
  try {
    await env.DB.prepare(`ALTER TABLE coaching_progress ADD COLUMN unlocked_stage INTEGER DEFAULT 1`).run();
  } catch {
    // column already present
  }
}

// Push a cohort's unlocked_stage onto every member's REAL journey gate
// (coaching_progress.unlocked_stage for their drawn scenario), so advancing the
// cohort actually opens the next call for everyone in it. Memory is untouched.
async function setCohortMembersStage(env, cohortId, stage) {
  await ensureProgress(env);
  const now = Math.floor(Date.now() / 1000);
  const ms = await env.DB
    .prepare(`SELECT invite_id, scenario_id FROM cohort_members WHERE cohort_id = ?`)
    .bind(cohortId)
    .all();
  for (const m of ms?.results || []) {
    if (!m.invite_id || !m.scenario_id) continue;
    await env.DB
      .prepare(`INSERT INTO coaching_progress (invite_id, scenario_id, unlocked_stage, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(invite_id, scenario_id) DO UPDATE SET unlocked_stage = excluded.unlocked_stage`)
      .bind(m.invite_id, m.scenario_id, stage, now)
      .run();
  }
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
