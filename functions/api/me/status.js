// "What does my cs_me cookie give me access to?" The recipient SPA hits this
// on boot to decide between a personal dashboard and a login redirect.
// Mirrors /api/magic-status; returns { active: false } for missing / expired
// / revoked / out-of-sync cookies. When active, returns the recipient's
// display name (if any), expiry, and their assigned scenarios hydrated with
// persona display data so the frontend can render cards in one round trip.

import { getInviteScope, DEMO_RECIPIENT_EMAIL, PREVIEW_RECIPIENT_EMAIL } from '../../../shared/auth.js';
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

  return json({
    active: true,
    is_demo: isDemo,
    is_preview: isPreview,
    is_coaching: isCoaching,
    // Don't surface the internal sentinel address to the client.
    recipient_name: (isDemo || isPreview) ? null : (scope.recipient_name || null),
    recipient_email: (isDemo || isPreview) ? null : scope.recipient_email,
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
