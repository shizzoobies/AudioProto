// Instructor Live Mode customer dossier (instructor role only).
//
// Returns everything the instructor needs to BE Robert and run the ideal path:
// the scenario snapshot, the key facts for the on-screen reservation, the
// dynamic move timeline, the 8-phase ideal-path script, an objection cheat
// sheet, presenter tips, and the success criteria used by the debrief checklist.
//
// This content is the instructor's role-play crib (it mirrors the Robert demo
// script PDF) and must never reach the trainee. Self-gated by the cs_live
// cookie; only the instructor role is allowed. Listed in /api PUBLIC_PATHS.

import { getLiveScope } from '../../../shared/live.js';
import { getScenario, demoSalesDateBlock } from '../../../shared/scenarios.js';

export async function onRequestGet({ request, env }) {
  const scope = await getLiveScope(request, env);
  if (!scope) return json({ error: 'unauthorized' }, 401);
  if (scope.role !== 'instructor') return json({ error: 'forbidden' }, 403);

  const s = getScenario(scope.scenario_id) || getScenario('demo_sales') || {};
  const timeline = (() => {
    try {
      return demoSalesDateBlock(new Date());
    } catch {
      return '';
    }
  })();

  return json({
    scenario_id: scope.scenario_id,
    customer_name: s.customer_name || 'Robert',
    title: s.title || 'One-Way Reservation',
    headline: 'Sales scenario: One-Way Reservation (Cincinnati to Austin)',
    how_to_use:
      'This is your control crib for the live practice call. You play Robert: friendly, easygoing, but in no rush to commit. Let the trainee lead the intake, answer one thing at a time, and raise your three objections naturally. The phases below are the ideal path. If the trainee handles your concerns and clearly asks for the reservation, you book.',
    snapshot: SNAPSHOT,
    key_facts: KEY_FACTS,
    timeline,
    objections: OBJECTIONS,
    script: SCRIPT,
    cheat_sheet: CHEAT_SHEET,
    presenter_tips: PRESENTER_TIPS,
    opening_lines: Array.isArray(s.opening_lines) ? s.opening_lines : [],
    success_criteria: Array.isArray(s.success_criteria) ? s.success_criteria : [],
    steps: ['Details', 'Equipment', 'Location', 'Scheduling', 'Checkout', 'Reservation Complete'],
  });
}

const SNAPSHOT = [
  { label: 'Goal', value: 'Earn the reservation on this call. Robert is friendly but in no rush. Challenging but winnable.' },
  { label: 'The customer', value: 'Robert Keller, 43, moving his family from Cincinnati, OH to Austin, TX for a new job. Full three-bedroom house. He does not know what size truck he needs and is relying on the trainee.' },
  { label: 'His three objections', value: '1. He feels he should run a decision this size past his wife Beth. 2. Driving a 26 foot truck cross country quietly scares him. 3. He keeps meaning to just do it this weekend.' },
  { label: 'How they win', value: 'Understand the move, recommend and price the right truck, build real urgency on his fixed deadline, handle the three objections (the Beth stall usually melts when the reservation feels low risk and reversible), and clearly ASK for the reservation.' },
  { label: 'How they lose', value: 'Being pushy, talking over him, making him repeat himself, or never actually asking for the reservation. Then he says he will think about it and books this weekend on his own.' },
];

const KEY_FACTS = [
  { label: 'Route', value: 'Cincinnati, OH to Austin, TX. One way. About a thousand miles.' },
  { label: 'Truck', value: '26 foot one-way (the right size for a full three-bedroom home). Robert does not know this, the trainee recommends it.' },
  { label: 'Price on screen', value: 'The 26 foot one-way lands around $2,771. Read the exact total off the Equipment step on screen when they quote it.' },
  { label: 'Move date', value: 'About two weekends out. He picks up that Saturday and drives that weekend with his brother Dave. See the timeline below for the exact date.' },
  { label: 'The hard deadline', value: 'His new job in Austin starts the Monday right after he drives out, and his Cincinnati house closing is fixed. Neither can move. This is the urgency.' },
  { label: 'Contact', value: 'Cell: 513-555-2840. Email: robert.keller@gmail.com. Billing ZIP: 45209.' },
  { label: 'Card (checkout)', value: 'Visa 4539 1488 0343 6467, exp 08/27, CVV 419. Read the long number first in four-digit groups, then exp, CVV, and ZIP only as each is asked. Do not dump it all at once.' },
];

const OBJECTIONS = [
  { name: 'The Beth stall (the big one)', resolves: 'Melts when the reservation feels low risk and reversible: free to make, free to change or cancel. Reserving now just holds the truck and rate while he and Beth talk it through, so it is not really going around her.' },
  { name: 'Nerves about driving the 26 foot truck', resolves: 'Eases once reassured: it is an automatic, drives like a big van, and his brother Dave is splitting the drive. He lets this worry go and does not re-raise it.' },
  { name: 'The "just do it this weekend" stall', resolves: 'Since there is no cost and no commitment to reserve, there is no reason to wait and risk the truck or the rate. Two minutes now and it is handled.' },
];

const SCRIPT = [
  {
    phase: 1,
    label: 'Greeting and the opening',
    lines: [
      { who: 'agent', text: 'Thank you for calling Meridian Moving and Storage, this is [name]. Who do I have the pleasure of speaking with?' },
      { who: 'robert', text: 'Hey, yeah, this is Robert. I am looking to get a price on a one-way truck rental.' },
      { who: 'agent', text: 'Happy to help with that, Robert. Let me grab a few details so I can size this right and get you a real number.' },
    ],
    note: 'Robert will not lay out his whole situation. He answers what is asked, one thing at a time. The trainee leads the call.',
  },
  {
    phase: 2,
    label: 'Understand the move (Details step)',
    lines: [
      { who: 'agent', text: 'Where are you moving from, and where to?' },
      { who: 'robert', text: 'From Cincinnati, here in Ohio, out to Austin, Texas.' },
      { who: 'agent', text: 'Got it, Cincinnati to Austin. And when are you looking to pick the truck up?' },
      { who: 'robert', text: 'A couple weekends from now. I would grab it that Saturday morning and drive out that weekend.' },
      { who: 'agent', text: 'Perfect. And what are you moving, roughly? Apartment, a house?' },
      { who: 'robert', text: 'It is a full three-bedroom house. The usual furniture, the appliances, a packed garage, and a ton of boxes. We have been here twelve years, so there is a lot of it.' },
    ],
    note: 'If he is vague, probe once (big items, garage, appliances). Do not over-ask.',
  },
  {
    phase: 3,
    label: 'Recommend and price the truck (Equipment step)',
    lines: [
      { who: 'agent', text: 'For a full three-bedroom with appliances and a garage going cross country, I would put you in our 26 foot truck. It keeps you to a single trip.' },
      { who: 'robert', text: 'Yeah? I honestly have no idea what size I need. I have never moved anything this big.' },
      { who: 'agent', text: 'That is what I am here for. For the one-way, Cincinnati to Austin, that comes to about [read the total on screen, around twenty-seven hundred], and it includes the one-way drop in Austin.' },
      { who: 'robert', text: 'Okay. That is about what I figured it would run.' },
    ],
    note: 'Quote confidently off the screen, no apologizing. Robert is not price shopping and will not haggle.',
  },
  {
    phase: 4,
    label: 'Build genuine urgency (his real deadline)',
    lines: [
      { who: 'agent', text: 'One-way trucks on this route go fast for weekend pickups, and the rate is good if we lock it in today. Your move weekend is fixed, so I would hate for the 26 footer to be gone.' },
      { who: 'robert', text: 'Yeah, that is the thing, my start date in Austin is locked. I cannot show up late.' },
      { who: 'agent', text: 'Then let us protect that date. Reserving now holds both the truck and this rate.' },
      { who: 'robert', text: 'I hear you. Let me think about it though, I feel like I should run it by my wife first.' },
    ],
    note: 'No fake scarcity. The deadline and limited one-way inventory are real. He takes it seriously, then surfaces the Beth objection.',
  },
  {
    phase: 5,
    label: 'Handle the three objections',
    lines: [
      { who: 'agent', text: '5a. Beth stall: The reservation is free to make and free to change or cancel if plans shift. Reserving now just holds your truck and rate while you and Beth talk it through.' },
      { who: 'robert', text: 'Oh, so it is not a commitment commitment. I can still move it if I need to.' },
      { who: 'agent', text: '5b. Big-truck nerves: It is an automatic, handles like a big van, and your brother splits the driving. First-timers take these cross country every day.' },
      { who: 'robert', text: 'Yeah, that part makes me nervous, not going to lie. But Dave is coming with me, so that helps.' },
      { who: 'agent', text: '5c. This-weekend stall: No cost and no commitment to reserve, so no reason to risk the truck or rate. Two minutes now and it is handled.' },
      { who: 'robert', text: 'Heh. Yeah, you are right. I have had this on my list for two weeks. Let us just do it.' },
    ],
    note: 'The key move is making the reservation feel low risk and reversible. Once each concern is genuinely addressed, he eases up and does not re-raise it.',
  },
  {
    phase: 6,
    label: 'Ask for the business (close)',
    lines: [
      { who: 'agent', text: 'Great. Let us lock in your 26 foot one-way for that Saturday, Cincinnati to Austin. I will just need a few details to hold it. Sound good?' },
      { who: 'robert', text: 'Yeah, let us do it.' },
    ],
    note: 'Ask clearly and warmly. Once his concerns are handled, this is the natural yes.',
  },
  {
    phase: 7,
    label: 'Take the details and payment (Checkout step)',
    lines: [
      { who: 'agent', text: 'Best cell number for the confirmation?' },
      { who: 'robert', text: 'Five one three, five five five, two eight four oh.' },
      { who: 'agent', text: 'And an email for the receipt?' },
      { who: 'robert', text: 'Robert dot Keller at gmail dot com.' },
      { who: 'agent', text: 'To hold the reservation I will take a card. The long number first.' },
      { who: 'robert', text: 'Four five three nine, one four eight eight, oh three four three, six four six seven.' },
      { who: 'agent', text: 'Expiration? Security code? Billing ZIP?' },
      { who: 'robert', text: 'Oh eight, two seven. Four one nine. Four five two oh nine.' },
    ],
    note: 'Ask one piece at a time, in order. He hands them over one at a time. If asked to repeat something already given, he notices it.',
  },
  {
    phase: 8,
    label: 'Read back and confirm (Reservation Complete)',
    lines: [
      { who: 'agent', text: 'All set, Robert. A 26 foot one-way, picking up that Saturday in Cincinnati, dropping in Austin, for about [total]. Confirmation number is [read off screen], copy on its way to your phone and email.' },
      { who: 'robert', text: 'Awesome. That was easier than I expected. Thank you.' },
      { who: 'agent', text: 'My pleasure. Congratulations on the new role, and good luck with the move.' },
    ],
    note: 'Confirm truck, route, date, total, and the confirmation number. Warm close. He ends friendly and relieved.',
  },
];

const CHEAT_SHEET = [
  { says: 'Let me run it past my wife Beth.', reply: 'It is free to reserve and free to change or cancel. Reserving now just holds your truck and rate while you two talk. You are not committing to anything.' },
  { says: 'I am nervous about driving a 26 footer that far.', reply: 'It is an automatic, drives like a big van, and Dave is splitting the trip with you. First-timers do this every day.' },
  { says: 'I will just sort it out this weekend.', reply: 'No cost and no commitment to reserve, so no reason to risk losing the truck or the rate. Two minutes now and it is done.' },
  { says: 'What is this going to run me?', reply: 'Quote the one-way total confidently off the screen, around twenty-seven hundred, and note it includes the Austin drop. Do not apologize for the price.' },
  { says: '(He goes quiet or rambles)', reply: 'Steer back with the next agent line. Ask a direct question or move to the close. He stays friendly, he just needs the trainee to lead.' },
];

const PRESENTER_TIPS = [
  'Wait for the trainee to greet, then say why you are calling. Do not run their intake for them.',
  'Do not flip to yes on the very first ask. Make them handle the Beth stall plus one more concern, then commit.',
  'The most reliable unlock is making the reservation feel low risk and reversible. That is what melts the Beth objection.',
  'You are not price shopping and will not haggle. React naturally to the quote.',
  'If they make you repeat your number or the route, notice it, lightly the first time, with a little more edge if it keeps happening.',
  'Stay friendly the whole way. You are winnable, reward good selling. Only walk if they are pushy, talk over you, or never actually ask.',
];

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
