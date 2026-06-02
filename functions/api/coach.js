import { getScenario } from '../../shared/scenarios.js';
import { buildCoaching } from '../../shared/coaching-rubric.js';
import { loadRubricForCoaching } from '../../shared/rubric-store.js';
import { getMagicScope, getInviteScope } from '../../shared/auth.js';
import { recordUsage } from '../../shared/usage.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 2000;

export async function onRequestPost(context) {
  const { request, env } = context;
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

  // Magic-link visitors can only coach the scenario their cookie is scoped to.
  const lockedScenario = await getMagicScope(request, env);
  if (lockedScenario && lockedScenario !== body.scenario_id) {
    return jsonError('forbidden_scenario', 403);
  }
  // Invite recipients can only coach scenarios in their assigned set.
  const inviteScope = await getInviteScope(request, env);
  if (inviteScope && !inviteScope.scenarios.has(body.scenario_id)) {
    return jsonError('forbidden_scenario', 403);
  }

  const transcript = sanitizeTranscript(body?.transcript);
  if (transcript.length < 2) {
    return jsonError('transcript_too_short', 400);
  }

  const userPrompt = buildUserPrompt(scenario, transcript);

  // Build the system prompt + tool schema from the live (admin-editable) rubric;
  // falls back to the in-code defaults if the DB rubric is unavailable. `display`
  // is returned to the client so the report renders exactly the enabled items.
  const { systemPrompt, tool, display } = buildCoaching(await loadRubricForCoaching(env));

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
        // Cache the static rubric + tool definition (identical on every
        // coaching call) — the dynamic transcript stays at full rate
        // because it's unique per call. The system prompt + tool together
        // clear Anthropic's 1024-token caching minimum easily and pay 10%
        // of the input rate on cache hits.
        system: [
          { type: 'text', text: systemPrompt,
            cache_control: { type: 'ephemeral' } },
        ],
        tools: [
          { ...tool, cache_control: { type: 'ephemeral' } },
        ],
        tool_choice: { type: 'tool', name: tool.name },
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
    (b) => b?.type === 'tool_use' && b?.name === tool.name
  );
  if (!toolBlock?.input) {
    return jsonError('no_tool_use', 502);
  }

  recordUsage(context, env, {
    endpoint: 'coach',
    scenario_id: body?.scenario_id || null,
    model: MODEL,
    input_tokens: payload.usage?.input_tokens || 0,
    cache_creation_input_tokens: payload.usage?.cache_creation_input_tokens || 0,
    cache_read_input_tokens: payload.usage?.cache_read_input_tokens || 0,
    output_tokens: payload.usage?.output_tokens || 0,
  });

  // Attach the rubric display structure so the client renders exactly the
  // enabled items (and we no longer hand-sync a rubric copy in the browser).
  return new Response(JSON.stringify({ ...toolBlock.input, rubric: display }), {
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

  // Agent-first: the trainee (the CSR agent) greets first, then the customer
  // responds. The transcript already leads with the agent's greeting, so we
  // do NOT prepend a synthetic customer opening — that would misrepresent who
  // spoke first and credit the trainee with a line they never said.
  const lines = [];
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

Full transcript (the CSR agent is the trainee and greets first; ${scenario.customer_name} is the roleplayed customer who responds):
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
