// GET /api/coaching/dashboard — the manager's whole coaching-dashboard state in
// one shot (the data behind the course-module experience). NOT under /api/admin,
// so the middleware passes it through; this endpoint authenticates itself via
// the manager's cs_me invite cookie (getInviteScope) and only ever exposes the
// agent + stage that invite is assigned.
//
// Resolves the manager's assigned coaching agent + their unlocked stage:
//   - in a cohort  -> the cohort_members.scenario_id + the cohort's unlocked_stage
//   - not in one   -> the first ca_ scenario in their invite scope + MAX_STAGE
//     (everything unlocked for ad-hoc / non-cohort managers)
// then returns a MANAGER-FACING agent profile (no skill_gap / attitude /
// resistance / receptiveness / voice_id), the editable Development-Plan fields,
// the manager's saved answers, and their completed calls.

import { getInviteScope } from '../../../shared/auth.js';
import { DASHBOARD_SECTIONS, MAX_STAGE, PRACTICUM_PHASES, fillTokens } from '../../../shared/coaching-dashboard.js';
import { ensureDashboardTables } from '../../../shared/dashboard-store.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);

  const scope = await getInviteScope(request, env);
  if (!scope) return jsonError('unauthorized', 401);

  try {
    await ensureDashboardTables(env);

    // --- Resolve the assigned agent (scenarioId) + the unlocked stage ---------
    let scenarioId = null;
    let stage = MAX_STAGE;

    const member = await env.DB
      .prepare(`SELECT cohort_id, scenario_id FROM cohort_members WHERE invite_id = ? LIMIT 1`)
      .bind(scope.invite_id)
      .first();

    if (member) {
      // Cohort member: the cohort pins the agent + the progression gate.
      scenarioId = member.scenario_id || firstCoachingScenario(scope.scenarios);
      const cohort = await env.DB
        .prepare(`SELECT unlocked_stage FROM cohorts WHERE id = ?`)
        .bind(member.cohort_id)
        .first();
      stage = clampStage(cohort?.unlocked_stage);
    } else {
      // Ad-hoc (non-cohort) manager: first authored agent in scope, all unlocked.
      scenarioId = firstCoachingScenario(scope.scenarios);
      stage = MAX_STAGE;
    }

    // No resolvable authored agent -> empty state; the client shows a placeholder.
    if (!scenarioId) {
      return json({ active: true, agent: null });
    }

    // --- Manager-facing agent profile ----------------------------------------
    const row = await env.DB
      .prepare(`SELECT * FROM coaching_agents WHERE id = ? AND active = 1`)
      .bind(scenarioId)
      .first();

    if (!row) {
      // The assigned agent is gone / deactivated — same empty state.
      return json({ active: true, agent: null });
    }

    const agent = {
      id: row.id,
      name: row.name || '',
      age: row.age ?? null,
      role_title: row.role_title || '',
      personality: row.personality || '',
      photo: row.photo || '',
      incident: row.incident || '',
      incident_image: row.incident_image || '',
      scenario_name: row.scenario_name || '',
    };

    // Token values woven into the stories/prompts + question labels. Filled
    // server-side so the client renders ready copy. TeamMemberName = agent name.
    const tokenVals = {
      TeamMemberName: agent.name,
      OrganizationGoal: row.org_goal || '',
      BusinessOutcome: row.business_outcome || '',
      PerformanceOpportunity: row.performance_opportunity || '',
      PerformanceSummary: row.performance_summary || '',
      Incident: row.incident || '',
    };
    const fill = (t) => fillTokens(t, tokenVals);

    // --- Editable Development-Plan fields -------------------------------------
    const fieldsRes = await env.DB
      .prepare(
        `SELECT section_key, label, type, position, hint, part, grp FROM dashboard_fields
           WHERE active = 1 ORDER BY section_key, position`
      )
      .all();
    const fields = (fieldsRes?.results || []).map((f) => ({
      key: `${f.section_key}__${f.position}`,
      section_key: f.section_key,
      label: fill(f.label),
      type: f.type || 'textarea',
      position: f.position ?? 0,
      hint: f.hint ? fill(f.hint) : '',
      part: f.part ?? null,
      group: f.grp || '',
    }));

    // --- The manager's saved answers -----------------------------------------
    const answersRes = await env.DB
      .prepare(`SELECT field_key, value FROM dashboard_answers WHERE invite_id = ?`)
      .bind(scope.invite_id)
      .all();
    const answers = {};
    for (const a of answersRes?.results || []) {
      answers[a.field_key] = a.value == null ? '' : a.value;
    }

    // --- The manager's completed calls (one-try) -----------------------------
    const callsRes = await env.DB
      .prepare(
        `SELECT mode, conversation_id, taken_by, completed_at FROM dashboard_calls WHERE invite_id = ?`
      )
      .bind(scope.invite_id)
      .all();
    const calls = {};
    for (const c of callsRes?.results || []) {
      calls[c.mode] = {
        completed: true,
        has_recording: !!c.conversation_id,
        taken_by: c.taken_by || null,
        completed_at: c.completed_at ?? null,
      };
    }

    // --- Editable narrative blocks (Story / Assignment / Leadership / Prompt) --
    // Keyed { section_key: { slot: value } }, token-filled server-side.
    const blocksRes = await env.DB
      .prepare(`SELECT section_key, slot, value FROM dashboard_blocks`)
      .all();
    const blocks = {};
    for (const b of blocksRes?.results || []) {
      if (!blocks[b.section_key]) blocks[b.section_key] = {};
      blocks[b.section_key][b.slot] = fill(b.value || '');
    }

    // --- Shared course syllabus (Pre-Week 1, read-only) ----------------------
    // Authored by admins; shown collapsed at the top of the dashboard. Read
    // defensively so a missing table (none saved yet) just yields null.
    let syllabus = null;
    try {
      const row = await env.DB
        .prepare(`SELECT content FROM coaching_syllabus WHERE id = 'default'`)
        .first();
      if (row?.content) {
        const parsed = JSON.parse(row.content);
        if (parsed && typeof parsed === 'object') syllabus = parsed;
      }
    } catch {
      syllabus = null;
    }

    return json({
      active: true,
      stage,
      max_stage: MAX_STAGE,
      sections: DASHBOARD_SECTIONS,
      agent,
      fields,
      answers,
      calls,
      blocks,
      practicum_phases: PRACTICUM_PHASES,
      syllabus,
    });
  } catch (e) {
    return jsonError('dashboard_failed', 500, String(e?.message || e));
  }
}

// First scenario in the invite scope that is an authored coaching agent (ca_).
function firstCoachingScenario(scenarios) {
  if (!scenarios) return null;
  for (const id of scenarios) {
    if (typeof id === 'string' && id.startsWith('ca_')) return id;
  }
  return null;
}

// Keep the unlocked stage within [1, MAX_STAGE]; default to 1 when unset.
function clampStage(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > MAX_STAGE) return MAX_STAGE;
  return Math.floor(n);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
