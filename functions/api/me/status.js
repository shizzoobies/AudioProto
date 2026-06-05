// "What does my cs_me cookie give me access to?" The recipient SPA hits this
// on boot to decide between a personal dashboard and a login redirect.
// Mirrors /api/magic-status; returns { active: false } for missing / expired
// / revoked / out-of-sync cookies. When active, returns the recipient's
// display name (if any), expiry, and their assigned scenarios hydrated with
// persona display data so the frontend can render cards in one round trip.

import { getInviteScope, DEMO_RECIPIENT_EMAIL, PREVIEW_RECIPIENT_EMAIL, COACHING_RECIPIENT_EMAIL } from '../../../shared/auth.js';
import { listScenarioTypesForDisplay, getScenario } from '../../../shared/scenarios.js';

export async function onRequestGet({ request, env }) {
  const scope = await getInviteScope(request, env);
  if (!scope) return json({ active: false });

  // Hydrate the scenario IDs with persona display info.
  const personaMap = new Map();
  for (const t of listScenarioTypesForDisplay()) {
    for (const p of t.personas) personaMap.set(p.id, p);
  }
  const scenarios = [];
  for (const sid of scope.scenarios) {
    // The "all coaching agents" sentinel was already expanded by getInviteScope
    // into concrete ca_ ids; skip the sentinel itself so it never renders.
    if (sid === '__all_coaching__') continue;

    // Admin-authored coaching agents (ca_) live in D1, not the SCENARIOS map.
    // Emit the manager-facing data-contract object (prompt-only/server-only
    // fields are intentionally omitted). All D1 reads are wrapped so a missing
    // table can never break status; an inactive/unknown ca_ id is skipped.
    if (typeof sid === 'string' && sid.startsWith('ca_')) {
      let agent = null;
      try {
        agent = await env.DB
          .prepare(`SELECT * FROM coaching_agents WHERE id = ? AND active = 1`)
          .bind(sid)
          .first();
      } catch {
        agent = null;
      }
      if (!agent) continue;
      let openingLines = [];
      if (agent.opening_lines) {
        try {
          const parsed = JSON.parse(agent.opening_lines);
          if (Array.isArray(parsed)) openingLines = parsed;
        } catch {
          openingLines = [];
        }
      }
      // Server-side per-manager progress for this authored scenario, keyed to the
      // invite link. Wrapped so a missing table/row never breaks status; defaults
      // to a no-prior state. Drives the Follow-up gate + "N calls" line in the UI.
      let progress = { call_count: 0, has_prior: false, unlocked_stage: 1, modes_done: { assessment: false, coaching: false, followup: false } };
      try {
        const prog = await env.DB
          .prepare(`SELECT call_count, assessment_done, coaching_done, followup_done, unlocked_stage FROM coaching_progress WHERE invite_id = ? AND scenario_id = ?`)
          .bind(scope.invite_id, agent.id)
          .first();
        const callCount = Number(prog?.call_count) || 0;
        progress = {
          call_count: callCount,
          has_prior: callCount > 0,
          // Admin progression gate (default 1 = only the first call open).
          unlocked_stage: Number.isFinite(Number(prog?.unlocked_stage)) ? Number(prog.unlocked_stage) : 1,
          modes_done: {
            assessment: !!prog?.assessment_done,
            coaching: !!prog?.coaching_done,
            followup: !!prog?.followup_done,
          },
        };
      } catch {
        // Columns may predate this build (no call saved since deploy). Fall back
        // to call_count only; treat all modes as not-yet-done.
        try {
          const prog = await env.DB
            .prepare(`SELECT call_count FROM coaching_progress WHERE invite_id = ? AND scenario_id = ?`)
            .bind(scope.invite_id, agent.id)
            .first();
          const callCount = Number(prog?.call_count) || 0;
          progress = { call_count: callCount, has_prior: callCount > 0, modes_done: { assessment: false, coaching: false, followup: false } };
        } catch {
          progress = { call_count: 0, has_prior: false, modes_done: { assessment: false, coaching: false, followup: false } };
        }
      }
      scenarios.push({
        id: agent.id,
        kind: 'coaching_agent',
        scenario_name: agent.scenario_name || '',
        name: agent.name || '',
        age: agent.age ?? null,
        role_title: agent.role_title || '',
        demeanor: agent.demeanor || '',
        incident: agent.incident || '',
        image_id: agent.image_id || '',
        accent_color: agent.accent_color || '',
        modes: {
          assessment: !!agent.mode_assessment,
          coaching: !!agent.mode_coaching,
          followup: !!agent.mode_followup,
        },
        opening_lines: openingLines,
        progress,
      });
      continue;
    }

    // Fall back to getScenario for ids not in the displayed type list (e.g. the
    // demo scenarios, which live in SCENARIOS but no SCENARIO_TYPE) so their
    // names/taglines still render on the landing instead of a raw id.
    const p = personaMap.get(sid) || getScenario(sid);
    scenarios.push({
      id: sid,
      customer_name: p?.customer_name || sid,
      customer_short: p?.customer_short || '',
      title: p?.title || '',
      tagline: p?.tagline || '',
      premium: !!p?.premium,
      points: Array.isArray(p?.points) ? p.points : [],
      phone: p?.phone || '',
      location: p?.location || null,
    });
  }

  const isDemo = scope.recipient_email === DEMO_RECIPIENT_EMAIL;
  // Full-library detection: the dedicated preview sentinel, OR any invite that
  // has been granted EVERY real scenario (e.g. the admin "Entire library"
  // checkbox on a per-person invite). Either way the visitor gets the whole
  // library navigation rather than the flat recipient list.
  const fullLib = [];
  for (const t of listScenarioTypesForDisplay()) {
    for (const p of (t.personas || [])) fullLib.push(p.id);
  }
  const coversLibrary = fullLib.length > 0 && fullLib.every((id) => scope.scenarios.has(id));
  const isPreview = scope.recipient_email === PREVIEW_RECIPIENT_EMAIL || coversLibrary;

  // The open coaching link uses a sentinel recipient_email just like demo/preview;
  // don't leak that internal address to the client either.
  const isCoachingSentinel = scope.recipient_email === COACHING_RECIPIENT_EMAIL;

  // Coaching-test invite? Read the invite's `mode` column directly. Queried
  // defensively (its own try/catch) so a DB that predates the column — i.e. no
  // coaching invite has ever been created — is treated as not-coaching instead
  // of throwing. getInviteScope's SELECT intentionally does NOT touch `mode`.
  let isCoaching = false;
  try {
    const row = await env.DB
      .prepare(`SELECT mode FROM invites WHERE id = ? LIMIT 1`)
      .bind(scope.invite_id)
      .first();
    isCoaching = row?.mode === 'coaching';
  } catch {
    isCoaching = false;
  }

  // Shared coaching landing content (hero + free-form sections), authored by
  // admins. Only relevant to coaching recipients; read defensively so a missing
  // table (no content saved yet) just yields null and the client uses defaults.
  let coachingLanding = null;
  if (isCoaching) {
    try {
      const row = await env.DB
        .prepare(`SELECT content FROM coaching_landing WHERE id = 'default'`)
        .first();
      if (row?.content) {
        const parsed = JSON.parse(row.content);
        if (parsed && typeof parsed === 'object') coachingLanding = parsed;
      }
    } catch {
      coachingLanding = null;
    }
  }

  return json({
    active: true,
    is_demo: isDemo,
    is_preview: isPreview,
    is_coaching: isCoaching,
    coaching_landing: coachingLanding,
    // Don't surface the internal sentinel address to the client.
    recipient_name: (isDemo || isPreview || isCoachingSentinel) ? null : (scope.recipient_name || null),
    recipient_email: (isDemo || isPreview || isCoachingSentinel) ? null : scope.recipient_email,
    expires_at: scope.expires_at,
    scenarios,
  });
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
