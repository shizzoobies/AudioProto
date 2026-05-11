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
