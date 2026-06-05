// Admin image upload for the coaching landing page. Stores the bytes as a BLOB
// in D1 (no external object storage / no Cloudflare setup) and serves them
// same-origin from /coaching-image/<id> — which satisfies the strict CSP
// (img-src 'self'). Full-admin only (under /api/admin/, not in any scoped
// allow-list). Image bytes never travel in the landing content JSON or
// /api/me/status; only the id reference does.
//
// POST multipart/form-data with field "file" -> { id, url }

import { randomId, getAdminScope } from '../../../shared/auth.js';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureTable(env);

    const form = await request.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return jsonError('no_file', 400);
    }
    const mime = String(file.type || '').toLowerCase();
    if (!ALLOWED.has(mime)) return jsonError('unsupported_type', 415, `mime: ${mime || 'unknown'}`);

    const buf = await file.arrayBuffer();
    if (buf.byteLength === 0) return jsonError('empty_file', 400);
    if (buf.byteLength > MAX_BYTES) return jsonError('too_large', 413, `${buf.byteLength} bytes > ${MAX_BYTES}`);

    const id = 'img_' + randomId(10);
    const now = Math.floor(Date.now() / 1000);
    let createdBy = null;
    try { const s = await getAdminScope(request, env); createdBy = s?.email || s?.admin_id || null; } catch {}

    await env.DB
      .prepare(`INSERT INTO coaching_images (id, mime, data, bytes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, mime, buf, buf.byteLength, now, createdBy)
      .run();

    return json({ id, url: `/coaching-image/${id}` }, 201);
  } catch (e) {
    return jsonError('upload_failed', 500, String(e?.message || e));
  }
}

async function ensureTable(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS coaching_images (
         id          TEXT PRIMARY KEY,
         mime        TEXT NOT NULL,
         data        BLOB NOT NULL,
         bytes       INTEGER,
         created_at  INTEGER,
         created_by  TEXT
       )`
    ).run();
  } catch {
    // already present
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
