// Admin endpoint for the editable Call Review rubric (table rubric_items).
// Middleware enforces cs_admin on every method.
//
// GET    - { sections, items } : every item (enabled + disabled), grouped client-side.
// POST   - { op } :
//            op='toggle'  { key, enabled }            enable/disable an item
//            op='upsert'  { item:{key?,section,label,guidance,enabled?} }  add or edit
//            op='delete'  { key }                     delete a custom item (defaults protected)
//
// The table is created + seeded on demand (ensureSeeded) so the feature works
// even if migration 0004 has not been run by hand. Disabling an item keeps the
// row (enabled=0) so the rubric never collapses; only admin-added items delete.

import { RUBRIC_SECTIONS, DEFAULT_RUBRIC_ITEMS } from '../../../shared/coaching-rubric.js';
import { getRubricItems } from '../../../shared/rubric-store.js';

const SECTION_KEYS = new Set(RUBRIC_SECTIONS.map((s) => s.key));

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureSeeded(env);
    const items = await getRubricItems(env);
    const list = (items && items.length)
      ? items
      : DEFAULT_RUBRIC_ITEMS.map((d) => ({ ...d, enabled: 1, is_custom: 0 }));
    return json({ sections: RUBRIC_SECTIONS, items: list });
  } catch (e) {
    return jsonError('status_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }
  try {
    await ensureSeeded(env);
    switch (body?.op) {
      case 'toggle': return await toggleItem(env, body);
      case 'upsert': return await upsertItem(env, body);
      case 'delete': return await deleteItem(env, body);
      default: return jsonError('unknown_op', 400);
    }
  } catch (e) {
    return jsonError('op_failed', 500, String(e?.message || e));
  }
}

async function toggleItem(env, body) {
  const key = String(body?.key || '').trim();
  if (!key) return jsonError('missing_key', 400);
  const enabled = body?.enabled ? 1 : 0;
  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB
    .prepare(`UPDATE rubric_items SET enabled = ?, updated_at = ? WHERE key = ?`)
    .bind(enabled, now, key)
    .run();
  return json({ ok: true, changed: res?.meta?.changes || 0 });
}

async function upsertItem(env, body) {
  const it = body?.item || {};
  const section = String(it.section || '').trim();
  if (!SECTION_KEYS.has(section)) return jsonError('bad_section', 400);
  const label = String(it.label || '').trim();
  const guidance = String(it.guidance || '').trim();
  if (!label || !guidance) return jsonError('missing_fields', 400);
  const enabled = (it.enabled === false || it.enabled === 0) ? 0 : 1;
  const now = Math.floor(Date.now() / 1000);
  let key = String(it.key || '').trim();

  if (key) {
    // Edit existing item. Don't touch is_custom / created_at.
    await env.DB
      .prepare(`UPDATE rubric_items SET section = ?, label = ?, guidance = ?, enabled = ?, updated_at = ? WHERE key = ?`)
      .bind(section, label, guidance, enabled, now, key)
      .run();
    return json({ ok: true, key });
  }

  // New (admin-added) item: generate a unique key, place at end of its section.
  key = await uniqueKey(env, section, label);
  const posRow = await env.DB
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM rubric_items WHERE section = ?`)
    .bind(section)
    .first();
  const position = Number(posRow?.p) || 0;
  await env.DB
    .prepare(`INSERT INTO rubric_items (key, section, label, guidance, position, enabled, is_custom, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(key, section, label, guidance, position, enabled, now, now)
    .run();
  return json({ ok: true, key }, 201);
}

async function deleteItem(env, body) {
  const key = String(body?.key || '').trim();
  if (!key) return jsonError('missing_key', 400);
  const row = await env.DB.prepare(`SELECT is_custom FROM rubric_items WHERE key = ?`).bind(key).first();
  if (!row) return jsonError('not_found', 404);
  if (!Number(row.is_custom)) return jsonError('cannot_delete_default', 400);
  await env.DB.prepare(`DELETE FROM rubric_items WHERE key = ?`).bind(key).run();
  return json({ ok: true });
}

// Slug a section+label into a stable, unique score key (safe for the tool schema).
async function uniqueKey(env, section, label) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const base = (`${section}_${slug}`).slice(0, 48) || `${section}_item`;
  let key = base;
  let n = 1;
  while (await keyExists(env, key)) {
    n += 1;
    key = `${base}_${n}`;
  }
  return key;
}

async function keyExists(env, key) {
  const r = await env.DB.prepare(`SELECT 1 FROM rubric_items WHERE key = ? LIMIT 1`).bind(key).first();
  return !!r;
}

// Create the table if needed and seed the defaults when empty. Idempotent and
// cheap once seeded (a single COUNT). Keeps the rubric from ever being partial.
async function ensureSeeded(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS rubric_items (
       key TEXT PRIMARY KEY,
       section TEXT NOT NULL,
       label TEXT NOT NULL,
       guidance TEXT NOT NULL,
       position INTEGER NOT NULL DEFAULT 0,
       enabled INTEGER NOT NULL DEFAULT 1,
       is_custom INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`
  ).run();
  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM rubric_items`).first();
  if (countRow && Number(countRow.n) > 0) return;
  const now = Math.floor(Date.now() / 1000);
  const stmts = DEFAULT_RUBRIC_ITEMS.map((d) =>
    env.DB
      .prepare(`INSERT OR IGNORE INTO rubric_items (key, section, label, guidance, position, enabled, is_custom, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`)
      .bind(d.key, d.section, d.label, d.guidance, d.position || 0, now, now)
  );
  if (stmts.length) await env.DB.batch(stmts);
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
