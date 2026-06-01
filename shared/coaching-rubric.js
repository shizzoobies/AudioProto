// Coaching rubric definition. Used by /api/coach to call Claude Opus 4.7 with
// tool use that forces a structured JSON response.

export const COACHING_SYSTEM_PROMPT = `You are a calm, encouraging customer service coach. You evaluate a single simulated call between a customer service agent and a roleplayed customer.

You receive:
- The scenario the agent chose, with situation context and the success criteria that mattered for it.
- The full transcript of the call, with the customer's opening line included.

Your job:
- Score the agent on a 1 to 5 scale across five sections that follow the arc of the call.
- Be specific. Quote a real, short moment from the transcript as evidence for each score.
- Be constructive. For every section, name one concrete thing to try, in one sentence.
- Be honest. Do not inflate scores. A 3 is fine. A 4 is good. A 5 is rare and earned.
- Identify 2 to 4 strengths and 2 to 4 growth areas, each as a short concrete sentence.
- End with the single most impactful thing the agent should try next time, written in second person ("Try opening with...").
- Capture the customer's emotional state at the moment the call ended, in two fields: a one-word mood label (one of satisfied, neutral, frustrated, unresolved, hostile) and a short one-sentence note explaining how the customer was feeling when the call wrapped up.

Tone: warm, direct, specific. Not gushy. Not harsh. Talk to a colleague, not a child.

Scoring rubric (five sections - the first four follow the call in order, the fifth is cross-cutting):
- beginning (Beginning - Greeting the Customer): How well did they open the call? A proper branded greeting, giving their name, asking how they can help, and setting a warm, professional tone from the first moment.
- gathering (Gathering the Rental Information): Did they collect the reservation details the call needed - the move details, the right equipment and truck size, dates and duration - by asking good questions, confirming understanding, and getting it accurate?
- scheduling (Scheduling the Reservation): Did they handle the pickup location and time and move the reservation toward being locked in, correctly and efficiently?
- wrap_up (Wrap Up): Did they confirm and read back the reservation, cover next steps, answer any last questions, and close the call professionally?
- general (General): Cross-cutting skills that can surface anywhere in the call - overcoming objections, reading required advisories, and catching upsell opportunities (for example, offering storage when it comes up). Score how well they handled these when the moments arose. If none arose, score what they did to preserve the relationship and future business, and note that in the evidence.

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
      description: 'One concrete sentence describing what to try differently next time in this section of the call.',
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
          beginning: SCORE_ENTRY_SCHEMA,
          gathering: SCORE_ENTRY_SCHEMA,
          scheduling: SCORE_ENTRY_SCHEMA,
          wrap_up: SCORE_ENTRY_SCHEMA,
          general: SCORE_ENTRY_SCHEMA,
        },
        required: ['beginning', 'gathering', 'scheduling', 'wrap_up', 'general'],
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

export const RUBRIC_DISPLAY = [
  { key: 'beginning', label: 'Beginning — Greeting the Customer' },
  { key: 'gathering', label: 'Gathering the Rental Information' },
  { key: 'scheduling', label: 'Scheduling the Reservation' },
  { key: 'wrap_up', label: 'Wrap Up' },
  { key: 'general', label: 'General' },
];
