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
    { kind: 'customer', label: 'Alex Anderson', text: 'Hi, I need to rent a truck for the Fourth of July weekend. We\'re moving from a two-bedroom here in Gainesville to a three-bedroom apartment.' },
    { kind: 'agent',    label: 'You',           text: 'Happy to help! For a two-bedroom into a three-bedroom, most families do great with our 20-foot truck. Does that sound about right for what you\'re moving?' },
    { kind: 'customer', label: 'Alex Anderson', text: 'Yeah, that sounds about right. We\'ve got a decent amount of furniture.' },
    { kind: 'agent',    label: 'You',           text: 'Perfect. The 20-foot is $39.95 plus $1.19 a mile. Most families need about 8 hours with it — will that work for you?' },
    { kind: 'customer', label: 'Alex Anderson', text: 'Eight hours should be plenty, we\'re only going a few miles across town.' },
    { kind: 'agent',    label: 'You',           text: 'Great. Families who rent the 20-foot also find a utility dolly and a dozen furniture pads make the move a lot easier — can I add those for $17.00?' },
  ],

  // In-progress reservation used across the POS step previews (steps 2-5).
  // Matched to the CSF equipment-page reference for a 1:1 visual compare.
  reservation: {
    customerName: 'Alex Anderson',
    phone: '(904) 210-1071',
    email: 'alexander_anderson@uhaul.com',
    movingFrom: 'GAINESVILLE, FL 32609',
    movingTo: '',
    rentalDate: '7/4/2026',
    moving: '2 Bedroom Home to 3 Bedroom Apt.',
    moveType: 'In Town',
    truckLabel: "20' Moving Truck",
    truckRate: '$39.95 + $1.19/mile',
    rentalLength: '8 hour(s)',
    location: 'Gainesville Main',
    pickupTime: 'Sat, Jul 4 · 9:00 AM',
  },

  truckSizes: [
    { size: 10, base: 19.95, per_mile: 0.79 },
    { size: 15, base: 29.95, per_mile: 0.99 },
    { size: 20, base: 39.95, per_mile: 1.19 },
    { size: 26, base: 49.95, per_mile: 1.39 },
  ],

  locations: [
    { name: 'Meridian Moving & Storage of Gainesville', entity: '833071', address: '4821 NW 6TH ST, GAINESVILLE, FL 32609',    phone: '(352) 555-0188', hours: 'Open until 7:00 PM', dist: '0.9' },
    { name: '39th Convenience & Bait Shop',             entity: '511204', address: '3910 NW 13TH ST, GAINESVILLE, FL 32609',     phone: '(352) 555-0231', hours: 'Open until 9:00 PM', dist: '1.4' },
    { name: 'EconoMart Food & Beverage',                entity: '622315', address: '1200 SE HAWTHORNE RD, GAINESVILLE, FL 32641', phone: '(352) 555-0177', hours: 'Open until 10:00 PM', dist: '2.1' },
    { name: 'Meridian at University of Florida',        entity: '733428', address: '1800 W UNIVERSITY AVE, GAINESVILLE, FL 32603', phone: '(352) 555-0199', hours: 'Open until 6:00 PM', dist: '3.0' },
    { name: 'Walkers One Stop Shop LLC',                entity: '844539', address: '5500 NW 34TH BLVD, GAINESVILLE, FL 32605',     phone: '(352) 555-0144', hours: 'Open until 8:00 PM', dist: '3.8' },
  ],

  // Cart matches the reference: truck + environmental fee + VLRF.
  cartLines: [
    { label: "20' Moving Truck", sub: '+ $1.19/mile', amount: 39.95 },
    { label: 'Environmental Fee', sub: '', amount: 1.00 },
    { label: 'Vehicle License Recovery Fee - FL H/W Truck', sub: '', amount: 1.20 },
  ],
  cartUMoveTotal: 42.15,
  cartTotal: 42.15,

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
      beginning_greeting: {
        score: 4,
        evidence: '"Thanks for calling Meridian, this is Derek" opened with a clean branded greeting.',
        suggestion: 'Slow the greeting down a touch so the brand and your name land clearly.',
      },
      beginning_offer: {
        score: 4,
        evidence: '"How can I help you today?" set a warm, ready-to-help tone right away.',
        suggestion: 'Use the customer\'s name once you have it to add a little personal warmth.',
      },
      gathering_details: {
        score: 4,
        evidence: 'Asked where they were moving from and to and confirmed the date.',
        suggestion: 'Read the move details back once collected so the customer can catch anything you missed.',
      },
      gathering_equipment: {
        score: 3,
        evidence: 'Identified the 15-foot truck from the furniture description.',
        suggestion: 'Briefly say why that size fits ("most 2-bedrooms do great in the 15-foot").',
      },
      scheduling_location: {
        score: 4,
        evidence: 'Confirmed the Gainesville branch as the closest pickup.',
        suggestion: 'Mention the address and hours so the customer knows exactly where to go.',
      },
      scheduling_time: {
        score: 2,
        evidence: 'Never nailed down a firm pickup time before moving on.',
        suggestion: 'Lock the time explicitly: "Let\'s set pickup for 9 AM Saturday, does that work?"',
      },
      wrap_readback: {
        score: 2,
        evidence: 'Call ended without reading back the reservation or a confirmation number.',
        suggestion: 'Always read back: confirmation number, truck, date, time, and total.',
      },
      wrap_close: {
        score: 3,
        evidence: '"Anything else I can do for you?" gave a courteous close.',
        suggestion: 'Confirm the next step (the texted confirmation + app check-in) before saying goodbye.',
      },
      general_objections: {
        score: 4,
        evidence: 'Handled the price-vs-competitor objection calmly with a value comparison.',
        suggestion: 'After answering the objection, move straight to the ask instead of waiting.',
      },
      general_advisories: {
        score: 3,
        evidence: 'Quoted the rate but did not mention the environmental fee or VLRF upfront.',
        suggestion: 'Read the required fees and advisories before the total so nothing is a surprise.',
      },
      general_upsell: {
        score: 2,
        evidence: 'Missed the furniture-pads upsell when the sectional came up.',
        suggestion: 'When a storage or add-on opportunity surfaces, name it: "Would storage help while you settle in?"',
      },
      general_policy: {
        score: 4,
        evidence: 'Correctly quoted the 15-foot rate and per-mile charge.',
        suggestion: 'Keep policy references exact; avoid promising holds beyond the stated cutoff.',
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
      recipient_email: 'priya@meridiansimulations.org',
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
        <div class="welcome-eyebrow">Simulation</div>
        <h1 class="welcome-title">Education &amp; Development</h1>
        <p class="welcome-lead">Pick a track to practice. Each is a set of realistic, voice-driven customer calls with a scored coaching report at the end.</p>
      </header>

      <div class="welcome-section">
        <div class="welcome-section-eyebrow">Simulation tracks</div>
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
          <h3 class="mode-choice-title">Explore More Scenarios</h3>
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
        <button class="ghost-button" type="button"><span aria-hidden="true">‹</span> Back to home</button>
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
        <div class="recipient-eyebrow">Sales simulation</div>
        <h1 class="recipient-title">Hi Jordan</h1>
        <p class="recipient-subtitle">You have 3 simulations to take.</p>
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
        <div class="kiosk-eyebrow">Sales simulation</div>
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

// CSF top header — mirrors the real Customer Service Form chrome. Step 1 shows
// "New Reservation"; mid-reservation steps show Back / Next / Save-Close Quote.
function csfTopbar(stepTitle, step) {
  const actions = step === 1
    ? `<button type="button" class="csf-new-btn">New Reservation</button>`
    : `<div class="csf-topbar-actions">
         <button type="button" class="csf-topbtn">${BACK_ICON} Back</button>
         <button type="button" class="csf-topbtn">${NEXT_ICON} Next</button>
         <button type="button" class="csf-topbtn">${CLOSE_ICON} Save/Close Quote</button>
       </div>`;
  return `
    <div class="csf-topbar">
      <div class="csf-topbar-titles">
        <div class="csf-eyebrow">Customer Service Form</div>
        <div class="csf-title">${esc(stepTitle)}</div>
        ${step === 1 ? '<div class="csf-subtitle">CSF Admin / Rules</div>' : ''}
      </div>
      <div class="csf-topbar-nav">
        <div class="csf-nav-row">
          <a class="csf-nav-link">FAQs</a>
          <a class="csf-nav-link">POS Dashboard</a>
        </div>
        ${actions}
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

const SCRIPT_ICON = `<svg class="csf-script-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-4 3v-3H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const EDIT_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M9.5 3 L13 6.5 L6 13.5 L2.5 13.5 L2.5 10 Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const BACK_ICON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 5 L6 8 L9 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const NEXT_ICON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M7 5 L10 8 L7 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

// Step 1 left-rail opening script (greeting + first ask, both green).
function leftScript() {
  return `
    <div class="pos-script">
      <svg class="pos-script-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-4 3v-3H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      <div class="pos-script-lines">
        <p class="pos-script-line">Thank you for calling Meridian Moving and Storage, this is Alexander. How may I help you?</p>
        <p class="pos-script-suggest">No problem! May I start with your cell phone number?</p>
      </div>
    </div>
  `;
}

// Main-panel call script for steps 2-5 (green). Step 2 is the rich equipment
// pitch with the Yes/No fit check and the objection-help line.
function panelScript(step) {
  if (step === 2) {
    return `
      <div class="csf-script">
        <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">Most families need about 8 hours with a 20' Moving Truck. Will that work for you?</p></div>
        <div class="pos-radio-row" style="margin-left:25px;">
          <label class="pos-radio"><input type="radio" name="eq-fit" checked> Yes</label>
          <label class="pos-radio"><input type="radio" name="eq-fit"> No</label>
        </div>
        <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">The rate for the 20' Moving Truck I recommend is $39.95 plus $1.19/mile plus a $1.00 environmental fee and a $1.20 Vehicle License Recovery Fee, plus local taxes. Which credit card would you like to use to confirm this reservation?</p></div>
        <p class="csf-script-text csf-script-indent">Alex, families who rent a 20' Moving Truck find adding a Utility Dolly and a dozen Furniture Pads make their move easier. Can I add this to your rental for $17.00?</p>
        <a class="csf-link csf-script-indent">Add UD/PO</a>
      </div>
      <div class="csf-objection">Is the customer not ready to book? <a class="csf-link">Click for help to overcome their objections</a> to book now!</div>
    `;
  }
  const lines = {
    3: ['The closest pickup spot to you is our Gainesville Main store on SW Archer Road. Does that work?'],
    5: ['What is your preferred method of contact: email, phone, or text?', 'Can I go ahead and lock in that reservation for you?'],
  }[step] || [];
  if (!lines.length) return '';
  return `<div class="csf-script" style="margin-bottom:16px;">${lines.map((t) =>
    `<div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">${esc(t)}</p></div>`
  ).join('')}</div>`;
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
  if (!filled) {
    // Pre-lookup: Customer Contact Information with the opening script.
    return `
      <aside class="pos-rail pos-rail-left" aria-label="Customer and reservation context">
        <section class="pos-card">
          <div class="pos-card-head"><span class="pos-card-title">Customer Contact Information</span>${EDIT_ICON}</div>
          <div class="pos-card-body">${leftScript()}${lookupHtml()}</div>
        </section>
        <section class="pos-card">
          <div class="pos-card-head"><span class="pos-card-title">Reservation Notes</span>${EDIT_ICON}</div>
          <div class="pos-card-body" style="min-height:36px;"></div>
        </section>
      </aside>
    `;
  }
  // Post-lookup: full customer profile + reservation details.
  return `
    <aside class="pos-rail pos-rail-left" aria-label="Customer and reservation context">
      <section class="pos-card">
        <div class="pos-card-head"><span class="pos-card-title">Customer</span>${EDIT_ICON}</div>
        <div class="pos-card-body">
          <div class="csf-cust-name">${esc(R.customerName)}</div>
          <div class="csf-cust-line">${esc(R.phone)}</div>
          <div class="csf-cust-line">${esc(R.email)}</div>
          <div class="csf-verified"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.3 8 L7 9.7 L10.7 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Verified Customer</div>
          <div class="csf-pastrentals"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5 V8 L10.5 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Past Rentals/Reservations</div>
        </div>
      </section>
      <section class="pos-card">
        <div class="pos-card-head"><span class="pos-card-title">Checklist</span></div>
        <div class="pos-card-body"><div class="pos-check-item">U-Move</div></div>
      </section>
      <section class="pos-card">
        <div class="pos-card-head"><span class="pos-card-title">Reservation Details</span>${EDIT_ICON}</div>
        <div class="pos-card-body">
          <div class="csf-rd-group"><span class="csf-rd-label">Moving From</span><span class="csf-rd-value">${esc(R.movingFrom)}</span></div>
          <div class="csf-rd-group"><span class="csf-rd-label">Rental Date</span><span class="csf-rd-value">${esc(R.rentalDate)}</span></div>
          <div class="csf-rd-group"><span class="csf-rd-label">Moving</span><span class="csf-rd-value">${esc(R.moving)}</span></div>
          <div class="csf-rd-label">${esc(R.moveType)}</div>
          <button type="button" class="csf-convert-btn">Convert to One-Way</button>
        </div>
      </section>
      ${step >= 3 ? `
      <section class="pos-card">
        <div class="pos-card-head"><span class="pos-card-title">Entity ${esc(MOCK.locations[0].entity)}</span><span style="cursor:pointer;font-size:18px;line-height:1;font-weight:400;">+</span></div>
      </section>` : ''}
      <section class="pos-card">
        <div class="pos-card-head"><span class="pos-card-title">Reservation Notes</span>${EDIT_ICON}</div>
        <div class="pos-card-body">
          <div class="csf-notes-label">Customer Notes</div>
          <div class="csf-notes-text">No cautionary notes &nbsp;·&nbsp; <a class="csf-link">Add Cautionary Note</a></div>
          <div class="csf-notes-label">Callback Notes</div>
        </div>
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
  const trash = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const lines = MOCK.cartLines.map((l) => `
    <div class="csf-cart-line">
      <div class="csf-cart-line-label">${esc(l.label)}</div>
      <div class="csf-cart-line-amt">${fmtMoney(l.amount)}${l.sub ? `<span class="csf-cart-line-sub">${esc(l.sub)}</span>` : ''}</div>
    </div>
  `).join('');
  return `
    <div class="csf-cart-sub"><span>U-Move</span><span style="cursor:pointer;">${trash}</span></div>
    ${lines}
    <div class="csf-cart-subtotal"><span>U-Move Total:</span><span>${fmtMoney(MOCK.cartUMoveTotal)}</span></div>
    <div class="csf-cart-total"><span>Total</span><span>${fmtMoney(MOCK.cartTotal)}</span></div>
    <div class="csf-cart-links">
      <a class="csf-link">Estimate Price w/ Mileage</a>
      <a class="csf-link">Show Taxes</a>
      <a class="csf-link">View Coverage Rates</a>
    </div>
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
  const truckSvg = `<svg viewBox="0 0 80 48" fill="none" aria-hidden="true"><rect x="2" y="12" width="46" height="26" rx="2" stroke="currentColor" stroke-width="2"/><path d="M48 20h15l13 10v8H48z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="20" cy="40" r="5" stroke="currentColor" stroke-width="2"/><circle cx="62" cy="40" r="5" stroke="currentColor" stroke-width="2"/></svg>`;
  const boxSvg = `<svg viewBox="0 0 64 48" fill="none" aria-hidden="true"><rect x="14" y="8" width="36" height="34" rx="2" stroke="currentColor" stroke-width="2"/><path d="M14 18h36M28 8v34" stroke="currentColor" stroke-width="2"/></svg>`;
  const arrows = `<span class="csf-equip-arrows"><svg viewBox="0 0 12 8" fill="none"><path d="M2 6 L6 2 L10 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><svg viewBox="0 0 12 8" fill="none"><path d="M2 2 L6 6 L10 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  const dims = `<a class="csf-equip-dims">&#9776; Dimensions</a>`;
  return `
    <div class="csf-equip-grid">
      <div class="csf-equip-card">
        <div class="csf-equip-banner">&#128077; Recommended</div>
        <div class="csf-equip-head">${arrows}<span class="csf-equip-head-name">20' Moving Truck</span></div>
        <div class="csf-equip-body">
          <div class="csf-equip-img">${truckSvg}</div>
          <div class="csf-equip-rate">$39.95 <span class="csf-equip-rate-sub">+ $1.19/mile</span></div>
          <div class="csf-equip-length">
            <span class="csf-equip-length-label">Rental Length:</span>
            <select class="pos-input"><option selected>8 hour(s)</option><option>1 day</option><option>2 days</option></select>
          </div>
          <button type="button" class="csf-equip-btn csf-equip-btn-selected">&#10003; Selected</button>
          <p class="csf-equip-note">Equipment must be dropped off at the pick up location.</p>
          ${dims}
        </div>
      </div>
      <div class="csf-equip-card">
        <div class="csf-equip-head"><input class="csf-equip-qty" value="4"><span class="csf-equip-head-name">U-Box Container(s)</span></div>
        <div class="csf-equip-body">
          <div class="csf-equip-img">${boxSvg}<span class="csf-equip-badge-count">4</span></div>
          <div class="csf-equip-rate">$279.80 <span class="csf-equip-rate-sub">+ Delivery</span></div>
          <button type="button" class="csf-equip-btn csf-equip-btn-select">Select</button>
          <p class="csf-equip-note">Rate includes one month of U-Box access and a dozen furniture pads.</p>
          <p class="csf-equip-note">($69.95 per box)</p>
          ${dims}
        </div>
      </div>
    </div>
    <a class="csf-showall">&#43; Show all moving equipment</a>
  `;
}

function posStep3() {
  const pin = (n) => `<svg viewBox="0 0 24 30" fill="currentColor" aria-hidden="true"><path d="M12 0C6 0 1.5 4.5 1.5 10.5 1.5 18 12 30 12 30s10.5-12 10.5-19.5C22.5 4.5 18 0 12 0z"/></svg><span>${n}</span>`;
  const pins = [
    { x: '47%', y: '60%', n: 1 }, { x: '53%', y: '52%', n: 2 },
    { x: '43%', y: '68%', n: 3 }, { x: '50%', y: '62%', n: 4 },
  ].map((p) => `<div class="csf-map-pin" style="left:${p.x};top:${p.y};">${pin(p.n)}</div>`).join('');

  const map = `
    <div class="csf-map">
      <div class="csf-map-roadtag">Road</div>
      ${pins}
    </div>
  `;

  const controls = `
    <div class="csf-loc-controls">
      <span class="csf-loc-sort">Sort by: <a class="csf-link">Distance to Customer &#9662;</a></span>
      <div class="csf-loc-filters">
        <label class="pos-check"><input type="checkbox" checked> Trucks</label>
        <label class="pos-check"><input type="checkbox"> Trailers</label>
        <label class="pos-check"><input type="checkbox"> Towing</label>
      </div>
      <div class="csf-loc-legend">
        <span><i class="csf-legend-sq" style="background:#16a34a;"></i> Available</span>
        <span><i class="csf-legend-sq" style="background:#ea7a1d;"></i> Alternate Models</span>
        <span><i class="csf-legend-sq" style="background:#dc2626;"></i> No Availability</span>
      </div>
    </div>
  `;

  const locs = MOCK.locations.map((loc, i) => {
    const open = i === 0;
    return `
      <div class="csf-loc-card">
        <div class="csf-loc-card-head">
          <span class="csf-loc-num">${i + 1}</span>
          <span class="csf-loc-card-name">${esc(loc.name)}</span>
          <span class="csf-loc-toggle">${open ? '&minus;' : '+'}</span>
        </div>
        ${open ? `
        <div class="csf-loc-card-body">
          <div class="csf-loc-card-addr">${esc(loc.address)}</div>
          <div class="csf-loc-card-dist">${esc(loc.dist)} mile(s)</div>
          <div class="csf-loc-card-links">
            <a class="csf-link">&#9678; Directions</a>
            <a class="csf-link">Cross Contact (${esc(loc.entity)})</a>
            <a class="csf-link">View ESL</a>
          </div>
        </div>` : ''}
      </div>
    `;
  }).join('');

  const equip = [
    { model: "10' Moving Truck", price: '$19.95', sub: '+ $1.19/mile' },
    { model: "15' Moving Truck", price: '$29.95', sub: '+ $1.19/mile' },
    { model: "20' Moving Truck", price: '$39.95', sub: '+ $1.19/mile', sel: true },
    { model: "26' Moving Truck", price: '$49.95', sub: '+ $1.19/mile' },
    { model: "4' x 7' Utility Trailer", price: '$14.95' },
    { model: "5' x 8' Utility Trailer", price: '$24.95' },
    { model: "5' x 8' Cargo Trailer", price: '$24.95' },
    { model: "4' x 8' Cargo Trailer", price: '$19.95' },
    { model: "5' x 9' Utility Trailer with Ramp", price: '$29.95' },
    { model: "6' x 12' Utility Trailer with Ramp", price: '$39.95' },
  ];
  const equipRows = equip.map((e) => `
    <tr>
      <td><span class="csf-eq-cell"><input type="checkbox"${e.sel ? ' checked' : ''}> ${esc(e.model)}</span></td>
      <td>${esc(e.price)}${e.sub ? ` <span class="csf-eq-permile">${esc(e.sub)}</span>` : ''}</td>
    </tr>
  `).join('');

  return `
    <p class="csf-loc-note">Based on the selections, rates may have been updated for this quote. If rates were updated, make sure to inform the customer of any changes before proceeding.</p>
    ${map}
    ${controls}
    <div class="csf-loc-split">
      <div>
        <div class="csf-loc-avail-head">Available and Closest</div>
        ${locs}
        <a class="csf-loc-more">View More Locations…</a>
      </div>
      <div>
        <div class="csf-equip-avail-name">${esc(MOCK.locations[0].name)}</div>
        <select class="pos-input csf-equip-select"><option selected>Available Equipment</option></select>
        <table class="csf-equip-table">
          <thead><tr><th>Model</th><th>Price</th></tr></thead>
          <tbody>${equipRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function posStep4() {
  const loc = MOCK.locations[0];
  const addrParts = loc.address.split(',');
  const street = addrParts.shift().trim();
  const rest = addrParts.join(',').trim();
  const truckSvg = `<svg viewBox="0 0 80 48" fill="none" aria-hidden="true"><rect x="2" y="12" width="46" height="26" rx="2" stroke="currentColor" stroke-width="2"/><path d="M48 20h15l13 10v8H48z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="20" cy="40" r="5" stroke="currentColor" stroke-width="2"/><circle cx="62" cy="40" r="5" stroke="currentColor" stroke-width="2"/></svg>`;
  const times = ['Select a time...', '9:00 AM', '10:00 AM', '11:30 AM', '1:00 PM', '3:30 PM'];
  return `
    <div class="csf-sched-grid">
      <div class="csf-sched-left">
        <div class="csf-sched-truck-row">
          <div class="csf-sched-truck-img">${truckSvg}</div>
          <div>
            <div class="csf-sched-truck-name">20' Moving Truck ${EDIT_ICON}</div>
            <div class="csf-sched-truck-rate">$39.95 <span>+ $1.19/mile</span></div>
          </div>
        </div>
        <div class="csf-sched-addlinks">
          <a class="csf-link">&#43; Add Coverage</a>
          <a class="csf-link">&#43; Add Dollies/Furniture Pads</a>
          <a class="csf-link">&#43; Add Trailer / Towing</a>
        </div>
        <div class="csf-sched-loc-title">Pick Up Location (${esc(loc.entity)})</div>
        <div class="csf-sched-loc-name">${esc(loc.name)}</div>
        <div class="csf-sched-loc-addr">&#9678; ${esc(street)}</div>
        <div class="csf-sched-loc-addr">${esc(rest)}</div>
        <div class="csf-sched-loc-addr">&#9742; ${esc(loc.phone)}</div>
        <div class="csf-sched-loc-links">
          <a class="csf-link">Directions</a>
          <a class="csf-link">Cross Contact</a>
        </div>
      </div>
      <div class="csf-sched-right">
        <div class="csf-sched-rl-label">Rental Length ${EDIT_ICON}</div>
        <div class="csf-sched-rl-value">8 hour(s)</div>
        <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">What time would you like to pick up?</p></div>
        <label class="pos-field"><span class="pos-field-label">Available Times</span><select class="pos-input">${times.map((t, i) => `<option${i === 0 ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <div class="pos-radio-row"><label class="pos-radio"><input type="radio" name="pm4"> In Store</label><label class="pos-radio"><input type="radio" name="pm4"> TruckShare</label></div>
        <a class="csf-link" style="display:inline-block;margin-bottom:12px;">Check Other Locations</a>
        <label class="pos-check"><input type="checkbox"> Send to Traffic</label>
      </div>
    </div>
  `;
}

function posStep5() {
  const infoIcon = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2v3.6M8 5.2v.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const months = ['1 - January', '2 - February', '3 - March', '4 - April', '5 - May', '6 - June', '7 - July', '8 - August', '9 - September', '10 - October', '11 - November', '12 - December'];
  const years = ['2026', '2027', '2028', '2029', '2030'];

  // 1. Credit card to confirm reservation
  const creditCard = `
    <section class="pos-card">
      <div class="pos-card-head" style="display:flex;align-items:center;justify-content:space-between;"><span class="pos-card-title">Credit Card to Confirm Reservation</span>${infoIcon}</div>
      <div class="pos-card-body">
        <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">Which credit card would you like to use to confirm your reservation?</p></div>
        <div class="pos-grid-3">
          <label class="pos-field"><span class="pos-field-label">* Card Number</span><input class="pos-input" type="text"></label>
          <label class="pos-field"><span class="pos-field-label">* Expiration Month</span><select class="pos-input">${months.map((m) => `<option>${m}</option>`).join('')}</select></label>
          <label class="pos-field"><span class="pos-field-label">* Expiration Year</span><select class="pos-input">${years.map((y) => `<option>${y}</option>`).join('')}</select></label>
        </div>
        <div class="pos-grid-2" style="align-items:end;">
          <label class="pos-field"><span class="pos-field-label">* Billing Zip Code</span><input class="pos-input" type="text" value="32609"></label>
          <div class="csf-row-end"><button type="button" class="primary-button">Save</button></div>
        </div>
        <div class="csf-cc-links">
          <a class="csf-link">&#43; Add Gift Card/Certificate</a>
          <a class="csf-link">What is a gift card/certificate?</a>
          <a class="csf-link">More Payment Options</a>
        </div>
      </div>
    </section>
  `;

  // 2. Additional products and services (sub-tabs)
  const additional = `
    <section class="pos-card">
      <div class="pos-card-head" style="display:flex;align-items:center;justify-content:space-between;"><span class="pos-card-title">Additional Products and Services</span><span style="cursor:pointer;font-size:18px;line-height:1;">&minus;</span></div>
      <div class="pos-card-body">
        <div class="csf-tabs">
          <button type="button" class="csf-tab active">Storage</button>
          <button type="button" class="csf-tab">Dollies/Furniture Pads</button>
          <button type="button" class="csf-tab">Moving Help</button>
        </div>
        <div class="csf-subtab-body">
          <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">Will you need storage before or after your move?</p></div>
          <div class="pos-grid-2">
            <label class="pos-field"><span class="pos-field-label">Storage Location</span><select class="pos-input"><option selected>Select</option><option>Gainesville Main</option></select></label>
            <label class="pos-field"><span class="pos-field-label">Move In Date</span><input class="pos-input" type="date"></label>
          </div>
          <div class="pos-field">
            <span class="pos-field-label">Do you want to add storage at another location?</span>
            <div class="pos-radio-row"><label class="pos-radio"><input type="radio" name="stor"> Yes</label><label class="pos-radio"><input type="radio" name="stor" checked> No</label></div>
          </div>
          <div class="csf-row-end"><button type="button" class="primary-button">Find Storage Rooms</button></div>
        </div>
      </div>
    </section>
  `;

  // 3. U-Move reservation details (collapsed)
  const rsvDetails = `
    <section class="pos-card">
      <div class="pos-card-head" style="display:flex;align-items:center;justify-content:space-between;"><span class="pos-card-title">U-Move Reservation Details</span><span style="cursor:pointer;font-size:18px;line-height:1;font-weight:400;">+</span></div>
    </section>
  `;

  // 4. Verify contact information for scheduling
  const verify = `
    <section class="pos-card">
      <div class="pos-card-head"><span class="pos-card-title">Verify Contact Information for Scheduling</span></div>
      <div class="pos-card-body">
        <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">What is your preferred method of contact; email, phone or text?</p></div>
        <p class="csf-verify-note">Please verify with your customer the email/phone number shown below.</p>
        <ul class="csf-verify-list">
          <li>Customer's Email Address is required if they prefer being contacted via Email.</li>
          <li>Customer's Phone Number is required if they prefer being contacted via Phone or Text.</li>
        </ul>
        <div class="pos-grid-3">
          <label class="pos-field"><span class="pos-field-label">Email for Reservation Receipt</span><input class="pos-input" type="text" value="${esc(R.email)}"></label>
          <label class="pos-field"><span class="pos-field-label">Phone Number</span><input class="pos-input" type="tel" value="${esc(R.phone)}"></label>
          <div class="pos-field"><span class="pos-field-label">Preferred Contact Method</span><div class="pos-check-row"><label class="pos-check"><input type="checkbox"> Email</label><label class="pos-check"><input type="checkbox"> Phone</label><label class="pos-check"><input type="checkbox" checked> Text</label></div></div>
        </div>
        <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">May I please have your current address?</p></div>
        <div class="pos-grid-2">
          <label class="pos-field"><span class="pos-field-label">Current Address</span><input class="pos-input" type="text" placeholder="Optional"></label>
          <div class="pos-field"><span class="pos-field-label">Preferred Language</span><div class="pos-radio-row"><label class="pos-radio"><input type="radio" name="lang5" checked> English</label><label class="pos-radio"><input type="radio" name="lang5"> French</label><label class="pos-radio"><input type="radio" name="lang5"> Spanish</label></div></div>
        </div>
        <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">Would you like to add an Authorized Contact to your reservation, who can call in on your behalf to ask questions and/or make changes?</p></div>
        <a class="csf-link">Authorized Contacts</a>
      </div>
    </section>
  `;

  return creditCard + additional + rsvDetails + verify;
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
  timer = '00:00',
  paused = false,
} = {}) {
  const trashIcon = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const infoIcon = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2v3.6M8 5.2v.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  const rightRail = showRightRail ? `
          <aside class="pos-rail pos-rail-right" aria-label="Cart and payment">
            <section class="pos-card pos-cart-card">
              <div class="pos-card-head pos-card-head-accent"><span class="pos-card-title">Shopping Cart</span><span style="cursor:pointer;">${trashIcon}</span></div>
              <div class="pos-card-body">${cartBodyHtml(filled)}</div>
            </section>
            ${step !== 5 ? `
            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Credit Card</span></div>
              <div class="pos-card-body pos-cc">${ccPanelHtml(false)}</div>
            </section>` : ''}
          </aside>` : '';

  // The category tabs only appear on the Details step (where you confirm the
  // U-Move category). Later steps drop them and the panel stands alone.
  const tabs = step === 1 ? csfTabs() : '';
  const standalone = step === 1 ? '' : ' data-standalone="true"';
  const panelHead = step === 1 ? 'U-Move' : stepTitle;
  const primaryLabel = step === 5 ? 'Book it' : (step === 1 ? 'Continue' : 'Next');

  return `
    <section class="call" data-call-mode="phone"${paused ? ' data-paused="true"' : ''}>
      <header class="call-header">
        <button class="ghost-button call-back" type="button">Back to scenarios</button>
        <div class="call-meta">
          <div class="call-customer-name">${esc(R.customerName)}</div>
          <div class="call-scenario-title">The Price Shopper <span class="call-mode-pill">Phone call</span></div>
        </div>
        <div class="call-actions">
          <span class="call-timer" role="timer" aria-label="Call duration">${esc(timer)}</span>
          <button class="ghost-button call-pause${paused ? ' is-paused' : ''}" type="button" aria-pressed="${paused ? 'true' : 'false'}">${paused ? 'Resume' : 'Pause'}</button>
          <button class="danger-button" type="button">End call</button>
        </div>
      </header>
      <div class="call-body">
        ${csfTopbar(stepTitle, step)}
        <div class="pos" data-rail="${showRightRail ? 'full' : 'single'}">
          ${leftRailHtml(step, filled)}

          <div class="pos-stage">
            ${tabs}
            ${step === 5 ? `
              <div class="csf-checkout">${posStep5()}</div>
              <div class="csf-checkout-foot">
                <button type="button" class="csf-btn-secondary">Print Quote</button>
                <button type="button" class="csf-btn-secondary">Send Quote</button>
                <button type="button" class="primary-button">Reserve Now</button>
              </div>
            ` : `
            <div class="csf-panel"${standalone}>
              <div class="csf-panel-head" style="display:flex;align-items:center;justify-content:space-between;">${esc(panelHead)}${infoIcon}</div>
              <div class="csf-panel-body">
                ${panelScript(step)}
                <form class="pos-form" autocomplete="off" novalidate>
                  <div class="pos-step" data-step="${step}">
                    ${posStepSection(step)}
                  </div>
                </form>
                <div class="csf-panel-foot">
                  <a class="csf-link">CSF Admin / Rules</a>
                  <button type="button" class="primary-button">${esc(primaryLabel)}</button>
                </div>
              </div>
            </div>
            `}
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
    timer: '01:12',
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
    timer: '01:48',
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript.slice(0, 1)),
    phoneStatusState: 'your_turn',
    phoneStatusText: 'Your turn — just talk.',
    phoneStatusHint: 'Pause for a beat when you finish and your reply sends.',
  });
}

function renderCallListening() {
  return buildCallShell({
    step: 1,
    filled: false,
    timer: '02:05',
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript.slice(0, 1)),
    phoneStatusState: 'listening',
    phoneStatusText: 'Listening to you...',
    phoneStatusHint: 'Pause a beat when you finish.',
  });
}

function renderCallThinking() {
  // Simulator latency — the call clock freezes here (not a "live" state).
  return buildCallShell({
    step: 1,
    filled: false,
    timer: '02:20',
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript.slice(0, 2)),
    phoneStatusState: 'thinking',
    phoneStatusText: 'Derek Huang is thinking...',
    phoneStatusHint: 'Customer reply coming in.',
  });
}

function renderCallPaused() {
  // Pause freezes the timer + dims the form (data-paused), mic + audio halt.
  return buildCallShell({
    step: 2,
    filled: true,
    showRightRail: true,
    timer: '03:26',
    paused: true,
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript.slice(0, 3)),
    phoneStatusState: 'paused',
    phoneStatusText: 'Call paused',
    phoneStatusHint: 'Resume when you are ready.',
  });
}

function renderCallMultiTurn() {
  return buildCallShell({
    step: 1,
    filled: false,
    timer: '03:48',
    transcriptHtml: transcriptHtmlFrom(MOCK.transcript),
    phoneStatusState: 'your_turn',
    phoneStatusText: 'Your turn — just talk.',
    phoneStatusHint: 'Pause for a beat when you finish and your reply sends.',
  });
}

// ---- Pre-call modal + ring screen (the start-of-call sequence) ------------
// Both are full-screen overlays in the real app; here they're contained in a
// .preview-frame so they sit in flow and work in the stacked "print all" view.

function renderPrecallModal() {
  const backdrop = buildCallShell({ step: 1, filled: false, phoneStatusState: 'connecting', phoneStatusText: 'Connecting...', phoneStatusHint: 'Putting the call through.' });
  const closeIcon = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  return `
    <div class="preview-frame">
      <div class="preview-frame-blur">${backdrop}</div>
      <div class="precall-overlay">
        <div class="precall-scrim"></div>
        <div class="precall-card" role="dialog" aria-modal="true">
          <button type="button" class="precall-close" aria-label="Cancel">${closeIcon}</button>
          <div class="precall-eyebrow">The Price Shopper</div>
          <h2 class="precall-name">${esc(R.customerName)}</h2>
          <p class="precall-short">Budget-conscious, comparing three companies</p>
          <p class="precall-tagline">Wants the cheapest 15' in the city.</p>
          <div class="precall-actions">
            <button type="button" class="ghost-button precall-cancel">Cancel</button>
            <button type="button" class="primary-button precall-start">Start <span aria-hidden="true">›</span></button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderRingScreen() {
  const backdrop = buildCallShell({ step: 1, filled: false, phoneStatusState: 'connecting', phoneStatusText: 'Connecting...', phoneStatusHint: 'Putting the call through.' });
  const phoneIcon = `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const phoneFill = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" fill="currentColor" stroke="none"/></svg>`;
  return `
    <div class="preview-frame">
      <div class="preview-frame-blur">${backdrop}</div>
      <div class="precall-overlay precall-ringing">
        <div class="precall-scrim"></div>
        <div class="ring-screen" role="dialog" aria-modal="true">
          <div class="ring-status">Incoming call…</div>
          <div class="ring-avatar" aria-hidden="true">
            <span class="ring-pulse ring-pulse-1"></span>
            <span class="ring-pulse ring-pulse-2"></span>
            <span class="ring-avatar-core">${phoneIcon}</span>
          </div>
          <div class="ring-name">${esc(R.customerName)}</div>
          <div class="ring-sub">The Price Shopper</div>
          <div class="ring-actions">
            <button type="button" class="ring-btn ring-decline" aria-label="Decline call">${phoneFill}</button>
            <button type="button" class="ring-btn ring-answer">${phoneFill}<span class="ring-answer-label">Answer</span></button>
          </div>
        </div>
      </div>
    </div>
  `;
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

// The "Reservation Complete" POS screen the real CSF shows after Reserve Now
// (before our app pivots to coaching). Green success banner (success is green
// everywhere; the maroon accent stays on the buttons), then a summary + charges
// card, then the footer. No left rail / cart — full-width like the target.
function renderReservationComplete() {
  const truckSvg = `<svg viewBox="0 0 80 48" width="64" height="40" fill="none" aria-hidden="true"><rect x="2" y="12" width="46" height="26" rx="2" stroke="currentColor" stroke-width="2"/><path d="M48 20h15l13 10v8H48z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="20" cy="40" r="5" stroke="currentColor" stroke-width="2"/><circle cx="62" cy="40" r="5" stroke="currentColor" stroke-width="2"/></svg>`;
  const charges = [
    { label: "26' Moving Van", sub: 'plus $1.19/mile', amount: '$49.95' },
    { label: 'Environmental Fee', sub: '', amount: '$1.00' },
    { label: 'Vehicle License Recovery Fee - FL H/W Truck', sub: '', amount: '$1.20' },
    { label: 'Estimated Tax', sub: '', amount: '$3.91' },
  ];
  return `
    <section class="call" data-call-mode="phone">
      <div class="call-body" style="padding: 18px;">
        <div class="csf-complete">
          <div class="csf-complete-banner">
            <div class="csf-complete-banner-title">&#9989; Reservation Complete</div>
            <p class="csf-complete-banner-text">The reservation has been completed!</p>
            <p class="csf-complete-banner-text">If they would like to receive helpful videos regarding their rental, <a class="csf-link">click here</a></p>
            <div class="csf-complete-banner-foot">
              <select class="pos-input csf-complete-lang"><option>English</option><option>French</option><option>Spanish</option></select>
              <a class="csf-link">Receipt</a>
            </div>
          </div>
          <div class="pos-card csf-complete-card">
            <div class="pos-card-body">
              <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">Your reservation has been completed. A confirmation and link to the Meridian app has been sent via text to ${esc(R.phone)}. Prior to your pickup, you can complete your check-in through the app, as well as confirm, review or make any changes to your reservation. 70318282</p></div>
              <h3 class="csf-complete-name">Customer Name: ${esc(R.customerName)}</h3>
              <div class="csf-complete-grid">
                <div class="csf-complete-col">
                  <div class="csf-complete-subhead">Reservation Summary</div>
                  <div class="csf-complete-truck">${truckSvg}</div>
                  <div class="csf-complete-model">26' MOVING VAN</div>
                  <dl class="csf-complete-facts">
                    <div><dt>Pick Up Date:</dt><dd>09/26/2026</dd></div>
                    <div><dt>Pick Up Time:</dt><dd>10:00 AM</dd></div>
                    <div><dt>Hours Reserved:</dt><dd>10 hours</dd></div>
                    <div><dt>Rental Type:</dt><dd>In Town</dd></div>
                  </dl>
                  <div class="csf-complete-loc">
                    <div class="csf-complete-map" aria-hidden="true"></div>
                    <div class="csf-complete-loc-info">
                      <em>MERIDIAN MOVING &amp; STORAGE OF GAINESVILLE</em>
                      <span>4821 NW 6TH ST</span>
                      <span>GAINESVILLE, FL 32609</span>
                      <span>(352) 415-8437</span>
                      <a class="csf-link">&#9678; Directions</a>
                      <a class="csf-link">Cross Contact</a>
                      <a class="csf-link">&#43; Add Storage in GAINESVILLE, FL</a>
                    </div>
                  </div>
                  <label class="pos-check" style="margin-top:10px;"><input type="checkbox"> GAINESVILLE, FL 32609</label>
                  <div style="margin-top:8px;"><button type="button" class="csf-btn-secondary">Start Moving Help</button></div>
                </div>
                <div class="csf-complete-col">
                  <div class="csf-complete-subhead">Summary of Charges</div>
                  <div class="csf-complete-charges">
                    ${charges.map((c) => `<div class="csf-complete-charge"><span class="csf-complete-charge-label">${esc(c.label)}${c.sub ? `<span class="csf-complete-charge-sub">${esc(c.sub)}</span>` : ''}</span><span class="csf-complete-charge-amt">${esc(c.amount)}</span></div>`).join('')}
                    <div class="csf-complete-charge csf-complete-total"><span class="csf-complete-charge-label">Total:</span><span class="csf-complete-charge-amt">$56.06<span class="csf-complete-charge-sub">plus $1.19/mile (due in store)</span></span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="csf-complete-foot">
            <span class="csf-complete-foot-note">Does this same customer need to make another reservation? Click below to make another reservation for this customer.</span>
            <a class="csf-link">&#43; Create New Reservation for this Customer</a>
            <button type="button" class="csf-btn-secondary">Close</button>
          </div>
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

  function scoreSection(section) {
    const vals = section.items.map((it) => Number(r.scores[it.key]?.score)).filter((n) => Number.isFinite(n));
    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    const chevron = `<svg class="report-section-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M4 6 L8 10 L12 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `
      <details class="report-section" open>
        <summary class="report-section-summary">
          <span class="report-section-name">${esc(section.label)}</span>
          ${avg != null ? `<span class="report-section-avg"><strong>${avg.toFixed(1)}</strong> <span>/ 5</span></span>` : ''}
          ${chevron}
        </summary>
        <div class="report-section-cards">
          ${section.items.map((it) => rubricCard(it, r.scores[it.key])).join('')}
        </div>
      </details>
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

      <h2 class="report-section-title">Call Review</h2>
      <div class="report-scorecard">
        ${RUBRIC.map((section) => scoreSection(section)).join('')}
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
        <p class="admin-login-sub">Enter the admin password to manage simulation invites.</p>
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
        <h1 class="admin-section-title">Send a simulation invite</h1>
        <p class="admin-section-sub">Pick the scenarios you want this batch of recipients to practice, then send invites one at a time.</p>
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

// Ordered to walk the scenario journey top-to-bottom: choose a scenario →
// pre-call modal → ring → answer → live call phases → POS steps → coaching
// report. Non-scenario surfaces (kiosk/auth/admin) trail at the end.
const STATES = [
  // --- 1. Start page: choose a scenario ---
  { id: 'home-welcome',          label: '1 · Start — Education & Development landing', render: renderHomeWelcome },
  { id: 'picker-type',           label: '1 · Start — Scenario type grid',      render: renderPickerType },
  { id: 'picker-persona',        label: '1 · Start — Persona list (Damage Dispute)', render: renderPickerPersona },
  { id: 'picker-random',         label: '1 · Start — Random "surprise me" card', render: renderPickerRandom },
  { id: 'recipient-home',        label: '1 · Start — Recipient / invite home',  render: renderRecipientHome },
  // --- 2. Start-of-call sequence ---
  { id: 'precall-modal',         label: '2 · Pre-call — Modal over blurred call', render: renderPrecallModal },
  { id: 'ring-screen',           label: '3 · Ring — Incoming call (answer/decline)', render: renderRingScreen },
  // --- 4. Live call phases ---
  { id: 'call-idle',             label: '4 · Call — Connecting / answered',    render: renderCallIdle },
  { id: 'call-customer-speaking', label: '4 · Call — Customer speaking',       render: renderCallCustomerSpeaking },
  { id: 'call-listening',        label: '4 · Call — Listening to you',         render: renderCallListening },
  { id: 'call-your-turn',        label: '4 · Call — Your turn',                render: renderCallYourTurn },
  { id: 'call-thinking',         label: '4 · Call — Customer thinking (clock frozen)', render: renderCallThinking },
  { id: 'call-paused',           label: '4 · Call — Paused (timer frozen, form dimmed)', render: renderCallPaused },
  { id: 'call-multi-turn',       label: '4 · Call — Multi-turn transcript',    render: renderCallMultiTurn },
  // --- 5. The CSF reservation steps ---
  { id: 'call-step-details',     label: '5 · CSF — Step 1: Details',           render: renderCallStepDetails },
  { id: 'call-step-equipment',   label: '5 · CSF — Step 2: Equipment',         render: renderCallStepEquipment },
  { id: 'call-step-location',    label: '5 · CSF — Step 3: Location',          render: renderCallStepLocation },
  { id: 'call-step-time',        label: '5 · CSF — Step 4: Scheduling',        render: renderCallStepTime },
  { id: 'call-step-checkout',    label: '5 · CSF — Step 5: Checkout',          render: renderCallStepCheckout },
  { id: 'call-pos-script-hint',  label: '5 · CSF — POS script hint cards',     render: renderCallPosHint },
  // --- 6. End of call: reservation complete, then coaching ---
  { id: 'reservation-complete',  label: '6 · CSF — Reservation Complete screen', render: renderReservationComplete },
  { id: 'report-generating',     label: '6 · Report — Generating spinner',     render: renderReportGenerating },
  { id: 'report-shown',          label: '6 · Report — Full coaching report',   render: renderReportShown },
  // --- Other surfaces ---
  { id: 'kiosk-splash',          label: '· Kiosk — Mic disclaimer splash',     render: renderKioskSplash },
  { id: 'auth-login',            label: '· Auth — Login splash',               render: renderAuthLogin },
  { id: 'admin-login',           label: '· Admin — Login card',                render: renderAdminLogin },
  { id: 'admin-dashboard',       label: '· Admin — Dashboard (invites + scenarios)', render: renderAdminDashboard },
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

// ---------------------------------------------------------------------------
// Per-field CSR script tooltip — mirrors the live focus-follow bubble so the
// behavior is testable here (no live call needed). Keyed off each field's label
// text. Delegated on the preview root, so it works across every CSF state.
// ---------------------------------------------------------------------------
const PREVIEW_FIELD_SCRIPTS = {
  'moving from': 'What zip code, city, or landmark are you moving from?',
  'moving to': 'And where are you moving to?',
  'move/pickup date': 'What day would you like to pick up?',
  'how many bedrooms': 'How many bedrooms are you moving?',
  'credit card number': 'Which credit card would you like to use to confirm the reservation?',
  'card number': 'Which credit card would you like to use to confirm the reservation?',
  'billing zip code': 'And the billing zip code for that card?',
  'email for reservation receipt': "What's the best email for the reservation receipt?",
  'phone number': 'And the best phone number to reach you?',
  'current address': 'May I please have your current address?',
  'storage location': 'Will you need storage before or after your move?',
};
const PREVIEW_LOOKUP_SCRIPT = 'May I start with your cell phone number or email address?';
const pvTip = document.createElement('div');
pvTip.className = 'pos-fieldtip';
pvTip.hidden = true;
pvTip.innerHTML = `<span class="pos-fieldtip-icon" aria-hidden="true">${SCRIPT_ICON}</span><span class="pos-fieldtip-text"></span>`;
document.body.appendChild(pvTip);
const pvTipText = pvTip.querySelector('.pos-fieldtip-text');
function pvNorm(s) { return String(s || '').toLowerCase().replace(/^\*\s*/, '').replace(/[:?]\s*$/, '').trim(); }
root.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el.matches || !el.matches('input, select, textarea')) { pvTip.hidden = true; return; }
  let script = '';
  if (el.closest('.pos-lookup')) {
    script = PREVIEW_LOOKUP_SCRIPT;
  } else {
    const field = el.closest('.pos-field');
    const label = field && field.querySelector('.pos-field-label');
    if (label) script = PREVIEW_FIELD_SCRIPTS[pvNorm(label.textContent)] || '';
  }
  if (!script) { pvTip.hidden = true; return; }
  pvTipText.textContent = script;
  pvTip.hidden = false;
  const r = el.getBoundingClientRect();
  let top = r.top - pvTip.offsetHeight - 8;
  if (top < 8) top = r.bottom + 8;
  pvTip.style.top = `${Math.round(top)}px`;
  pvTip.style.left = `${Math.round(r.left)}px`;
});
root.addEventListener('focusout', () => { pvTip.hidden = true; });
