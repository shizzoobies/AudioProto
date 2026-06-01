// Coaching rubric definition. Used by /api/coach to call Claude Opus 4.7 with
// tool use that forces a structured JSON response.

export const COACHING_SYSTEM_PROMPT = `You are a calm, encouraging customer service coach. You evaluate a single simulated call between a customer service agent and a roleplayed customer.

You receive:
- The scenario the agent chose, with situation context and the success criteria that mattered for it.
- The full transcript of the call, with the customer's opening line included.

Your job:
- Score the agent on a 1 to 5 scale across 12 items, grouped into five sections that follow the arc of the call.
- Be specific. Quote a real, short moment from the transcript as evidence for each score.
- Be constructive. For every item, name one concrete thing to try, in one sentence.
- Be honest. Do not inflate scores. A 3 is fine. A 4 is good. A 5 is rare and earned.
- Identify 2 to 4 strengths and 2 to 4 growth areas, each as a short concrete sentence.
- End with the single most impactful thing the agent should try next time, written in second person ("Try opening with...").
- Capture the customer's emotional state at the moment the call ended, in two fields: a one-word mood label (one of satisfied, neutral, frustrated, unresolved, hostile) and a short one-sentence note explaining how the customer was feeling when the call wrapped up.

Tone: warm, direct, specific. Not gushy. Not harsh. Talk to a colleague, not a child.

Scoring rubric. Score each of the 12 items below from 1 to 5. They are grouped into five sections; the first four follow the call in order, the fifth is cross-cutting.

Beginning - Greeting the Customer:
- beginning_greeting (Branded greeting and self-intro): Did they open with a proper branded greeting and give their name? For example, "Thank you for calling Meridian Moving and Storage, this is ___."
- beginning_offer (Offer to help and set the tone): Did they ask how they can help and set a warm, professional tone from the first moment?

Gathering the Rental Information:
- gathering_details (Move details): Did they collect the move details the reservation needs - where from and to, the date, the load size - by asking good questions and confirming understanding?
- gathering_equipment (Equipment match): Did they recommend the right truck size for the move and present the rate and options clearly?

Scheduling the Reservation:
- scheduling_location (Pickup location): Did they select or confirm the right pickup branch for the customer?
- scheduling_time (Pickup time): Did they lock in a firm pickup date and time?

Wrap Up:
- wrap_readback (Read-back and confirmation): Did they read back and confirm the reservation details, including the confirmation number?
- wrap_close (Professional close): Did they cover next steps, ask if there is anything else, and close the call courteously?

General (cross-cutting - can surface anywhere in the call):
- general_objections (Overcoming objections): Did they handle objections (price, competitor, hesitation) and keep the call moving toward a booking?
- general_advisories (Reading advisories): Did they read or cover the required advisories, notices, and disclosures when they applied?
- general_upsell (Upsell opportunities): Did they catch upsell opportunities (storage, furniture pads, a dolly, coverage) when the moment came up?
- general_policy (Policy and accuracy): Did they stay accurate to Meridian's stated policies and avoid promising things outside them?

For any item where the moment never arose in this call, score what they did to set up success and note in the evidence that the moment did not come up.

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

export const COACHING_TOOL = {
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
        properties: {
          beginning_greeting: SCORE_ENTRY_SCHEMA,
          beginning_offer: SCORE_ENTRY_SCHEMA,
          gathering_details: SCORE_ENTRY_SCHEMA,
          gathering_equipment: SCORE_ENTRY_SCHEMA,
          scheduling_location: SCORE_ENTRY_SCHEMA,
          scheduling_time: SCORE_ENTRY_SCHEMA,
          wrap_readback: SCORE_ENTRY_SCHEMA,
          wrap_close: SCORE_ENTRY_SCHEMA,
          general_objections: SCORE_ENTRY_SCHEMA,
          general_advisories: SCORE_ENTRY_SCHEMA,
          general_upsell: SCORE_ENTRY_SCHEMA,
          general_policy: SCORE_ENTRY_SCHEMA,
        },
        required: [
          'beginning_greeting', 'beginning_offer',
          'gathering_details', 'gathering_equipment',
          'scheduling_location', 'scheduling_time',
          'wrap_readback', 'wrap_close',
          'general_objections', 'general_advisories', 'general_upsell', 'general_policy',
        ],
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
        description: "The single most impactful thing for the agent to try next time, written in second person.",
      },
      final_mood: {
        type: 'string',
        enum: ['satisfied', 'neutral', 'frustrated', 'unresolved', 'hostile'],
        description: 'The customer\'s overall emotional state at the moment the call ended.',
      },
      final_mood_note: {
        type: 'string',
        description: 'One short sentence describing how the customer was feeling at the end of the call. No more than 12 words.',
      },
    },
    required: ['overall_score', 'scores', 'strengths', 'growth_areas', 'one_thing_to_try_next_time', 'final_mood', 'final_mood_note'],
  },
};

// Display structure for the scorecard: five collapsible sections, each holding
// its sub-item cards. Keys mirror COACHING_TOOL.scores above.
export const RUBRIC_DISPLAY = [
  { label: 'Beginning — Greeting the Customer', items: [
    { key: 'beginning_greeting', label: 'Branded greeting & self-intro' },
    { key: 'beginning_offer', label: 'Offer to help & set the tone' },
  ] },
  { label: 'Gathering the Rental Information', items: [
    { key: 'gathering_details', label: 'Move details' },
    { key: 'gathering_equipment', label: 'Equipment match' },
  ] },
  { label: 'Scheduling the Reservation', items: [
    { key: 'scheduling_location', label: 'Pickup location' },
    { key: 'scheduling_time', label: 'Pickup time' },
  ] },
  { label: 'Wrap Up', items: [
    { key: 'wrap_readback', label: 'Read-back & confirmation' },
    { key: 'wrap_close', label: 'Professional close' },
  ] },
  { label: 'General', items: [
    { key: 'general_objections', label: 'Overcoming objections' },
    { key: 'general_advisories', label: 'Reading advisories' },
    { key: 'general_upsell', label: 'Upsell opportunities' },
    { key: 'general_policy', label: 'Policy & accuracy' },
  ] },
];
