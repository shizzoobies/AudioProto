// Public read-only check the kiosk frontend uses on boot: does this visitor
// have a valid cs_magic cookie, and if so what scenario is it locked to?
// Mirrors the demo-status pattern. Returns { active: false } for missing or
// expired cookies, a mismatched token fingerprint (i.e. the owner rotated
// MAGIC_LINK_TOKEN after the cookie was issued), or unset env config.

import { getMagicScope } from '../../shared/auth.js';

export async function onRequestGet({ request, env }) {
  const scenario = await getMagicScope(request, env);
  if (!scenario) return json({ active: false });
  return json({ active: true, scenario });
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
