// The fixed "Development by Design" course skeleton, rebuilt to Bobbie's
// framework (Development_by_Design_AI_Dashboard_Framework_Draft): five weeks that
// walk the repeatable process (Define Success -> Assess Capability -> Design the
// Plan -> Prepare & Conduct the Conversation -> Follow Up & Reinforce), a single
// AI "Development Conversation" in Week 4, and a documented Real World Practicum.
//
// The SECTION STRUCTURE is fixed here (order, week/stage mapping, which week holds
// the call). The CONTENT is data-driven and admin-editable: this module seeds the
// narrative blocks (Story / Assignment / Leadership Reflection / Final Prompt) and
// the reflection questions; the admin can then edit any of it live. Stories and
// prompts are token-aware ({{TeamMemberName}} etc.), filled per scenario.
//
// It is intentionally PURE: no Date, no randomness, no IO. The dashboard endpoints
// import these constants; shared/dashboard-store.js seeds dashboard_fields +
// dashboard_blocks from the DEFAULT_* arrays (and re-seeds on a SEED_VERSION bump).

// Highest stage number = one per week (W1..W5 = 1..5) plus the Real World
// Practicum (6). A non-cohort (ad-hoc) manager gets MAX_STAGE so the whole journey
// is unlocked; cohort members get their cohort's unlocked_stage. Advancing a
// cohort by one stage unlocks exactly one week.
export const MAX_STAGE = 6;

// Bump whenever DEFAULT_DASHBOARD_FIELDS / DEFAULT_DASHBOARD_BLOCKS or the
// section_keys change. On a bump, dashboard-store wipes + re-seeds the fields and
// blocks (and clears stale answers / resets cohort stages) exactly once, so a
// redesign rolls out cleanly without a manual migration. v1 = original 3-week
// skeleton; v2 = the 5-week + Final course; v3 = Bobbie's Development by Design
// reframe (this file).
export const SEED_VERSION = 3;

// Friendly heading for each week / the Practicum group, used by the participant
// dashboard and the admin field editor.
export const WEEK_TITLES = {
  1: 'Week 1 · Define Success',
  2: 'Week 2 · Assess Capability',
  3: 'Week 3 · Design the Plan',
  4: 'Week 4 · Prepare & Conduct the Conversation',
  5: 'Week 5 · Follow Up & Reinforce',
  6: 'Real World Practicum',
};

// ---- Tokens ----------------------------------------------------------------
// Per-scenario values woven into the Stories and prompts. TeamMemberName is the
// authored agent's name; the other four are dedicated scenario fields the admin
// fills in the Scenario editor. fillTokens() replaces {{Token}} with the value,
// or a soft fallback so the copy still reads before an admin fills it in.
export const DASHBOARD_TOKENS = [
  'TeamMemberName',
  'OrganizationGoal',
  'BusinessOutcome',
  'PerformanceOpportunity',
  'PerformanceSummary',
];

const TOKEN_FALLBACKS = {
  TeamMemberName: 'your team member',
  OrganizationGoal: 'the organization’s goal',
  BusinessOutcome: 'the desired business outcome',
  PerformanceOpportunity: 'the performance opportunity',
  PerformanceSummary: 'their recent performance',
  Incident: 'the recent incident described in their profile',
};

export function fillTokens(text, values) {
  if (text == null) return '';
  const v = values || {};
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
    const val = v[key];
    if (val != null && String(val).trim() !== '') return String(val);
    return TOKEN_FALLBACKS[key] != null ? TOKEN_FALLBACKS[key] : m;
  });
}

// ---- Section skeleton ------------------------------------------------------
// Each week is one group. A `form` section holds that week's editable questions
// (keyed by section_key) plus its narrative blocks (same section_key). Week 4 is
// split into a prep form (part 1), the call, and a reflection form (part 2). The
// Practicum is a documented, read-only `info` section (built out later).
export const DASHBOARD_SECTIONS = [
  { key: 'w1_define',   week: 1, stage: 1, type: 'form', title: 'Define Success',                 section_key: 'w1_define' },
  { key: 'w2_assess',   week: 2, stage: 2, type: 'form', title: 'Assess Current Capability',      section_key: 'w2_assess' },
  { key: 'w3_design',   week: 3, stage: 3, type: 'form', title: 'Design the Development Plan',     section_key: 'w3_design' },
  { key: 'w4_prepare',  week: 4, stage: 4, type: 'form', title: 'Prepare for the Conversation',   section_key: 'w4_prepare', part: 1 },
  { key: 'w4_conduct',  week: 4, stage: 4, type: 'call', title: 'Development Conversation',        mode: 'coaching' },
  { key: 'w4_reflect',  week: 4, stage: 4, type: 'form', title: 'Reflect on the Conversation',    section_key: 'w4_reflect', part: 2 },
  { key: 'w5_followup', week: 5, stage: 5, type: 'form', title: 'Follow Up & Reinforce',          section_key: 'w5_followup' },
  { key: 'practicum',   week: 6, stage: 6, type: 'info', title: 'Real World Practicum',           section_key: 'practicum', final: true },
];

// Valid call modes for authored scenarios + the recording proxy. The course now
// uses a single 'coaching' call (the Development Conversation in Week 4), but
// 'assessment' / 'followup' stay valid so authored scenarios can still enable and
// record those calls outside the course flow.
export const CALL_MODES = ['assessment', 'coaching', 'followup'];

// The unlock stage required for a call mode, used to ENFORCE the gate server-side
// (a locked call cannot be started regardless of the client path). The course
// call ('coaching') unlocks in Week 4. Unknown mode -> stage 1 (always allowed).
export function stageForMode(mode) {
  const s = DASHBOARD_SECTIONS.find((x) => x.type === 'call' && x.mode === mode);
  return s ? s.stage : 1;
}

// ---- Narrative blocks (admin-editable, token-aware) ------------------------
// One row per (section_key, slot). Slots:
//   story             - the week's narrative framing (top of the week)
//   assignment        - the week's assignment instruction
//   info              - optional supporting info the participant reviews (Week 2
//                       placeholder for Bobbie's "information to review" content)
//   leadership_intro  - the framing line above the Leadership Reflection question
//   final_prompt      - the closing / unlock message that ends the week
//   completion        - the post-course Congratulations message (Week 5)
//   practicum_story   - the Real World Practicum overview
export const DEFAULT_DASHBOARD_BLOCKS = [
  // Week 1 - Define Success
  { section_key: 'w1_define', slot: 'story',
    value: 'Earlier today, you met with your Senior Manager to discuss your team’s performance. Together, you reviewed how your team contributes to the organization’s goal of increasing transactions and ensuring customers have the best experience during their interaction with us.\n\nBased on recent performance data, you agreed your primary focus should be helping {{TeamMemberName}} improve {{BusinessOutcome}}.' },
  { section_key: 'w1_define', slot: 'assignment',
    value: 'Determine what success looks like.' },
  { section_key: 'w1_define', slot: 'leadership_intro',
    value: 'Before you can help someone improve, you have to know what success looks like.' },
  { section_key: 'w1_define', slot: 'final_prompt',
    value: 'Next week you’ll discuss your definition of success before assessing capability.' },

  // Week 2 - Assess Current Capability
  { section_key: 'w2_assess', slot: 'story',
    value: 'Last week, you defined what success looks like for {{TeamMemberName}}. This week, it’s time to better understand where they are today.\n\nYour definition of success has been reviewed. Now your Senior Manager asks: “If success is clearly defined, why isn’t your team member there already?”\n\nBefore creating a development plan, you need to understand your team member’s current capability. Your goal is not to solve the problem yet. Your goal is to gather information, identify patterns, and better understand what may be contributing to the current performance.\n\nAs you review your team member’s information, remember to look at the whole picture. Great managers recognize strengths, identify opportunities, and use evidence to guide their decisions.' },
  { section_key: 'w2_assess', slot: 'assignment',
    value: 'Assess your team member’s current capability. Review the information available to you and document your observations before creating a development plan.' },
  // The information the participant reviews to assess capability (Bobbie’s open
  // "what happened in between time" item). Defaults to the scenario’s performance
  // summary + recent incident (token-filled); admin can edit or replace it once
  // the content is finalized.
  { section_key: 'w2_assess', slot: 'info',
    value: '{{PerformanceSummary}}\n\nA recent incident: {{Incident}}' },
  { section_key: 'w2_assess', slot: 'leadership_intro',
    value: 'Great managers observe before they act.' },
  { section_key: 'w2_assess', slot: 'final_prompt',
    value: 'During next week’s class, you’ll discuss your observations and compare your thinking with your peers. Once you’ve identified what may be contributing to the performance gap, you’ll be ready to intentionally design a development plan that addresses the right opportunity, not just the symptoms.' },

  // Week 3 - Design the Development Plan
  { section_key: 'w3_design', slot: 'story',
    value: 'Over the past week, you reviewed your team member’s performance and identified patterns, recognized strengths, and explored what may be preventing them from consistently achieving the desired business outcome.\n\nNow it’s time to move from observation to action.\n\nUnderstanding the performance gap is important, but understanding alone won’t create improvement. Intentional development requires an intentional plan.\n\nRather than hoping performance improves over time or relying on a single coaching conversation, the goal is to create meaningful opportunities for team members to learn, practice, receive feedback, and build confidence over time.\n\nAs you build your development plan, think beyond what your team member needs to improve. Consider how you’ll help them develop the capability to achieve lasting success.' },
  { section_key: 'w3_design', slot: 'assignment',
    value: 'Design a development plan that intentionally builds your team member’s capability and supports the desired business outcome. Your plan should provide clear direction, meaningful opportunities for development, and a strategy for measuring progress over time.' },
  { section_key: 'w3_design', slot: 'leadership_intro',
    value: 'Intentional development beats reacting to performance.' },
  { section_key: 'w3_design', slot: 'final_prompt',
    value: 'Next week, you’ll shift your focus from planning to execution. You’ll prepare for your development conversation by considering how you’ll communicate your observations, engage your team member in the process, and build commitment to the development plan you’ve created.' },

  // Week 4 - Prepare & Conduct the Development Conversation
  { section_key: 'w4_prepare', slot: 'story',
    value: 'Over the past three weeks, you’ve defined success, assessed your team member’s current capability, and designed a development plan to help them build the skills needed to achieve the desired business outcome.\n\nNow it’s time to bring that plan to life.\n\nA thoughtful development plan is only effective if it’s communicated in a way that builds trust, creates clarity, and encourages ownership. Great managers don’t walk into these conversations hoping they’ll go well, they prepare for them.\n\nBefore meeting with your team member, take time to organize your thoughts, anticipate questions, and consider how you’ll guide the conversation. Once you’re ready, you’ll conduct your development conversation with your simulated team member and then reflect on the experience.' },
  { section_key: 'w4_prepare', slot: 'assignment',
    value: 'Prepare for your development conversation before meeting with your team member. Use the checklist to confirm you are ready, then answer the preparation questions.' },
  { section_key: 'w4_conduct', slot: 'story',
    value: 'You’ve completed your preparation. The next step is to conduct your development conversation with {{TeamMemberName}}. Once the conversation is complete, return to the dashboard to reflect on the experience.' },
  { section_key: 'w4_reflect', slot: 'assignment',
    value: 'Now that the conversation is complete, reflect on how it went.' },
  { section_key: 'w4_reflect', slot: 'final_prompt',
    value: 'You have successfully guided your team member through the first step of their development journey. Next week, you’ll focus on one of the most overlooked but most important responsibilities of a leader: following up, reinforcing progress, and evaluating whether your development efforts are leading to meaningful, lasting improvement.' },

  // Week 5 - Follow Up & Reinforce
  { section_key: 'w5_followup', slot: 'story',
    value: 'Your development conversation with {{TeamMemberName}} is complete, and together you’ve established a clear path forward.\n\nWhile the conversation was an important milestone, lasting development doesn’t happen in a single meeting. Growth occurs over time through consistent follow-up, meaningful feedback, recognition, and opportunities to practice new skills.\n\nAs a manager, your role doesn’t end when the conversation is over. It continues as you observe progress, reinforce positive behaviors, adjust your approach when needed, and support your team member as they work toward the desired business outcome.\n\nThis week, your focus is on creating a follow-up and reinforcement strategy that supports continuous development and long-term success.' },
  { section_key: 'w5_followup', slot: 'assignment',
    value: 'Develop a follow-up and reinforcement strategy that helps your team member continue building capability while making measurable progress toward the desired business outcome. Remember, development isn’t complete when the conversation ends. Effective managers intentionally reinforce learning, monitor progress, and adapt their approach based on what they observe over time.' },
  { section_key: 'w5_followup', slot: 'leadership_intro',
    value: 'Throughout this simulation, you’ve practiced each step of the Development by Design framework: determining the business outcome, defining success, assessing capability, designing a development plan, conducting a development conversation, and following up and reinforcing progress.' },
  { section_key: 'w5_followup', slot: 'completion',
    value: 'Congratulations! You’ve completed the Development by Design Leadership Simulation.\n\nThroughout this experience, you’ve practiced using a repeatable process to intentionally develop a team member, from defining success through reinforcing long-term growth. The simulation provided an opportunity to think critically, make decisions, practice coaching, and reflect on your leadership approach in a safe environment.\n\nThe framework you’ve practiced here is the same framework you’ll now apply with one of your own team members during the practicum. The scenario may change. The business outcome may change. The person may change. The process remains the same.\n\nAs you begin your practicum, remember that intentional development isn’t about fixing people, it’s about helping them build the capability to succeed. Your simulation is complete. Your leadership journey continues.' },

  // Real World Practicum (documented, read-only for now)
  { section_key: 'practicum', slot: 'practicum_story',
    value: 'You’ve completed the AI simulation. Now apply the Development by Design framework with one of your own team members. Aim for at least three check-ins over the course of your real-world practicum.' },
];

// Real World Practicum phases (documented on the dashboard; not built as an
// interactive flow yet, per Bobbie).
export const PRACTICUM_PHASES = [
  'Select Team Member',
  'Define Success',
  'Assess Capability',
  'Design the Plan',
  'Execute the Plan',
  'Follow Up & Reinforce',
];

// ---- Reflection questions (admin-editable seed) ----------------------------
// Each: { section_key, label, type, position, hint?, group?, part? }.
//   type:  'textarea' (default) | 'checklist' | 'yesno'
//   hint:  optional "Consider:" helper bullets (one per line)
//   group: 'leadership' renders the question in the Leadership Reflection block
//   part:  Week 4 only - 1 (prep) or 2 (post-call reflection)
export const DEFAULT_DASHBOARD_FIELDS = [
  // Week 1 - Define Success
  { section_key: 'w1_define', position: 0, label: 'Describe the desired business outcome in your own words.' },
  { section_key: 'w1_define', position: 1, label: 'What would success look like?' },
  { section_key: 'w1_define', position: 2, label: 'What behaviors would you expect?' },
  { section_key: 'w1_define', position: 3, label: 'What habits or routines would support success?' },
  { section_key: 'w1_define', position: 4, label: 'How will you measure success?' },
  { section_key: 'w1_define', position: 5, label: 'How does improving this outcome support the organization’s goal?' },
  { section_key: 'w1_define', position: 6, group: 'leadership', label: 'What is one insight you gained this week about defining success before taking action?' },

  // Week 2 - Assess Current Capability
  { section_key: 'w2_assess', position: 0, label: 'After reviewing the available information, what did you observe about your team member’s overall performance?' },
  { section_key: 'w2_assess', position: 1, label: 'What strengths does your team member demonstrate that you want to continue building on?' },
  { section_key: 'w2_assess', position: 2, label: 'What performance opportunities or challenges did you observe?' },
  { section_key: 'w2_assess', position: 3, label: 'What evidence led you to those conclusions?',
    hint: 'Performance metrics\nCustomer interactions\nQuality observations\nAttendance or reliability\nPrevious coaching\nOther observations' },
  { section_key: 'w2_assess', position: 4, label: 'Based on everything you’ve observed, what capability do you believe your team member needs to develop in order to achieve the desired outcome?' },
  { section_key: 'w2_assess', position: 5, label: 'What additional information would help you better understand the situation before creating a development plan?' },
  { section_key: 'w2_assess', position: 6, group: 'leadership', label: 'What is one insight you gained this week about the importance of observing before taking action?' },

  // Week 3 - Design the Development Plan
  { section_key: 'w3_design', position: 0, label: 'What capability are you trying to improve?' },
  { section_key: 'w3_design', position: 1, label: 'Why did you prioritize this capability?' },
  { section_key: 'w3_design', position: 2, label: 'What combination of development activities will best help your team member build this capability?',
    hint: 'Observation or shadowing\nSide-by-side coaching\nPractice opportunities\nStretch assignments\nResources or job aids\nFeedback sessions\nPeer mentoring\nOther' },
  { section_key: 'w3_design', position: 3, label: 'How often will you meet or coach your team member?' },
  { section_key: 'w3_design', position: 4, label: 'What opportunities will your team member have to practice and apply what they are learning?' },
  { section_key: 'w3_design', position: 5, label: 'How will you reinforce progress and encourage continued development?' },
  { section_key: 'w3_design', position: 6, label: 'How will you measure whether your development plan is working?' },
  { section_key: 'w3_design', position: 7, label: 'What obstacles or challenges could impact your team’s success, and how will you address them?' },
  { section_key: 'w3_design', position: 8, group: 'leadership', label: 'What is one insight you gained this week about the importance of designing development intentionally instead of simply reacting to performance?' },

  // Week 4 Part 1 - Prepare (checklist + questions)
  { section_key: 'w4_prepare', part: 1, position: 0, type: 'checklist', label: 'Preparation checklist',
    hint: 'Reviewed your team member’s performance information and observations.\nReviewed the development plan you created.\nIdentified the key messages you want your team member to understand.\nPrepared questions to better understand your team member’s perspective.\nConsidered how you will gain commitment to the development plan.\nThought about how you will respond if your team member has questions, concerns, or becomes defensive.\nDetermined whether your Senior Agent(s) could help support this development effort.' },
  { section_key: 'w4_prepare', part: 1, position: 1, label: 'How did you prepare for your development conversation?' },
  { section_key: 'w4_prepare', part: 1, position: 2, label: 'What were the two or three most important messages you wanted your team member to leave the conversation understanding?' },
  { section_key: 'w4_prepare', part: 1, position: 3, label: 'What questions did you plan to ask to better understand your team member’s perspective?' },
  { section_key: 'w4_prepare', part: 1, position: 4, type: 'yesno', label: 'Did you involve your Senior Agent(s) in preparing for or supporting this development effort?' },
  { section_key: 'w4_prepare', part: 1, position: 5, label: 'If yes, how did you involve them, and how did their support influence your preparation?' },
  { section_key: 'w4_prepare', part: 1, position: 6, label: 'What concerns or challenges did you anticipate before beginning the conversation?' },

  // Week 4 Part 2 - Reflect on the Conversation
  { section_key: 'w4_reflect', part: 2, position: 0, label: 'How did the conversation go?' },
  { section_key: 'w4_reflect', part: 2, position: 1, label: 'How did your team member respond to the conversation?' },
  { section_key: 'w4_reflect', part: 2, position: 2, label: 'What part of the conversation was most effective?' },
  { section_key: 'w4_reflect', part: 2, position: 3, label: 'What challenges did you encounter during the conversation?' },
  { section_key: 'w4_reflect', part: 2, position: 4, label: 'How did your preparation influence the conversation?' },
  { section_key: 'w4_reflect', part: 2, position: 5, label: 'Did having a development plan help you feel more confident and intentional during the conversation? Why or why not?' },
  { section_key: 'w4_reflect', part: 2, position: 6, label: 'What commitments or next steps were established by the end of the conversation?' },
  { section_key: 'w4_reflect', part: 2, position: 7, label: 'If you could have the conversation again, what would you do differently?' },
  { section_key: 'w4_reflect', part: 2, position: 8, group: 'leadership', label: 'Looking back on the entire experience, what did you learn about the value of preparing before having a development conversation?' },
  { section_key: 'w4_reflect', part: 2, position: 9, group: 'leadership', label: 'How do you think the conversation would have been different if you had entered it without defining success, assessing capability, and creating a development plan first?' },

  // Week 5 - Follow Up & Reinforce
  { section_key: 'w5_followup', position: 0, label: 'How will you measure your team member’s progress over time?',
    hint: 'Consider the metrics, observations, conversations, or other indicators you will use to evaluate progress.' },
  { section_key: 'w5_followup', position: 1, label: 'What specific behaviors, decisions, actions, or results will tell you your team member is moving toward success?' },
  { section_key: 'w5_followup', position: 2, label: 'How often will you follow up with your team member, and what will those follow-up interactions look like?' },
  { section_key: 'w5_followup', position: 3, label: 'How will you recognize and reinforce progress throughout the development process?',
    hint: 'Consider both formal and informal ways you can recognize improvement and encourage continued growth.' },
  { section_key: 'w5_followup', position: 4, label: 'If progress slows or your team member encounters challenges, how will you adjust your approach while continuing to support their development?' },
  { section_key: 'w5_followup', position: 5, label: 'Looking back on your development plan and coaching conversation, is there anything you would modify moving forward? Why?' },
  { section_key: 'w5_followup', position: 6, group: 'leadership', label: 'Looking back on the entire experience, what is the greatest leadership insight you’ve gained about intentionally developing people?' },
  { section_key: 'w5_followup', position: 7, group: 'leadership', label: 'How will you apply this framework with your own team members moving forward?' },

  // Real World Practicum - final reflection (documented)
  { section_key: 'practicum', position: 0, label: 'What surprised you most?' },
  { section_key: 'practicum', position: 1, label: 'What leadership behaviors changed?' },
  { section_key: 'practicum', position: 2, label: 'Which part of the framework will have the greatest impact on your leadership?' },
];
