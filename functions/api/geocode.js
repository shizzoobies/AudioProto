// Geocoding proxy. Turns a customer's typed ZIP / city / landmark into
// coordinates so the Location step can rank branches by real distance and
// auto-fill one-way mileage. Uses OpenStreetMap's Nominatim, which is keyless
// (no secret to provision), so this route adds no new Cloudflare variables.
// The shared auth middleware already gates it, which keeps the proxy from
// being open to the world. Nominatim's usage policy asks callers to send a
// real User-Agent and to cache results; we do both.

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'MeridianCallSimulator/1.0 (training demo; +https://ka-testing.com)';
// Bare city/landmark queries are biased to the simulator's metro so "Stone Oak"
// resolves locally instead of to a same-named place in another state.
const METRO_BIAS = 'San Antonio, TX';
const CACHE_TTL_SECONDS = 86400;

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) return jsonError('query_required', 400);
  if (query.length > 120) return jsonError('query_too_long', 400);

  const params = new URLSearchParams({
    format: 'json',
    limit: '1',
    addressdetails: '0',
    countrycodes: 'us',
  });
  if (/^\d{5}$/.test(query)) {
    // A bare 5-digit string is a ZIP; the dedicated param is far more reliable
    // than free-text search, which sometimes reads digits as a house number.
    params.set('postalcode', query);
  } else {
    const hasState = /,\s*[A-Za-z]{2}\b|\btexas\b|\btx\b/i.test(query);
    params.set('q', hasState ? query : `${query}, ${METRO_BIAS}`);
  }
  const upstreamUrl = `${NOMINATIM_SEARCH}?${params.toString()}`;

  const cache = caches.default;
  const cacheKey = new Request(upstreamUrl);

  let data = null;
  try {
    const cached = await cache.match(cacheKey);
    if (cached) data = await cached.json();
  } catch {
    data = null;
  }

  if (!data) {
    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
    } catch {
      return jsonError('upstream_unreachable', 502);
    }
    if (!upstream.ok) return jsonError('upstream_error', 502);
    data = await upstream.json().catch(() => null);
    if (Array.isArray(data)) {
      try {
        await cache.put(
          cacheKey,
          new Response(JSON.stringify(data), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': `max-age=${CACHE_TTL_SECONDS}`,
            },
          })
        );
      } catch {
        // Caching is best-effort; a miss just means another upstream call.
      }
    }
  }

  const top = Array.isArray(data) && data[0] ? data[0] : null;
  const lat = top ? Number(top.lat) : NaN;
  const lng = top ? Number(top.lon) : NaN;
  if (!top || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ found: false }, 200);
  }

  return json(
    {
      found: true,
      lat,
      lng,
      label: typeof top.display_name === 'string' ? top.display_name : query,
    },
    200
  );
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function jsonError(code, status) {
  return json({ error: code }, status);
}
