// Gate for the static "Designing Growth" game. This middleware runs for every
// /designing-growth/* request (index.html AND data.json, which is the whole game
// content) BEFORE the static asset is served. A valid cs_game cookie (minted by
// /game-pass/<token>) releases the page via next(); anything else gets a
// no-password "need a link" page.
//
// getGameScope re-reads the invites row on every request, so revoking or
// regenerating the link in the admin dashboard cuts off access immediately.
//
// Note: the engine + stylesheet live under /assets and stay public — they hold no
// game content. data.json (all the copy, deltas and branching) sits inside this
// gated folder on purpose.

import { getGameScope } from '../../shared/auth.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const scope = await getGameScope(request, env);
  if (scope) return next();
  return gatePage();
}

function gatePage() {
  const html = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>Access by link only</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html,body{margin:0;padding:0;background:#f4eddf;color:#241d1c;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:grid;place-items:center}
    main{max-width:520px;padding:32px;text-align:center}
    h1{font-weight:600;letter-spacing:-0.02em;font-size:24px;margin:0 0 12px}
    p{margin:0;color:#7e7764;line-height:1.55}
  </style>
</head><body><main>
  <h1>This page is access by link only.</h1>
  <p>Open it using the shared link you were given. If your link stopped working, it may have expired or been revoked.</p>
</main></body></html>`;
  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
