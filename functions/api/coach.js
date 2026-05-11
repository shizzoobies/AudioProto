import { getScenario } from '../../shared/scenarios.js';
import { COACHING_SYSTEM_PROMPT, COACHING_TOOL } from '../../shared/coaching-rubric.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 2000;

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

  const transcript = sanitizeTranscript(body?.transcript);
  if (transcript.length < 2) {
    return jsonError('transcript_too_short', 400);
  }

  const userPrompt = buildUserPrompt(scenario, transcript);

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
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: COACHING_SYSTEM_PROMPT,
        tools: [COACHING_TOOL],
        tool_choice: { type: 'tool', name: COACHING_TOOL.name },
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
  } catch {
    return jsonError('upstream_unreachable', 502);
  }

  if (!upstream.ok) {
    const text = await safeReadText(upstream);
    return new Response(
      JSON.stringify({ error: 'upstream_error', status: upstream.status, detail: text.slice(0, 500) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return jsonError('upstream_malformed', 502);
  }

  const toolBlock = (payload?.content || []).find(
    (b) => b?.type === 'tool_use' && b?.name === COACHING_TOOL.name
  );
  if (!toolBlock?.input) {
    return jsonError('no_tool_use', 502);
  }

  return new Response(JSON.stringify(toolBlock.input), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function sanitizeTranscript(transcript) {
  if (!Array.isArray(transcript)) return [];
  const out = [];
  for (const m of transcript) {
    if (!m || typeof m !== 'object') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (typeof m.content !== 'string') continue;
    const trimmed = m.content.trim();
    if (!trimmed) continue;
    out.push({ role: m.role, content: trimmed.slice(0, 4000) });
  }
  return out.slice(-80);
}

function buildUserPrompt(scenario, transcript) {
  const criteria = (scenario.success_criteria || [])
    .map((c, i) => `${i + 1}. ${c}`)
    .join('\n');

  const lines = [];
  lines.push(`[Customer opening] ${scenario.customer_name}: ${scenario.opening_line}`);
  for (const m of transcript) {
    const speaker = m.role === 'assistant' ? `${scenario.customer_name}` : 'Agent';
    lines.push(`[${speaker}] ${m.content}`);
  }
  const formattedTranscript = lines.join('\n');

  return `Scenario: ${scenario.title}
Customer: ${scenario.customer_name} (${scenario.customer_short})

Situation:
${scenario.description}

Success criteria for this scenario:
${criteria}

Full transcript (the agent is the trainee; ${scenario.customer_name} is the roleplayed customer):
${formattedTranscript}

Submit your coaching report now by calling submit_coaching_report.`;
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
