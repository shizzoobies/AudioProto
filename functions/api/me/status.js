// "What does my cs_me cookie give me access to?" The recipient SPA hits this
// on boot to decide between a personal dashboard and a login redirect.
// Mirrors /api/magic-status; returns { active: false } for missing / expired
// / revoked / out-of-sync cookies. When active, returns the recipient's
// display name (if any), expiry, and their assigned scenarios hydrated with
// persona display data so the frontend can render cards in one round trip.

import { getInviteScope } from '../../../shared/auth.js';
import { listScenarioTypesForDisplay } from '../../../shared/scenarios.js';

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
    const p = personaMap.get(sid);
    scenarios.push({
      id: sid,
      customer_name: p?.customer_name || sid,
      customer_short: p?.customer_short || '',
      tagline: p?.tagline || '',
      premium: !!p?.premium,
    });
  }

  return json({
    active: true,
    recipient_name: scope.recipient_name || null,
    recipient_email: scope.recipient_email,
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
