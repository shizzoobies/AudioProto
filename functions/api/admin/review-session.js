// Identity probe for a scoped review-editor visitor. The admin SPA calls this on
// boot when the full admin session check fails: a valid cs_review cookie means
// "render the rubric-only reviewer view." Reachable by cs_review (via the
// middleware allow-list) and by full admins. DELETE clears the cs_review cookie
// (reviewer logout).

import { getReviewScope } from '../../../shared/auth.js';

export async function onRequestGet({ request, env }) {
  const scope = await getReviewScope(request, env);
  return json({ reviewer: !!scope });
}

export async function onRequestDelete({ request }) {
  const isHttps = new URL(request.url).protocol === 'https:';
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  const parts = ['cs_review=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttps) parts.push('Secure');
  headers.append('Set-Cookie', parts.join('; '));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
