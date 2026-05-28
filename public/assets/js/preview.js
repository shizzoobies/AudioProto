// preview.js — static state gallery for visual dial-in
// No fetch(), no imports from app.js/admin.js, no API calls.
// All mock data is inline in the MOCK object below.
// To add a new state: push an entry to STATES and add a render fn.

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK = {
  // Scenario types for the picker grid
  scenarioTypes: [
    { id: 'price_shopper',   title: 'The Price Shopper',      difficulty: 'easy',   persona_count: 5, description: 'On a budget, comparing quotes from three companies.' },
    { id: 'first_time',      title: 'The First-Time Mover',   difficulty: 'easy',   persona_count: 5, description: 'Never rented a truck. Needs hand-holding through every step.' },
    { id: 'damage_dispute',  title: 'The Damage Dispute',     difficulty: 'medium', persona_count: 5, description: 'Claims the truck scratched their furniture on the last rental.' },
    { id: 'last_minute',     title: 'The Last-Minute Caller', difficulty: 'medium', persona_count: 5, description: 'Needs a truck tomorrow morning — is there anything available?' },
    { id: 'overpacker',      title: 'The Overpacker',         difficulty: 'hard',   persona_count: 5, description: 'Rented a 10\' last time, swears it was big enough, but it wasn\'t.' },
  ],

  // Personas for the persona picker (inside "The Damage Dispute")
  personas: [
    { id: 'patricia_w',  customer_name: 'Patricia Williams', customer_short: 'Retired teacher, methodical', tagline: 'Has photos. Wants a case number.', premium: false },
    { id: 'robert_c',    customer_name: 'Robert Chen',       customer_short: 'Small-business owner',        tagline: 'Calm but firm — this is the third call.', premium: false },
    { id: 'sarah_m',     customer_name: 'Sarah Mitchell',    customer_short: 'Young professional',          tagline: 'Emotional, just moved across town.', premium: true  },
    { id: 'james_t',     customer_name: 'James Trevino',     customer_short: 'Retired military',            tagline: 'Wants to speak to a manager right away.', premium: false },
    { id: 'linda_k',     customer_name: 'Linda Kowalski',    customer_short: 'Stay-at-home parent',         tagline: 'Nervous about confrontation, but won\'t drop it.', premium: true  },
  ],

  // Recipient scenarios (shown on recipient home)
  recipientScenarios: [
    { id: 'price_shopper_1', customer_name: 'Derek Huang',    customer_short: 'Budget-conscious, comparing three companies', tagline: 'Wants the cheapest 15\' in the city.', premium: false },
    { id: 'damage_1',        customer_name: 'Patricia Williams', customer_short: 'Retired teacher, methodical', tagline: 'Has photos. Wants a case number.', premium: false },
    { id: 'sales_objection_1', customer_name: 'Marcus Reed',  customer_short: 'Asked about pricing, hesitates at the card ask', tagline: 'Needs to "think about it" before committing.', premium: true  },
  ],

  // Multi-turn transcript mock
  transcript: [
    { kind: 'customer', label: 'Derek Huang',  text: 'Hi, yeah, I\'m calling about a truck rental. I need something for this Saturday — moving from the Westside to Stone Oak.' },
    { kind: 'agent',    label: 'You',          text: 'Sure, I can help with that! What size load are you moving — studio, one-bedroom, or larger?' },
    { kind: 'customer', label: 'Derek Huang',  text: 'It\'s a two-bedroom apartment. Not a lot of furniture but we do have a sectional and a king bed.' },
    { kind: 'agent',    label: 'You',          text: 'For a two-bedroom with a sectional and a king, I\'d put you in our 15-foot truck. That\'s $29.95 a day plus $0.89 a mile. How many days do you need it?' },
    { kind: 'customer', label: 'Derek Huang',  text: 'Just one day should be fine. But honestly, the quote I got from U-Haul was $24 a day. Can you match that?' },
    { kind: 'agent',    label: 'You',          text: 'I understand — price matters. Our 15-foot rate does include roadside assistance and a damage waiver option that U-Haul charges extra for. Would you like me to walk you through the total so you can compare apples to apples?' },
  ],

  // In-progress reservation used across the POS step previews (steps 2-5).
  reservation: {
    customerName: 'Derek Huang',
    phone: '(210) 555-0142',
    email: 'derek.huang@gmail.com',
    movingFrom: 'Westside, San Antonio TX 78237',
    movingTo: 'Stone Oak, San Antonio TX 78258',
    rentalDate: 'Sat, May 30, 2026',
    moving: '2 Bedroom Home',
    moveType: 'In Town',
    truckLabel: "15' Moving Truck",
    truckRate: '$29.95/day + $0.89/mile',
    rentalLength: '1 day (24-hr period)',
    location: 'San Antonio Central',
    pickupTime: 'Sat, May 30 · 9:00 AM',
  },

  truckSizes: [
    { size: 10, base: 19.95, per_mile: 0.79 },
    { size: 15, base: 29.95, per_mile: 0.89 },
    { size: 20, base: 39.95, per_mile: 0.99 },
    { size: 26, base: 49.95, per_mile: 1.09 },
  ],

  locations: [
    { name: 'San Antonio Central', entity: 'Entity 4471', address: '1200 Fredericksburg Rd, San Antonio TX 78201', phone: '(210) 555-0188', hours: 'Open until 7:00 PM', dist: '1.2', avail: [10, 15, 20, 26] },
    { name: 'Stone Oak',           entity: 'Entity 5532', address: '20475 US-281 N, San Antonio TX 78258',       phone: '(210) 555-0211', hours: 'Open until 6:00 PM', dist: '3.8', avail: [15, 20] },
    { name: 'Leon Valley',         entity: 'Entity 3390', address: '6900 Bandera Rd, San Antonio TX 78238',      phone: '(210) 555-0144', hours: 'Open until 8:00 PM', dist: '5.1', avail: [10, 15, 26] },
  ],

  cartLines: [
    { label: "15' Moving Truck", sub: '1 day @ $29.95', amount: 29.95 },
    { label: 'Mileage',          sub: '22 mi @ $0.89',  amount: 19.58 },
    { label: 'Furniture pads',   sub: '1 pack',         amount: 10.00 },
    { label: 'Utility dolly',    sub: '1 day',          amount: 7.00 },
    { label: 'Damage waiver',    sub: 'Basic · 1 day',  amount: 15.00 },
  ],
  cartSubtotal: 81.53,
  cartTax: 6.73,
  cartTotal: 88.26,

  // Coaching report mock
  report: {
    overall_score: 3.5,
    final_mood: 'neutral',
    final_mood_note: 'Left uncertain but not hostile. A stronger close would have resolved it.',
    strengths: [
      'Offered a clear apples-to-apples comparison when challenged on price.',
      'Stayed calm and professional when the customer mentioned a competitor.',
    ],
    growth_areas: [
      'Did not ask for the reservation at the end of the call.',
      'Missed the upsell opportunity on furniture pads — customer mentioned a sectional.',
    ],
    one_thing_to_try_next_time: 'After you\'ve handled the price objection, move straight to the close: "Can I go ahead and get that Saturday reservation locked in for you?" Don\'t wait for the customer to ask.',
    scores: {
      rapport: {
        score: 4,
        evidence: '"I understand — price matters" acknowledged the customer\'s concern without being defensive.',
        suggestion: 'Use the customer\'s name once or twice to build more personal warmth.',
      },
      listening: {
        score: 3,
        evidence: 'Correctly identified the load size from the furniture description.',
        suggestion: 'When the customer mentioned U-Haul by name, reflect it back: "You\'ve been shopping around — that\'s smart."',
      },
      problem_solving: {
        score: 4,
        evidence: 'Pivoted to a value comparison rather than defending the price directly.',
        suggestion: 'Offer to email a written quote so the customer can compare side-by-side at their own pace.',
      },
      sales: {
        score: 2,
        evidence: 'No explicit ask for the reservation was made before the call ended.',
        suggestion: 'Trial-close after the value pitch: "Does that work for you?" then move to the reservation.',
      },
      policy: {
        score: 3,
        evidence: 'Correctly quoted the 15-foot rate and per-mile charge.',
        suggestion: 'Mention the environmental fee and VLRF upfront so the final total isn\'t a surprise.',
      },
      resolution: {
        score: 3,
        evidence: 'Customer received enough information to make a decision, but did not commit.',
        suggestion: 'End every call with a clear next action — either a reservation or a callback time.',
      },
    },
  },

  // Mock invites for admin dashboard
  invites: [
    {
      id: 'inv_001',
      recipient_name: 'Jordan Lee',
      recipient_email: 'jordan.lee@firmmovingco.com',
      scenarios: [
        { customer_name: 'Derek Huang',    tagline: 'Wants the cheapest 15\' in the city.' },
        { customer_name: 'Patricia Williams', tagline: 'Has photos. Wants a case number.' },
      ],
      expires_at: Math.floor(Date.now() / 1000) + 86400 * 6,
      last_click_at: Math.floor(Date.now() / 1000) - 3600 * 2,
      total_calls: 3,
      revoked: false,
    },
    {
      id: 'inv_002',
      recipient_name: 'Priya Nair',
      recipient_email: 'priya@meridiantraining.org',
      scenarios: [
        { customer_name: 'Sarah Mitchell', tagline: 'Emotional, just moved across town.' },
      ],
      expires_at: Math.floor(Date.now() / 1000) - 86400 * 3,
      last_click_at: null,
      total_calls: 0,
      revoked: false,
    },
    {
      id: 'inv_003',
      recipient_name: 'Marcus Webb',
      recipient_email: 'mwebb@meridian.com',
      scenarios: [
        { customer_name: 'James Trevino', tagline: 'Wants to speak to a manager right away.' },
        { customer_name: 'Linda Kowalski', tagline: "Nervous about confrontation, but won't drop it." },
        { customer_name: 'Robert Chen',   tagline: 'Calm but firm — this is the third call.' },
      ],
      expires_at: null,
      last_click_at: Math.floor(Date.now() / 1000) - 86400 * 1,
      total_calls: 7,
      revoked: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtDate(ts) {
  if (!ts) return 'never expires';
  try { return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
}

function fmtRelative(ts) {
  if (!ts) return 'no clicks yet';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toFixed(2);
}

function inviteStatus(inv) {
  const now = Math.floor(Date.now() / 1000);
  if (inv.revoked) return { tag: 'revoked', label: 'Revoked', cls: 'is-revoked' };
  if (inv.expires_at && inv.expires_at < now) return { tag: 'expired', label: 'Expired', cls: 'is-expired' };
  return { tag: 'active', label: 'Active', cls: 'is-active' };
}

// ---------------------------------------------------------------------------
// State renderers  — each returns an HTML string
// ---------------------------------------------------------------------------

function renderAuthLogin() {
  return `
    <body-override class="auth-page" style="display:contents">
    <main class="auth-card" aria-labelledby="auth-title">
      <div class="auth-mark" aria-hidden="true"></div>
      <h1 id="auth-title" class="auth-title">Call Simulator</h1>
      <p class="auth-subtitle">Enter the access password to continue.</p>
      <form class="auth-form" novalidate>
        <label for="pw-preview" class="auth-label">Password</label>
        <input type="password" id="pw-preview" class="auth-input" placeholder="" value="••••••••">
        <button type="button" class="auth-submit">Continue</button>
        <p class="auth-error" role="alert" style="display:none"></p>
      </form>
    </main>
    </body-override>
  `;
}

function renderHomeWelcome() {
  return `
    <section class="welcome">
      <header class="welcome-hero">
        <div class="welcome-eyebrow">Customer service training</div>
        <h1 class="welcome-title">Training Center</h1>
        <p class="welcome-lead">Pick a track to practice. Each is a set of realistic, voice-driven customer calls with a scored coaching report at the end.</p>
      </header>

      <div class="welcome-section">
        <div class="welcome-section-eyebrow">Training tracks</div>
        <p class="welcome-section-sub">Choose the kind of call you want to work on.</p>
      </div>

      <div class="welcome-modes">
        <button class="mode-choice" type="button">
          <div class="mode-choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M3 11.5V5a2 2 0 0 1 2-2h6.5a2 2 0 0 1 1.4.6l7.5 7.5a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0L3.6 13a2 2 0 0 1-.6-1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <circle cx="7.5" cy="7.5" r="1.4" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </div>
          <h3 class="mode-choice-title">Sales Scenarios</h3>
          <p class="mode-choice-text">Quoting, handling objections, and closing the deal. Practice turning an inquiry into a confident reservation.</p>
          <span class="mode-choice-cta">Coming soon</span>
        </button>
        <button class="mode-choice" type="button">
          <div class="mode-choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <rect x="5" y="4" width="14" height="17" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M9 12.5l2 2 4-4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h3 class="mode-choice-title">Post Reservation Situations</h3>
          <p class="mode-choice-text">Changes, delays, and problems after a reservation already exists. Practice keeping a committed customer happy.</p>
          <span class="mode-choice-cta">Coming soon</span>
        </button>
      </div>

      <div class="welcome-divider" aria-hidden="true">
        <span class="welcome-divider-text">or</span>
      </div>

      <div class="welcome-showcase">
        <button class="mode-choice mode-choice-showcase" type="button">
          <div class="mode-choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
              <path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            </svg>
          </div>
          <h3 class="mode-choice-title">Explore More Scenario Training</h3>
          <p class="mode-choice-text">The full library: the five core scenario types, the random "surprise me" call, and the Elena showcase. Chat or phone mode.</p>
          <span class="mode-choice-cta">Open the library <span aria-hidden="true">›</span></span>
        </button>
      </div>
    </section>
  `;
}

function renderPickerType() {
  const cards = MOCK.scenarioTypes.map((t) => `
    <li class="scenario-card" tabindex="0" role="button">
      <div class="scenario-difficulty difficulty-${esc(t.difficulty)}">${esc(t.difficulty.charAt(0).toUpperCase() + t.difficulty.slice(1))}</div>
      <h2 class="scenario-title">${esc(t.title)}</h2>
      <p class="scenario-customer">${t.persona_count} different callers</p>
      <p class="scenario-description">${esc(t.description)}</p>
      <div class="scenario-cta">Start call <span aria-hidden="true">›</span></div>
    </li>
  `).join('');

  const randomCard = `
    <li class="scenario-card scenario-card-random" tabindex="0" role="button">
      <div class="scenario-difficulty difficulty-random">
        <svg viewBox="0 0 24 24" class="random-icon" aria-hidden="true">
          <rect x="2.5" y="2.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <rect x="12.5" y="12.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <path d="M11.5 6 L17 6 L17 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12.5 17.5 L7 17.5 L7 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Random
      </div>
      <h2 class="scenario-title">Surprise me</h2>
      <p class="scenario-customer">Caller unknown</p>
      <p class="scenario-description">Pick one of the 25 callers at random. You will not know who is on the line until you take the call.</p>
      <div class="scenario-cta">Take the call <span aria-hidden="true">›</span></div>
    </li>
  `;

  return `
    <section class="picker">
      <header class="picker-header">
        <div class="picker-format-row">
          <div class="picker-format">
            <span class="picker-format-label">Format</span>
            <span class="picker-format-value">Phone call</span>
          </div>
          <button class="ghost-button" type="button">Change format</button>
        </div>
        <h1 class="picker-title">Choose a scenario</h1>
        <p class="picker-subtitle">Each scenario is a different customer with a different problem. Pick one, or hit Surprise me to be tested cold.</p>
      </header>
      <ul class="scenario-grid">${cards}${randomCard}</ul>
    </section>
  `;
}

function renderPickerPersona() {
  const cards = MOCK.personas.map((p) => `
    <li class="scenario-card" tabindex="0" role="button">
      ${p.premium ? '<div class="scenario-difficulty difficulty-premium">Premium</div>' : ''}
      <h2 class="scenario-title">${esc(p.customer_name)}</h2>
      <p class="scenario-customer">${esc(p.customer_short)}</p>
      <p class="scenario-description">${esc(p.tagline)}</p>
      <div class="scenario-cta">Take the call <span aria-hidden="true">›</span></div>
    </li>
  `).join('');

  return `
    <section class="picker">
      <div class="welcome-back">
        <button class="ghost-button" type="button"><span aria-hidden="true">‹</span> Back to training center</button>
      </div>
      <header class="picker-header">
        <div class="picker-format-row">
          <div class="section-format-toggle" role="group" aria-label="Call format">
            <button type="button" class="section-format-btn active">Phone</button>
            <button type="button" class="section-format-btn">Chat</button>
          </div>
        </div>
        <h1 class="picker-title">The Damage Dispute</h1>
        <p class="picker-subtitle">Claims the truck scratched their furniture on the last rental. Resolve it without losing the customer.</p>
      </header>
      <ul class="scenario-grid">${cards}</ul>
    </section>
  `;
}

function renderPickerRandom() {
  return `
    <section class="picker">
      <header class="picker-header">
        <div class="picker-format-row">
          <div class="picker-format">
            <span class="picker-format-label">Format</span>
            <span class="picker-format-value">Phone call</span>
          </div>
          <button class="ghost-button" type="button">Change format</button>
        </div>
        <h1 class="picker-title">Choose a scenario</h1>
        <p class="picker-subtitle">Each scenario is a different customer with a different problem.</p>
      </header>
      <ul class="scenario-grid">
        <li class="scenario-card scenario-card-random" tabindex="0" role="button">
          <div class="scenario-difficulty difficulty-random">
            <svg viewBox="0 0 24 24" class="random-icon" aria-hidden="true">
              <rect x="2.5" y="2.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
              <rect x="12.5" y="12.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
              <path d="M11.5 6 L17 6 L17 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M12.5 17.5 L7 17.5 L7 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Random
          </div>
          <h2 class="scenario-title">Surprise me</h2>
          <p class="scenario-customer">Caller unknown</p>
          <p class="scenario-description">Pick one of the 25 callers at random. You will not know who is on the line until you take the call.</p>
          <div class="scenario-cta">Take the call <span aria-hidden="true">›</span></div>
        </li>
      </ul>
    </section>
  `;
}

function renderRecipientHome() {
  const cards = MOCK.recipientScenarios.map((p) => `
    <li class="scenario-card" tabindex="0" role="button">
      ${p.premium ? '<div class="scenario-difficulty difficulty-premium">Premium</div>' : ''}
      <h2 class="scenario-title">${esc(p.customer_name)}</h2>
      <p class="scenario-customer">${esc(p.customer_short)}</p>
      <p class="scenario-description">${esc(p.tagline)}</p>
      <div class="scenario-cta">Take the call <span aria-hidden="true">›</span></div>
    </li>
  `).join('');

  return `
    <section class="recipient-home">
      <header class="recipient-header">
        <div class="recipient-eyebrow">Sales training</div>
        <h1 class="recipient-title">Hi Jordan</h1>
        <p class="recipient-subtitle">You have 3 training calls to take.</p>
      </header>
      <div class="recipient-disclaimer" role="note">
        <strong>These are voice calls.</strong> When prompted, please allow microphone access for this page so the customer can hear you.
      </div>
      <ul class="scenario-grid">${cards}</ul>
    </section>
  `;
}

function renderKioskSplash() {
  return `
    <section class="kiosk-splash">
      <header class="kiosk-splash-header">
        <div class="kiosk-eyebrow">Sales training</div>
        <h1 class="kiosk-title">Overcoming Objections</h1>
        <p class="kiosk-subtitle">Practice the three-point method: build genuine urgency, acknowledge the objection, and ask for the business again.</p>
      </header>
      <article class="kiosk-card">
        <h2 class="kiosk-card-name">Sarah Mitchell</h2>
        <p class="kiosk-card-short">Young professional, first long-distance move</p>
        <p class="kiosk-card-tagline">Emotional, just moved across town. Needs reassurance before committing.</p>
      </article>
      <div class="kiosk-disclaimer" role="note">
        <strong>This is a voice call.</strong> When prompted, please allow microphone access for this page so the customer can hear you.
      </div>
      <button class="primary-button kiosk-cta" type="button">Take the call <span aria-hidden="true">›</span></button>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Call shell — replicates the in-call POS interface. Parameterized by which
// reservation step is active (1 Details, 2 Equipment, 3 Location, 4 Time,
// 5 Checkout) and whether the rails/cart show an in-progress reservation.
// ---------------------------------------------------------------------------

const R = MOCK.reservation;

function transcriptHtmlFrom(turns) {
  return turns.map((m) => `
    <li class="message message-${esc(m.kind)}">
      <div class="message-label">${esc(m.label)}</div>
      <div class="message-bubble">${esc(m.text)}</div>
    </li>
  `).join('');
}

const CSF_TABS = ['U-Move', 'U-Box', 'Storage', 'Hitch', 'Moving Help', 'Ready-To-Go Box', 'Hookup'];

// CSF top header — mirrors the real Customer Service Form chrome.
function csfTopbar(stepTitle) {
  return `
    <div class="csf-topbar">
      <div class="csf-topbar-titles">
        <div class="csf-eyebrow">Customer Service Form</div>
        <div class="csf-title">${esc(stepTitle)}</div>
        <div class="csf-subtitle">CSF Admin / Rules</div>
      </div>
      <div class="csf-topbar-nav">
        <div class="csf-nav-row">
          <a class="csf-nav-link">FAQs</a>
          <a class="csf-nav-link">POS Dashboard</a>
        </div>
        <button type="button" class="csf-new-btn">New Reservation</button>
      </div>
    </div>
  `;
}

// Equipment category tabs — only U-Move is functional in the sim.
function csfTabs() {
  return `<div class="csf-tabs">${CSF_TABS.map((t, i) =>
    `<button type="button" class="csf-tab${i === 0 ? ' active' : ''}">${esc(t)}</button>`
  ).join('')}</div>`;
}

// Per-step call script for the left rail. Plain lines are narration; suggest
// lines are the words to say next (green, our established convention).
function scriptForStep(step) {
  const lines = {
    1: [
      { text: 'Thank you for calling Meridian Moving and Storage, this is Alexander. How may I help you?' },
      { suggest: true, text: 'No problem! May I start with your cell phone number?' },
    ],
    2: [
      { suggest: true, text: "Based on what you're moving, I'd put you in a 15-foot truck — $29.95 a day plus $0.89 a mile. How many days do you need it?" },
      { suggest: true, text: 'Families who rent a truck find a utility dolly and a dozen furniture pads make the move easier. Can I add those for $17.00?' },
    ],
    3: [
      { suggest: true, text: 'The closest pickup spot to you is our San Antonio Central store on Fredericksburg Road. Does that work?' },
    ],
    4: [
      { suggest: true, text: 'What time would you like to pick up on Saturday?' },
    ],
    5: [
      { suggest: true, text: 'What is your preferred method of contact: email, phone, or text?' },
      { suggest: true, text: 'Can I go ahead and lock in that Saturday reservation for you?' },
    ],
  }[step] || [];
  const icon = `<svg class="pos-script-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-4 3v-3H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  const linesHtml = lines.map((l) =>
    `<p class="${l.suggest ? 'pos-script-suggest' : 'pos-script-line'}">${esc(l.text)}</p>`
  ).join('');
  return `<div class="pos-script">${icon}<div class="pos-script-lines">${linesHtml}</div></div>`;
}

function lookupHtml() {
  return `
    <div class="pos-lookup">
      <input class="pos-input" type="text" placeholder="Phone number or email address">
      <button type="button" class="pos-lookup-btn" aria-label="Search">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5 L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  `;
}

function leftRailHtml(step, filled) {
  // Contact card carries the call script. Before lookup it shows the search
  // field; once filled it shows the caller's details on file.
  const contactBody = filled
    ? `${scriptForStep(step)}
       <div class="pos-divider"><span>On file</span></div>
       <div class="pos-kv"><span>Name</span><span>${esc(R.customerName)}</span></div>
       <div class="pos-kv"><span>Phone</span><span>${esc(R.phone)}</span></div>
       <div class="pos-kv"><span>Email</span><span>${esc(R.email)}</span></div>`
    : `${scriptForStep(step)}${lookupHtml()}`;

  const detailsCard = filled ? `
      <section class="pos-card">
        <div class="pos-card-head"><span class="pos-card-title">Reservation Details</span></div>
        <div class="pos-card-body">
          <div class="pos-kv"><span>Moving From</span><span>${esc(R.movingFrom)}</span></div>
          <div class="pos-kv"><span>Moving To</span><span>${esc(R.movingTo)}</span></div>
          <div class="pos-kv"><span>Rental Date</span><span>${esc(R.rentalDate)}</span></div>
          <div class="pos-kv"><span>Moving</span><span>${esc(R.moving)}</span></div>
          <div class="pos-kv"><span>Move Type</span><span>${esc(R.moveType)}</span></div>
        </div>
      </section>` : '';

  return `
    <aside class="pos-rail pos-rail-left" aria-label="Customer and reservation context">
      <section class="pos-card">
        <div class="pos-card-head"><span class="pos-card-title">Customer Contact Information</span></div>
        <div class="pos-card-body">${contactBody}</div>
      </section>
      ${detailsCard}
      <section class="pos-card">
        <div class="pos-card-head">
          <span class="pos-card-title">Reservation Notes</span>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M9.5 3 L13 6.5 L6 13.5 L2.5 13.5 L2.5 10 Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </div>
        <div class="pos-card-body" style="min-height:36px;"></div>
      </section>
    </aside>
  `;
}

function callDockHtml(transcriptHtml, phoneStatusState, phoneStatusText, phoneStatusHint) {
  return `
    <div class="call-dock" data-mode="phone" data-collapsed="false">
      <button type="button" class="call-dock-head" aria-expanded="true">
        <span class="call-dock-dot"></span>
        <span class="call-dock-title">${esc(R.customerName)}</span>
        <span class="call-dock-sub">Live call</span>
        <span class="call-dock-chevron" aria-hidden="true">&#9662;</span>
      </button>
      <div class="call-dock-body">
        <div class="call-dock-convo">
          <ol class="transcript" aria-live="polite">${transcriptHtml}</ol>
        </div>
        <div class="call-dock-aside">
          <div class="visualizer-wrap" data-active="false"><canvas class="visualizer"></canvas></div>
          <div class="phone-status" data-state="${esc(phoneStatusState)}">
            <div class="phone-status-row">
              <span class="phone-status-dot" aria-hidden="true"></span>
              <span class="phone-status-text">${esc(phoneStatusText)}</span>
            </div>
            <p class="phone-status-hint">${esc(phoneStatusHint)}</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function cartBodyHtml(filled) {
  if (!filled) return '<p class="pos-card-empty">Add equipment to start the cart.</p>';
  const lines = MOCK.cartLines.map((l) => `
    <div class="pos-cart-line">
      <div class="pos-cart-line-label">${esc(l.label)}<span class="pos-cart-line-sub">${esc(l.sub)}</span></div>
      <div class="pos-cart-line-amt mono">${fmtMoney(l.amount)}</div>
    </div>
  `).join('');
  return `
    <div class="pos-cart-tag">Truck Rental</div>
    ${lines}
    <div class="pos-cart-rule"></div>
    <div class="pos-cart-line pos-cart-subtotal"><div class="pos-cart-line-label">Subtotal</div><div class="pos-cart-line-amt mono">${fmtMoney(MOCK.cartSubtotal)}</div></div>
    <details class="pos-cart-taxes"><summary>Show taxes</summary>
      <div class="pos-cart-line pos-cart-line-muted"><div class="pos-cart-line-label">Estimated tax (8.25%)</div><div class="pos-cart-line-amt mono">${fmtMoney(MOCK.cartTax)}</div></div>
    </details>
    <div class="pos-cart-rule"></div>
    <div class="pos-cart-line pos-cart-total"><div class="pos-cart-line-label">Total</div><div class="pos-cart-line-amt mono">${fmtMoney(MOCK.cartTotal)}</div></div>
    <div class="pos-cart-note">Estimate. In-town mileage is reconciled at the actual miles driven on return.</div>
  `;
}

function ccPanelHtml(filled) {
  return `
    <label class="pos-field"><span class="pos-field-label">Card Number</span><input class="pos-input" type="text" placeholder="4111 1111 1111 1111" maxlength="23"${filled ? ' value="4111 1111 1111 1111"' : ''}></label>
    <div class="pos-grid-2">
      <label class="pos-field"><span class="pos-field-label">Exp Month</span><select class="pos-input"><option>09</option></select></label>
      <label class="pos-field"><span class="pos-field-label">Exp Year</span><select class="pos-input"><option>2028</option></select></label>
    </div>
    <label class="pos-field"><span class="pos-field-label">Billing Zip Code</span><input class="pos-input" type="text" placeholder="78207" maxlength="5"${filled ? ' value="78201"' : ''}></label>
    ${filled ? '<div class="pos-cc-chip" data-brand="visa"><span class="pos-cc-brand">VISA</span><span class="mono">&bull;&bull;&bull;&bull; 1111</span></div>' : ''}
  `;
}

function posStep1() {
  return `
    <div class="pos-grid-3">
      <label class="pos-field"><span class="pos-field-label">Moving From</span><input class="pos-input" type="text"></label>
      <label class="pos-field"><span class="pos-field-label">Moving To (Optional)</span><input class="pos-input" type="text"></label>
      <div class="pos-field">
        <span class="pos-field-label">Move Type</span>
        <div class="pos-radio-row">
          <label class="pos-radio"><input type="radio" name="mt1" checked> In Town</label>
          <label class="pos-radio"><input type="radio" name="mt1"> One Way</label>
        </div>
      </div>
    </div>
    <div class="pos-grid-2">
      <label class="pos-field"><span class="pos-field-label">Move/Pickup Date</span><input class="pos-input" type="date"></label>
      <label class="pos-field"><span class="pos-field-label">How many bedrooms?</span><select class="pos-input"><option selected>Select</option><option>Studio</option><option>1 Bedroom Home</option><option>2 Bedroom Home</option><option>3 Bedroom Home</option></select></label>
    </div>
    <div class="pos-field"><span class="pos-field-label">Are you towing a vehicle?</span><div class="pos-radio-row"><label class="pos-radio"><input type="radio" name="tow1"> Yes</label><label class="pos-radio"><input type="radio" name="tow1" checked> No</label></div></div>
    <div class="pos-field"><span class="pos-field-label">Do you need a trailer?</span><div class="pos-radio-row"><label class="pos-radio"><input type="radio" name="trl1"> Yes</label><label class="pos-radio"><input type="radio" name="trl1" checked> No</label></div></div>
  `;
}

function posStep2() {
  const allEquip = MOCK.truckSizes.map((t) => `
    <button type="button" class="pos-equip-opt" data-truck="${t.size}">
      <span class="pos-equip-opt-name">${t.size}' Moving Truck</span>
      <span class="pos-equip-opt-rate mono">$${t.base.toFixed(2)}/day + $${t.per_mile.toFixed(2)}/mi</span>
    </button>
  `).join('');
  return `
    <div class="pos-equip-rec" data-size="15">
      <div class="pos-equip-badge">Recommended</div>
      <div class="pos-equip-body">
        <div class="pos-equip-name">15' Moving Truck — fits a 2-bedroom home</div>
        <div class="pos-equip-rate mono">$29.95/day + $0.89/mile</div>
        <div class="pos-grid-2 pos-field-inline">
          <label class="pos-field"><span class="pos-field-label">Rental length (24-hr periods)</span><select class="pos-input"><option selected>1 day</option><option>2 days</option><option>3 days</option></select></label>
          <label class="pos-field"><span class="pos-field-label">Estimated miles</span><input class="pos-input" type="number" value="22"></label>
        </div>
      </div>
    </div>
    <div class="pos-upsell">
      <label class="pos-check"><input type="checkbox" checked> Furniture pads ($10/pack)</label>
      <label class="pos-check"><input type="checkbox" checked> Utility dolly ($7/day)</label>
    </div>
    <fieldset class="pos-fieldset">
      <legend>Damage waiver</legend>
      <select class="pos-input"><option>Decline coverage</option><option selected>Basic ($15/day, up to $5k)</option><option>Premium ($25/day, up to $25k)</option></select>
    </fieldset>
    <details class="pos-equip-all">
      <summary>Show all moving equipment</summary>
      <div class="pos-equip-grid">${allEquip}</div>
    </details>
  `;
}

function posStep3() {
  const locs = MOCK.locations.map((loc, i) => {
    const recommended = i === 0;
    const chips = MOCK.truckSizes.map((t) =>
      `<span class="pos-loc-chip${loc.avail.includes(t.size) ? '' : ' out'}">${t.size}' ${loc.avail.includes(t.size) ? '$' + t.base.toFixed(2) : 'N/A'}</span>`
    ).join('');
    return `
      <button type="button" class="pos-loc${recommended ? ' recommended selected' : ''}" data-location="${esc(loc.name)}">
        <div class="pos-loc-rank">${i + 1}</div>
        <div class="pos-loc-main">
          <div class="pos-loc-name">Meridian Moving &amp; Storage of ${esc(loc.name)}${recommended ? ' <span class="pos-loc-badge">Recommended</span>' : ''}</div>
          <div class="pos-loc-addr mono">${esc(loc.address)}</div>
          <div class="pos-loc-meta">${esc(loc.dist)} mi away &middot; ${esc(loc.hours)}</div>
          <div class="pos-loc-equip">${chips}</div>
        </div>
      </button>
    `;
  }).join('');
  return `<div class="pos-loc-list">${locs}</div>`;
}

function posStep4() {
  const loc = MOCK.locations[0];
  return `
    <div class="pos-sched-truck">
      <div class="pos-sched-row"><span class="pos-sched-truck-name">${esc(R.truckLabel)}</span><span class="mono">${esc(R.truckRate)}</span></div>
      <div class="pos-sched-sub">Rental length: ${esc(R.rentalLength)}</div>
    </div>
    <div class="pos-sched-loc">
      <div class="pos-sched-loc-title">Pick Up Location (${esc(loc.entity)})</div>
      <div class="pos-sched-loc-name">Meridian Moving &amp; Storage of ${esc(loc.name)}</div>
      <div class="pos-sched-loc-addr mono">${esc(loc.address)}</div>
      <div class="pos-sched-loc-addr mono">${esc(loc.phone)}</div>
    </div>
    <label class="pos-field"><span class="pos-field-label">Available Times</span><select class="pos-input"><option selected>9:00 AM</option><option>10:00 AM</option><option>11:30 AM</option><option>1:00 PM</option><option>3:30 PM</option></select></label>
    <div class="pos-field">
      <span class="pos-field-label">Pickup Method</span>
      <div class="pos-radio-row"><label class="pos-radio"><input type="radio" name="pm4" checked> In Store</label><label class="pos-radio"><input type="radio" name="pm4"> TruckShare</label></div>
    </div>
    <label class="pos-check"><input type="checkbox"> Send to Traffic</label>
  `;
}

function posStep5() {
  return `
    <div class="pos-test-banner">Training mode. Card details are not stored or charged.</div>
    <div class="pos-card-status">Card on file — ready to confirm the reservation.</div>
    <fieldset class="pos-fieldset">
      <legend>Additional products and services</legend>
      <label class="pos-field"><span class="pos-field-label">Will you need storage before or after the move?</span><select class="pos-input"><option selected>No storage needed</option><option>Yes, before the move</option><option>Yes, after the move</option></select></label>
    </fieldset>
    <fieldset class="pos-fieldset">
      <legend>Verify contact information</legend>
      <div class="pos-grid-2">
        <label class="pos-field"><span class="pos-field-label">Email for receipt</span><input class="pos-input" type="text" value="derek.huang@gmail.com"></label>
        <label class="pos-field"><span class="pos-field-label">Phone number</span><input class="pos-input" type="tel" value="210-555-0142"></label>
      </div>
      <div class="pos-field">
        <span class="pos-field-label">Preferred Contact Method</span>
        <div class="pos-check-row"><label class="pos-check"><input type="checkbox"> Email</label><label class="pos-check"><input type="checkbox"> Phone</label><label class="pos-check"><input type="checkbox" checked> Text</label></div>
      </div>
      <label class="pos-field"><span class="pos-field-label">Current Address (optional)</span><input class="pos-input" type="text" placeholder="Street, city, state"></label>
      <div class="pos-field">
        <span class="pos-field-label">Preferred Language</span>
        <div class="pos-radio-row"><label class="pos-radio"><input type="radio" name="lang5" checked> English</label><label class="pos-radio"><input type="radio" name="lang5"> French</label><label class="pos-radio"><input type="radio" name="lang5"> Spanish</label></div>
      </div>
    </fieldset>
  `;
}

function posStepSection(step) {
  return [posStep1, posStep2, posStep3, posStep4, posStep5][step - 1]();
}

function posNavHtml(step) {
  const back = step > 1 ? '<button type="button" class="ghost-button">Back</button>' : '<span></span>';
  const next = step === 5 ? 'Complete reservation' : 'Continue';
  return `<div class="pos-nav">${back}<button type="button" class="primary-button">${esc(next)}</button></div>`;
}

function buildCallShell({
  step = 1,
  filled = false,
  stepTitle = 'Reservation Details',
  showRightRail = false,
  transcriptHtml = '',
  phoneStatusState = 'connecting',
  phoneStatusText = 'Connecting...',
  phoneStatusHint = 'Putting the call through.',
} = {}) {
  const rightRail = showRightRail ? `
          <aside class="pos-rail pos-rail-right" aria-label="Cart and payment">
            <section class="pos-card pos-cart-card">
              <div class="pos-card-head pos-card-head-accent"><span class="pos-card-title">Shopping Cart</span></div>
              <div class="pos-card-body">${cartBodyHtml(filled)}</div>
            </section>
            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Credit Card</span></div>
              <div class="pos-card-body pos-cc">${ccPanelHtml(filled && step === 5)}</div>
            </section>
          </aside>` : '';

  return `
    <section class="call" data-call-mode="phone">
      <header class="call-header">
        <button class="ghost-button call-back" type="button">Back to scenarios</button>
        <div class="call-meta">
          <div class="call-customer-name">${esc(R.customerName)}</div>
          <div class="call-scenario-title">The Price Shopper <span class="call-mode-pill">Phone call</span></div>
        </div>
        <button class="danger-button" type="button">End call</button>
      </header>
      <div class="call-body">
        ${csfTopbar(stepTitle)}
        <div class="pos" data-rail="${showRightRail ? 'full' : 'single'}">
          ${leftRailHtml(step, filled)}

          <div class="pos-stage">
            ${csfTabs()}
            <div class="csf-panel">
              <div class="csf-panel-head">U-Move</div>
              <div class="csf-panel-body">
                <form class="pos-form" autocomplete="off" novalidate>
                  <div class="pos-step" data-step="${step}">
                    ${posStepSection(step)}
                  </div>
                  ${posNavHtml(step)}
                </form>
              </div>
            </div>
          </div>

          ${rightRail}
        </div>

        ${callDockHtml(transcriptHtml, phoneStatusState, phoneStatusText, phoneStatusHint)}
      </div>
    </section>
  `;
}

function renderCallIdle() {
  return buildCallShell({
    step: 1,
    filled: false,
    transcriptHtml: '',
    phoneStatusState: 'connecting',
    phoneStatusText: 'Connecting you to Derek Huang...',
    phoneStatusHint: 'Putting the call through.',
  });
}

function renderCallCustomerSpeaking() {
  return buildCallShell({
    step: 1,
    filled: false,
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript.slice(0, 1)),
    phoneStatusState: 'customer_talking',
    phoneStatusText: 'Derek Huang is talking...',
    phoneStatusHint: 'Listen until they finish.',
  });
}

function renderCallYourTurn() {
  return buildCallShell({
    step: 1,
    filled: false,
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript.slice(0, 1)),
    phoneStatusState: 'your_turn',
    phoneStatusText: 'Your turn — just talk.',
    phoneStatusHint: 'Pause for a beat when you finish and your reply sends.',
  });
}

function renderCallMultiTurn() {
  return buildCallShell({
    step: 1,
    filled: false,
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript),
    phoneStatusState: 'your_turn',
    phoneStatusText: 'Your turn — just talk.',
    phoneStatusHint: 'Pause for a beat when you finish and your reply sends.',
  });
}

function renderCallStepDetails() {
  return buildCallShell({
    step: 1,
    filled: false,
    stepTitle: 'Reservation Details',
    showRightRail: false,
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript.slice(0, 1)),
    phoneStatusState: 'your_turn',
    phoneStatusText: 'Your turn — just talk.',
    phoneStatusHint: 'Pause for a beat when you finish and your reply sends.',
  });
}

function renderCallStepEquipment() {
  return buildCallShell({
    step: 2,
    filled: true,
    stepTitle: 'Choose Equipment',
    showRightRail: true,
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript.slice(0, 4)),
    phoneStatusState: 'your_turn',
    phoneStatusText: 'Your turn — just talk.',
    phoneStatusHint: 'Walk them through the truck that fits.',
  });
}

function renderCallStepLocation() {
  return buildCallShell({
    step: 3,
    filled: true,
    stepTitle: 'Select Pick Up Location',
    showRightRail: true,
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript.slice(0, 4)),
    phoneStatusState: 'your_turn',
    phoneStatusText: 'Your turn — just talk.',
    phoneStatusHint: 'Confirm where they are loading.',
  });
}

function renderCallStepTime() {
  return buildCallShell({
    step: 4,
    filled: true,
    stepTitle: 'Scheduling',
    showRightRail: true,
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript.slice(0, 4)),
    phoneStatusState: 'your_turn',
    phoneStatusText: 'Your turn — just talk.',
    phoneStatusHint: 'Lock in a pickup time.',
  });
}

function renderCallStepCheckout() {
  return buildCallShell({
    step: 5,
    filled: true,
    stepTitle: 'Checkout',
    showRightRail: true,
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript),
    phoneStatusState: 'your_turn',
    phoneStatusText: 'Your turn — just talk.',
    phoneStatusHint: 'Ask for the business and confirm contact info.',
  });
}

function renderCallPosHint() {
  // Shows the pos-hint cards in isolation so you can stare at the green colours.
  return `
    <section class="call" data-call-mode="phone" style="min-height: unset;">
      <div class="call-body" style="overflow: visible; padding: 24px;">
        <div style="max-width: 520px; margin: 0 auto;">
          <p class="pos-hint">Try: "Thanks for calling Meridian Moving and Storage. May I start with your cell phone number?"</p>
          <p style="margin-top: 16px;" class="pos-hint">Try: "Based on what you're moving, I'd put you in a 15-foot truck. That's $29.95 a day plus $0.89 a mile. How many days do you need it?"</p>
          <p style="margin-top: 16px;" class="pos-hint">Try: "Families who rent a truck find a Utility Dolly and a dozen Furniture Pads make the move easier. Can I add those for $17.00?"</p>
        </div>
      </div>
    </section>
  `;
}

function renderReportGenerating() {
  return `
    <section class="analyzing">
      <div class="analyzing-ring" aria-hidden="true">
        <div class="analyzing-ring-spin"></div>
      </div>
      <h1 class="analyzing-title">Analyzing your call...</h1>
      <p class="analyzing-text">Reviewing the transcript with Derek Huang and scoring against the rubric. This usually takes a few seconds.</p>
    </section>
  `;
}

function renderReportShown() {
  const r = MOCK.report;
  const RUBRIC = [
    { key: 'rapport',         label: 'Rapport & Empathy' },
    { key: 'listening',       label: 'Active Listening' },
    { key: 'problem_solving', label: 'Problem Solving' },
    { key: 'sales',           label: 'Sales Acumen' },
    { key: 'policy',          label: 'Policy & Accuracy' },
    { key: 'resolution',      label: 'Overall Resolution' },
  ];

  function rubricCard(entry, data) {
    if (!data) {
      return `
        <article class="rubric-card rubric-card-missing">
          <header class="rubric-head">
            <h3 class="rubric-label">${esc(entry.label)}</h3>
            <div class="rubric-score-text">No score</div>
          </header>
          <p class="rubric-evidence">No evidence captured.</p>
        </article>
      `;
    }
    const score = Math.max(1, Math.min(5, Math.round(Number(data.score) || 0)));
    return `
      <article class="rubric-card" data-score="${score}">
        <header class="rubric-head">
          <h3 class="rubric-label">${esc(entry.label)}</h3>
          <div class="rubric-score-text"><strong>${score}</strong> <span>/ 5</span></div>
        </header>
        <div class="rubric-bar" aria-label="Score ${score} out of 5">
          ${[1,2,3,4,5].map((i) => `<span class="rubric-bar-pip${i <= score ? ' filled' : ''}"></span>`).join('')}
        </div>
        <p class="rubric-evidence">${esc(data.evidence || '')}</p>
        <p class="rubric-suggestion"><span class="rubric-suggestion-label">Try next time</span> ${esc(data.suggestion || '')}</p>
      </article>
    `;
  }

  return `
    <section class="report">
      <header class="report-header">
        <div class="report-scenario-tag">The Price Shopper</div>
        <h1 class="report-title">Coaching report</h1>
        <div class="report-mood" data-mood="neutral">
          <span class="report-mood-dot" aria-hidden="true"></span>
          <span class="report-mood-label">Derek Huang left the call <strong>neutral</strong></span>
          <span class="report-mood-note">${esc(r.final_mood_note)}</span>
        </div>
      </header>

      <div class="report-overall">
        <div class="report-score-ring" data-score="${r.overall_score}" style="--ring-percent: 62.5%;">
          <span class="report-score-value">${r.overall_score.toFixed(1)}</span>
          <span class="report-score-divisor">/ 5</span>
        </div>
        <div class="report-overall-label">Overall</div>
      </div>

      <div class="report-disclaimer">
        <p>Every call has room to grow, even a strong one. This report is built to surface those opportunities, not to grade you. A score below five is not a failure, it simply marks where your next improvement lives. Take one thing from it into your next call.</p>
      </div>

      <div class="report-callouts">
        <div class="report-callout report-callout-strengths">
          <h2 class="callout-title">Strengths</h2>
          <ul class="callout-list">
            ${r.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}
          </ul>
        </div>
        <div class="report-callout report-callout-growth">
          <h2 class="callout-title">Growth areas</h2>
          <ul class="callout-list">
            ${r.growth_areas.map((s) => `<li>${esc(s)}</li>`).join('')}
          </ul>
        </div>
      </div>

      <blockquote class="report-pullquote">
        <div class="report-pullquote-label">One thing to try next time</div>
        <p class="report-pullquote-text">${esc(r.one_thing_to_try_next_time)}</p>
      </blockquote>

      <h2 class="report-section-title">Rubric breakdown</h2>
      <div class="report-rubric">
        ${RUBRIC.map((entry) => rubricCard(entry, r.scores[entry.key])).join('')}
      </div>

      <div class="report-actions">
        <button class="ghost-button" type="button">Back to scenarios</button>
        <button class="primary-button" type="button">Run this scenario again</button>
      </div>
    </section>
  `;
}

function renderAdminLogin() {
  return `
    <div class="admin-body" style="display:contents">
    <section class="admin-login">
      <header class="admin-login-head">
        <h1 class="admin-login-title">Admin login</h1>
        <p class="admin-login-sub">Enter the admin password to manage training invites.</p>
      </header>
      <form autocomplete="off">
        <label class="admin-field">
          <span class="admin-field-label">Admin password</span>
          <input type="password" class="admin-input" value="••••••••">
        </label>
        <button class="primary-button admin-login-btn" type="button">Sign in</button>
      </form>
    </section>
    </div>
  `;
}

function renderAdminDashboard() {
  // Scenario types panel — show two types, one expanded
  const typeExpanded = `
    <details class="admin-type" data-type="damage_dispute" open>
      <summary class="admin-type-summary">
        <span class="admin-type-info">
          <span class="admin-type-title">The Damage Dispute</span>
          <span class="admin-type-meta">5 scenarios · Medium</span>
        </span>
        <span class="admin-type-selected" data-type-count="damage_dispute">2</span>
        <svg class="admin-chev" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 2 L8 6 L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </summary>
      <div class="admin-type-body">
        <p class="admin-type-desc">Claims the truck scratched their furniture on the last rental.</p>
        <div class="admin-scenario-list">
          ${MOCK.personas.map((p, i) => `
            <label class="admin-scenario-row">
              <input type="checkbox" name="scenario_id" value="${esc(p.id)}" ${i < 2 ? 'checked' : ''}>
              <span class="admin-scenario-info">
                <span class="admin-scenario-name">${esc(p.customer_name)}${p.premium ? ' <span class="admin-pill admin-pill-premium">Premium</span>' : ''}</span>
                <span class="admin-scenario-tagline">${esc(p.tagline)}</span>
              </span>
            </label>
          `).join('')}
        </div>
      </div>
    </details>
    <details class="admin-type" data-type="price_shopper">
      <summary class="admin-type-summary">
        <span class="admin-type-info">
          <span class="admin-type-title">The Price Shopper</span>
          <span class="admin-type-meta">5 scenarios · Easy</span>
        </span>
        <svg class="admin-chev" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 2 L8 6 L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </summary>
      <div class="admin-type-body">
        <p class="admin-type-desc">On a budget, comparing quotes from three companies.</p>
        <div class="admin-scenario-list">
          <label class="admin-scenario-row">
            <input type="checkbox" name="scenario_id" value="price_1">
            <span class="admin-scenario-info">
              <span class="admin-scenario-name">Derek Huang</span>
              <span class="admin-scenario-tagline">Wants the cheapest 15' in the city.</span>
            </span>
          </label>
        </div>
      </div>
    </details>
  `;

  // Invite cards
  const inviteRows = MOCK.invites.map((inv) => {
    const status = inviteStatus(inv);
    const chips = inv.scenarios.slice(0, 4).map((s) =>
      `<span class="admin-chip">${esc(s.customer_name)}</span>`
    ).join('');
    const expiresText = inv.expires_at
      ? `expires ${fmtDate(inv.expires_at)}`
      : 'never expires';
    const usageText = fmtRelative(inv.last_click_at);

    return `
      <div class="admin-invite-card ${esc(status.cls)}">
        <div class="admin-invite-recipient">
          <div class="admin-invite-name">${esc(inv.recipient_name || inv.recipient_email)}</div>
          ${inv.recipient_name ? `<div class="admin-invite-email">${esc(inv.recipient_email)}</div>` : ''}
        </div>
        <div class="admin-invite-scenarios">${chips}</div>
        <div class="admin-invite-meta">
          <div class="admin-invite-meta-line"><strong>${inv.total_calls}</strong> ${inv.total_calls === 1 ? 'call' : 'calls'} · ${esc(usageText)}</div>
          <div class="admin-invite-meta-line">${esc(expiresText)}</div>
        </div>
        <span class="admin-pill admin-pill-${esc(status.tag)}">${esc(status.label)}</span>
        <div class="admin-invite-actions">
          ${status.tag === 'active' ? `<button type="button" class="ghost-button">Revoke</button>` : ''}
          ${status.tag === 'active' ? `<button type="button" class="ghost-button">Resend</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="admin-body" style="display:contents">
    <section class="admin-section">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Invite recipients</p>
        <h1 class="admin-section-title">Send a training invite</h1>
        <p class="admin-section-sub">Pick the scenarios you want this batch of recipients to train on, then send invites one at a time.</p>
      </header>

      <form autocomplete="off">
        <div class="admin-scenarios-panel">
          <div class="admin-scenarios-head">
            <span class="admin-scenarios-label">Scenarios</span>
            <span class="admin-selected-badge">2 selected</span>
          </div>
          <div class="admin-types-list">${typeExpanded}</div>
        </div>

        <div class="admin-invite-form">
          <div class="admin-field">
            <label class="admin-field-label" for="adm-name-prev">Name</label>
            <input type="text" id="adm-name-prev" class="admin-input" placeholder="Full name" value="Jordan Lee">
          </div>
          <div class="admin-field">
            <label class="admin-field-label" for="adm-email-prev">Email</label>
            <input type="email" id="adm-email-prev" class="admin-input" placeholder="name@firm.com" value="jordan.lee@firmmovingco.com">
          </div>
          <div class="admin-field">
            <label class="admin-field-label" for="adm-expiry-prev">Expiry</label>
            <select id="adm-expiry-prev" class="admin-select">
              <option value="7" selected>7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="never">Never</option>
            </select>
          </div>
          <div class="admin-send-cell">
            <button type="button" class="primary-button">Send invite</button>
          </div>
        </div>
      </form>
    </section>

    <section class="admin-section">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Members</p>
        <h2 class="admin-section-title">Active invites</h2>
        <p class="admin-section-sub">Every recipient with a live or past link. Revoke to disable a link immediately.</p>
      </header>
      <div class="admin-invite-list">${inviteRows}</div>
    </section>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// State catalog
// ---------------------------------------------------------------------------

const STATES = [
  { id: 'auth-login',            label: 'Auth — Login splash',                render: renderAuthLogin },
  { id: 'home-welcome',          label: 'Home — Training center landing',      render: renderHomeWelcome },
  { id: 'picker-type',           label: 'Picker — Scenario type grid',         render: renderPickerType },
  { id: 'picker-persona',        label: 'Picker — Persona list (Damage Dispute)', render: renderPickerPersona },
  { id: 'picker-random',         label: 'Picker — Random card isolated',       render: renderPickerRandom },
  { id: 'recipient-home',        label: 'Recipient — Personal training page',  render: renderRecipientHome },
  { id: 'kiosk-splash',          label: 'Kiosk — Mic disclaimer splash',       render: renderKioskSplash },
  { id: 'call-idle',             label: 'Call — Idle / Connecting',            render: renderCallIdle },
  { id: 'call-customer-speaking', label: 'Call — Customer speaking',           render: renderCallCustomerSpeaking },
  { id: 'call-your-turn',        label: 'Call — Your turn',                    render: renderCallYourTurn },
  { id: 'call-multi-turn',       label: 'Call — Multi-turn transcript',        render: renderCallMultiTurn },
  { id: 'call-step-details',     label: 'Call — Step 1: Details',              render: renderCallStepDetails },
  { id: 'call-step-equipment',   label: 'Call — Step 2: Equipment',            render: renderCallStepEquipment },
  { id: 'call-step-location',    label: 'Call — Step 3: Location',             render: renderCallStepLocation },
  { id: 'call-step-time',        label: 'Call — Step 4: Time / Scheduling',    render: renderCallStepTime },
  { id: 'call-step-checkout',    label: 'Call — Step 5: Checkout',             render: renderCallStepCheckout },
  { id: 'call-pos-script-hint',  label: 'Call — POS script hint cards',        render: renderCallPosHint },
  { id: 'report-generating',     label: 'Report — Generating spinner',         render: renderReportGenerating },
  { id: 'report-shown',          label: 'Report — Full coaching report',       render: renderReportShown },
  { id: 'admin-login',           label: 'Admin — Login card',                  render: renderAdminLogin },
  { id: 'admin-dashboard',       label: 'Admin — Dashboard (invites + scenarios)', render: renderAdminDashboard },
];

// ---------------------------------------------------------------------------
// Navigation wiring
// ---------------------------------------------------------------------------

const root = document.getElementById('preview-root');
const sel  = document.getElementById('preview-select');
const printToggle = document.getElementById('preview-print-toggle');

// Build dropdown
STATES.forEach((s) => {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = s.label;
  sel.appendChild(opt);
});

function showState(id) {
  const s = STATES.find((x) => x.id === id) || STATES[0];

  // Clear print-all mode so single-state view works
  document.body.classList.remove('print-all');
  printToggle.classList.remove('active');
  printToggle.textContent = 'Print all';

  root.innerHTML = s.render();
  sel.value = s.id;

  // Auth login: temporarily override body class so auth styles apply
  const bodyOverride = root.querySelector('body-override');
  if (bodyOverride) {
    document.body.classList.add('auth-page');
  } else {
    document.body.classList.remove('auth-page');
  }

  // Update hash without triggering hashchange
  history.replaceState(null, '', `#${s.id}`);
}

function showAll() {
  document.body.classList.add('print-all');
  document.body.classList.remove('auth-page');
  printToggle.classList.add('active');
  printToggle.textContent = 'Exit print all';

  root.innerHTML = STATES.map((s) => `
    <div class="preview-divider">${esc(s.id)} — ${esc(s.label)}</div>
    <div class="preview-state active" data-state="${esc(s.id)}">${s.render()}</div>
  `).join('');
}

sel.addEventListener('change', () => showState(sel.value));

printToggle.addEventListener('click', () => {
  if (document.body.classList.contains('print-all')) {
    // Exit print-all: go back to whatever the select shows
    showState(sel.value);
  } else {
    showAll();
  }
});

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id && STATES.some((s) => s.id === id)) showState(id);
});

// Initial load: use hash if valid, else first state
const initialId = location.hash.slice(1);
if (initialId && STATES.some((s) => s.id === initialId)) {
  showState(initialId);
} else {
  showState(STATES[0].id);
}
