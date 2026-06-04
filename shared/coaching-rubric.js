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
  { key: 'call_process', label: 'Call Process' },
  { key: 'soft_skills', label: 'Soft Skills' },
];

const SECTION_LABEL = Object.fromEntries(RUBRIC_SECTIONS.map((s) => [s.key, s.label]));

// The default rubric items (also the D1 seed). Per item:
//   guidance   - what the model looks for (the core instruction)
//   anchors    - what a 1, 3, and 5 look like (drives consistent scoring)
//   policy_ref - the company standard the agent is held to (criteria grounding)
//   required   - must-say / must-do elements the model verifies
// anchors/policy_ref/required are optional; the model ignores empty ones.
export const DEFAULT_RUBRIC_ITEMS = [
  { key: 'beginning_greeting', section: 'call_process', position: 0,
    label: 'Branded greeting & self-intro',
    guidance: 'Did they open with a proper branded greeting and give their name? For example, "Thank you for calling Meridian Moving and Storage, this is ___."',
    anchors: '5: Opens with the full branded greeting and their name right away. 3: Greets warmly but misses either the company name or their own name. 1: No greeting, or jumps in without identifying the company or themselves.',
    policy_ref: 'Meridian standard: every inbound call opens with "Thank you for calling Meridian Moving and Storage, this is [name]."',
    required: 'Company name "Meridian Moving and Storage"; the agent\'s own name' },
  { key: 'beginning_offer', section: 'soft_skills', position: 0,
    label: 'Offer to help & set the tone',
    guidance: 'Did they ask how they can help and set a warm, professional tone from the first moment?',
    anchors: '5: Warmly invites the customer to share what they need and sets a confident, friendly tone. 3: Offers to help but flatly or transactionally. 1: No offer to help; cold or rushed open.',
    policy_ref: 'Meridian standard: after the greeting, invite the customer to explain what they need before launching into questions.',
    required: 'An open invitation to help (e.g. "How can I help you today?")' },
  { key: 'gathering_details', section: 'call_process', position: 1,
    label: 'Move details',
    guidance: 'Did they collect the move details the reservation needs - where from and to, the date, the load size - by asking good questions and confirming understanding?',
    anchors: '5: Collects and confirms all core details (origin, destination, date, load size) with good questions. 3: Gets most details but leaves a gap or never confirms. 1: Quotes or books without establishing the basic move details.',
    policy_ref: 'Meridian standard: a reservation requires origin, destination, pickup date, and load/home size before a quote.',
    required: 'Origin; destination; pickup date; load or home size' },
  { key: 'gathering_equipment', section: 'call_process', position: 2,
    label: 'Equipment match',
    guidance: 'Did they recommend the right truck size for the move and present the rate and options clearly?',
    anchors: '5: Recommends the right truck for the load and presents the rate and options clearly. 3: Suggests a truck vaguely or without tying it to the load. 1: Wrong-size recommendation, or no clear rate given.',
    policy_ref: 'Meridian standard: match truck size to the home/load size and present the rate before asking to book. Fleet: 10\', 15\', 20\', 26\'.',
    required: 'A specific truck size; the rate' },
  { key: 'scheduling_location', section: 'call_process', position: 3,
    label: 'Pickup location',
    guidance: 'Did they select or confirm the right pickup branch for the customer?',
    anchors: '5: Confirms a specific pickup branch the customer can reach. 3: Mentions a location but does not confirm it works for them. 1: No pickup location established.',
    policy_ref: 'Meridian standard: confirm a real pickup branch and that the customer can get to it.',
    required: 'A named pickup location' },
  { key: 'scheduling_time', section: 'call_process', position: 4,
    label: 'Pickup time',
    guidance: 'Did they lock in a firm pickup date and time?',
    anchors: '5: Locks a firm pickup date AND time. 3: Gets a date but leaves the time loose. 1: No firm pickup time.',
    policy_ref: 'Meridian standard: every reservation carries a firm pickup date and time.',
    required: 'A firm date; a firm time' },
  { key: 'wrap_readback', section: 'call_process', position: 5,
    label: 'Read-back & confirmation',
    guidance: 'Did they read back and confirm the reservation details, including the confirmation number?',
    anchors: '5: Reads back the full reservation (truck, dates, location, total) and gives the confirmation number. 3: Confirms some details but skips the read-back or the confirmation number. 1: Ends without confirming the reservation.',
    policy_ref: 'Meridian standard: always read back the reservation and provide the confirmation number before closing.',
    required: 'Read-back of the details; the confirmation number' },
  { key: 'wrap_close', section: 'soft_skills', position: 3,
    label: 'Professional close',
    guidance: 'Did they cover next steps, ask if there is anything else, and close the call courteously?',
    anchors: '5: Covers next steps, asks "anything else," and closes courteously. 3: Closes politely but skips next steps or the "anything else." 1: Abrupt or no real close.',
    policy_ref: 'Meridian standard: close by confirming next steps, asking if there is anything else, and thanking the customer.',
    required: 'Next steps; "anything else?"; a courteous sign-off' },
  { key: 'general_objections', section: 'soft_skills', position: 1,
    label: 'Overcoming objections',
    guidance: 'Did they handle objections (price, competitor, hesitation, "let me think about it" or "I need to ask my spouse") in the moment and land the booking on this call?',
    anchors: '5: Acknowledges the objection, resolves it in the moment (e.g. removes the risk of committing now, builds genuine urgency, reassures the worry), and closes the reservation on this call. 3: Acknowledges but does not resolve it, or lets the customer defer to "later" without trying to close now. 1: Ignores it, argues, caves, or actively defers the sale (offers a callback, tells them to think about it).',
    policy_ref: 'Meridian standard: the goal of a sales call is to overcome objections and complete the reservation on THIS call. Resolve hesitation in the moment by reinforcing value and removing risk (reservations are free to cancel or change), never by scheduling a callback, getting a third party on the line, or telling the customer to call back later.',
    required: 'Acknowledge the objection; resolve it in the moment; ask for and move to lock the booking on this call' },
  { key: 'general_advisories', section: 'call_process', position: 6,
    label: 'Reading advisories',
    guidance: 'Did they read or cover the required advisories, notices, and disclosures when they applied?',
    anchors: '5: Reads or covers every required advisory/disclosure that applied. 3: Covers some but misses one that applied. 1: Skips required advisories entirely.',
    policy_ref: 'Meridian standard: required advisories/disclosures (coverage options, mileage and fuel policy, age/license requirements) must be covered when applicable.',
    required: 'Coverage/insurance advisory; mileage & fuel policy; any disclosure the scenario calls for' },
  { key: 'general_upsell', section: 'soft_skills', position: 2,
    label: 'Upsell opportunities',
    guidance: 'Did they catch upsell opportunities (storage, furniture pads, a dolly, coverage) when the moment came up?',
    anchors: '5: Surfaces a genuinely relevant add-on at the right moment. 3: Mentions an add-on but mistimed or generic. 1: Misses obvious upsell moments, or pushes irrelevant add-ons.',
    policy_ref: 'Meridian standard: offer add-ons that fit the move (furniture pads, dolly, storage, coverage); never pressure or oversell.',
    required: 'At least one relevant, well-timed add-on offer' },
  { key: 'general_policy', section: 'call_process', position: 7,
    label: 'Policy & accuracy',
    guidance: "Did they stay accurate to Meridian's stated policies and avoid promising things outside them?",
    anchors: '5: Everything stated is accurate to Meridian policy with no out-of-policy promises. 3: Mostly accurate with a minor misstatement. 1: Promises or states something outside Meridian policy.',
    policy_ref: 'Meridian standard: never promise rates, availability, or terms outside published policy; when unsure, say you will confirm rather than guess.',
    required: 'Accurate rates/terms; no out-of-policy promises' },
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

Stay within Meridian policy when you coach. Every suggestion must be something a Meridian agent can actually do on the call. The objective of a sales call is to overcome the customer's objections and complete the reservation on THIS call. Do NOT praise or recommend deferring the sale: never suggest scheduling a callback, offering to get a spouse or third party on the line, telling the customer to think about it and call back, or any path that puts the booking off to a later time. Those are the outcome to avoid, not coaching advice. When a customer hesitates or wants to check with someone else, the agent's job is to resolve it in the moment, typically by removing the risk of committing now (Meridian reservations are free to cancel or change, so booking now holds the truck and rate without locking the customer in), building genuine urgency around the customer's real deadline, reassuring their specific worry, and clearly asking for the booking. Frame growth areas around landing the reservation on this call, not around following up later.

Hold etiquette: if at any point the agent places the caller on hold (or steps away / goes quiet to look something up), they should ASK the caller's permission first ("May I place you on a brief hold?"), wait for a yes, keep it short, and thank the caller when they return. Reward this when done well; if the agent holds or goes silent without asking, or leaves the caller hanging, note it as a growth area under the most relevant item (professionalism / wrap up).

Scoring rubric. For each item below, FIRST decide whether it actually applied to this call (see the applicability rule in the closing instructions), then score the ones that applied from 1 to 5. Submit an entry for every item; mark the ones that did not apply as not applicable instead of scoring them.`;

const PROMPT_TAIL = `Applicability (apply only the relevant parts):
- For EACH item, decide first whether it actually applied to THIS call. If the situation genuinely never arose, or the item could not apply given the context (for example: personalizing the greeting with the customer's name on a brand-new inbound call where you do not yet have their name; a returning-customer step on a first-time caller; an advisory or add-on that simply did not fit this move), set "applicable" to false, briefly note in the evidence why it did not apply, and do not score it. Not-applicable items are excluded from scoring and never count against the agent.
- Only mark an item not applicable when it TRULY did not apply. If the moment did arise and the agent handled it poorly, skipped a required step, or rushed past it, that is a LOW score, not "not applicable." Do not use "not applicable" to excuse a real miss.
- Base overall_score only on the items that applied.

Style rules:
- Do not use em dashes anywhere in your output. Use commas, periods, or restart sentences.
- Evidence is best as a short verbatim quote in double quotes. If no quote fits, paraphrase in one sentence.
- Suggestions are single sentences, not paragraphs.
- overall_score is on a 1.0 to 5.0 scale and may be a decimal. Round to one decimal place.

Submit the report by calling the submit_coaching_report tool exactly once.`;

const SCORE_ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    applicable: {
      type: 'boolean',
      description: 'Whether this item actually applied to THIS call. Set false ONLY when the situation genuinely never arose or could not apply given the context (for example: personalizing a greeting with the customer\'s name on a brand-new inbound call where the name is not yet known; a returning-customer step on a first-time caller; an advisory or disclosure that did not apply to this move). Do NOT set false just because the agent skipped or fumbled something they SHOULD have done — that is a low score, not Not Applicable. When false, the item is marked Not Applicable and excluded from scoring; it never counts against the agent.',
    },
    score: {
      type: 'integer',
      minimum: 1,
      maximum: 5,
      description: 'Score from 1 to 5. Ignored when applicable is false.',
    },
    evidence: {
      type: 'string',
      description: 'A short verbatim quote from the transcript (in double quotes) or a one-sentence paraphrase. When applicable is false, briefly state why this item did not apply to this call.',
    },
    suggestion: {
      type: 'string',
      description: 'One concrete sentence describing what to try differently next time for this item. May be empty when applicable is false.',
    },
  },
  required: ['applicable', 'score', 'evidence', 'suggestion'],
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

  // Resilience guard: an item whose section is not one of the current section
  // keys (e.g. a row still on an OLD section key because /api/coach read D1
  // before the admin-side migration fired) must never be orphaned. Remap it to
  // the default item's section by key, falling back to call_process.
  const VALID = new Set(RUBRIC_SECTIONS.map((s) => s.key));
  const DEFAULT_SECTION_BY_KEY = Object.fromEntries(DEFAULT_RUBRIC_ITEMS.map((d) => [d.key, d.section]));
  items = items.map((it) => VALID.has(it.section) ? it : { ...it, section: DEFAULT_SECTION_BY_KEY[it.key] || 'call_process' });

  // System prompt: regenerate the rubric block from the items.
  const bySection = new Map();
  for (const it of items) {
    if (!bySection.has(it.section)) bySection.set(it.section, []);
    bySection.get(it.section).push(it);
  }
  const oneLine = (v) => String(v == null ? '' : v).replace(/\s*\n\s*/g, '; ').trim();
  const itemBlock = (it) => {
    const lines = [`- ${it.key} (${it.label}): ${oneLine(it.guidance)}`];
    if (oneLine(it.anchors)) lines.push(`    Score guide: ${oneLine(it.anchors)}`);
    if (oneLine(it.required)) lines.push(`    Required (note any missing in the evidence): ${oneLine(it.required)}`);
    if (oneLine(it.policy_ref)) lines.push(`    Company policy to hold them to: ${oneLine(it.policy_ref)}`);
    return lines.join('\n');
  };
  const blocks = [];
  for (const s of RUBRIC_SECTIONS) {
    const list = bySection.get(s.key);
    if (!list || !list.length) continue;
    blocks.push(`${s.label}:\n${list.map(itemBlock).join('\n')}`);
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
          description: 'Overall call score from 1.0 to 5.0, rounded to one decimal. Average only the items that applied to this call; exclude any item marked not applicable.',
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
