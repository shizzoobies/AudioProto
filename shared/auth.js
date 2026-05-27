const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

function bytesToBase64Url(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stringToBase64Url(str) {
  return bytesToBase64Url(ENCODER.encode(str));
}

function base64UrlToBytes(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlToString(str) {
  return DECODER.decode(base64UrlToBytes(str));
}

async function getKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = stringToBase64Url(JSON.stringify(header));
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;

  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(data));
  const sigB64 = bytesToBase64Url(new Uint8Array(sig));

  return `${data}.${sigB64}`;
}

export async function verifyToken(token, secret) {
  if (typeof token !== 'string') {
    throw new Error('malformed_token');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('malformed_token');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;

  const key = await getKey(secret);
  const sigBytes = base64UrlToBytes(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, ENCODER.encode(data));
  if (!valid) {
    throw new Error('invalid_signature');
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlToString(payloadB64));
  } catch {
    throw new Error('malformed_payload');
  }

  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('expired');
  }

  return payload;
}

// Short hex fingerprint of a secret (first 16 bytes of SHA-256). We stash this
// in cs_magic cookies so rotating MAGIC_LINK_TOKEN in the dashboard invalidates
// every already-issued cookie immediately, not just future ones.
export async function tokenFingerprint(s) {
  const data = ENCODER.encode(String(s || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(digest)).slice(0, 16);
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// If the request is authenticated only by a valid cs_magic cookie (and the
// MAGIC_LINK_TOKEN fingerprint still matches what's currently configured),
// return the scenario_id the visitor is locked to. Returns null if the
// visitor has a normal session (no lock applies) or has no valid magic scope
// at all. Used by chat/tts/coach to refuse any scenario outside the lane.
export async function getMagicScope(request, env) {
  if (!env?.SESSION_SECRET || !env?.MAGIC_LINK_TOKEN) return null;
  const cookies = parseCookieHeader(request.headers.get('Cookie') || '');
  if (cookies.session) {
    try {
      await verifyToken(cookies.session, env.SESSION_SECRET);
      return null;
    } catch {
      // fall through: session is bad, try magic
    }
  }
  const t = cookies.cs_magic;
  if (!t) return null;
  try {
    const payload = await verifyToken(t, env.SESSION_SECRET);
    if (!payload?.magic) return null;
    const fp = await tokenFingerprint(env.MAGIC_LINK_TOKEN);
    if (payload.h !== fp) return null;
    return typeof payload.scenario === 'string' ? payload.scenario : null;
  } catch {
    return null;
  }
}

export function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}
