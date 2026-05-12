import { getScenario } from '../../shared/scenarios.js';
import { verifyToken } from '../../shared/auth.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const STANDARD_MODEL = 'claude-sonnet-4-6';
const PREMIUM_MODEL = 'claude-opus-4-7';
const SHOWCASE_PERSONA_PREFIX = 'showcase_';
const MAX_TOKENS = 512;
const PREMIUM_MAX_TOKENS = 768;

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonError('anthropic_key_missing', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid_request', 400);
  }

  const scenario = getScenario(body?.scenario_id);
  if (!scenario) {
    return jsonError('unknown_scenario', 400);
  }

  const messages = sanitizeMessages(body?.messages);
  if (!messages.length) {
    return jsonError('messages_required', 400);
  }

  const isShowcase = String(body.scenario_id || '').startsWith(SHOWCASE_PERSONA_PREFIX);
  const demoUnlocked = await isDemoUnlocked(request, env.SESSION_SECRET);
  const usePremium = isShowcase && demoUnlocked;
  const modelId = usePremium ? PREMIUM_MODEL : STANDARD_MODEL;
  const maxTokens = usePremium ? PREMIUM_MAX_TOKENS : MAX_TOKENS;

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        system: scenario.system_prompt,
        messages,
        stream: true,
      }),
    });
  } catch (err) {
    return jsonError('upstream_unreachable', 502);
  }

  if (!upstream.ok || !upstream.body) {
    const text = await safeReadText(upstream);
    return new Response(
      JSON.stringify({ error: 'upstream_error', status: upstream.status, detail: text.slice(0, 500) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const stream = transformAnthropicSse(upstream.body);

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Chat-Model': modelId,
    },
  });
}

async function isDemoUnlocked(request, secret) {
  if (!secret) return false;
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies.cs_demo;
  if (!token) return false;
  try {
    const payload = await verifyToken(token, secret);
    return !!payload?.demo;
  } catch {
    return false;
  }
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

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (typeof m.content !== 'string') continue;
    const trimmed = m.content.trim();
    if (!trimmed) continue;
    out.push({ role: m.role, content: trimmed.slice(0, 4000) });
  }
  return out.slice(-40);
}

function transformAnthropicSse(upstreamBody) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = extractDataLine(rawEvent);
            if (!dataLine) continue;
            const text = extractTextDelta(dataLine);
            if (text) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', text })}\n\n`)
              );
            }
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: String(err?.message || err) })}\n\n`
          )
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } finally {
        controller.close();
      }
    },
  });
}

function extractDataLine(rawEvent) {
  for (const line of rawEvent.split('\n')) {
    if (line.startsWith('data: ')) return line.slice(6);
  }
  return null;
}

function extractTextDelta(dataLine) {
  let parsed;
  try {
    parsed = JSON.parse(dataLine);
  } catch {
    return null;
  }
  if (parsed?.type === 'content_block_delta' && parsed?.delta?.type === 'text_delta') {
    return parsed.delta.text || '';
  }
  return null;
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
