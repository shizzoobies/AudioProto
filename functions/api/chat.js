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
  // Fetch the demo-cookie check and the live weather in parallel so the
  // weather lookup adds no extra latency to the turn.
  const [demoUnlocked, weatherBlock] = await Promise.all([
    isDemoUnlocked(request, env.SESSION_SECRET),
    fetchWeatherBlock(scenario.location),
  ]);
  // Premium personas (scenario.premium) always run on the premium model, no
  // demo cookie required. The showcase persona still needs the demo unlock.
  const usePremium = !!scenario.premium || (isShowcase && demoUnlocked);
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
        system: [
          scenario.system_prompt,
          currentDateBlock(),
          weatherBlock,
          openingContinuationBlock(body?.opening_line),
          usePremium ? (isShowcase ? premiumVoiceDirectionBlock() : genericPremiumVoiceBlock()) : '',
        ].filter(Boolean).join('\n\n'),
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

// Personas have no idea what day it is unless we tell them. Without this
// the model invents dates ("about nine weeks out" -> a random month), so
// we anchor it to the real wall clock on every request. Central time is a
// fine default - the personas live in Texas. This is appended after the
// static persona prompt so it never collides with the persona's identity.
function currentDateBlock() {
  let today;
  try {
    today = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date());
  } catch {
    today = new Date().toISOString().slice(0, 10);
  }
  return [
    'Real-world clock (authoritative - you live in the present):',
    `- Today's date is ${today}.`,
    '- Any date you mention must be computed relative to today and stated accurately. If your situation says something is "about nine weeks out" or "next month", count forward from today and name the correct month and day. Never reference a month that does not line up with that math.',
    '- Speak dates naturally per the number rules above (for example "August fourth" or "the first week of August"), not in digits.',
  ].join('\n');
}

// Only sent when the showcase persona is running on the premium voice
// model (eleven_v3), which performs square-bracket delivery tags instead
// of speaking them. Gives Elena real moment-to-moment range and keeps her
// from sounding identical on every call.
function premiumVoiceDirectionBlock() {
  return [
    'Premium voice delivery (you are currently running on an expressive voice model):',
    '- You may place square-bracket delivery tags inline. They are performed, not spoken aloud. Use them sparingly and only where they earn it - most sentences need none, never more than one per short reply, never two in a row.',
    '- Emotional tone tags you may use: [warmly], [gently], [softly], [hesitant], [reassuring], [thoughtful], [tired], [excited], [amused], [wistful].',
    '- Non-verbal tags you may use: [sighs], [laughs softly], [chuckles], [exhales].',
    '- Match the tag to the moment: warmth in greetings and small talk, a soft [sighs] or [wistful] before a heavy topic (your dad Hector, your estranged brother Felipe), gentle energy about Mateo, brisk focus when you are deep in move logistics, [amused] or [laughs softly] when something is genuinely funny.',
    '- Never use asterisks or parenthetical actions like *laughs* or (sighs). Only square-bracket tags from the lists above.',
    '- Vary your wording, rhythm, and energy from call to call so you never sound scripted. Do not reuse the same stock opening every time; greet the way the moment calls for.',
  ].join('\n');
}

// Premium voice delivery for non-showcase premium personas (the sales /
// post-reservation cast). Same expressive eleven_v3 tag guidance as Elena's
// block, minus her personal references, so any premium persona gets real
// moment-to-moment range without sounding scripted.
function genericPremiumVoiceBlock() {
  return [
    'Premium voice delivery (you are currently running on an expressive voice model):',
    '- You may place square-bracket delivery tags inline. They are performed, not spoken aloud. Use them sparingly and only where they earn it - most sentences need none, never more than one per short reply, never two in a row.',
    '- Emotional tone tags you may use: [warmly], [gently], [softly], [hesitant], [reassuring], [thoughtful], [tired], [excited], [amused], [wistful], [skeptical], [firmly].',
    '- Non-verbal tags you may use: [sighs], [laughs softly], [chuckles], [exhales].',
    '- Match the tag to the moment and your mood; never decorate every line. Keep the delivery natural and human.',
    '- Never use asterisks or parenthetical actions like *laughs* or (sighs). Only square-bracket tags from the lists above.',
    '- Vary your wording, rhythm, and energy from call to call so you never sound scripted.',
  ].join('\n');
}

// The persona's opening line is delivered client-side and is NOT part of
// the message history the model receives, so without this the model thinks
// the conversation just started and re-introduces itself on the first
// reply. Telling it exactly what it already said anchors it to continue.
function openingContinuationBlock(openingLine) {
  const line = String(openingLine || '').trim().slice(0, 600);
  if (!line) return '';
  return [
    'Conversation state: you have ALREADY opened this call. Your first words, which the other person has already heard, were:',
    `"${line}"`,
    'Do not greet again, do not say your name again, do not re-introduce yourself. Just continue the conversation naturally, responding directly to what the other person says next.',
  ].join('\n');
}

// WMO weather interpretation codes -> plain English.
const WMO_DESCRIPTIONS = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light rain showers', 81: 'rain showers', 82: 'heavy rain showers',
  85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'severe thunderstorms with hail',
};

// Live local weather for the persona's city, so they react to the world
// like a real person ("it's brutal out today"). Open-Meteo is free and
// needs no key. The subrequest is edge-cached for 15 minutes so it costs
// nothing on the hot path, and any failure degrades gracefully to no
// weather block at all.
async function fetchWeatherBlock(location) {
  const loc = location || { label: 'your area', lat: 29.4241, lon: -98.4936 };
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago';
    const res = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true } });
    if (!res.ok) return '';
    const data = await res.json();
    const c = data?.current;
    if (!c || typeof c.temperature_2m !== 'number') return '';
    const temp = Math.round(c.temperature_2m);
    const feels = Math.round(c.apparent_temperature);
    const desc = WMO_DESCRIPTIONS[c.weather_code] || 'mixed conditions';
    const wind = Math.round(c.wind_speed_10m);
    const feelsClause =
      Number.isFinite(feels) && Math.abs(feels - temp) >= 3 ? ` (feels like ${feels}°F)` : '';
    return [
      `Local weather right now (${loc.label}): ${temp}°F${feelsClause}, ${desc}, wind ${wind} mph.`,
      'This is ambient knowledge. Reference the weather only if it comes up naturally (small talk, the agent asks about your day, or it bears on your move). Never open the call with a weather report.',
    ].join('\n');
  } catch {
    return '';
  }
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
