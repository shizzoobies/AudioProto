// The Rise/Reach embed page: /embed/call?ct=<course token>&sid=<scenario>&learner=<name>
//
// Served by a Function (not a static file) for two reasons:
// 1. Headers. public/_headers only applies to static assets, and the site-wide
//    lockdown there is frame-ancestors 'none' + X-Frame-Options: DENY. This
//    route ALONE must allow framing by the Reach/Rise ancestor chain, so it
//    emits its own headers: a scoped frame-ancestors list (env-tunable), NO
//    X-Frame-Options at all (XFO cannot express an allowlist and would
//    conflict), and the same CSP the app uses (incl. wss://api.elevenlabs.io).
// 2. Pre-validation. An invalid or revoked course token gets a friendly
//    "inactive" page before any app code loads.
//
// The page itself is a lean shell: no site chrome, one #embed-root, the shared
// stylesheet plus embed overrides, and the embed.js module. The course token
// stays in the query string (the embed client reads it there and sends it in
// POST bodies); Referrer-Policy keeps it out of outbound referrers.

import { ensureEmbedTables, getEmbedScope } from '../../shared/embed-auth.js';

const BUILD = '20260718-4';

// Every origin in the ancestor chain (Reach page -> Rise lesson -> Mighty
// block -> us) must be allowed. The default covers the known Articulate
// hosting origins plus 'self' for the local /embed-test.html harness; set
// EMBED_FRAME_ANCESTORS (space-separated) once the published course's real
// location.ancestorOrigins are known.
const DEFAULT_FRAME_ANCESTORS =
  "'self' https://*.reach360.com https://*.articulate.com https://*.articulateusercontent.com";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const ct = url.searchParams.get('ct') || '';

  const frameAncestors = env.EMBED_FRAME_ANCESTORS || DEFAULT_FRAME_ANCESTORS;
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), interest-cohort=()',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob: data:; " +
      "connect-src 'self' wss://api.elevenlabs.io; " +
      `frame-ancestors ${frameAncestors}; base-uri 'self'; form-action 'self'`,
  };

  let active = false;
  if (env.DB) {
    await ensureEmbedTables(env);
    active = !!(await getEmbedScope(env, ct));
  }
  if (!active) {
    return new Response(inactiveHtml(), { status: 401, headers });
  }

  // postMessage target origins for the completion signal. The wrapper's origin
  // is usually an Articulate content host; env-tunable like frame-ancestors.
  const parentOrigins = String(env.EMBED_PARENT_ORIGINS || '')
    .split(/\s+/)
    .filter(Boolean);

  return new Response(pageHtml(parentOrigins), { status: 200, headers });
}

function pageHtml(parentOrigins) {
  // The config rides on a body data attribute (not an inline script) so the
  // page keeps script-src 'self' with no inline exceptions.
  const config = escapeAttr(JSON.stringify({ parentOrigins, build: BUILD }));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>First Call</title>
<meta name="color-scheme" content="light">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Poppins:wght@400;500;600&family=Space+Grotesk:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/assets/css/styles.css?v=20260630-5">
<link rel="stylesheet" href="/assets/css/embed.css?v=${BUILD}">
</head>
<body class="app-page embed-page" data-view="call" data-app-state="ready" data-embed-config="${config}">
  <main id="embed-root" class="embed-main"></main>
  <script type="module" src="/assets/js/embed.js?v=${BUILD}"></script>
</body>
</html>`;
}

function inactiveHtml() {
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>Exercise unavailable</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html,body{margin:0;padding:0;background:#0a0a0b;color:#e4e4e7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:grid;place-items:center}
    main{max-width:520px;padding:32px;text-align:center}
    h1{font-weight:600;letter-spacing:-0.02em;font-size:22px;margin:0 0 12px}
    p{margin:0;color:#a1a1aa;line-height:1.55}
  </style>
</head><body><main>
  <h1>This exercise isn't available.</h1>
  <p>The access link for this course may have been changed or turned off. Please let your course administrator know.</p>
</main></body></html>`;
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
