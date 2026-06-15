// Admin CRUD for the SHARED course syllabus — the "Pre-Week 1" content shown at
// the top of every participant's coaching dashboard (program overview,
// expectations, schedule). A single shared document (one row), authored by full
// admins / full-tier coaching editors. Participants read it (read-only) inside
// /api/coaching/dashboard. Reachable by cs_admin and, via the middleware
// full-tier allow-list, by a full coaching-editor link.
//
// GET  - { content: { title, sections: [ { id, heading, body } ] } }
// POST - { title?, sections? } -> validates/caps, saves, returns { content }

import { randomId, getAdminScope } from '../../../shared/auth.js';

const SINGLETON_ID = 'default';
const TITLE_CAP = 200;
const HEADING_CAP = 200;
const BODY_CAP = 8000;
const MAX_SECTIONS = 40;
const WELCOME_INTRO_CAP = 6000;

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureTable(env);
    const row = await env.DB
      .prepare(`SELECT content FROM coaching_syllabus WHERE id = ?`)
      .bind(SINGLETON_ID)
      .first();
    return json({ content: normalizeContent(parseContent(row?.content)) });
  } catch (e) {
    return jsonError('load_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureTable(env);
    let body;
    try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

    const content = normalizeContent(body);
    const now = Math.floor(Date.now() / 1000);
    let updatedBy = null;
    try { const s = await getAdminScope(request, env); updatedBy = s?.email || s?.admin_id || null; } catch {}

    await env.DB
      .prepare(
        `INSERT INTO coaching_syllabus (id, content, updated_at, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .bind(SINGLETON_ID, JSON.stringify(content), now, updatedBy)
      .run();

    return json({ content });
  } catch (e) {
    return jsonError('save_failed', 500, String(e?.message || e));
  }
}

async function ensureTable(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS coaching_syllabus (
         id          TEXT PRIMARY KEY,
         content     TEXT,
         updated_at  INTEGER,
         updated_by  TEXT
       )`
    ).run();
  } catch {
    // already present
  }
}

function parseContent(raw) {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : null;
  } catch {
    return null;
  }
}

// Coerce arbitrary input into the canonical { title, sections:[{id,heading,body}] }
// shape with caps applied. Always returns a complete, safe object so callers
// (admin + the participant dashboard) never have to guard. Empty sections drop.
function normalizeContent(input) {
  const src = input && typeof input === 'object' ? input : {};
  const title = cap(src.title, TITLE_CAP);
  const rawSections = Array.isArray(src.sections) ? src.sections : [];
  const sections = [];
  for (const s of rawSections.slice(0, MAX_SECTIONS)) {
    if (!s || typeof s !== 'object') continue;
    const heading = cap(s.heading, HEADING_CAP);
    const bodyText = cap(s.body, BODY_CAP);
    if (!heading && !bodyText) continue;
    sections.push({
      id: typeof s.id === 'string' && s.id ? s.id.slice(0, 40) : 'syl_' + randomId(6),
      heading,
      body: bodyText,
    });
  }
  // Pre-Week 1 welcome-email settings live in the same Launch document.
  // welcome_intro '' means "use the default branded copy"; welcome_embed_syllabus
  // controls whether the syllabus sections are appended to the email.
  const welcome_intro = cap(src.welcome_intro, WELCOME_INTRO_CAP);
  const welcome_embed_syllabus = !!src.welcome_embed_syllabus;
  return { title, sections, welcome_intro, welcome_embed_syllabus };
}

function cap(v, n) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, n);
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
