import { verifyToken } from '../../shared/auth.js';

export async function onRequestGet({ request, env }) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies.cs_demo;
  if (!token || !env.SESSION_SECRET) {
    return jsonOk({ demo: false });
  }
  try {
    const payload = await verifyToken(token, env.SESSION_SECRET);
    return jsonOk({ demo: !!payload?.demo, expires_at: payload?.exp });
  } catch {
    return jsonOk({ demo: false });
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function parseCookies(header) {
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
