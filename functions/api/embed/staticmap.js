// Course-token-authed proxy to the branch static map for the Rise embed.
// GET /api/embed/staticmap?ct=<course token>&c=...&pts=...&w=...&h=... - the
// map loads as an <img>, which cannot carry headers or cookies, so the token
// rides in the query string (same semi-public token already in the page URL).
// After validating the token this delegates to the exact same /api/staticmap
// handler, so rendering can never drift between the app and the embed.

import { onRequestGet as staticmapGet } from '../staticmap.js';
import { ensureEmbedTables, getEmbedScope } from '../../../shared/embed-auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return jsonError('db_not_configured', 500);
  await ensureEmbedTables(env);

  const ct = new URL(request.url).searchParams.get('ct') || '';
  const scope = await getEmbedScope(env, ct);
  if (!scope) return jsonError('invalid_token', 403);

  return staticmapGet(context);
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
