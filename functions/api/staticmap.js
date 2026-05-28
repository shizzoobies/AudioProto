// Server-side proxy for Google Static Maps.
//
// The API key never reaches the browser: the client sends only coordinates,
// this Worker adds the key, fetches the PNG from Google, and relays it.
// Cloudflare edge-caches the response, so repeat loads of the same scenario
// hit Google at most once per cache window (essentially free at our volume).
//
// Query params:
//   c   = "lat,lon"             center / customer marker (required)
//   pts = "lat,lon|lat,lon|..." branch markers, numbered 1..N (optional)
//   w,h = map size in CSS px    (optional; default 600x200, capped at 640)
//
// Auth: _middleware.js already requires a valid session / magic / invite /
// admin cookie for every /api/* route outside the public allowlist, so this
// can't be hit anonymously to burn the Maps quota.
//
// Key: reuses GOOGLE_PLACES_API_KEY (enable "Maps Static API" on it) unless a
// dedicated GOOGLE_MAPS_API_KEY is set.

const GOOGLE_STATIC = 'https://maps.googleapis.com/maps/api/staticmap';
const MAX_POINTS = 9;   // single-char marker labels: 1..9
const MAX_DIM = 640;    // Google Static Maps caps the base size at 640 (scale=2 → retina)

export async function onRequestGet({ request, env }) {
  const key = env.GOOGLE_MAPS_API_KEY || env.GOOGLE_PLACES_API_KEY;
  if (!key) return jsonError('maps_key_missing', 500);

  const qs = new URL(request.url).searchParams;
  const center = parsePair(qs.get('c'));
  if (!center) return jsonError('bad_center', 400);

  const pts = (qs.get('pts') || '')
    .split('|')
    .map(parsePair)
    .filter(Boolean)
    .slice(0, MAX_POINTS);

  const w = clampDim(qs.get('w'), 600);
  const h = clampDim(qs.get('h'), 200);

  // Customer = blue "C" marker; branches = green numbered pins. No center/zoom
  // means Google auto-fits the viewport to all the markers.
  const params = new URLSearchParams();
  params.set('size', `${w}x${h}`);
  params.set('scale', '2');
  params.set('maptype', 'roadmap');
  params.append('markers', `color:0x1d4ed8|label:C|${center.lat},${center.lon}`);
  pts.forEach((p, i) => {
    params.append('markers', `color:0x16a34a|label:${i + 1}|${p.lat},${p.lon}`);
  });
  params.set('key', key);

  const target = `${GOOGLE_STATIC}?${params.toString()}`;

  let upstream;
  try {
    upstream = await fetch(target, { cf: { cacheTtl: 86400, cacheEverything: true } });
  } catch {
    return jsonError('upstream_unreachable', 502);
  }
  if (!upstream.ok) {
    return jsonError(`google_${upstream.status}`, 502);
  }

  // Relay the image with a long edge + browser cache. Identical coordinates
  // produce an identical request URL, so the edge serves it without re-billing.
  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'image/png');
  headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');
  return new Response(upstream.body, { status: 200, headers });
}

function parsePair(s) {
  if (!s) return null;
  const parts = String(s).split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function clampDim(v, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(120, Math.min(MAX_DIM, n));
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
