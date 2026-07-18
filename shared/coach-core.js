// Core coaching-report generation, factored out of functions/api/coach.js so
// the Rise embed route (functions/api/embed/coach.js) scores transcripts the
// exact same way behind a different auth gate. /api/coach responses must stay
// byte-identical after the refactor; the only caller-visible difference is the
// `endpoint` tag written to call_usage ('coach' vs 'embed_coach') so admin
// usage separates embed spend.

import { buildCoaching } from './coaching-rubric.js';
import { loadRubricForCoaching } from './rubric-store.js';
import { recordUsage } from './usage.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-7';
// Big enough for a long custom rubric: every item needs score+evidence+suggestion,
// so a 20+ item rubric can blow past 2000 and truncate the scores object.
const MAX_TOKENS = 5000;

// Runs the full scoring pipeline. Returns:
//   { ok: true, body }  - body is the exact JSON object /api/coach returns
//   { ok: false, code, status }               - simple error (jsonError shape)
//   { ok: false, code: 'upstream_error', status: 502, upstreamStatus, detail }
export async function runCoach(ctx, env, { scenario, transcript, endpoint = 'coach' }) {
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, code: 'anthropic_key_missing', status: 500 };
  }

  const clean = sanitizeTranscript(transcript);
  if (clean.length < 2) {
    return { ok: false, code: 'transcript_too_short', status: 400 };
  }

  const userPrompt = buildUserPrompt(scenario, clean);

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
    return { ok: false, code: 'upstream_unreachable', status: 502 };
  }

  if (!upstream.ok) {
    const text = await safeReadText(upstream);
    return {
      ok: false,
      code: 'upstream_error',
      status: 502,
      upstreamStatus: upstream.status,
      detail: text.slice(0, 500),
    };
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    return { ok: false, code: 'upstream_malformed', status: 502 };
  }

  const toolBlock = (payload?.content || []).find(
    (b) => b?.type === 'tool_use' && b?.name === tool.name
  );
  if (!toolBlock?.input) {
    return { ok: false, code: 'no_tool_use', status: 502 };
  }

  recordUsage(ctx, env, {
    endpoint,
    scenario_id: scenario?.id || null,
    model: MODEL,
    input_tokens: payload.usage?.input_tokens || 0,
    cache_creation_input_tokens: payload.usage?.cache_creation_input_tokens || 0,
    cache_read_input_tokens: payload.usage?.cache_read_input_tokens || 0,
    output_tokens: payload.usage?.output_tokens || 0,
  });

  // Temporary diagnostic: compare what the model scored against the rubric the
  // report renders, so an all-"No score" report is unambiguous (truncation vs
  // empty scores vs key mismatch). Surfaced to the client console.
  const _scoreKeys = Object.keys(toolBlock.input?.scores || {});
  const _rubricKeys = display.flatMap((s) => (s.items || []).map((i) => i.key));
  const _diag = {
    stop: payload?.stop_reason || null,
    overall: toolBlock.input?.overall_score ?? null,
    scoreKeys: _scoreKeys.length,
    rubricKeys: _rubricKeys.length,
    missing: _rubricKeys.filter((k) => !(toolBlock.input?.scores || {})[k]).length,
    sampleScoreKey: _scoreKeys[0] || null,
    sampleRubricKey: _rubricKeys[0] || null,
  };

  // Attach the rubric display structure so the client renders exactly the
  // enabled items (and we no longer hand-sync a rubric copy in the browser).
  return { ok: true, body: { ...toolBlock.input, rubric: display, _diag } };
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
