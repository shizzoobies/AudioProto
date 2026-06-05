// Admin CRUD for the SHARED coaching landing page content — the splash/hero and
// free-form content sections every participant sees above their scenarios. It's
// a single shared document (one row), authored by full admins. Participants read
// it (read-only) via /api/me/status. Full-admin only: this path is NOT in the
// middleware's scoped allow-lists, so the scoped Scenarios-editor can't edit it.
//
// GET  - { content: { hero:{eyebrow,title,intro}, sections:[{id,heading,body}] } }
// POST - { hero?, sections? } -> validates/caps, saves, returns { content }

import { randomId, getAdminScope } from '../../../shared/auth.js';

const SINGLETON_ID = 'default';
const FIELD_CAP = 280;     // hero eyebrow/title
const INTRO_CAP = 4000;    // hero intro + section body
const HEADING_CAP = 200;
const MAX_SECTIONS = 30;

// Per-block styling + layout vocabulary. Anything outside these sets is dropped
// on save, so the stored content is always a safe, known shape.
const BLOCK_TYPES = new Set(['text', 'image_overlay', 'image_split']);
const FONT_KEYS = new Set(['default', 'sans', 'serif', 'geometric', 'modern', 'mono']);
const ALIGNS = new Set(['left', 'center', 'right']);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const IMAGE_ID_RE = /^img_[a-f0-9]{6,}$/i;

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureTable(env);
    const row = await env.DB
      .prepare(`SELECT content FROM coaching_landing WHERE id = ?`)
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

    // Upsert the singleton row.
    await env.DB
      .prepare(
        `INSERT INTO coaching_landing (id, content, updated_at, updated_by)
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
      `CREATE TABLE IF NOT EXISTS coaching_landing (
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

// Coerce arbitrary input into the canonical shape with caps applied. Always
// returns a complete, safe object so callers never have to guard.
function normalizeContent(input) {
  const src = input && typeof input === 'object' ? input : {};
  const heroSrc = src.hero && typeof src.hero === 'object' ? src.hero : {};
  const hero = {
    eyebrow: cap(heroSrc.eyebrow, FIELD_CAP),
    title: cap(heroSrc.title, FIELD_CAP),
    intro: cap(heroSrc.intro, INTRO_CAP),
    font: font(heroSrc.font),
    textColor: color(heroSrc.textColor),
    bgColor: color(heroSrc.bgColor),
    imageId: imageId(heroSrc.imageId),
    overlay: pct(heroSrc.overlay),
    align: ALIGNS.has(heroSrc.align) ? heroSrc.align : 'center',
  };
  const rawSections = Array.isArray(src.sections) ? src.sections : [];
  const sections = [];
  for (const s of rawSections.slice(0, MAX_SECTIONS)) {
    if (!s || typeof s !== 'object') continue;
    const type = BLOCK_TYPES.has(s.type) ? s.type : 'text';
    const heading = cap(s.heading, HEADING_CAP);
    const bodyText = cap(s.body, INTRO_CAP);
    const imgId = imageId(s.imageId);
    // Keep a block if it carries anything — text OR an image (image-only banners
    // are valid).
    if (!heading && !bodyText && !imgId) continue;
    sections.push({
      id: typeof s.id === 'string' && s.id ? s.id.slice(0, 40) : 'sec_' + randomId(6),
      type,
      heading,
      body: bodyText,
      imageId: imgId,
      imageSide: s.imageSide === 'right' ? 'right' : 'left',
      overlay: pct(s.overlay),
      font: font(s.font),
      textColor: color(s.textColor),
      bgColor: color(s.bgColor),
    });
  }
  return { hero, sections };
}

function cap(v, n) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, n);
}
function font(v) { return typeof v === 'string' && FONT_KEYS.has(v) ? v : ''; }
function color(v) { return typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : ''; }
function imageId(v) { return typeof v === 'string' && IMAGE_ID_RE.test(v) ? v : ''; }
function pct(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
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
