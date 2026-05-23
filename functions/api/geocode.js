// City typeahead backend for the reservation's Moving From / Moving To fields.
// A query returns up to a handful of candidate places; the picked one's
// coordinates let the Location step rank branches by real distance and
// auto-fill one-way mileage. Uses Komoot's Photon (an OSM-based geocoder built
// for type-ahead), which is keyless, so this route adds no Cloudflare secret.
// The shared auth middleware gates it. Photon, like Nominatim, asks for a real
// User-Agent and reasonable caching; we do both. Results are biased toward the
// San Antonio metro but real out-of-area destinations still resolve.

const PHOTON_SEARCH = 'https://photon.komoot.io/api/';
const USER_AGENT = 'MeridianCallSimulator/1.0 (training demo; +https://ka-testing.com)';
const SA_LAT = '29.4246';
const SA_LON = '-98.4951';
const CACHE_TTL_SECONDS = 86400;

// Only surface populated places / administrative areas in the dropdown, not
// POIs like airports, museums, or parks that Photon also matches.
const PLACE_VALUES = new Set([
  'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'locality',
  'municipality', 'county', 'state', 'administrative', 'region', 'district', 'quarter',
]);

const STATE_ABBR = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'puerto rico': 'PR',
};

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

  const wasZip = /^\d{5}$/.test(query);
  const params = new URLSearchParams({
    q: query,
    limit: '8',
    lang: 'en',
    lat: SA_LAT,
    lon: SA_LON,
  });
  const upstreamUrl = `${PHOTON_SEARCH}?${params.toString()}`;

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
    if (data && Array.isArray(data.features)) {
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

  const features = data && Array.isArray(data.features) ? data.features : [];
  const results = [];
  const seen = new Set();
  for (const feature of features) {
    const r = toResult(feature, wasZip);
    if (!r) continue;
    const dedupe = r.display.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    results.push(r);
    if (results.length >= 5) break;
  }

  return json({ results }, 200);
}

// Shape one Photon feature into a candidate the autocomplete can display, or
// null to skip it (non-US, missing coords, or a POI rather than a place).
function toResult(feature, wasZip) {
  const props = feature?.properties || {};
  if (props.countrycode !== 'US') return null;
  const coords = feature?.geometry?.coordinates;
  const lng = Array.isArray(coords) ? Number(coords[0]) : NaN;
  const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const st = props.state ? (STATE_ABBR[String(props.state).toLowerCase()] || props.state) : '';

  if (wasZip) {
    // For a ZIP search Photon puts the digits in `name` and the place in `city`.
    const zip = props.name || '';
    const place = props.city || props.county || '';
    if (!place && !zip) return null;
    const head = place || zip;
    let display = st ? `${head}, ${st}` : head;
    if (place && zip) display = st ? `${place}, ${st} ${zip}` : `${place} ${zip}`;
    return { lat, lng, city: place || head, state: st, postcode: zip, display };
  }

  if (!PLACE_VALUES.has(props.osm_value)) return null;
  const place = props.name || props.city || '';
  if (!place) return null;
  return {
    lat,
    lng,
    city: props.city || props.name || '',
    state: st,
    postcode: props.postcode || '',
    display: st ? `${place}, ${st}` : place,
  };
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
