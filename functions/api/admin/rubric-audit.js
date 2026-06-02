// Admin-only activity log for the Call Review rubric editor. Returns recent
// events (opens via the shared link + every change). Middleware requires
// cs_admin and this path is NOT in the review allow-list, so scoped reviewers
// cannot read the log.
//
// GET - { events: [{ ts, actor, actor_kind, action, item_key, detail }] }

import { getRubricAudit } from '../../../shared/rubric-audit.js';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ events: [] });
  try {
    const events = await getRubricAudit(env, 80);
    return json({ events });
  } catch (e) {
    return json({ events: [], error: String(e?.message || e) });
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
