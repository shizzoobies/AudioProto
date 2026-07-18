// Course-token-authed proxy to the city-typeahead geocoder for the Rise embed.
// POST /api/embed/geocode?ct=<course token> with the same {query, bias} body as
// /api/geocode. The embed iframe has no cookies, so the cookie-gated
// /api/geocode returns 401 there; this wrapper validates the course token and
// then delegates to the exact same handler (same providers, same response
// shape), so the two routes cannot drift.

import { onRequestPost as geocodePost } from '../geocode.js';
import { ensureEmbedTables, getEmbedScope } from '../../../shared/embed-auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonError('db_not_configured', 500);
  await ensureEmbedTables(env);

  const ct = new URL(request.url).searchParams.get('ct') || '';
  const scope = await getEmbedScope(env, ct);
  if (!scope) return jsonError('invalid_token', 403);

  return geocodePost(context);
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
