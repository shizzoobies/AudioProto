// Public, same-origin server for coaching landing images stored in D1 (see
// /api/admin/coaching-landing-image). Served from /coaching-image/<id> so the
// strict CSP (img-src 'self') allows them in <img>. Not under /api, so the API
// middleware does not gate it — landing images aren't sensitive, and ids are
// random. Long, immutable cache: each upload gets a fresh id, so content never
// changes under a given id.

const ID_RE = /^img_[a-f0-9]{6,}$/i;

export async function onRequest({ env, params }) {
  const id = String(params?.id || '');
  if (!ID_RE.test(id) || !env.DB) return notFound();

  let row;
  try {
    row = await env.DB
      .prepare(`SELECT mime, data FROM coaching_images WHERE id = ?`)
      .bind(id)
      .first();
  } catch {
    return notFound();
  }
  if (!row || row.data == null) return notFound();

  // D1 returns BLOB columns as a plain Array<number> (or sometimes an
  // ArrayBuffer). Normalize to a Uint8Array — a valid Response body. Passing the
  // raw number[] yields an EMPTY body (HTTP 200, 0 bytes).
  const body = row.data instanceof ArrayBuffer || ArrayBuffer.isView(row.data)
    ? row.data
    : new Uint8Array(row.data);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': typeof row.mime === 'string' && row.mime ? row.mime : 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
