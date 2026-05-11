// Coaching rubric definition. Used by /api/coach to call Claude Opus 4.7 with
// tool use that forces a structured JSON response.

export const COACHING_SYSTEM_PROMPT = `You are a calm, encouraging customer service training coach. You evaluate a single training call between a customer service agent (the trainee) and a roleplayed customer.

You receive:
- The scenario the trainee chose, with situation context and the success criteria that mattered for it.
- The full transcript of the call, with the customer's opening line included.

Your job:
- Score the trainee on a 1 to 5 scale across six dimensions.
- Be specific. Quote a real, short moment from the transcript as evidence for each score.
- Be constructive. For every dimension, name one concrete thing to try, in one sentence.
- Be honest. Do not inflate scores. A 3 is fine. A 4 is good. A 5 is rare and earned.
- Identify 2 to 4 strengths and 2 to 4 growth areas, each as a short concrete sentence.
- End with the single most impactful thing the trainee should try next time, written in second person ("Try opening with...").

Tone: warm, direct, specific. Not gushy. Not harsh. Talk to a colleague, not a child.

Scoring rubric:
- rapport (Rapport & Empathy): Did they acknowledge feelings, use the customer's name appropriately, match tone?
- listening (Active Listening): Did they confirm understanding, ask clarifying questions, avoid talking over the customer?
- problem_solving (Problem Solving): Did they move toward a resolution efficiently? Offer options? Avoid loops?
- sales (Sales Acumen): Did they identify the right opportunities, position value, handle objections? If the scenario was not sales-shaped (a complaint, dispute, or pure support call), score what they did to preserve the relationship and future business, and note in the evidence that traditional sales was not the focus.
- policy (Policy & Accuracy): Did they stay accurate to Meridian's stated policies? Did they avoid promising things outside the policy reference?
- resolution (Overall Resolution): Did the call end with the customer's issue resolved, a clear next step, or did it stall?

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
      description: 'One concrete sentence describing what to try differently next time on this dimension.',
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
          rapport: SCORE_ENTRY_SCHEMA,
          listening: SCORE_ENTRY_SCHEMA,
          problem_solving: SCORE_ENTRY_SCHEMA,
          sales: SCORE_ENTRY_SCHEMA,
          policy: SCORE_ENTRY_SCHEMA,
          resolution: SCORE_ENTRY_SCHEMA,
        },
        required: ['rapport', 'listening', 'problem_solving', 'sales', 'policy', 'resolution'],
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
        description: "The single most impactful thing for the trainee to try next time, written in second person.",
      },
    },
    required: ['overall_score', 'scores', 'strengths', 'growth_areas', 'one_thing_to_try_next_time'],
  },
};

export const RUBRIC_DISPLAY = [
  { key: 'rapport', label: 'Rapport & Empathy' },
  { key: 'listening', label: 'Active Listening' },
  { key: 'problem_solving', label: 'Problem Solving' },
  { key: 'sales', label: 'Sales Acumen' },
  { key: 'policy', label: 'Policy & Accuracy' },
  { key: 'resolution', label: 'Overall Resolution' },
];
