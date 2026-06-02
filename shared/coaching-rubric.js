// Coaching rubric definition. Used by /api/coach to call Claude with tool use
// that forces a structured JSON response.
//
// The rubric is now DATA-DRIVEN: an admin-editable list of items (stored in D1,
// table rubric_items) is turned into the system prompt + the Claude tool schema
// + the report display structure by buildCoaching(). The defaults below are the
// seed set and the fallback when the DB is unavailable or empty, so behavior is
// unchanged until an admin edits the rubric.

// The fixed sections, in display order. Items reference one of these by `section`
// key. Section management is intentionally not exposed in the admin UI yet.
export const RUBRIC_SECTIONS = [
  { key: 'beginning', label: 'Beginning — Greeting the Customer' },
  { key: 'gathering', label: 'Gathering the Rental Information' },
  { key: 'scheduling', label: 'Scheduling the Reservation' },
  { key: 'wrap', label: 'Wrap Up' },
  { key: 'general', label: 'General' },
];

const SECTION_LABEL = Object.fromEntries(RUBRIC_SECTIONS.map((s) => [s.key, s.label]));

// The default rubric items (also the D1 seed). `guidance` is the scoring
// instruction the model reads; `label` is the short card label in the report.
export const DEFAULT_RUBRIC_ITEMS = [
  { key: 'beginning_greeting', section: 'beginning', position: 0,
    label: 'Branded greeting & self-intro',
    guidance: 'Did they open with a proper branded greeting and give their name? For example, "Thank you for calling Meridian Moving and Storage, this is ___."' },
  { key: 'beginning_offer', section: 'beginning', position: 1,
    label: 'Offer to help & set the tone',
    guidance: 'Did they ask how they can help and set a warm, professional tone from the first moment?' },
  { key: 'gathering_details', section: 'gathering', position: 0,
    label: 'Move details',
    guidance: 'Did they collect the move details the reservation needs - where from and to, the date, the load size - by asking good questions and confirming understanding?' },
  { key: 'gathering_equipment', section: 'gathering', position: 1,
    label: 'Equipment match',
    guidance: 'Did they recommend the right truck size for the move and present the rate and options clearly?' },
  { key: 'scheduling_location', section: 'scheduling', position: 0,
    label: 'Pickup location',
    guidance: 'Did they select or confirm the right pickup branch for the customer?' },
  { key: 'scheduling_time', section: 'scheduling', position: 1,
    label: 'Pickup time',
    guidance: 'Did they lock in a firm pickup date and time?' },
  { key: 'wrap_readback', section: 'wrap', position: 0,
    label: 'Read-back & confirmation',
    guidance: 'Did they read back and confirm the reservation details, including the confirmation number?' },
  { key: 'wrap_close', section: 'wrap', position: 1,
    label: 'Professional close',
    guidance: 'Did they cover next steps, ask if there is anything else, and close the call courteously?' },
  { key: 'general_objections', section: 'general', position: 0,
    label: 'Overcoming objections',
    guidance: 'Did they handle objections (price, competitor, hesitation) and keep the call moving toward a booking?' },
  { key: 'general_advisories', section: 'general', position: 1,
    label: 'Reading advisories',
    guidance: 'Did they read or cover the required advisories, notices, and disclosures when they applied?' },
  { key: 'general_upsell', section: 'general', position: 2,
    label: 'Upsell opportunities',
    guidance: 'Did they catch upsell opportunities (storage, furniture pads, a dolly, coverage) when the moment came up?' },
  { key: 'general_policy', section: 'general', position: 3,
    label: 'Policy & accuracy',
    guidance: "Did they stay accurate to Meridian's stated policies and avoid promising things outside them?" },
];

const PROMPT_HEAD = `You are a calm, encouraging customer service coach. You evaluate a single simulated call between a customer service agent and a roleplayed customer.

You receive:
- The scenario the agent chose, with situation context and the success criteria that mattered for it.
- The full transcript of the call, with the customer's opening line included.

Your job:
- Score the agent on a 1 to 5 scale across the items below, grouped into sections that follow the arc of the call.
- Be specific. Quote a real, short moment from the transcript as evidence for each score.
- Be constructive. For every item, name one concrete thing to try, in one sentence.
- Be honest. Do not inflate scores. A 3 is fine. A 4 is good. A 5 is rare and earned.
- Identify 2 to 4 strengths and 2 to 4 growth areas, each as a short concrete sentence.
- End with the single most impactful thing the agent should try next time, written in second person ("Try opening with...").
- Capture the customer's emotional state at the moment the call ended, in two fields: a one-word mood label (one of satisfied, neutral, frustrated, unresolved, hostile) and a short one-sentence note explaining how the customer was feeling when the call wrapped up.

Tone: warm, direct, specific. Not gushy. Not harsh. Talk to a colleague, not a child.

Scoring rubric. Score each of the items below from 1 to 5, grouped into sections. Submit a score for every item.`;

const PROMPT_TAIL = `For any item where the moment never arose in this call, score what they did to set up success and note in the evidence that the moment did not come up.

Style rules:
- Do not use em dashes anywhere in your output. Use commas, periods, or restart sentences.
- Evidence is best as a short verbatim quote in double quotes. If no quote fits, paraphrase in one sentence.
- Suggestions are single sentences, not paragraphs.
- overall_score is on a 1.0 to 5.0 scale and may be a decimal. Round to one decimal place.

Submit the report by calling the submit_coaching_report tool exactly once.`;

const SCORE_ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    score: {
      type: 'integer',
      minimum: 1,
      maximum: 5,
      description: 'Score from 1 to 5.',
    },
    evidence: {
      type: 'string',
      description: 'A short verbatim quote from the transcript (in double quotes) or a one-sentence paraphrase.',
    },
    suggestion: {
      type: 'string',
      description: 'One concrete sentence describing what to try differently next time for this item.',
    },
  },
  required: ['score', 'evidence', 'suggestion'],
};

// Order a list of items by section (RUBRIC_SECTIONS order) then by position.
function orderItems(items) {
  const sectionIndex = Object.fromEntries(RUBRIC_SECTIONS.map((s, i) => [s.key, i]));
  return [...items].sort((a, b) => {
    const sa = sectionIndex[a.section] ?? 999;
    const sb = sectionIndex[b.section] ?? 999;
    if (sa !== sb) return sa - sb;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

// Build the coaching system prompt, the Claude tool schema, and the report
// display structure from a list of rubric items. Only ENABLED items are used.
// Falls back to the defaults if no enabled items are passed (an empty tool
// schema would be invalid and would break scoring).
export function buildCoaching(rawItems) {
  let items = (Array.isArray(rawItems) ? rawItems : [])
    .filter((it) => it && it.key && it.section && it.label && it.guidance)
    .filter((it) => it.enabled === undefined || it.enabled === null || it.enabled === true || it.enabled === 1);
  if (!items.length) items = DEFAULT_RUBRIC_ITEMS;
  items = orderItems(items);

  // System prompt: regenerate the rubric block from the items.
  const bySection = new Map();
  for (const it of items) {
    if (!bySection.has(it.section)) bySection.set(it.section, []);
    bySection.get(it.section).push(it);
  }
  const blocks = [];
  for (const s of RUBRIC_SECTIONS) {
    const list = bySection.get(s.key);
    if (!list || !list.length) continue;
    const lines = list.map((it) => `- ${it.key} (${it.label}): ${it.guidance}`).join('\n');
    blocks.push(`${s.label}:\n${lines}`);
  }
  const systemPrompt = `${PROMPT_HEAD}\n\n${blocks.join('\n\n')}\n\n${PROMPT_TAIL}`;

  // Tool schema: one SCORE_ENTRY per item key, all required.
  const scoreProps = {};
  const scoreRequired = [];
  for (const it of items) {
    scoreProps[it.key] = SCORE_ENTRY_SCHEMA;
    scoreRequired.push(it.key);
  }
  const tool = {
    name: 'submit_coaching_report',
    description: 'Submit the final coaching report for this practice call.',
    input_schema: {
      type: 'object',
      properties: {
        overall_score: {
          type: 'number',
          minimum: 1,
          maximum: 5,
          description: 'Overall call score from 1.0 to 5.0, rounded to one decimal.',
        },
        scores: {
          type: 'object',
          properties: scoreProps,
          required: scoreRequired,
        },
        strengths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: '2 to 4 short, specific strengths shown in this call.',
        },
        growth_areas: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: '2 to 4 short, specific growth areas.',
        },
        one_thing_to_try_next_time: {
          type: 'string',
          description: 'The single most impactful thing for the agent to try next time, written in second person.',
        },
        final_mood: {
          type: 'string',
          enum: ['satisfied', 'neutral', 'frustrated', 'unresolved', 'hostile'],
          description: "The customer's overall emotional state at the moment the call ended.",
        },
        final_mood_note: {
          type: 'string',
          description: 'One short sentence describing how the customer was feeling at the end of the call. No more than 12 words.',
        },
      },
      required: ['overall_score', 'scores', 'strengths', 'growth_areas', 'one_thing_to_try_next_time', 'final_mood', 'final_mood_note'],
    },
  };

  // Display structure: sections (in order) each holding their item {key,label}.
  const display = [];
  for (const s of RUBRIC_SECTIONS) {
    const list = bySection.get(s.key);
    if (!list || !list.length) continue;
    display.push({ label: s.label, items: list.map((it) => ({ key: it.key, label: it.label })) });
  }

  return { systemPrompt, tool, display };
}

// Backward-compatible static exports, built from the defaults. Used as the
// fallback when the DB rubric is unavailable, and by anything importing the old
// names directly.
const DEFAULT_BUILD = buildCoaching(DEFAULT_RUBRIC_ITEMS);
export const COACHING_SYSTEM_PROMPT = DEFAULT_BUILD.systemPrompt;
export const COACHING_TOOL = DEFAULT_BUILD.tool;
export const RUBRIC_DISPLAY = DEFAULT_BUILD.display;
export { SECTION_LABEL };
