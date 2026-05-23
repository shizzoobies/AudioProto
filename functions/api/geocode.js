// City typeahead backend for the reservation's Moving From / Moving To fields.
// A query returns up to a handful of candidate places; the picked one's
// coordinates let the Location step rank branches by real distance and
// auto-fill one-way mileage.
//
// Provider strategy: if GOOGLE_PLACES_API_KEY is set we use Google Places Text
// Search (New) as the primary (best coverage + an SLA), and fall back to
// Komoot's Photon (a keyless OSM type-ahead) whenever the key is absent or
// Google errors / returns nothing. So local dev with no key just uses Photon,
// and production degrades gracefully if Google has a hiccup. Either way the
// response shape is the same: { results: [{ lat, lng, city, state, postcode,
// display }] }. The shared auth middleware gates this route. Results are
// biased toward the San Antonio metro but real out-of-area destinations
// (e.g. "Austin") still resolve. Responses carry X-Geocode-Source for debug.

const PHOTON_SEARCH = 'https://photon.komoot.io/api/';
const GOOGLE_TEXT_SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const USER_AGENT = 'MeridianCallSimulator/1.0 (training demo; +https://ka-testing.com)';
// San Antonio metro center, for both providers' location bias.
const SA_LAT = 29.4246;
const SA_LON = -98.4951;
const CACHE_TTL_SECONDS = 86400;

// Only surface populated places / administrative areas in the dropdown, not
// POIs like airports, museums, or parks that the geocoders also match.
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

export async function onRequestPost({ request, env }) {
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

  // Primary: Google Places (only when a key is configured).
  if (env && env.GOOGLE_PLACES_API_KEY) {
    const cached = await readCache('google', query);
    if (cached) return json({ results: cached }, 200, 'google-cache');
    try {
      const results = await googleSearch(query, wasZip, env.GOOGLE_PLACES_API_KEY);
      if (results.length) {
        await writeCache('google', query, results);
        return json({ results }, 200, 'google');
      }
      // No matches: fall through to Photon rather than returning empty.
    } catch {
      // Google unreachable / errored: fall through to Photon.
    }
  }

  // Fallback: Photon.
  const cachedP = await readCache('photon', query);
  if (cachedP) return json({ results: cachedP }, 200, 'photon-cache');
  let results;
  try {
    results = await photonSearch(query, wasZip);
  } catch {
    return jsonError('upstream_unreachable', 502);
  }
  await writeCache('photon', query, results);
  return json({ results }, 200, 'photon');
}

// --- Google Places Text Search (New) ---------------------------------------
// Text Search returns full place objects (location + address components), so a
// single call yields coordinates and we keep the same result contract as
// Photon - no separate Place Details round-trip on selection.
async function googleSearch(query, wasZip, key) {
  const res = await fetch(GOOGLE_TEXT_SEARCH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'places.location,places.displayName,places.formattedAddress,places.addressComponents,places.types',
    },
    body: JSON.stringify({
      textQuery: query,
      regionCode: 'US',
      maxResultCount: 5,
      languageCode: 'en',
      locationBias: {
        circle: { center: { latitude: SA_LAT, longitude: SA_LON }, radius: 50000 },
      },
    }),
  });
  if (!res.ok) throw new Error(`google_${res.status}`);
  const data = await res.json().catch(() => null);
  const places = data && Array.isArray(data.places) ? data.places : [];
  return dedupe(places.map((p) => googleToResult(p, wasZip)));
}

function googleToResult(place, wasZip) {
  const loc = place?.location || {};
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const comps = Array.isArray(place.addressComponents) ? place.addressComponents : [];
  const find = (type) => comps.find((c) => Array.isArray(c.types) && c.types.includes(type));
  const cityC = find('locality') || find('postal_town') || find('sublocality') || find('administrative_area_level_3');
  const stateC = find('administrative_area_level_1');
  const zipC = find('postal_code');

  const name = place.displayName && place.displayName.text ? place.displayName.text : '';
  const city = cityC ? (cityC.shortText || cityC.longText || '') : '';
  const state = stateC ? (stateC.shortText || '') : '';
  const postcode = zipC ? (zipC.longText || zipC.shortText || '') : '';
  const place_name = name || city;
  if (!place_name && !city) return null;

  let display = state ? `${place_name}, ${state}` : place_name;
  if (wasZip && postcode && city) display = state ? `${city}, ${state} ${postcode}` : `${city} ${postcode}`;
  return { lat, lng, city: city || place_name, state, postcode, display };
}

// --- Komoot Photon (keyless OSM type-ahead) --------------------------------
async function photonSearch(query, wasZip) {
  const params = new URLSearchParams({
    q: query,
    limit: '8',
    lang: 'en',
    lat: String(SA_LAT),
    lon: String(SA_LON),
  });
  const upstreamUrl = `${PHOTON_SEARCH}?${params.toString()}`;
  const res = await fetch(upstreamUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`photon_${res.status}`);
  const data = await res.json().catch(() => null);
  const features = data && Array.isArray(data.features) ? data.features : [];
  return dedupe(features.map((f) => photonToResult(f, wasZip)));
}

function photonToResult(feature, wasZip) {
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

// --- shared helpers --------------------------------------------------------
function dedupe(rawResults) {
  const out = [];
  const seen = new Set();
  for (const r of rawResults) {
    if (!r) continue;
    const key = r.display.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= 5) break;
  }
  return out;
}

function cacheKey(provider, query) {
  return new Request(`https://geocode.cache/${provider}?q=${encodeURIComponent(query.toLowerCase())}`);
}

async function readCache(provider, query) {
  try {
    const hit = await caches.default.match(cacheKey(provider, query));
    if (hit) return await hit.json();
  } catch {
    // Cache misses are non-fatal.
  }
  return null;
}

async function writeCache(provider, query, results) {
  try {
    await caches.default.put(
      cacheKey(provider, query),
      new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_TTL_SECONDS}` },
      })
    );
  } catch {
    // Best-effort; a miss just means another upstream call.
  }
}

function json(obj, status, source) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (source) headers['X-Geocode-Source'] = source;
  return new Response(JSON.stringify(obj), { status, headers });
}

function jsonError(code, status) {
  return json({ error: code }, status);
}
