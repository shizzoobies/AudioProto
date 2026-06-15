// The fixed "Development by Design" course skeleton (5 weeks + a Final
// real-world case study). Content is data-driven (the agent profile + the
// editable form fields), but the SECTION STRUCTURE is fixed: this module is the
// single source of truth for the section order, week/stage mapping, and the seed
// form fields.
//
// It is intentionally PURE: no Date, no randomness, no IO. The dashboard
// endpoints import these constants; shared/dashboard-store.js seeds
// dashboard_fields from DEFAULT_DASHBOARD_FIELDS (and re-seeds on SEED_VERSION
// bumps).

// Highest stage number = one per week plus the Final assignment (W1..W5 = 1..5,
// Final = 6). A non-cohort (ad-hoc) manager gets MAX_STAGE so the whole journey
// is unlocked; cohort members get their cohort's unlocked_stage. Advancing a
// cohort by one stage unlocks exactly one week.
export const MAX_STAGE = 6;

// Bump this whenever DEFAULT_DASHBOARD_FIELDS or the section_keys change. On a
// bump, dashboard-store wipes + re-seeds the form fields (and clears stale
// answers / resets cohort stages) exactly once, so a redesign rolls out cleanly
// without a manual migration. v1 = the original 3-week skeleton; v2 = this
// 5-week + Final "Development by Design" course.
export const SEED_VERSION = 2;

// Friendly heading for each week / the Final group, used by the participant
// dashboard and the admin field editor.
export const WEEK_TITLES = {
  1: 'Week 1 · Intentional Development',
  2: 'Week 2 · Diagnosis',
  3: 'Week 3 · Strategy for Growth',
  4: 'Week 4 · The Performance Conversation',
  5: 'Week 5 · Follow-Up & Reinforcement',
  6: 'Final · Real-World Case Study',
};

// The fixed course skeleton. Content is data-driven; structure is fixed.
// week 6 is the Final assignment group (final:true). One stage per week.
export const DASHBOARD_SECTIONS = [
  // Week 1 — Intentional Development: meet the agent (assessment call) FIRST,
  // then a single diagnosis form. The incident folds into the agent profile.
  { key: 'assessment',      week: 1, stage: 1, type: 'call', title: 'Meet & Assess the Agent', mode: 'assessment' },
  { key: 'diagnosis',       week: 1, stage: 1, type: 'form', title: 'Diagnosis', section_key: 'diagnosis' },

  // Week 2 — Diagnosis: the development plan (no call).
  { key: 'devplan',         week: 2, stage: 2, type: 'form', title: 'Development Plan', section_key: 'devplan' },

  // Week 3 — Strategy for Growth: prepare for the coaching call (no call).
  { key: 'callprep',        week: 3, stage: 3, type: 'form', title: 'Prepare for the Coaching Call', section_key: 'callprep' },

  // Week 4 — The Performance Conversation: the coaching call, then the follow-up plan.
  { key: 'coaching',        week: 4, stage: 4, type: 'call', title: 'The Coaching Conversation', mode: 'coaching' },
  { key: 'followupplan',    week: 4, stage: 4, type: 'form', title: 'Follow-Up Plan', section_key: 'followupplan' },

  // Week 5 — Follow-Up & Reinforcement: prepare the real-world case study (no call).
  { key: 'casestudyprep',   week: 5, stage: 5, type: 'form', title: 'Preparing Your Real-World Case Study', section_key: 'casestudyprep' },

  // Final — Real-World Case Study: the Development by Design process applied to a
  // real team member, organized into six parts.
  { key: 'cs_diagnosis',     week: 6, stage: 6, type: 'form', title: 'Diagnosis', section_key: 'cs_diagnosis', final: true },
  { key: 'cs_devplan',       week: 6, stage: 6, type: 'form', title: 'Development Plan', section_key: 'cs_devplan', final: true },
  { key: 'cs_perfconvo',     week: 6, stage: 6, type: 'form', title: 'Performance Conversation', section_key: 'cs_perfconvo', final: true },
  { key: 'cs_followup',      week: 6, stage: 6, type: 'form', title: 'Follow-Up Strategy', section_key: 'cs_followup', final: true },
  { key: 'cs_documentation', week: 6, stage: 6, type: 'form', title: 'Documentation', section_key: 'cs_documentation', final: true },
  { key: 'cs_playbook',      week: 6, stage: 6, type: 'form', title: 'Personal Playbook', section_key: 'cs_playbook', final: true },
];

// The call modes the recording proxy / authoring validate against. The course
// only uses assessment + coaching now, but 'followup' stays valid so authored
// scenarios may still enable a follow-up call and its saved memory keeps working.
export const CALL_MODES = ['assessment', 'coaching', 'followup'];

// The unlock stage required for a given call mode (assessment=1, coaching=4).
// Used to ENFORCE the dashboard gate on the SERVER so a locked call cannot be
// started regardless of the client path. Unknown mode -> stage 1.
export function stageForMode(mode) {
  const s = DASHBOARD_SECTIONS.find((x) => x.type === 'call' && x.mode === mode);
  return s ? s.stage : 1;
}

// Default form fields (the admin can edit these live; this is the seed). Each:
// { section_key, label, type:'textarea', position }. Week 1 diagnosis + Week 5
// prep fields are intentionally generic starting points (the exact questions are
// still being finalized) and are meant to be edited in the admin.
export const DEFAULT_DASHBOARD_FIELDS = [
  // Week 1 — Diagnosis (after the assessment call).
  { section_key: 'diagnosis', label: 'What did you observe about the agent during the assessment call?', type: 'textarea', position: 0 },
  { section_key: 'diagnosis', label: 'What skill gap(s) do you suspect, and what is your evidence?', type: 'textarea', position: 1 },
  { section_key: 'diagnosis', label: 'What additional information would help you pin down the root cause?', type: 'textarea', position: 2 },

  // Week 2 — Development Plan.
  { section_key: 'devplan', label: 'What is your proposed development strategy for this agent?', type: 'textarea', position: 0 },
  { section_key: 'devplan', label: 'What is the rationale behind this strategy?', type: 'textarea', position: 1 },

  // Week 3 — Prepare for the Coaching Call.
  { section_key: 'callprep', label: 'What are the key points you need to address on the coaching call?', type: 'textarea', position: 0 },
  { section_key: 'callprep', label: 'How will you open the call?', type: 'textarea', position: 1 },
  { section_key: 'callprep', label: 'What about this agent might affect your approach (personality, quirks, sensitivities)?', type: 'textarea', position: 2 },
  { section_key: 'callprep', label: 'What is the skill gap, and what is its root cause?', type: 'textarea', position: 3 },

  // Week 4 — Follow-Up Plan (after the coaching call).
  { section_key: 'followupplan', label: 'How will you measure the agent’s improvement?', type: 'textarea', position: 0 },
  { section_key: 'followupplan', label: 'When will you check in with the agent again?', type: 'textarea', position: 1 },
  { section_key: 'followupplan', label: 'What other skill gaps will you address once this one improves?', type: 'textarea', position: 2 },

  // Week 5 — Preparing Your Real-World Case Study.
  { section_key: 'casestudyprep', label: 'Which of your real team members will you apply the process with?', type: 'textarea', position: 0 },
  { section_key: 'casestudyprep', label: 'What performance issue or growth opportunity will you focus on?', type: 'textarea', position: 1 },
  { section_key: 'casestudyprep', label: 'What do you already know about the situation going in?', type: 'textarea', position: 2 },

  // Final — Real-World Case Study (six parts).
  { section_key: 'cs_diagnosis', label: 'Diagnosis: what is the skill gap and its root cause for your team member?', type: 'textarea', position: 0 },
  { section_key: 'cs_devplan', label: 'Development plan: your strategy and the rationale behind it.', type: 'textarea', position: 0 },
  { section_key: 'cs_perfconvo', label: 'Performance conversation: how did it go? Key points raised and how they reacted.', type: 'textarea', position: 0 },
  { section_key: 'cs_followup', label: 'Follow-up strategy: how and when will you measure and reinforce improvement?', type: 'textarea', position: 0 },
  { section_key: 'cs_documentation', label: 'Documentation: how are you recording progress and outcomes?', type: 'textarea', position: 0 },
  { section_key: 'cs_playbook', label: 'Personal playbook: what did you learn that you will reuse with future team members?', type: 'textarea', position: 0 },
];
