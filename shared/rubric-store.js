// D1-backed store for the admin-editable Call Review rubric (table rubric_items,
// created by migration 0004). Used by /api/coach (to build the prompt + tool)
// and /api/admin/rubric (to manage items). Falls back to the in-code defaults
// when the DB is unavailable or the table has not been seeded yet, so coaching
// always works even before the migration runs.

import { DEFAULT_RUBRIC_ITEMS } from './coaching-rubric.js';

// Read every rubric item (enabled and disabled). Returns null if the DB is
// unavailable or the table does not exist yet (so callers can fall back).
export async function getRubricItems(env) {
  if (!env?.DB) return null;
  try {
    const res = await env.DB
      .prepare(`SELECT key, section, label, guidance, anchors, policy_ref, required, position, enabled, is_custom
                FROM rubric_items`)
      .all();
    const rows = res?.results || [];
    return rows.map((r) => ({
      key: r.key,
      section: r.section,
      label: r.label,
      guidance: r.guidance,
      anchors: r.anchors || '',
      policy_ref: r.policy_ref || '',
      required: r.required || '',
      position: Number(r.position) || 0,
      enabled: Number(r.enabled) ? 1 : 0,
      is_custom: Number(r.is_custom) ? 1 : 0,
    }));
  } catch {
    return null;
  }
}

// The item list to build the coaching prompt from: the live DB rubric if it
// exists and is non-empty, otherwise the in-code defaults. buildCoaching() then
// filters to enabled items.
export async function loadRubricForCoaching(env) {
  const items = await getRubricItems(env);
  if (items && items.length) return items;
  return DEFAULT_RUBRIC_ITEMS;
}
