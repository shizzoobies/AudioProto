// Display-safe scenario probe for the Rise embed. GET /api/embed/scenario?ct=&sid=
// Course-token authenticated (never cookies: third-party iframe context). This
// is what the embed boots on, so a revoked token shows the inactive state
// before any call is attempted. Returns ONLY the fields the embed UI needs:
// never the system_prompt or any other persona internals.

import { getScenario } from '../../../shared/scenarios.js';
import { ensureEmbedTables, getEmbedScope, tokenAllowsScenario } from '../../../shared/embed-auth.js';
import { EMBED_VOICE_SCENARIOS } from './start.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  await ensureEmbedTables(env);

  const url = new URL(request.url);
  const ct = url.searchParams.get('ct') || '';
  const sid = url.searchParams.get('sid') || '';

  const scope = await getEmbedScope(env, ct);
  if (!scope) return jsonError('invalid_token', 403);

  const scenario = getScenario(sid);
  if (!scenario || !tokenAllowsScenario(scope, sid) || !EMBED_VOICE_SCENARIOS.has(sid)) {
    return jsonError('forbidden_scenario', 403);
  }

  return json({
    id: scenario.id,
    customer_name: scenario.customer_name || '',
    customer_short: scenario.customer_short || '',
    title: scenario.title || '',
    type_title: scenario.type_title || scenario.title || '',
    tagline: scenario.tagline || '',
    phone: scenario.phone || '',
    premium: !!scenario.premium,
    blind: !!scenario.blind,
    location: scenario.location || null,
    customer_record: scenario.customer_record || null,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
