// Admin CRUD for the editable course NARRATIVE (dashboard_blocks): the Story,
// Assignment, Information, Leadership intro, Final Prompt, Completion, and
// Practicum text per course section. Full admins + full-tier coaching editors
// (see the middleware allow-list). Tables self-bootstrap + seed via
// ensureDashboardTables (shared/dashboard-store.js).
//
// GET  - { blocks: [ { section_key, slot, value } ... ] }
// POST - upsert one { section_key, slot, value } OR a batch { blocks: [...] }.
//        Unknown (section_key, slot) pairs are skipped. Returns { ok, saved }.

import { ensureDashboardTables } from '../../../shared/dashboard-store.js';
import { DEFAULT_DASHBOARD_BLOCKS } from '../../../shared/coaching-dashboard.js';

// The valid (section_key, slot) pairs are EXACTLY what the course seeds, derived
// from the single source of truth so the editor can never write a stray block.
const VALID = new Set(DEFAULT_DASHBOARD_BLOCKS.map((b) => `${b.section_key}::${b.slot}`));
const MAX_VALUE = 8000;

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureDashboardTables(env);
    const res = await env.DB
      .prepare(`SELECT section_key, slot, value FROM dashboard_blocks ORDER BY section_key ASC, slot ASC`)
      .all();
    return json({ blocks: res?.results || [] });
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureDashboardTables(env);

    let body;
    try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

    const incoming = Array.isArray(body?.blocks) ? body.blocks : [body];
    const now = Math.floor(Date.now() / 1000);
    let saved = 0;
    for (const b of incoming) {
      const section_key = typeof b?.section_key === 'string' ? b.section_key.trim() : '';
      const slot = typeof b?.slot === 'string' ? b.slot.trim() : '';
      if (!VALID.has(`${section_key}::${slot}`)) continue; // skip unknown pairs
      const value = typeof b?.value === 'string' ? b.value.slice(0, MAX_VALUE) : '';
      await env.DB
        .prepare(`INSERT INTO dashboard_blocks (section_key, slot, value, updated_at)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT (section_key, slot) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .bind(section_key, slot, value, now)
        .run();
      saved += 1;
    }
    return json({ ok: true, saved });
  } catch (e) {
    return jsonError('save_failed', 500, String(e?.message || e));
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
