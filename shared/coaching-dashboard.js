// The fixed 3-week / 8-section "coaching dashboard" course skeleton (Phase 1).
// Content is data-driven (the agent profile + the Development-Plan fields), but
// the SECTION STRUCTURE is fixed: this module is the single source of truth for
// the section order, week/stage mapping, and the seed Development-Plan fields.
//
// It is intentionally PURE: no Date, no randomness, no IO. The dashboard
// endpoints import these constants; shared/dashboard-store.js seeds
// dashboard_fields from DEFAULT_DASHBOARD_FIELDS the first time it runs.

// Highest stage number; a non-cohort (ad-hoc) manager gets MAX_STAGE so the
// whole journey is unlocked. Cohort members get their cohort's unlocked_stage.
export const MAX_STAGE = 5;

// The fixed 3-week / 8-section course skeleton. Content is data-driven; structure is fixed.
export const DASHBOARD_SECTIONS = [
  { key: 'incident',   week: 1, stage: 1, type: 'incident',   title: 'A Recent Incident' },
  { key: 'devplan1',   week: 1, stage: 1, type: 'form',       title: 'Development Plan: Part 1', section_key: 'devplan1' },
  { key: 'assessment', week: 1, stage: 1, type: 'call',       title: 'Assessing the Agent', mode: 'assessment' },
  { key: 'devplan2',   week: 1, stage: 2, type: 'form',       title: 'Development Plan: Part 2', section_key: 'devplan2' },
  { key: 'coaching',   week: 2, stage: 3, type: 'call',       title: 'Coaching', mode: 'coaching' },
  { key: 'devplan3',   week: 2, stage: 3, type: 'form',       title: 'Development Plan: Part 3', section_key: 'devplan3' },
  { key: 'followup',   week: 3, stage: 4, type: 'call',       title: 'Follow-up', mode: 'followup' },
  { key: 'activities', week: 3, stage: 5, type: 'activities', title: 'Follow-Up Activities' },
];

// The three call modes (mirror COACHING_AGENT_MODES); used to validate the mode
// on dashboard_calls writes and the recording proxy.
export const CALL_MODES = ['assessment', 'coaching', 'followup'];

// The unlock stage required for a given call mode (assessment=1, coaching=3,
// followup=4). Used to enforce the dashboard gate on the SERVER so a locked call
// cannot be started regardless of the client path. Unknown mode -> stage 1.
export function stageForMode(mode) {
  const s = DASHBOARD_SECTIONS.find((x) => x.type === 'call' && x.mode === mode);
  return s ? s.stage : 1;
}

// Default Development-Plan fields (the admin can later edit these; this is the seed).
// Each: { section_key, label, type:'textarea', position }
export const DEFAULT_DASHBOARD_FIELDS = [
  { section_key:'devplan1', label:'What skill gaps do you suspect from the incident?', type:'textarea', position:0 },
  { section_key:'devplan1', label:'How will you diagnose the skill gap on the assessment call?', type:'textarea', position:1 },
  { section_key:'devplan2', label:'Skill gaps you diagnosed: list and prioritize them', type:'textarea', position:0 },
  { section_key:'devplan2', label:'Your plan to address the top gap in ~15 minutes', type:'textarea', position:1 },
  { section_key:'devplan2', label:"Account for the agent's personal quirks", type:'textarea', position:2 },
  { section_key:'devplan3', label:'What you addressed and how receptive the agent was', type:'textarea', position:0 },
  { section_key:'devplan3', label:'How you expect them to move forward (were you clear about it?)', type:'textarea', position:1 },
  { section_key:'devplan3', label:'Your plan for follow-up', type:'textarea', position:2 },
  { section_key:'devplan3', label:'Any other notes', type:'textarea', position:3 },
];
