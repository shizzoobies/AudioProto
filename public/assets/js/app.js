import { Conversation } from './conversation.js';
import { requestCoachingReport, renderReportHtml } from './coach.js';
import { AudioPlayer, attachVisualizer, synthesizeSentence, ContinuousRecorder, transcribeAudio } from './audio.js';

const state = {
  scenarioTypes: [],
  typeById: new Map(),
  personaById: new Map(),
  allPersonaIds: [],
  view: 'picker',
  activeScenario: null,
  conversation: null,
  audioPlayer: null,
  visualizerCleanup: null,
  audioMuted: false,
  ttsControllers: new Set(),
  micDenied: false,
  inputMode: 'voice',
  sttController: null,
  callMode: 'phone',
  silenceTimer: null,
  demoUnlocked: false,
  orb: null,
};

// Meridian's San Antonio branch network. Surfaced in the CSR panel so the
// trainee can match the pickup branch to where the customer is loading.
const BRANCHES = [
  {
    name: 'Downtown',
    area: 'Central',
    address: '410 S Santa Rosa Ave, San Antonio, TX 78207',
    hours: 'Mon-Sat 7a-7p, Sun 9a-5p',
    serves: 'Downtown, Southtown, King William, Tobin Hill',
    lat: 29.4218,
    lng: -98.4980,
  },
  {
    name: 'Northgate',
    area: 'North Central',
    address: '14200 San Pedro Ave, San Antonio, TX 78232',
    hours: 'Mon-Sat 7a-7p, Sun 9a-5p',
    serves: 'Stone Oak, Northwest Hills, Hollywood Park, North Central',
    lat: 29.6010,
    lng: -98.4910,
  },
  {
    name: 'Riverside',
    area: 'Southeast',
    address: '800 SE Military Dr, San Antonio, TX 78214',
    hours: 'Mon-Sat 7a-6p, Sun closed',
    serves: 'Riverside, Highland Park, Southeast Side',
    lat: 29.3517,
    lng: -98.4799,
  },
  {
    name: 'Westside',
    area: 'West',
    address: '2100 Culebra Rd, San Antonio, TX 78228',
    hours: 'Mon-Sat 7a-7p, Sun 9a-5p',
    serves: 'West Side, Leon Valley, Loma Park',
    lat: 29.4561,
    lng: -98.5475,
  },
  {
    name: 'Airport',
    area: 'North / Airport',
    address: '9800 Airport Blvd, San Antonio, TX 78216',
    hours: 'Daily 6a-9p',
    serves: 'Airport corridor, North Central, Uptown',
    lat: 29.5293,
    lng: -98.4690,
  },
];

function setCallMode(mode) {
  if (mode === 'chat') {
    state.callMode = 'chat';
    state.inputMode = 'text';
    state.audioMuted = true;
  } else {
    state.callMode = 'phone';
    state.inputMode = 'voice';
    state.audioMuted = false;
  }
}

function teardownAudio() {
  if (state.silenceTimer) {
    clearTimeout(state.silenceTimer);
    state.silenceTimer = null;
  }
  for (const c of state.ttsControllers) {
    try { c.abort(); } catch {}
  }
  state.ttsControllers.clear();
  if (state.visualizerCleanup) {
    state.visualizerCleanup();
    state.visualizerCleanup = null;
  }
  if (state.orb) {
    try { state.orb.dispose(); } catch {}
    state.orb = null;
  }
  if (state.audioPlayer) {
    state.audioPlayer.destroy();
    state.audioPlayer = null;
  }
  if (state.continuousRecorder) {
    state.continuousRecorder.cancel();
    state.continuousRecorder = null;
  }
  if (state.sttController) {
    try { state.sttController.abort(); } catch {}
    state.sttController = null;
  }
}

const dom = {
  root: document.getElementById('app-root'),
  signOut: document.getElementById('sign-out'),
};

async function init() {
  renderPickerSkeleton();

  try {
    const sessionRes = await fetch('/api/session', { credentials: 'same-origin' });
    if (!sessionRes.ok) {
      window.location.replace('/');
      return;
    }
  } catch {
    window.location.replace('/');
    return;
  }

  try {
    const demoRes = await fetch('/api/demo-status', { credentials: 'same-origin' });
    if (demoRes.ok) {
      const data = await demoRes.json();
      state.demoUnlocked = !!data?.demo;
    }
  } catch {
    // Non-fatal; default to locked.
  }

  try {
    const res = await fetch('/api/scenarios', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('scenarios_failed');
    const data = await res.json();
    state.scenarioTypes = data.scenario_types || [];
    state.typeById = new Map(state.scenarioTypes.map((t) => [t.id, t]));
    state.personaById = new Map();
    state.allPersonaIds = [];
    for (const t of state.scenarioTypes) {
      for (const p of t.personas || []) {
        const enriched = { ...p, type_id: t.id, type_title: t.title, difficulty: t.difficulty };
        state.personaById.set(p.id, enriched);
        // Showcase persona is launched from the welcome screen only; exclude
        // it from the random pool and from the picker grid below.
        if (t.id !== 'showcase') state.allPersonaIds.push(p.id);
      }
    }
  } catch (err) {
    document.body.dataset.appState = 'ready';
    renderError('We could not load the scenarios. Refresh to try again.');
    return;
  }

  document.body.dataset.appState = 'ready';
  renderWelcome();

  dom.signOut.addEventListener('click', signOut);
}

function renderWelcome() {
  state.view = 'welcome';
  state.activeScenario = null;
  setDocumentTitle('Welcome');
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  teardownAudio();

  dom.root.innerHTML = `
    <section class="welcome">
      <header class="welcome-hero">
        <div class="welcome-eyebrow">Customer service training</div>
        <h1 class="welcome-title">Take a call.<br>Get coached.</h1>
        <p class="welcome-lead">Step into a realistic customer call with an AI that stays in character. End the call when you are ready and get a scored coaching report on six dimensions, with quoted evidence from your call and one concrete thing to try next time.</p>
      </header>

      <ul class="welcome-features">
        <li>
          <strong>5 distinct callers</strong>
          Each customer has a full backstory, mannerisms, and an emotional arc.
        </li>
        <li>
          <strong>Streaming voice</strong>
          Phone-call mode runs voice both ways. Chat mode keeps it silent.
        </li>
        <li>
          <strong>Coaching report</strong>
          Six dimensions, quoted evidence, mood snapshot, and one thing to try next time.
        </li>
      </ul>

      <div class="welcome-section">
        <div class="welcome-section-eyebrow">Pick your format</div>
        <p class="welcome-section-sub">Lock in how this call will run. Same as a real shift, you do not switch formats mid-call.</p>
      </div>

      <div class="welcome-modes">
        <button class="mode-choice" data-call-mode="chat" type="button">
          <div class="mode-choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4.5-1.05L3 20l1.05-4.5A8.04 8.04 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M8 11h.01M12 11h.01M16 11h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <h3 class="mode-choice-title">Chat</h3>
          <p class="mode-choice-text">You type. The customer replies in text. Quiet, fast, no audio at all.</p>
          <span class="mode-choice-cta">Start a chat call <span aria-hidden="true">›</span></span>
        </button>
        <button class="mode-choice mode-choice-phone" data-call-mode="phone" type="button">
          <div class="mode-choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h3 class="mode-choice-title">Phone call</h3>
          <p class="mode-choice-text">Hold to talk. The customer speaks back through your speakers. Like the real thing.</p>
          <span class="mode-choice-cta">Start a phone call <span aria-hidden="true">›</span></span>
        </button>
      </div>

      <div class="welcome-divider" aria-hidden="true">
        <span class="welcome-divider-text">or</span>
      </div>

      <div class="welcome-showcase">
        <button class="mode-choice mode-choice-showcase" data-action="showcase" type="button">
          <div class="mode-choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 2l2.7 7.4h7.8l-6.3 4.6 2.4 7.5L12 17.3l-6.6 4.2 2.4-7.5L1.5 9.4h7.8L12 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
            </svg>
          </div>
          <h3 class="mode-choice-title">Meet Elena</h3>
          <p class="mode-choice-text">The showcase persona introduces herself to the team and chats freely. Ask her about her life, her work, or the simulator. She drops into a customer roleplay on request. Phone mode, premium models unlock with the demo password.</p>
          <span class="mode-choice-cta">Open the showcase <span aria-hidden="true">›</span></span>
        </button>
      </div>
    </section>
  `;

  dom.root.querySelectorAll('[data-call-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setCallMode(btn.dataset.callMode);
      renderPicker();
    });
  });

  const showcaseBtn = dom.root.querySelector('[data-action="showcase"]');
  if (showcaseBtn) {
    showcaseBtn.addEventListener('click', () => {
      setCallMode('phone');
      startCall('showcase_elena');
    });
  }
}

function renderPickerSkeleton() {
  document.body.dataset.appState = 'ready';
  const cells = Array.from({ length: 5 }, () => `
    <li class="scenario-card scenario-card-skeleton" aria-hidden="true">
      <div class="skeleton-pill"></div>
      <div class="skeleton-line skeleton-line-title"></div>
      <div class="skeleton-line skeleton-line-meta"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line-short"></div>
    </li>
  `).join('');
  dom.root.innerHTML = `
    <section class="picker">
      <header class="picker-header">
        <h1 class="picker-title">Choose a scenario</h1>
        <p class="picker-subtitle">Loading scenarios...</p>
      </header>
      <ul class="scenario-grid">${cells}</ul>
    </section>
  `;
}

function setDocumentTitle(suffix) {
  const base = 'Call Simulator';
  document.title = suffix ? `${suffix} • ${base}` : base;
}

async function signOut() {
  dom.signOut.disabled = true;
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  teardownAudio();
  try {
    await fetch('/api/demo-unlock', { method: 'DELETE', credentials: 'same-origin' });
  } catch {}
  try {
    await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
  } finally {
    state.demoUnlocked = false;
    window.location.replace('/');
  }
}

function renderError(message) {
  dom.root.innerHTML = `
    <section class="error-shell">
      <h1 class="error-title">Something went wrong</h1>
      <p class="error-text">${escapeHtml(message)}</p>
    </section>
  `;
}

function renderPicker() {
  state.view = 'picker';
  state.activeScenario = null;
  setDocumentTitle('');
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  teardownAudio();

  const cards = state.scenarioTypes
    .filter((t) => t.id !== 'showcase')
    .map((t) => {
      const callerLabel = t.persona_count === 1 ? '1 caller' : `${t.persona_count} different callers`;
      return `
        <li class="scenario-card" data-scenario-id="${escapeAttr(t.id)}" tabindex="0" role="button" aria-label="Start scenario: ${escapeAttr(t.title)}">
          <div class="scenario-difficulty difficulty-${escapeAttr(t.difficulty)}">${capitalize(t.difficulty)}</div>
          <h2 class="scenario-title">${escapeHtml(t.title)}</h2>
          <p class="scenario-customer">${escapeHtml(callerLabel)}</p>
          <p class="scenario-description">${escapeHtml(t.description)}</p>
          <div class="scenario-cta">Start call <span aria-hidden="true">›</span></div>
        </li>
      `;
    })
    .join('');

  const randomCard = `
    <li class="scenario-card scenario-card-random" data-scenario-id="__random__" tabindex="0" role="button" aria-label="Start a random scenario without knowing who is calling">
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
      <p class="scenario-description">Pick one of the ${state.allPersonaIds.length} callers at random. You will not know who is on the line until you take the call.</p>
      <div class="scenario-cta">Take the call <span aria-hidden="true">›</span></div>
    </li>
  `;

  const modeLabel = state.callMode === 'chat' ? 'Chat' : 'Phone call';
  dom.root.innerHTML = `
    <section class="picker">
      <header class="picker-header">
        <div class="picker-format-row">
          <div class="picker-format">
            <span class="picker-format-label">Format</span>
            <span class="picker-format-value">${escapeHtml(modeLabel)}</span>
          </div>
          <button class="ghost-button" id="picker-change-format" type="button">Change format</button>
        </div>
        <h1 class="picker-title">Choose a scenario</h1>
        <p class="picker-subtitle">Each scenario is a different customer with a different problem. Pick one, or hit Surprise me to be tested cold.</p>
      </header>
      <ul class="scenario-grid">${cards}${randomCard}</ul>
    </section>
  `;

  document.getElementById('picker-change-format').addEventListener('click', renderWelcome);

  dom.root.querySelectorAll('.scenario-card').forEach((card) => {
    card.addEventListener('click', () => startCall(card.dataset.scenarioId));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startCall(card.dataset.scenarioId);
      }
    });
  });
}

async function startCall(typeOrPersonaId) {
  let blind = false;
  let personaId = null;

  if (typeOrPersonaId === '__random__') {
    blind = true;
    if (!state.allPersonaIds.length) return;
    personaId = state.allPersonaIds[Math.floor(Math.random() * state.allPersonaIds.length)];
  } else if (state.typeById.has(typeOrPersonaId)) {
    const type = state.typeById.get(typeOrPersonaId);
    const pool = type.personas || [];
    if (!pool.length) return;
    personaId = pool[Math.floor(Math.random() * pool.length)].id;
  } else if (state.personaById.has(typeOrPersonaId)) {
    personaId = typeOrPersonaId;
  } else {
    return;
  }

  const persona = state.personaById.get(personaId);
  if (!persona) return;

  if (personaId.startsWith('showcase_') && !state.demoUnlocked) {
    const unlocked = await promptDemoPassword();
    state.demoUnlocked = unlocked;
  }

  const lines = Array.isArray(persona.opening_lines) && persona.opening_lines.length
    ? persona.opening_lines
    : [persona.opening_line || ''];
  const chosen = lines[Math.floor(Math.random() * lines.length)] || '';
  state.activeScenario = {
    ...persona,
    title: persona.type_title,
    opening_line: chosen,
    blind,
  };
  renderCall(state.activeScenario);
}

function renderCall(scenario) {
  state.view = 'call';
  setDocumentTitle(scenario.blind ? 'Live call' : `Call: ${scenario.customer_name}`);
  teardownAudio();

  const displayName = scenario.blind ? 'Caller' : scenario.customer_name;
  const displayTitle = scenario.blind ? 'Incoming call' : scenario.title;

  const isPhone = state.callMode === 'phone';
  const composerMode = state.inputMode;
  const placeholder = isPhone
    ? 'Hold the mic to talk to the customer.'
    : 'Type your response...';
  const modeBadge = isPhone ? 'Phone call' : 'Chat';
  const isShowcaseCall = typeof scenario.id === 'string' && scenario.id.startsWith('showcase_');
  const useOrb = isPhone && isShowcaseCall && state.demoUnlocked;
  // Premium voice (eleven_v3) performs square-bracket delivery tags. When
  // active we keep those tags in the text we send to TTS but strip them
  // from the transcript. Standard tier strips them everywhere.
  const premiumVoice = isShowcaseCall && state.demoUnlocked;
  const premiumBadge = (isShowcaseCall && state.demoUnlocked)
    ? '<span class="call-mode-pill call-mode-pill-premium" title="Premium voice (Eleven v3)">Premium voice</span>'
    : '';

  // In-town: base is the 24-hour (per-day) rate, charged per day plus per_mile
  // mileage. One-way: ow_base + distance * ow_mile is a single bundled rate that
  // already includes the days and miles the route needs.
  const TRUCK_SIZES = [
    { size: 10, label: "10' Moving Truck", base: 19.95, per_mile: 0.79, ow_base: 130, ow_mile: 0.70 },
    { size: 15, label: "15' Moving Truck", base: 29.95, per_mile: 0.89, ow_base: 170, ow_mile: 0.80 },
    { size: 20, label: "20' Moving Truck", base: 39.95, per_mile: 1.19, ow_base: 230, ow_mile: 0.95 },
    { size: 26, label: "26' Moving Truck", base: 49.95, per_mile: 1.29, ow_base: 290, ow_mile: 1.05 },
  ];
  const TRUCK_BY_SIZE = Object.fromEntries(TRUCK_SIZES.map((t) => [t.size, t]));

  const LOAD_SIZES = [
    { value: 'home_improvement', label: 'Home Improvement / Small Loads', truck: 10 },
    { value: 'apt_studio', label: 'Apartment - 1 Bedroom / Studio / Deliveries', truck: 10 },
    { value: 'studio_1br', label: 'Studio to 1 Bedroom Apt.', truck: 10 },
    { value: '1br_2br', label: '1 Bedroom Home to 2 Bedroom Apt.', truck: 15 },
    { value: '2br_3br', label: '2 Bedroom Home to 3 Bedroom Apt.', truck: 20 },
    { value: '3br_4br', label: '3 Bedroom Home to 4 Bedroom Home', truck: 26 },
    { value: 'other', label: 'Other', truck: null },
  ];
  const LOAD_BY_VALUE = Object.fromEntries(LOAD_SIZES.map((l) => [l.value, l]));

  const RENTAL_LENGTHS = [
    { value: '1', label: '1 day (24 hours)', days: 1 },
    { value: '2', label: '2 days', days: 2 },
    { value: '3', label: '3 days', days: 3 },
    { value: '4', label: '4 days', days: 4 },
    { value: '5', label: '5 days', days: 5 },
    { value: '7', label: '7 days', days: 7 },
  ];
  const RENTAL_BY_VALUE = Object.fromEntries(RENTAL_LENGTHS.map((r) => [r.value, r]));

  const POS_LOCATIONS = BRANCHES.map((b, i) => ({
    ...b,
    entity: String(833071 - i * 412),
    distance: (1.6 + i * 2.4).toFixed(1),
    phone: ['(210) 555-0142', '(210) 555-0188', '(210) 555-0203', '(210) 555-0119', '(210) 555-0177'][i] || '(210) 555-0100',
    available_sizes: i === 2 ? [10, 15, 20] : [10, 15, 20, 26],
  }));
  const LOC_BY_NAME = Object.fromEntries(POS_LOCATIONS.map((l) => [l.name, l]));

  const loadSizeOptionsHtml = ['<option value="">Select...</option>']
    .concat(LOAD_SIZES.map((l) => `<option value="${l.value}">${escapeHtml(l.label)}</option>`)).join('');

  const rentalLengthOptionsHtml = RENTAL_LENGTHS
    .map((r) => `<option value="${r.value}"${r.value === '1' ? ' selected' : ''}>${escapeHtml(r.label)}</option>`).join('');

  const timeSlotsHtml = (() => {
    const out = ['<option value="">Select a time...</option>'];
    for (let h = 8; h <= 18; h++) {
      for (const m of [0, 30]) {
        const ampm = h < 12 ? 'AM' : 'PM';
        const hh = ((h + 11) % 12) + 1;
        const label = `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
        out.push(`<option value="${label}">${label}</option>`);
      }
    }
    return out.join('');
  })();

  const expMonthsHtml = ['<option value="">Month</option>']
    .concat(Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      return `<option value="${mm}">${mm}</option>`;
    })).join('');

  const nowYear = new Date().getFullYear();
  const expYearsHtml = ['<option value="">Year</option>']
    .concat(Array.from({ length: 9 }, (_, i) => {
      const yy = nowYear + i;
      return `<option value="${String(yy).slice(-2)}">${yy}</option>`;
    })).join('');

  dom.root.innerHTML = `
    <section class="call" data-call-mode="${escapeAttr(state.callMode)}"${useOrb ? ' data-orb-mode="meta"' : ''}>
      <header class="call-header">
        <button class="ghost-button call-back" id="call-back" type="button">Back to scenarios</button>
        <div class="call-meta">
          <div class="call-customer-name">${escapeHtml(displayName)}</div>
          <div class="call-scenario-title">${escapeHtml(displayTitle)} <span class="call-mode-pill">${escapeHtml(modeBadge)}</span>${premiumBadge}</div>
        </div>
        <button class="danger-button" id="end-call" type="button">End call</button>
      </header>
      <div class="call-body">
        ${useOrb ? `
        <div class="orb-zone" id="orb-zone" data-orb-mode="meta" data-active="false">
          <div class="orb-mount" id="orb-mount"></div>
        </div>
        ` : ''}

        <div class="pos" id="pos">
          <aside class="pos-rail pos-rail-left" aria-label="Customer and reservation context">
            <section class="pos-card">
              <div class="pos-card-head">
                <span class="pos-card-title">Customer Contact Information</span>
                <span class="pos-verified" id="pos-verified" hidden>Verified Customer</span>
              </div>
              <div class="pos-card-body" id="pos-customer-body">
                <p class="pos-card-empty">Look up the caller to load their profile.</p>
              </div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Checklist</span></div>
              <div class="pos-card-body">
                <div class="pos-check-item">Truck Rental</div>
              </div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Reservation Details</span></div>
              <div class="pos-card-body" id="pos-rsvdetails-body">
                <p class="pos-card-empty">Details fill in as you build the reservation.</p>
              </div>
            </section>

            <section class="pos-card" id="pos-entity-card" hidden>
              <div class="pos-card-head"><span class="pos-card-title" id="pos-entity-title">Entity</span></div>
              <div class="pos-card-body" id="pos-entity-body"></div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Reservation Notes</span></div>
              <div class="pos-card-body">
                <div class="pos-note-group">
                  <div class="pos-note-label">Customer Notes</div>
                  <p class="pos-note-text" id="pos-customer-notes">No cautionary notes</p>
                </div>
                <div class="pos-note-group">
                  <div class="pos-note-label">Callback Notes</div>
                  <p class="pos-note-text">None on file</p>
                </div>
              </div>
            </section>
          </aside>

          <div class="pos-stage">
            <ol class="pos-stepper" id="pos-stepper" aria-label="Reservation steps">
              <li class="pos-stepper-item active" data-step="1"><span class="pos-stepper-num">1</span><span class="pos-stepper-label">Details</span></li>
              <li class="pos-stepper-item" data-step="2"><span class="pos-stepper-num">2</span><span class="pos-stepper-label">Equipment</span></li>
              <li class="pos-stepper-item" data-step="3"><span class="pos-stepper-num">3</span><span class="pos-stepper-label">Location</span></li>
              <li class="pos-stepper-item" data-step="4"><span class="pos-stepper-num">4</span><span class="pos-stepper-label">Time</span></li>
              <li class="pos-stepper-item" data-step="5"><span class="pos-stepper-num">5</span><span class="pos-stepper-label">Checkout</span></li>
            </ol>

            <form class="pos-form" id="pos-form" autocomplete="off" novalidate>
              <section class="pos-step" data-step="1">
                <header class="pos-step-head">
                  <h3 class="pos-step-title">Reservation Details</h3>
                </header>
                <p class="pos-hint">Try: "Thanks for calling Meridian Moving and Storage. May I start with your cell phone number?"</p>
                <div class="pos-lookup">
                  <input class="pos-input" id="pos-lookup-input" type="text" placeholder="Phone number or email address">
                  <button type="button" class="pos-lookup-btn" id="pos-lookup-btn">Search</button>
                </div>
                <div class="pos-lookup-result" id="pos-lookup-result" hidden></div>

                <div class="pos-divider"><span>Move details</span></div>

                <div class="pos-grid-2">
                  <label class="pos-field">
                    <span class="pos-field-label">Moving From</span>
                    <input class="pos-input" data-rsv="moving_from" type="text" placeholder="Zip, city, or landmark">
                  </label>
                  <label class="pos-field">
                    <span class="pos-field-label">Moving To (optional)</span>
                    <input class="pos-input" data-rsv="moving_to" type="text" placeholder="Zip, city, or landmark">
                  </label>
                </div>

                <div class="pos-geo-status" id="pos-geo-status" hidden></div>

                <div class="pos-field">
                  <span class="pos-field-label">Move Type</span>
                  <div class="pos-radio-row">
                    <label class="pos-radio"><input type="radio" name="move_type" data-rsv="move_type" value="in_town" checked> In Town</label>
                    <label class="pos-radio"><input type="radio" name="move_type" data-rsv="move_type" value="one_way"> One Way</label>
                  </div>
                </div>

                <div class="pos-grid-2">
                  <label class="pos-field">
                    <span class="pos-field-label">Move / Pickup Date</span>
                    <input class="pos-input" data-rsv="pickup_date" type="date">
                  </label>
                  <label class="pos-field">
                    <span class="pos-field-label">How many bedrooms?</span>
                    <select class="pos-input" data-rsv="load_size">${loadSizeOptionsHtml}</select>
                  </label>
                </div>

                <div class="pos-grid-2">
                  <div class="pos-field">
                    <span class="pos-field-label">Are you towing a vehicle?</span>
                    <div class="pos-radio-row">
                      <label class="pos-radio"><input type="radio" name="towing" data-rsv="towing" value="yes"> Yes</label>
                      <label class="pos-radio"><input type="radio" name="towing" data-rsv="towing" value="no" checked> No</label>
                    </div>
                  </div>
                  <div class="pos-field">
                    <span class="pos-field-label">Do you need a trailer?</span>
                    <div class="pos-radio-row">
                      <label class="pos-radio"><input type="radio" name="trailer" data-rsv="trailer" value="yes"> Yes</label>
                      <label class="pos-radio"><input type="radio" name="trailer" data-rsv="trailer" value="no" checked> No</label>
                    </div>
                  </div>
                </div>
              </section>

              <section class="pos-step" data-step="2" hidden>
                <header class="pos-step-head">
                  <h3 class="pos-step-title">Choose Equipment</h3>
                </header>
                <p class="pos-hint" id="pos-equip-hint">Try: "Based on what you're moving, I'd put you in a truck this size. How many days do you need it?"</p>

                <div class="pos-equip-rec" id="pos-equip-rec" data-size="?">
                  <div class="pos-equip-badge">Recommended</div>
                  <div class="pos-equip-body">
                    <div class="pos-equip-name" id="pos-equip-name">Add a load size on the previous step to see a fit.</div>
                    <div class="pos-equip-rate mono" id="pos-equip-rate"></div>
                    <div class="pos-grid-2 pos-field-inline">
                      <label class="pos-field" id="pos-field-rental">
                        <span class="pos-field-label">Rental length (24-hr periods)</span>
                        <select class="pos-input" data-rsv="rental_length">${rentalLengthOptionsHtml}</select>
                      </label>
                      <label class="pos-field" id="pos-field-miles">
                        <span class="pos-field-label" id="pos-miles-label">Estimated miles</span>
                        <input class="pos-input" data-rsv="miles" type="number" min="0" step="1" placeholder="e.g. 25" value="0">
                      </label>
                    </div>
                  </div>
                </div>

                <div class="pos-upsell">
                  <p class="pos-hint">Try: "Families who rent a truck find a Utility Dolly and a dozen Furniture Pads make the move easier. Can I add those for $17.00?"</p>
                  <label class="pos-check"><input type="checkbox" data-rsv-equipment="pads"> Furniture pads ($10/pack)</label>
                  <label class="pos-check"><input type="checkbox" data-rsv-equipment="dolly"> Utility dolly ($7/day)</label>
                </div>

                <fieldset class="pos-fieldset">
                  <legend>Damage waiver</legend>
                  <select class="pos-input" data-rsv="waiver">
                    <option value="none">Decline coverage</option>
                    <option value="basic">Basic ($15/day, up to $5k)</option>
                    <option value="premium">Premium ($25/day, up to $25k)</option>
                  </select>
                </fieldset>

                <details class="pos-equip-all">
                  <summary>Show all moving equipment</summary>
                  <div class="pos-equip-grid">
                    ${TRUCK_SIZES.map((t) => `
                      <button type="button" class="pos-equip-opt" data-truck="${t.size}">
                        <span class="pos-equip-opt-name">${t.size}' Moving Truck</span>
                        <span class="pos-equip-opt-rate mono">$${t.base.toFixed(2)}/day + $${t.per_mile.toFixed(2)}/mi</span>
                      </button>
                    `).join('')}
                  </div>
                </details>
              </section>

              <section class="pos-step" data-step="3" hidden>
                <header class="pos-step-head">
                  <h3 class="pos-step-title">Select Pick Up Location</h3>
                </header>
                <p class="pos-hint" id="pos-loc-hint">Pick the location nearest where the customer is loading. Sorted by distance.</p>
                <div class="pos-loc-list" id="pos-loc-list"></div>
              </section>

              <section class="pos-step" data-step="4" hidden>
                <header class="pos-step-head">
                  <h3 class="pos-step-title">Scheduling</h3>
                </header>
                <div class="pos-sched-truck" id="pos-sched-truck"></div>
                <div class="pos-sched-loc" id="pos-sched-loc"></div>
                <p class="pos-hint">Try: "What time would you like to pick up?"</p>
                <label class="pos-field">
                  <span class="pos-field-label">Available Times</span>
                  <select class="pos-input" data-rsv="pickup_time">${timeSlotsHtml}</select>
                </label>
                <div class="pos-field">
                  <span class="pos-field-label">Pickup Method</span>
                  <div class="pos-radio-row">
                    <label class="pos-radio"><input type="radio" name="pickup_method" data-rsv="pickup_method" value="in_store" checked> In Store</label>
                    <label class="pos-radio"><input type="radio" name="pickup_method" data-rsv="pickup_method" value="truckshare"> TruckShare</label>
                  </div>
                </div>
                <label class="pos-check"><input type="checkbox" data-rsv-flag="send_to_traffic"> Send to Traffic</label>
              </section>

              <section class="pos-step" data-step="5" hidden>
                <header class="pos-step-head">
                  <h3 class="pos-step-title">Checkout</h3>
                </header>
                <div class="pos-test-banner">Training mode. Card details are not stored or charged.</div>
                <div class="pos-card-status" id="pos-card-status">Enter the card in the Credit Card panel to confirm.</div>

                <fieldset class="pos-fieldset">
                  <legend>Additional products and services</legend>
                  <label class="pos-field">
                    <span class="pos-field-label">Will you need storage before or after the move?</span>
                    <select class="pos-input" data-rsv="storage">
                      <option value="no">No storage needed</option>
                      <option value="before">Yes, before the move</option>
                      <option value="after">Yes, after the move</option>
                    </select>
                  </label>
                </fieldset>

                <fieldset class="pos-fieldset">
                  <legend>Verify contact information</legend>
                  <p class="pos-hint">Try: "What is your preferred method of contact: email, phone, or text?"</p>
                  <div class="pos-grid-2">
                    <label class="pos-field">
                      <span class="pos-field-label">Email for receipt</span>
                      <input class="pos-input" data-rsv="receipt_email" type="text" inputmode="email" placeholder="name@example.com">
                    </label>
                    <label class="pos-field">
                      <span class="pos-field-label">Phone number</span>
                      <input class="pos-input" data-rsv="receipt_phone" type="tel" placeholder="555-123-4567">
                    </label>
                  </div>
                  <div class="pos-field">
                    <span class="pos-field-label">Preferred Contact Method</span>
                    <div class="pos-check-row">
                      <label class="pos-check"><input type="checkbox" data-rsv-contact="email"> Email</label>
                      <label class="pos-check"><input type="checkbox" data-rsv-contact="phone"> Phone</label>
                      <label class="pos-check"><input type="checkbox" data-rsv-contact="text" checked> Text</label>
                    </div>
                  </div>
                  <label class="pos-field">
                    <span class="pos-field-label">Current Address (optional)</span>
                    <input class="pos-input" data-rsv="current_address" type="text" placeholder="Street, city, state">
                  </label>
                  <div class="pos-field">
                    <span class="pos-field-label">Preferred Language</span>
                    <div class="pos-radio-row">
                      <label class="pos-radio"><input type="radio" name="language" data-rsv="language" value="english" checked> English</label>
                      <label class="pos-radio"><input type="radio" name="language" data-rsv="language" value="french"> French</label>
                      <label class="pos-radio"><input type="radio" name="language" data-rsv="language" value="spanish"> Spanish</label>
                    </div>
                  </div>
                </fieldset>
              </section>

              <div class="pos-error" id="pos-error" hidden></div>
              <div class="pos-nav">
                <button type="button" class="ghost-button" id="pos-back" hidden>Back</button>
                <button type="submit" class="primary-button" id="pos-next">Continue</button>
              </div>
            </form>

            <div class="pos-result" id="pos-result"></div>
          </div>

          <aside class="pos-rail pos-rail-right" aria-label="Cart and payment">
            <section class="pos-card pos-cart-card">
              <div class="pos-card-head pos-card-head-accent"><span class="pos-card-title">Shopping Cart</span></div>
              <div class="pos-card-body" id="pos-cart-body">
                <p class="pos-card-empty">Add equipment to start the cart.</p>
              </div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Credit Card</span></div>
              <div class="pos-card-body pos-cc">
                <label class="pos-field">
                  <span class="pos-field-label">Card Number</span>
                  <input class="pos-input" data-rsv="card_number" type="text" inputmode="numeric" autocomplete="cc-number" placeholder="4111 1111 1111 1111" maxlength="23">
                </label>
                <div class="pos-grid-2">
                  <label class="pos-field">
                    <span class="pos-field-label">Exp Month</span>
                    <select class="pos-input" data-rsv="card_exp_month">${expMonthsHtml}</select>
                  </label>
                  <label class="pos-field">
                    <span class="pos-field-label">Exp Year</span>
                    <select class="pos-input" data-rsv="card_exp_year">${expYearsHtml}</select>
                  </label>
                </div>
                <label class="pos-field">
                  <span class="pos-field-label">Billing Zip Code</span>
                  <input class="pos-input" data-rsv="card_zip" type="text" inputmode="numeric" autocomplete="postal-code" placeholder="78207" maxlength="5">
                </label>
                <div class="pos-cc-chip" id="pos-cc-chip" data-brand="unknown" hidden>
                  <span class="pos-cc-brand" id="pos-cc-brand">CARD</span>
                  <span class="mono" id="pos-cc-last4">&bull;&bull;&bull;&bull;</span>
                </div>
              </div>
            </section>
          </aside>
        </div>

        <div class="call-dock" id="call-dock" data-mode="${isPhone ? 'phone' : 'chat'}" data-collapsed="false">
          <button type="button" class="call-dock-head" id="call-dock-head" aria-expanded="true">
            <span class="call-dock-dot" id="call-dock-dot"></span>
            <span class="call-dock-title">${escapeHtml(displayName)}</span>
            <span class="call-dock-sub">${isPhone ? 'Live call' : 'Chat'}</span>
            <span class="call-dock-chevron" aria-hidden="true">&#9662;</span>
          </button>
          <div class="call-dock-body" id="call-dock-body">
            <div class="call-dock-convo">
              <ol class="transcript" id="transcript" aria-live="polite"></ol>
            </div>
            <div class="call-dock-aside">
              ${isPhone ? `
              ${!useOrb ? `<div class="visualizer-wrap" id="visualizer-wrap" data-active="false"><canvas class="visualizer" id="visualizer"></canvas></div>` : ''}
              <div class="phone-status" id="phone-status" data-state="connecting">
                <div class="phone-status-row">
                  <span class="phone-status-dot" aria-hidden="true"></span>
                  <span class="phone-status-text" id="phone-status-text">Connecting...</span>
                </div>
                <p class="phone-status-hint" id="phone-status-hint">When the customer finishes, just talk. Pause for a beat and your reply sends.</p>
              </div>
              ` : `
              <div class="composer-wrap" id="composer-wrap" data-mode="text">
                <form class="composer" id="composer" autocomplete="off">
                  <label class="visually-hidden" for="composer-input">Your message</label>
                  <textarea id="composer-input" class="composer-input" placeholder="${escapeAttr(placeholder)}" rows="2"></textarea>
                  <button type="submit" class="composer-send" id="composer-send">Send</button>
                </form>
                <p class="composer-status" id="composer-status" aria-live="polite"></p>
              </div>
              `}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  const transcript = document.getElementById('transcript');
  const visualizerWrap = document.getElementById('visualizer-wrap');
  const visualizerCanvas = document.getElementById('visualizer');
  const orbZone = document.getElementById('orb-zone');
  const orbMount = document.getElementById('orb-mount');

  const customerLabel = scenario.blind ? 'Caller' : scenario.customer_name;

  const composer = isPhone ? null : document.getElementById('composer');
  const composerInput = isPhone ? null : document.getElementById('composer-input');
  const composerSend = isPhone ? null : document.getElementById('composer-send');
  const composerStatus = isPhone ? null : document.getElementById('composer-status');
  const phoneStatus = isPhone ? document.getElementById('phone-status') : null;
  const phoneStatusText = isPhone ? document.getElementById('phone-status-text') : null;
  const phoneStatusHint = isPhone ? document.getElementById('phone-status-hint') : null;
  const endCallBtn = document.getElementById('end-call');
  const backBtn = document.getElementById('call-back');

  function setPhoneState(s, text, hint) {
    if (!phoneStatus) return;
    phoneStatus.dataset.state = s;
    if (text != null) phoneStatusText.textContent = text;
    if (hint != null) phoneStatusHint.textContent = hint;
  }

  const audioPlayer = new AudioPlayer({
    onStart: () => {
      if (visualizerWrap) visualizerWrap.dataset.active = 'true';
      if (orbZone) orbZone.dataset.active = 'true';
      state.orb?.setActive(true);
      if (isPhone) {
        if (state.continuousRecorder) {
          state.continuousRecorder.cancel();
          state.continuousRecorder = null;
        }
        setPhoneState('customer_talking', `${customerLabel} is talking...`, 'Listen until they finish.');
      }
    },
    onEnd: () => {
      if (visualizerWrap) visualizerWrap.dataset.active = 'false';
      if (orbZone) orbZone.dataset.active = 'false';
      state.orb?.setActive(false);
      if (isPhone && state.view === 'call' && !conversation.isStreaming() && !state.continuousRecorder) {
        finalizeTurnBubble();
        startListening();
      }
    },
    onError: (err) => console.warn('audio error', err),
  });
  state.audioPlayer = audioPlayer;
  audioPlayer.setMuted(state.audioMuted);

  if (visualizerCanvas) {
    state.visualizerCleanup = attachVisualizer(
      visualizerCanvas,
      () => {
        if (state.continuousRecorder?.isSpeaking()) return state.continuousRecorder.getAnalyser();
        return audioPlayer.getAnalyser();
      },
      {
        getColor: () => state.continuousRecorder?.isSpeaking() ? '#60a5fa' : '#f5a524',
      }
    );
  }

  if (orbMount) {
    import('./orb.js')
      .then(({ createOrb }) => {
        if (state.view !== 'call' || !document.body.contains(orbMount)) return;
        try {
          state.orb = createOrb({
            container: orbMount,
            getAnalyser: () => audioPlayer.getAnalyser(),
          });
        } catch (err) {
          console.warn('orb init failed', err);
        }
      })
      .catch((err) => console.warn('orb load failed', err));
  }

  // Per-call TTS sequencing. We synthesize sentences in parallel for
  // throughput but enqueue the resulting blobs in strict submission
  // order, so audio always plays the sentences in the order Elena
  // produced them - never tail-first.
  let ttsSeq = 0;
  let ttsNextEnqueue = 0;
  let ttsDraining = false;
  const ttsPending = new Map();

  function speakSentence(text, opts = {}) {
    const onPlay = opts.onPlay;
    // Chat mode (or any muted state): no audio. Fire onPlay so the
    // transcript still surfaces in the same code path.
    if (state.audioMuted) {
      try { onPlay?.(); } catch {}
      return;
    }
    const cleaned = premiumVoice ? scrubForSpeechKeepTags(text) : scrubForSpeech(text);
    if (!cleaned) {
      try { onPlay?.(); } catch {}
      return;
    }
    const seq = ttsSeq++;
    const controller = new AbortController();
    state.ttsControllers.add(controller);
    synthesizeSentence({ scenarioId: scenario.id, text: cleaned, signal: controller.signal })
      .then((blob) => {
        state.ttsControllers.delete(controller);
        ttsPending.set(seq, { blob, onPlay });
        drainTts();
      })
      .catch((err) => {
        state.ttsControllers.delete(controller);
        if (err?.name !== 'AbortError') {
          console.warn('tts error', err.message || err);
        }
        ttsPending.set(seq, { blob: null, onPlay });
        drainTts();
      });
  }

  async function drainTts() {
    if (ttsDraining) return;
    ttsDraining = true;
    try {
      while (ttsPending.has(ttsNextEnqueue)) {
        const item = ttsPending.get(ttsNextEnqueue);
        ttsPending.delete(ttsNextEnqueue);
        ttsNextEnqueue++;
        if (item.blob) {
          // Await so each clip is decoded AND pushed to the play queue
          // before the next one. enqueueBlob decodes asynchronously, so
          // without awaiting, a later (often larger) clip can finish
          // decoding first and play out of order or smoosh together.
          await audioPlayer.enqueueBlob(item.blob, item.onPlay);
        } else {
          // Synthesis failed for this chunk. Fire onPlay anyway so the
          // transcript stays in sync with what she has already said.
          try { item.onPlay?.(); } catch {}
        }
      }
    } finally {
      ttsDraining = false;
    }
    // An item may have arrived during the final await; pick it up.
    if (ttsPending.has(ttsNextEnqueue)) drainTts();
  }

  // Speak the opening line. In phone mode the bubble fills when the
  // audio actually starts so the text never beats the voice. In chat
  // mode the line is shown immediately (no audio to wait for).
  let openingMessage = null;
  if (isPhone) {
    openingMessage = appendMessage(transcript, 'customer', customerLabel, '');
    const openingBubble = openingMessage.querySelector('.message-bubble');
    if (openingBubble) openingBubble.classList.add('streaming');
    speakSentence(scenario.opening_line, {
      onPlay: () => {
        if (!openingBubble) return;
        openingBubble.textContent = normalizeForTranscript(stripVoiceTags(scenario.opening_line));
        openingBubble.classList.remove('streaming');
      },
    });
  } else {
    appendMessage(transcript, 'customer', customerLabel, normalizeForTranscript(scenario.opening_line));
  }

  // In phone mode the bubble is created on first audio-segment play so
  // text never beats the voice. In chat mode the bubble is created on
  // assistant start and filled by streaming deltas as usual.
  let streamingBubble = null;
  const ensureStreamingBubble = (label) => {
    if (streamingBubble) return streamingBubble;
    const li = appendMessage(transcript, 'customer', label, '');
    streamingBubble = li.querySelector('.message-bubble');
    streamingBubble.classList.add('streaming');
    return streamingBubble;
  };
  const appendToStreamingBubble = (text) => {
    if (!streamingBubble) return;
    streamingBubble.textContent += text;
    transcript.scrollTop = transcript.scrollHeight;
  };
  const appendSentenceToBubble = (sentence) => {
    const bub = ensureStreamingBubble(customerLabel);
    const prefix = bub.textContent ? ' ' : '';
    bub.textContent += prefix + normalizeForTranscript(stripVoiceTags(sentence));
    transcript.scrollTop = transcript.scrollHeight;
  };
  const finalizeTurnBubble = () => {
    if (streamingBubble) {
      const raw = streamingBubble.textContent || '';
      const normalized = normalizeForTranscript(raw);
      if (normalized !== raw) {
        streamingBubble.textContent = normalized;
      }
      streamingBubble.classList.remove('streaming');
      streamingBubble = null;
    }
  };

  const SILENCE_TIMEOUT_MS = 30000;

  function armSilenceTimer() {
    clearSilenceTimer();
    state.silenceTimer = setTimeout(() => {
      state.silenceTimer = null;
      if (state.view !== 'call' || conversation.isStreaming()) return;
      appendSilenceMarker(transcript);
      conversation.sendUserMessage('[silence: 30s]');
    }, SILENCE_TIMEOUT_MS);
  }
  function clearSilenceTimer() {
    if (state.silenceTimer) {
      clearTimeout(state.silenceTimer);
      state.silenceTimer = null;
    }
  }

  const conversation = new Conversation({
    scenario,
    openingLine: scenario.opening_line,
    onAssistantStart: () => {
      clearSilenceTimer();
      // Chat mode shows text as it streams. Phone mode creates the
      // bubble lazily on first audio-segment play so text never
      // beats the voice.
      if (!isPhone) ensureStreamingBubble(customerLabel);
    },
    onAssistantDelta: (text) => {
      if (!isPhone) appendToStreamingBubble(text);
    },
    onAssistantEnd: () => {
      // Chat mode finalizes immediately. Phone mode finalizes when the
      // audio queue drains (audioPlayer.onEnd above) so the trailing
      // sentences land in sync.
      if (!isPhone) finalizeTurnBubble();
      armSilenceTimer();
    },
    onSentence: (sentence) => speakSentence(sentence, {
      onPlay: () => {
        if (isPhone) appendSentenceToBubble(sentence);
      },
    }),
    onMode: (mode) => {
      if (orbZone) orbZone.dataset.orbMode = mode;
      const callEl = dom.root.querySelector('.call');
      if (callEl && useOrb) callEl.dataset.orbMode = mode;
      state.orb?.setMode(mode);
    },
    onError: (err) => {
      finalizeTurnBubble();
      appendMessage(
        transcript,
        'system',
        'System',
        `We hit an error talking to the customer (${err.message || 'unknown'}). You can try sending again.`
      );
      setComposerEnabled(true);
    },
  });
  state.conversation = conversation;

  // ---- Mode-specific wiring ----

  if (isPhone) {
    setPhoneState('connecting', `Connecting you to ${customerLabel}...`, 'Putting the call through.');
  } else {
    composerInput.focus();

    composer.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = composerInput.value;
      if (!text.trim() || conversation.isStreaming()) return;
      clearSilenceTimer();
      appendMessage(transcript, 'agent', 'You', text);
      composerInput.value = '';
      setComposerEnabled(false);
      try {
        await conversation.sendUserMessage(text);
      } finally {
        setComposerEnabled(true);
        composerInput.focus();
      }
    });

    composerInput.addEventListener('input', () => clearSilenceTimer());

    composerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        composer.requestSubmit();
      }
    });
  }

  async function startListening() {
    if (state.view !== 'call' || !isPhone) return;
    if (state.continuousRecorder) return;
    if (state.micDenied) {
      setPhoneState('error', 'Mic access denied', 'Reload the page and allow the mic, or switch to Chat mode.');
      return;
    }
    try {
      const recorder = new ContinuousRecorder({
        onSpeechStart: () => {
          clearSilenceTimer();
          setPhoneState('listening', 'Listening to you...', 'Pause a beat when you finish.');
        },
        onSpeechEnd: (blob) => handleSpeechEnd(blob),
        onError: (err) => console.warn('mic err', err),
      });
      state.continuousRecorder = recorder;
      await recorder.start();
      setPhoneState('your_turn', 'Your turn.', 'Just start talking. The line auto-detects your pause.');
    } catch (err) {
      state.continuousRecorder = null;
      if (err.message === 'mic_denied') {
        state.micDenied = true;
        setPhoneState('error', 'Mic access denied', 'Reload the page and allow the mic, or switch to Chat mode.');
      } else if (err.message === 'mic_unsupported') {
        setPhoneState('error', 'Browser does not support mic', 'Switch to Chat mode to continue.');
      } else {
        setPhoneState('error', 'Mic unavailable', String(err.message || 'unknown'));
      }
    }
  }

  async function handleSpeechEnd(blob) {
    state.continuousRecorder = null;
    if (state.view !== 'call') return;
    if (!blob || blob.size < 800) {
      // false trigger; resume listening
      startListening();
      return;
    }
    clearSilenceTimer();
    setPhoneState('processing', 'Transcribing what you said...', 'Hold tight.');
    const sttController = new AbortController();
    state.sttController = sttController;
    try {
      const text = await transcribeAudio(blob, { signal: sttController.signal });
      if (sttController.signal.aborted) return;
      if (!text) {
        setPhoneState('your_turn', 'I did not catch that. Try again.', 'Speak when you are ready.');
        startListening();
        return;
      }
      appendMessage(transcript, 'agent', 'You', text);
      setPhoneState('thinking', `${customerLabel} is thinking...`, 'Customer reply coming in.');
      await conversation.sendUserMessage(text);
      // audioPlayer.onEnd will fire and re-start listening once playback drains.
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setPhoneState('your_turn', 'Transcription failed. Try again.', String(err?.message || 'unknown'));
      startListening();
    } finally {
      if (state.sttController === sttController) state.sttController = null;
    }
  }

  endCallBtn.addEventListener('click', () => {
    const messages = conversation.getMessages();
    conversation.cancel();
    teardownAudio();
    if (messages.length < 2) {
      renderShortCall(scenario);
      return;
    }
    runCoaching(scenario, messages);
  });

  backBtn.addEventListener('click', () => {
    conversation.cancel();
    teardownAudio();
    renderPicker();
  });

  function setComposerEnabled(enabled) {
    if (!composerInput || !composerSend) return;
    composerInput.disabled = !enabled;
    composerSend.disabled = !enabled;
    composerSend.textContent = enabled ? 'Send' : 'Sending';
  }

  // ---- POS reservation system ----
  const pos = document.getElementById('pos');
  const posForm = document.getElementById('pos-form');
  const posStepper = document.getElementById('pos-stepper');
  const posNav = pos.querySelector('.pos-nav');
  const posNextBtn = document.getElementById('pos-next');
  const posBackBtn = document.getElementById('pos-back');
  const posErrorEl = document.getElementById('pos-error');
  const posResult = document.getElementById('pos-result');
  const posCartBody = document.getElementById('pos-cart-body');
  const posCcChip = document.getElementById('pos-cc-chip');
  const posCcBrand = document.getElementById('pos-cc-brand');
  const posCcLast4 = document.getElementById('pos-cc-last4');
  const posCardStatus = document.getElementById('pos-card-status');
  const posEquipRec = document.getElementById('pos-equip-rec');
  const posEquipName = document.getElementById('pos-equip-name');
  const posEquipRate = document.getElementById('pos-equip-rate');
  const posEquipHint = document.getElementById('pos-equip-hint');
  const posLocList = document.getElementById('pos-loc-list');
  const posSchedTruck = document.getElementById('pos-sched-truck');
  const posSchedLoc = document.getElementById('pos-sched-loc');
  const posVerified = document.getElementById('pos-verified');
  const posCustomerBody = document.getElementById('pos-customer-body');
  const posRsvDetailsBody = document.getElementById('pos-rsvdetails-body');
  const posEntityCard = document.getElementById('pos-entity-card');
  const posEntityTitle = document.getElementById('pos-entity-title');
  const posEntityBody = document.getElementById('pos-entity-body');
  const posCustomerNotes = document.getElementById('pos-customer-notes');
  const posLookupInput = document.getElementById('pos-lookup-input');
  const posLookupBtn = document.getElementById('pos-lookup-btn');
  const posLookupResult = document.getElementById('pos-lookup-result');
  const posGeoStatus = document.getElementById('pos-geo-status');

  const WAIVER_INFO = {
    none: { label: 'Waiver declined', daily: 0 },
    basic: { label: 'Basic waiver', daily: 15 },
    premium: { label: 'Premium waiver', daily: 25 },
  };
  const ENV_FEE = 1.00;
  const VLRF = 1.20;
  const TAX_RATE = 0.0825;
  const TOTAL_STEPS = 5;
  let posStep = 1;
  let truckOverride = null;
  let selectedLocation = null;
  let selectedRecord = null;
  let storageAsked = false;
  // Geocoded origin/destination for distance-ranked branches and one-way
  // mileage. Null until the trainee enters a place we can resolve.
  let originGeo = null;
  let destGeo = null;
  let geoSeq = 0;
  let geoTimer = null;
  let lastGeoKey = null;

  function fmtMoney(n) { return '$' + Number(n || 0).toFixed(2); }

  function getRsv(name) {
    const els = pos.querySelectorAll(`[data-rsv="${name}"]`);
    if (!els.length) return '';
    if (els[0].type === 'radio') {
      const checked = Array.from(els).find((e) => e.checked);
      return checked ? checked.value : '';
    }
    return els[0].value || '';
  }
  function setRsv(name, value) {
    const el = pos.querySelector(`[data-rsv="${name}"]`);
    if (el) el.value = value;
  }

  function recommendedSize() {
    if (truckOverride) return truckOverride;
    const ls = LOAD_BY_VALUE[getRsv('load_size')];
    return ls && ls.truck ? ls.truck : null;
  }
  function currentTruck() {
    const size = recommendedSize();
    return size ? TRUCK_BY_SIZE[size] : null;
  }
  function rentalDays() {
    const r = RENTAL_BY_VALUE[getRsv('rental_length')];
    return r ? r.days : 1;
  }

  function oneWayQuote(truck, distance) {
    const dist = Math.max(0, Math.round(distance || 0));
    const amount = truck.ow_base + dist * truck.ow_mile;
    const days = Math.max(2, Math.ceil(dist / 400) + 1);
    return { amount, days, miles: dist };
  }

  function computeQuote() {
    const truck = currentTruck();
    const oneWay = getRsv('move_type') === 'one_way';
    const miles = Number(getRsv('miles') || 0);
    const waiver = WAIVER_INFO[getRsv('waiver') || 'none'] || WAIVER_INFO.none;
    const padsChecked = !!pos.querySelector('[data-rsv-equipment="pads"]:checked');
    const dollyChecked = !!pos.querySelector('[data-rsv-equipment="dolly"]:checked');

    const lines = [];
    let subtotal = 0;
    let days = oneWay ? 1 : rentalDays();
    let ow = null;
    if (truck) {
      if (oneWay) {
        ow = oneWayQuote(truck, miles);
        days = ow.days;
        subtotal += ow.amount;
        lines.push({ label: truck.label, sub: `one-way rate, includes ${ow.days} days and ${ow.miles} mi`, amount: ow.amount });
      } else {
        const truckCost = truck.base * days;
        subtotal += truckCost;
        lines.push({ label: truck.label, sub: `$${truck.base.toFixed(2)}/day x ${days} day${days === 1 ? '' : 's'}`, amount: truckCost });
        if (miles > 0) {
          const milesCost = truck.per_mile * miles;
          subtotal += milesCost;
          lines.push({ label: 'Mileage', sub: `${miles} mi x $${truck.per_mile.toFixed(2)}/mi`, amount: milesCost });
        }
      }
      subtotal += ENV_FEE;
      lines.push({ label: 'Environmental Fee', amount: ENV_FEE });
      subtotal += VLRF;
      lines.push({ label: 'Vehicle License Recovery Fee', amount: VLRF });
    }
    const waiverCost = waiver.daily * days;
    if (waiverCost > 0) { subtotal += waiverCost; lines.push({ label: `${waiver.label}${days > 1 ? ' x ' + days + ' days' : ''}`, amount: waiverCost }); }
    if (padsChecked) { subtotal += 10; lines.push({ label: 'Furniture pads', amount: 10 }); }
    if (dollyChecked) { const c = 7 * days; subtotal += c; lines.push({ label: `Utility dolly${days > 1 ? ' x ' + days + ' days' : ''}`, amount: c }); }

    const tax = subtotal * TAX_RATE;
    const total = subtotal + tax;
    return { truck, oneWay, days, miles, ow, waiver, padsChecked, dollyChecked, lines, subtotal, tax, total };
  }

  function renderCart() {
    const q = computeQuote();
    if (!q.truck) {
      posCartBody.innerHTML = '<p class="pos-card-empty">Add equipment to start the cart.</p>';
      return;
    }
    const lineHtml = q.lines.map((l) => `
      <div class="pos-cart-line">
        <div class="pos-cart-line-label">${escapeHtml(l.label)}${l.sub ? `<span class="pos-cart-line-sub">${escapeHtml(l.sub)}</span>` : ''}</div>
        <div class="pos-cart-line-amt mono">${fmtMoney(l.amount)}</div>
      </div>
    `).join('');
    posCartBody.innerHTML = `
      <div class="pos-cart-tag">Truck Rental</div>
      ${lineHtml}
      <div class="pos-cart-rule"></div>
      <div class="pos-cart-line pos-cart-subtotal"><div class="pos-cart-line-label">Subtotal</div><div class="pos-cart-line-amt mono">${fmtMoney(q.subtotal)}</div></div>
      <details class="pos-cart-taxes"><summary>Show taxes</summary>
        <div class="pos-cart-line pos-cart-line-muted"><div class="pos-cart-line-label">Estimated tax (8.25%)</div><div class="pos-cart-line-amt mono">${fmtMoney(q.tax)}</div></div>
      </details>
      <div class="pos-cart-rule"></div>
      <div class="pos-cart-line pos-cart-total"><div class="pos-cart-line-label">Total</div><div class="pos-cart-line-amt mono">${fmtMoney(q.total)}</div></div>
      <div class="pos-cart-note">Estimate. In-town mileage is reconciled at the actual miles driven on return.</div>
    `;
  }

  function renderEquip() {
    const size = recommendedSize();
    const truck = size ? TRUCK_BY_SIZE[size] : null;
    const oneWay = getRsv('move_type') === 'one_way';
    posEquipRec.dataset.size = size ? String(size) : '?';
    const badge = posEquipRec.querySelector('.pos-equip-badge');
    if (badge) badge.textContent = truckOverride ? 'Override' : 'Recommended';

    const rentalField = document.getElementById('pos-field-rental');
    const milesLabel = document.getElementById('pos-miles-label');
    if (rentalField) rentalField.hidden = oneWay;
    if (milesLabel) milesLabel.textContent = oneWay ? 'Estimated distance (miles)' : 'Estimated miles';

    if (!truck) {
      posEquipName.textContent = 'Pick a truck below, or set a load size on the Details step.';
      posEquipRate.textContent = '';
    } else {
      posEquipName.textContent = truck.label;
      posEquipRate.textContent = oneWay
        ? `$${truck.ow_base.toFixed(2)} + $${truck.ow_mile.toFixed(2)}/mi, distance-based (days and miles included)`
        : `$${truck.base.toFixed(2)}/day + $${truck.per_mile.toFixed(2)}/mile`;
      if (posEquipHint) posEquipHint.textContent = oneWay
        ? `Try: "For a one-way ${truck.label}, the rate is based on your distance and already includes the days and miles you'll need."`
        : `Try: "The ${truck.label} is $${truck.base.toFixed(2)} a day plus $${truck.per_mile.toFixed(2)} a mile. How many days will you need it?"`;
    }
    pos.querySelectorAll('.pos-equip-opt').forEach((b) => b.classList.toggle('selected', Number(b.dataset.truck) === size));
  }

  function renderEntity() {
    const loc = LOC_BY_NAME[selectedLocation];
    if (!loc) { posEntityCard.hidden = true; return; }
    posEntityCard.hidden = false;
    posEntityTitle.textContent = `Entity ${loc.entity}`;
    posEntityBody.innerHTML = `
      <div class="pos-kv"><span>Location</span><span>Meridian of ${escapeHtml(loc.name)}</span></div>
      <div class="pos-kv"><span>Address</span><span class="mono">${escapeHtml(loc.address)}</span></div>
      <div class="pos-kv"><span>Phone</span><span class="mono">${escapeHtml(loc.phone)}</span></div>
    `;
  }

  function haversineMiles(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 3958.8; // earth radius, miles
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function nearestBranch() {
    if (!originGeo) return null;
    let best = null;
    for (const loc of POS_LOCATIONS) {
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
      const mi = haversineMiles(originGeo, { lat: loc.lat, lng: loc.lng });
      if (!best || mi < best.mi) best = { loc, mi };
    }
    return best;
  }

  // Build the pickup-location list. With a geocoded origin the branches are
  // sorted nearest-first with real haversine distances and the closest is
  // tagged Recommended; without one we keep the original order and the static
  // distance estimates so the step still works before any ZIP is entered.
  function renderLocations() {
    const items = POS_LOCATIONS.map((loc) => ({
      loc,
      mi: originGeo && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
        ? haversineMiles(originGeo, { lat: loc.lat, lng: loc.lng })
        : null,
    }));
    const located = items.every((it) => it.mi != null);
    if (located) items.sort((a, b) => a.mi - b.mi);
    const locHint = document.getElementById('pos-loc-hint');
    if (locHint) {
      if (located && items[0]) {
        const where = cityLabelOf(originGeo, getRsv('moving_from'));
        locHint.textContent = `Based on ${where}, we suggest Meridian of ${items[0].loc.name} (${items[0].mi.toFixed(1)} mi). Branches are sorted nearest first.`;
      } else {
        locHint.textContent = 'Pick the location nearest where the customer is loading. Sorted by distance.';
      }
    }
    posLocList.innerHTML = items.map((item, i) => {
      const loc = item.loc;
      const recommended = i === 0;
      const distText = item.mi != null ? item.mi.toFixed(1) : loc.distance;
      const sel = loc.name === selectedLocation ? ' selected' : '';
      return `
      <button type="button" class="pos-loc${recommended ? ' recommended' : ''}${sel}" data-location="${escapeAttr(loc.name)}">
        <div class="pos-loc-rank">${i + 1}</div>
        <div class="pos-loc-main">
          <div class="pos-loc-name">Meridian Moving &amp; Storage of ${escapeHtml(loc.name)}${recommended ? ' <span class="pos-loc-badge">Recommended</span>' : ''}</div>
          <div class="pos-loc-addr mono">${escapeHtml(loc.address)}</div>
          <div class="pos-loc-meta">${escapeHtml(distText)} mi away &middot; ${escapeHtml(loc.hours)}</div>
          <div class="pos-loc-equip">
            ${TRUCK_SIZES.map((t) => `<span class="pos-loc-chip${loc.available_sizes.includes(t.size) ? '' : ' out'}">${t.size}' ${loc.available_sizes.includes(t.size) ? '$' + t.base.toFixed(2) : 'N/A'}</span>`).join('')}
          </div>
        </div>
      </button>
    `;
    }).join('');
  }

  function setGeoStatus(text, kind) {
    if (!posGeoStatus) return;
    if (!text) {
      posGeoStatus.hidden = true;
      posGeoStatus.textContent = '';
      posGeoStatus.removeAttribute('data-state');
      return;
    }
    posGeoStatus.hidden = false;
    posGeoStatus.dataset.state = kind || '';
    posGeoStatus.textContent = text;
  }

  async function geocodeQuery(query) {
    const q = (query || '').trim();
    if (!q) return null;
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.found
        ? { lat: data.lat, lng: data.lng, label: data.label, city: data.city || '', state: data.state || '', postcode: data.postcode || '' }
        : null;
    } catch {
      return null;
    }
  }

  // "San Antonio, TX" for status copy; falls back to the raw typed text.
  function cityLabelOf(geo, fallback) {
    if (!geo || !geo.city) return fallback;
    return geo.state ? `${geo.city}, ${geo.state}` : geo.city;
  }

  // Expand a bare 5-digit ZIP into "City, ST 78207" once we know the city, so
  // the trainee sees the place name fill in. Anything else is left as typed.
  function zipExpansion(geo, raw) {
    const zip = (raw || '').trim();
    if (!geo || !geo.city || !/^\d{5}$/.test(zip)) return null;
    return geo.state ? `${geo.city}, ${geo.state} ${zip}` : `${geo.city} ${zip}`;
  }

  // Resolve the typed origin (and, for one-way, destination), re-rank the
  // branches, and auto-fill one-way mileage. geoSeq guards against an earlier
  // slow lookup landing after a newer one and clobbering fresher results.
  async function refreshGeo() {
    const seq = ++geoSeq;
    const from = getRsv('moving_from');
    const to = getRsv('moving_to');
    const oneWay = getRsv('move_type') === 'one_way';

    // Skip redundant lookups (repeat blurs, tabbing through) so we stay light
    // on Nominatim. Any real edit changes the key and re-runs.
    const key = `${from}|${to}|${oneWay}`;
    if (key === lastGeoKey) return;

    if (!from) {
      originGeo = null;
      destGeo = null;
      lastGeoKey = key;
      setGeoStatus('', '');
      renderLocations();
      return;
    }

    setGeoStatus(`Locating ${from}...`, 'pending');
    const origin = await geocodeQuery(from);
    if (seq !== geoSeq) return;
    originGeo = origin;

    if (!origin) {
      lastGeoKey = key;
      setGeoStatus(`Could not place "${from}". Branches shown in default order.`, 'warn');
      renderLocations();
      return;
    }

    // Fill the city in for a bare ZIP so the trainee sees the place resolve.
    const fromExpanded = zipExpansion(origin, from);
    if (fromExpanded) setRsv('moving_from', fromExpanded);

    let dest = null;
    if (oneWay && to) {
      dest = await geocodeQuery(to);
      if (seq !== geoSeq) return;
      const toExpanded = zipExpansion(dest, to);
      if (toExpanded) setRsv('moving_to', toExpanded);
    }
    destGeo = dest;

    renderLocations();
    renderLeftRail();

    const nearest = nearestBranch();
    const where = cityLabelOf(origin, from);
    let msg = nearest ? `Nearest branch to ${where}: Meridian of ${nearest.loc.name}, ${nearest.mi.toFixed(1)} mi.` : `Located ${where}.`;
    if (oneWay) {
      if (dest) {
        const tripMi = Math.max(1, Math.round(haversineMiles(origin, dest)));
        setRsv('miles', String(tripMi));
        onPosChange();
        msg += ` One-way distance set to ${tripMi} mi.`;
      } else if (to) {
        msg += ' Could not place the destination; enter one-way miles manually.';
      }
    }
    // Record the post-expansion field values so the follow-up blur is a no-op.
    lastGeoKey = `${getRsv('moving_from')}|${getRsv('moving_to')}|${getRsv('move_type') === 'one_way'}`;
    setGeoStatus(msg, 'ok');
  }

  function scheduleGeo() {
    clearTimeout(geoTimer);
    geoTimer = setTimeout(refreshGeo, 600);
  }

  function renderSched() {
    const q = computeQuote();
    const loc = LOC_BY_NAME[selectedLocation];
    const rl = RENTAL_BY_VALUE[getRsv('rental_length')];
    if (q.truck) {
      const rateText = q.oneWay
        ? '$' + (q.ow ? q.ow.amount.toFixed(2) : q.truck.ow_base.toFixed(2)) + ' one-way'
        : '$' + q.truck.base.toFixed(2) + '/day + $' + q.truck.per_mile.toFixed(2) + '/mile';
      const lenText = q.oneWay
        ? `One-way · ${q.ow ? q.ow.days : 1} days and ${q.ow ? q.ow.miles : 0} mi included`
        : `Rental length: ${escapeHtml(rl ? rl.label : '1 day')}`;
      posSchedTruck.innerHTML = `
        <div class="pos-sched-row">
          <span class="pos-sched-truck-name">${escapeHtml(q.truck.label)}</span>
          <span class="mono">${rateText}</span>
        </div>
        <div class="pos-sched-sub">${lenText}</div>
      `;
    } else {
      posSchedTruck.innerHTML = '';
    }
    if (loc) {
      posSchedLoc.innerHTML = `
        <div class="pos-sched-loc-title">Pick Up Location (${escapeHtml(loc.entity)})</div>
        <div class="pos-sched-loc-name">Meridian Moving &amp; Storage of ${escapeHtml(loc.name)}</div>
        <div class="pos-sched-loc-addr mono">${escapeHtml(loc.address)}</div>
        <div class="pos-sched-loc-addr mono">${escapeHtml(loc.phone)}</div>
      `;
    } else {
      posSchedLoc.innerHTML = '<p class="pos-card-empty">Select a pickup location on the previous step.</p>';
    }
  }

  function renderLeftRail() {
    const ls = LOAD_BY_VALUE[getRsv('load_size')];
    const rows = [];
    if (getRsv('moving_from')) rows.push(['Moving From', getRsv('moving_from')]);
    if (getRsv('moving_to')) rows.push(['Moving To', getRsv('moving_to')]);
    if (getRsv('pickup_date')) rows.push(['Rental Date', getRsv('pickup_date')]);
    if (ls) rows.push(['Moving', ls.label]);
    rows.push(['Move Type', getRsv('move_type') === 'one_way' ? 'One Way' : 'In Town']);
    if (selectedLocation) rows.push(['Pickup', 'Meridian of ' + selectedLocation]);
    posRsvDetailsBody.innerHTML = rows.length
      ? rows.map(([k, v]) => `<div class="pos-kv"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join('')
      : '<p class="pos-card-empty">Details fill in as you build the reservation.</p>';
  }

  function renderCustomerCard(r) {
    posVerified.hidden = false;
    const parts = String(r.full_name || '').trim().split(/\s+/);
    const first = parts.shift() || '';
    const last = parts.join(' ');
    const hasHistory = (r.past_rentals || []).length || (r.active_reservations || []).length || (r.claims_cases || []).length;
    posCustomerBody.innerHTML = `
      <div class="pos-kv"><span>First Name</span><span>${escapeHtml(first)}</span></div>
      <div class="pos-kv"><span>Last Name</span><span>${escapeHtml(last)}</span></div>
      <div class="pos-kv"><span>Email</span><span class="mono">${escapeHtml(r.email || '')}</span></div>
      <div class="pos-kv"><span>Phone</span><span class="mono">${escapeHtml(r.phone || '')}</span></div>
      <div class="pos-kv"><span>Account</span><span class="mono">${escapeHtml(r.account_id || '')}</span></div>
      ${r.member_since ? `<div class="pos-kv"><span>Member since</span><span>${escapeHtml(String(r.member_since))}</span></div>` : ''}
      ${hasHistory ? '<button type="button" class="pos-link" id="pos-history-link">Past Rentals / Reservations</button>' : ''}
    `;
    if (r.notes) posCustomerNotes.textContent = r.notes;
    document.getElementById('pos-history-link')?.addEventListener('click', () => openHistoryModal(r));
  }

  function renderLookupResult(kind, r) {
    posLookupResult.hidden = false;
    posLookupResult.dataset.state = kind;
    if (kind === 'found') {
      posLookupResult.innerHTML = `<span class="pos-lookup-badge ok">Record found</span> ${escapeHtml(r.full_name)} loaded into the customer panel.`;
    } else if (kind === 'prospect') {
      posLookupResult.innerHTML = `<span class="pos-lookup-badge">New prospect</span> ${escapeHtml(r.notes || 'No record on file. Continue as a new reservation.')}`;
    } else {
      posLookupResult.innerHTML = '<span class="pos-lookup-badge">No match</span> No customer matched. Confirm the number, or continue as a new reservation.';
    }
  }

  function matchCustomerRecord(record, query) {
    if (!record || record.found === false) return false;
    const phoneDigits = (s) => String(s || '').replace(/\D/g, '');
    const norm = (s) => String(s || '').toLowerCase().trim();
    const qPhone = phoneDigits(query);
    const qText = norm(query);
    if (qPhone && phoneDigits(record.phone).includes(qPhone) && qPhone.length >= 4) return true;
    if (qText && norm(record.email).includes(qText) && qText.length >= 3) return true;
    if (qText && norm(record.full_name).includes(qText) && qText.length >= 2) return true;
    return false;
  }

  function doLookup() {
    const q = posLookupInput.value.trim();
    if (!q) return;
    const record = scenario.customer_record;
    if (matchCustomerRecord(record, q)) {
      selectedRecord = record;
      renderCustomerCard(record);
      renderLookupResult('found', record);
      setRsv('receipt_email', record.email || '');
      setRsv('receipt_phone', record.phone || '');
      renderLeftRail();
    } else if (record && record.found === false) {
      selectedRecord = null;
      posVerified.hidden = true;
      renderLookupResult('prospect', record);
    } else {
      selectedRecord = null;
      posVerified.hidden = true;
      renderLookupResult('notfound', null);
    }
  }

  function detectBrand(num) {
    const n = String(num || '').replace(/\D/g, '');
    if (/^4/.test(n)) return 'visa';
    if (/^(34|37)/.test(n)) return 'amex';
    if (/^(5[1-5]|2[2-7])/.test(n)) return 'mastercard';
    if (/^6(011|5)/.test(n)) return 'discover';
    return 'unknown';
  }
  function formatCardNumber(raw) {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 19);
    const groups = detectBrand(digits) === 'amex'
      ? [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)]
      : (digits.match(/.{1,4}/g) || []);
    return groups.filter(Boolean).join(' ');
  }
  function updateCardChip() {
    const num = getRsv('card_number').replace(/\D/g, '');
    const brand = detectBrand(num);
    posCcChip.hidden = num.length < 2;
    posCcChip.dataset.brand = brand;
    posCcBrand.textContent = brand === 'unknown' ? 'CARD' : brand.toUpperCase();
    posCcLast4.textContent = num ? '•••• ' + num.slice(-4) : '••••';
  }
  function updateCardStatus() {
    const num = getRsv('card_number').replace(/\D/g, '');
    if (!posCardStatus) return;
    posCardStatus.textContent = num.length >= 13
      ? `Card on file: ${detectBrand(num).toUpperCase()} ending ${num.slice(-4)}.`
      : 'Enter the card in the Credit Card panel to confirm.';
  }

  function showErr(text) {
    posErrorEl.textContent = text;
    posErrorEl.hidden = false;
    posErrorEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Gates live only where they are the natural action of the step, so the
  // trainee is never dead-ended on an unrelated field. The Details and Time
  // steps never block; you choose a truck on Equipment, a branch on Location,
  // and enter the card on Checkout.
  function validateStep(n) {
    if (n === 2) {
      if (!recommendedSize()) return 'Pick a truck below under "Show all moving equipment", or set a load size on the Details step.';
      if (getRsv('move_type') === 'one_way' && Number(getRsv('miles') || 0) <= 0) return 'Enter the estimated distance for the one-way move.';
    } else if (n === 3) {
      if (!selectedLocation) return 'Select a pickup location.';
    } else if (n === 5) {
      if (getRsv('card_number').replace(/\D/g, '').length < 13) return 'Enter the card number in the Credit Card panel.';
      if (!getRsv('card_exp_month') || !getRsv('card_exp_year')) return 'Set the card expiration in the Credit Card panel.';
      if (!/^\d{5}$/.test(getRsv('card_zip'))) return 'Enter a 5-digit billing ZIP in the Credit Card panel.';
    }
    return null;
  }

  function showStep(n) {
    posStep = Math.max(1, Math.min(TOTAL_STEPS, n));
    posForm.querySelectorAll('.pos-step').forEach((s) => { s.hidden = Number(s.dataset.step) !== posStep; });
    posStepper.querySelectorAll('.pos-stepper-item').forEach((it) => {
      const sn = Number(it.dataset.step);
      it.classList.toggle('active', sn === posStep);
      it.classList.toggle('done', sn < posStep);
    });
    posBackBtn.hidden = posStep === 1;
    posErrorEl.hidden = true;
    posNextBtn.textContent = posStep === TOTAL_STEPS ? 'Reserve Now' : 'Continue';
    if (posStep === 2) renderEquip();
    if (posStep === 4) renderSched();
    if (posStep === 5) updateCardStatus();
    const stage = posForm.closest('.pos-stage');
    if (stage) stage.scrollTop = 0;
  }

  posBackBtn.addEventListener('click', () => showStep(posStep - 1));

  posForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = validateStep(posStep);
    if (err) { showErr(err); return; }
    if (posStep === 1 && !storageAsked) {
      storageAsked = true;
      openStorageModal(() => showStep(2));
      return;
    }
    if (posStep < TOTAL_STEPS) { showStep(posStep + 1); return; }
    reserve();
  });

  function onPosChange() {
    renderCart();
    renderLeftRail();
    if (posStep === 2) renderEquip();
    if (posStep === 4) renderSched();
  }
  posForm.addEventListener('input', onPosChange);
  posForm.addEventListener('change', onPosChange);

  pos.querySelector('[data-rsv="load_size"]')?.addEventListener('change', () => {
    truckOverride = null;
    renderEquip();
    renderCart();
  });

  pos.querySelectorAll('.pos-equip-opt').forEach((b) => {
    b.addEventListener('click', () => {
      truckOverride = Number(b.dataset.truck);
      renderEquip();
      renderCart();
      renderSched();
    });
  });

  posLocList.addEventListener('click', (e) => {
    const card = e.target.closest('.pos-loc');
    if (!card) return;
    selectedLocation = card.dataset.location;
    pos.querySelectorAll('.pos-loc').forEach((c) => c.classList.toggle('selected', c === card));
    renderEntity();
    renderSched();
    renderLeftRail();
  });

  // Geocode the move addresses (debounced) so the Location step ranks branches
  // by real distance and one-way mileage auto-fills. move_type changes re-run
  // it because switching to One Way needs the destination resolved.
  ['moving_from', 'moving_to'].forEach((name) => {
    const el = pos.querySelector(`[data-rsv="${name}"]`);
    if (!el) return;
    el.addEventListener('input', scheduleGeo);
    el.addEventListener('blur', () => { clearTimeout(geoTimer); refreshGeo(); });
  });
  pos.querySelectorAll('[data-rsv="move_type"]').forEach((el) => {
    el.addEventListener('change', () => { clearTimeout(geoTimer); refreshGeo(); });
  });

  posLookupBtn.addEventListener('click', doLookup);
  posLookupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doLookup(); }
  });

  const posCardNum = pos.querySelector('[data-rsv="card_number"]');
  const posCardZip = pos.querySelector('[data-rsv="card_zip"]');
  posCardNum.addEventListener('input', (e) => {
    e.target.value = formatCardNumber(e.target.value);
    updateCardChip();
    updateCardStatus();
  });
  posCardZip.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
  });

  function reserve() {
    const q = computeQuote();
    const loc = LOC_BY_NAME[selectedLocation] || {};
    const num = getRsv('card_number').replace(/\D/g, '');
    const custName = selectedRecord?.full_name || (scenario.blind ? 'the caller' : scenario.customer_name);
    const exp = `${getRsv('card_exp_month') || '--'}/${getRsv('card_exp_year') || '--'}`;
    const brand = detectBrand(num);
    const last4 = num.slice(-4) || '----';
    const conf = 'MR-' + Math.floor(100000 + Math.random() * 900000);
    const ls = LOAD_BY_VALUE[getRsv('load_size')];
    const rl = RENTAL_BY_VALUE[getRsv('rental_length')];

    const lineHtml = q.lines.map((l) => `
      <div class="pos-cart-line"><div class="pos-cart-line-label">${escapeHtml(l.label)}</div><div class="pos-cart-line-amt mono">${fmtMoney(l.amount)}</div></div>
    `).join('');

    posForm.hidden = true;
    posStepper.hidden = true;
    if (posNav) posNav.hidden = true;
    posResult.innerHTML = `
      <div class="pos-receipt">
        <div class="pos-receipt-head">
          <div class="pos-receipt-tag"><span class="pos-receipt-check" aria-hidden="true">&#10003;</span> Reservation confirmed</div>
          <div class="pos-receipt-conf"><span class="pos-receipt-conf-label">Confirmation number</span><span class="pos-receipt-conf-num mono">${escapeHtml(conf)}</span></div>
        </div>
        <div class="pos-receipt-grid">
          <div class="pos-receipt-section">
            <div class="pos-receipt-section-title">Customer</div>
            <div class="pos-receipt-line"><span>Name</span><span>${escapeHtml(custName)}</span></div>
            ${getRsv('receipt_phone') ? `<div class="pos-receipt-line"><span>Phone</span><span class="mono">${escapeHtml(getRsv('receipt_phone'))}</span></div>` : ''}
            ${getRsv('receipt_email') ? `<div class="pos-receipt-line"><span>Email</span><span class="mono">${escapeHtml(getRsv('receipt_email'))}</span></div>` : ''}
          </div>
          <div class="pos-receipt-section">
            <div class="pos-receipt-section-title">Trip</div>
            <div class="pos-receipt-line"><span>Move type</span><span>${q.oneWay ? 'One Way' : 'In Town'}</span></div>
            ${ls ? `<div class="pos-receipt-line"><span>Load</span><span>${escapeHtml(ls.label)}</span></div>` : ''}
            <div class="pos-receipt-line"><span>Pickup</span><span>${escapeHtml(getRsv('pickup_date'))} &middot; ${escapeHtml(getRsv('pickup_time') || 'time TBD')}</span></div>
            <div class="pos-receipt-line"><span>Location</span><span>${escapeHtml(loc.name ? 'Meridian of ' + loc.name : 'TBD')}</span></div>
          </div>
          <div class="pos-receipt-section">
            <div class="pos-receipt-section-title">Equipment</div>
            <div class="pos-receipt-line"><span>Truck</span><span>${escapeHtml(q.truck ? q.truck.label : 'TBD')}</span></div>
            <div class="pos-receipt-line"><span>Rental length</span><span>${escapeHtml(q.oneWay ? `${q.ow ? q.ow.days : 1} days (one-way)` : (rl ? rl.label : '1 day'))}</span></div>
            ${q.miles > 0 ? `<div class="pos-receipt-line"><span>${q.oneWay ? 'Distance' : 'Mileage'}</span><span>${escapeHtml(String(q.miles))} mi</span></div>` : ''}
            <div class="pos-receipt-line"><span>Waiver</span><span>${escapeHtml(q.waiver.label)}</span></div>
            ${(q.padsChecked || q.dollyChecked) ? `<div class="pos-receipt-line"><span>Add-ons</span><span>${[q.padsChecked && 'Pads', q.dollyChecked && 'Dolly'].filter(Boolean).join(', ')}</span></div>` : ''}
          </div>
        </div>
        <div class="pos-receipt-cart">
          ${lineHtml}
          <div class="pos-cart-rule"></div>
          <div class="pos-cart-line pos-cart-subtotal"><div class="pos-cart-line-label">Subtotal</div><div class="pos-cart-line-amt mono">${fmtMoney(q.subtotal)}</div></div>
          <div class="pos-cart-line pos-cart-line-muted"><div class="pos-cart-line-label">Estimated tax</div><div class="pos-cart-line-amt mono">${fmtMoney(q.tax)}</div></div>
          <div class="pos-cart-rule"></div>
          <div class="pos-cart-line pos-cart-total"><div class="pos-cart-line-label">Total</div><div class="pos-cart-line-amt mono">${fmtMoney(q.total)}</div></div>
          <div class="pos-cc-chip" data-brand="${escapeAttr(brand)}">
            <span class="pos-cc-brand">${escapeHtml(brand === 'unknown' ? 'CARD' : brand.toUpperCase())}</span>
            <span class="mono">•••• ${escapeHtml(last4)}</span>
            <span class="mono">exp ${escapeHtml(exp)}</span>
          </div>
        </div>
        <div class="pos-receipt-readback">
          <div class="pos-receipt-readback-title">Read back to the caller</div>
          <p>"Your confirmation number is <strong class="mono">${escapeHtml(conf)}</strong>. We're holding a ${escapeHtml(q.truck ? q.truck.label : 'truck')} for you at the ${escapeHtml(loc.name || 'pickup')} location on ${escapeHtml(getRsv('pickup_date'))} at ${escapeHtml(getRsv('pickup_time') || 'your selected time')}. Your total comes to ${escapeHtml(fmtMoney(q.total))} on the card ending in ${escapeHtml(last4)}. Is there anything else I can help you with?"</p>
        </div>
        <div class="pos-receipt-actions">
          <button class="ghost-button" type="button" id="pos-new">Start another reservation</button>
        </div>
      </div>
    `;
    document.getElementById('pos-new')?.addEventListener('click', () => {
      posResult.innerHTML = '';
      posForm.reset();
      posForm.hidden = false;
      posStepper.hidden = false;
      if (posNav) posNav.hidden = false;
      truckOverride = null;
      selectedLocation = null;
      storageAsked = false;
      originGeo = null;
      destGeo = null;
      lastGeoKey = null;
      setGeoStatus('', '');
      posEntityCard.hidden = true;
      updateCardChip();
      setRsv('pickup_date', new Date().toISOString().slice(0, 10));
      renderCart();
      renderLeftRail();
      renderSched();
      renderLocations();
      showStep(1);
    });
  }

  function openStorageModal(onContinue) {
    const overlay = document.createElement('div');
    overlay.className = 'pos-modal';
    overlay.innerHTML = `
      <div class="pos-modal-inner" role="dialog" aria-modal="true" aria-labelledby="pos-storage-title">
        <div class="pos-modal-eyebrow">Storage</div>
        <h3 class="pos-modal-title" id="pos-storage-title">Will the customer need storage?</h3>
        <p class="pos-modal-sub">Ask if they need storage before or after the move. Meridian self-storage carries a one-year price-lock guarantee.</p>
        <div class="pos-modal-actions">
          <button type="button" class="ghost-button" data-storage="no">No thanks</button>
          <button type="button" class="primary-button" data-storage="after">Yes, add storage</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    let settled = false;
    function close(val) {
      if (settled) return;
      settled = true;
      if (val) setRsv('storage', val);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      onContinue();
    }
    function onKey(e) { if (e.key === 'Escape') close('no'); }
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-storage]');
      if (btn) { close(btn.dataset.storage); return; }
      if (e.target === overlay) close('no');
    });
    document.addEventListener('keydown', onKey);
  }

  function openHistoryModal(r) {
    const reservations = r.active_reservations || [];
    const claims = r.claims_cases || [];
    const past = r.past_rentals || [];
    const overlay = document.createElement('div');
    overlay.className = 'pos-modal';
    overlay.innerHTML = `
      <div class="pos-modal-inner pos-modal-wide" role="dialog" aria-modal="true" aria-labelledby="pos-hist-title">
        <div class="pos-modal-head">
          <h3 class="pos-modal-title" id="pos-hist-title">${escapeHtml(r.full_name)} &middot; history</h3>
          <button type="button" class="pos-modal-close" aria-label="Close">&times;</button>
        </div>
        ${reservations.length ? `<div class="pos-hist-group pos-hist-accent"><div class="pos-hist-title">Active reservations</div>${reservations.map((res) => `<div class="pos-hist-row"><span class="mono">${escapeHtml(res.confirmation)}</span> ${escapeHtml(res.truck)} &middot; ${escapeHtml(res.location)} &middot; ${escapeHtml(res.date)} &middot; ${escapeHtml(res.total)} &middot; <em>${escapeHtml(res.status)}</em></div>`).join('')}</div>` : ''}
        ${claims.length ? `<div class="pos-hist-group pos-hist-warn"><div class="pos-hist-title">Open claims</div>${claims.map((c) => `<div class="pos-hist-row"><span class="mono">${escapeHtml(c.case_id)}</span> ${escapeHtml(c.amount)} &middot; ${escapeHtml(c.description)} &middot; <em>${escapeHtml(c.status)}</em></div>`).join('')}</div>` : ''}
        ${past.length ? `<div class="pos-hist-group"><div class="pos-hist-title">Past rentals (${past.length})</div>${past.map((p) => `<div class="pos-hist-row"><span class="mono">${escapeHtml(p.date)}</span> ${escapeHtml(p.truck)} &middot; ${escapeHtml(p.location)} &middot; ${escapeHtml(p.total)} &middot; <em>${escapeHtml(p.status)}</em></div>`).join('')}</div>` : ''}
        ${r.notes ? `<div class="pos-hist-group"><div class="pos-hist-title">Agent notes</div><p class="pos-hist-notes">${escapeHtml(r.notes)}</p></div>` : ''}
      </div>
    `;
    document.body.appendChild(overlay);
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.pos-modal-close')) close();
    });
    document.addEventListener('keydown', onKey);
  }

  // Floating call dock collapse toggle
  const callDock = document.getElementById('call-dock');
  const callDockHead = document.getElementById('call-dock-head');
  callDockHead?.addEventListener('click', () => {
    const collapsed = callDock.dataset.collapsed === 'true';
    callDock.dataset.collapsed = String(!collapsed);
    callDockHead.setAttribute('aria-expanded', String(collapsed));
  });

  // Init
  setRsv('pickup_date', new Date().toISOString().slice(0, 10));
  renderLeftRail();
  renderCart();
  renderEquip();
  renderSched();
  renderLocations();
  updateCardChip();
  showStep(1);
}

async function runCoaching(scenario, messages) {
  state.view = 'analyzing';
  setDocumentTitle('Analyzing call');
  renderAnalyzing(scenario);

  try {
    const report = await requestCoachingReport(scenario.id, messages, scenario.opening_line);
    renderReport(scenario, report);
  } catch (err) {
    renderCoachingError(scenario, messages, err);
  }
}

function renderAnalyzing(scenario) {
  dom.root.innerHTML = `
    <section class="analyzing">
      <div class="analyzing-ring" aria-hidden="true">
        <div class="analyzing-ring-spin"></div>
      </div>
      <h1 class="analyzing-title">Analyzing your call...</h1>
      <p class="analyzing-text">Reviewing the transcript with ${escapeHtml(scenario.customer_name)} and scoring against the rubric. This usually takes a few seconds.</p>
    </section>
  `;
}

function renderReport(scenario, report) {
  state.view = 'report';
  setDocumentTitle(`Report: ${scenario.customer_name}`);
  const node = renderReportHtml(scenario, report, {
    onNewCall: renderPicker,
    onRetry: () => startCall(scenario.id),
  });
  dom.root.replaceChildren(node);
}

function renderShortCall(scenario) {
  state.view = 'ended';
  dom.root.innerHTML = `
    <section class="ended">
      <h1 class="ended-title">Call ended early.</h1>
      <p class="ended-text">That call was a little too short to coach on. Try going at least a few exchanges before ending.</p>
      <div class="ended-actions">
        <button class="ghost-button" id="ended-back" type="button">Back to scenarios</button>
        <button class="primary-button" id="ended-retry" type="button">Try ${escapeHtml(scenario.title)} again</button>
      </div>
    </section>
  `;
  document.getElementById('ended-back').addEventListener('click', renderPicker);
  document.getElementById('ended-retry').addEventListener('click', () => startCall(scenario.id));
}

function renderCoachingError(scenario, messages, err) {
  state.view = 'coaching_error';
  dom.root.innerHTML = `
    <section class="ended">
      <h1 class="ended-title">We could not finish the report.</h1>
      <p class="ended-text">Something went wrong analyzing the call (${escapeHtml(err?.message || 'unknown error')}). Your transcript is still intact, so you can try generating the report again.</p>
      <div class="ended-actions">
        <button class="ghost-button" id="error-back" type="button">Back to scenarios</button>
        <button class="primary-button" id="error-retry" type="button">Retry analysis</button>
      </div>
    </section>
  `;
  document.getElementById('error-back').addEventListener('click', renderPicker);
  document.getElementById('error-retry').addEventListener('click', () => runCoaching(scenario, messages));
}

function appendMessage(transcript, kind, label, text) {
  const li = document.createElement('li');
  li.className = `message message-${kind}`;
  li.innerHTML = `
    <div class="message-label">${escapeHtml(label)}</div>
    <div class="message-bubble"></div>
  `;
  li.querySelector('.message-bubble').textContent = text;
  transcript.appendChild(li);
  transcript.scrollTop = transcript.scrollHeight;
  return li;
}

function appendSilenceMarker(transcript) {
  const li = document.createElement('li');
  li.className = 'silence-marker';
  li.textContent = '· silence on the line ·';
  transcript.appendChild(li);
  transcript.scrollTop = transcript.scrollHeight;
  return li;
}

// Branch picker modal. Lets the trainee see each branch's full details
// and lock one in without leaving the reservation form. Writes the chosen
// branch into the given select and fires a change event so the cost
// estimate recomputes.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function capitalize(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

function promptDemoPassword() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'demo-modal';
    overlay.innerHTML = `
      <div class="demo-modal-inner" role="dialog" aria-modal="true" aria-labelledby="demo-modal-title">
        <div class="demo-modal-eyebrow">Premium demo mode</div>
        <h3 class="demo-modal-title" id="demo-modal-title">Unlock the premium voice</h3>
        <p class="demo-modal-text">This persona uses the premium voice model (Eleven v3). Enter the demo password to unlock it for this session, or skip to use the standard voice.</p>
        <form class="demo-modal-form" autocomplete="off">
          <label class="demo-modal-label" for="demo-modal-input">Demo password</label>
          <input type="password" class="demo-modal-input" id="demo-modal-input" autocomplete="off">
          <p class="demo-modal-error" hidden></p>
          <div class="demo-modal-actions">
            <button type="button" class="ghost-button demo-modal-skip">Skip · use standard voice</button>
            <button type="submit" class="primary-button">Unlock</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('input');
    const form = overlay.querySelector('form');
    const errEl = overlay.querySelector('.demo-modal-error');
    const skipBtn = overlay.querySelector('.demo-modal-skip');
    setTimeout(() => input.focus(), 50);

    let settled = false;
    function cleanup(result) {
      if (settled) return;
      settled = true;
      overlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(result);
    }
    function onOverlayClick(e) {
      if (e.target === overlay) cleanup(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') cleanup(false);
    }
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKey);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = input.value;
      if (!pw) return;
      input.disabled = true;
      errEl.hidden = true;
      try {
        const res = await fetch('/api/demo-unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ password: pw }),
        });
        if (res.ok) {
          cleanup(true);
        } else {
          input.disabled = false;
          errEl.textContent = 'Incorrect password. Try again, or skip to use the standard voice.';
          errEl.hidden = false;
          input.focus();
          input.select();
        }
      } catch {
        input.disabled = false;
        errEl.textContent = 'Could not reach the server. Try again in a moment.';
        errEl.hidden = false;
      }
    });

    skipBtn.addEventListener('click', () => cleanup(false));
  });
}

// Strip stage-direction artifacts before sending text to TTS. The persona
// prompt forbids these, but the model occasionally slips in *small laugh*,
// [chuckles], or (sighs) — which the voice synthesizer would otherwise read
// out loud as literal words.
const SPEECH_CUE_VERBS = /(?:laugh|laughs|laughing|sigh|sighs|sighing|chuckl[a-z]*|pause|pauses|breath[a-z]*|cough[a-z]*|mumbles?|whispers?|grumbl[a-z]*|huff[a-z]*|exhal[a-z]*|inhal[a-z]*|smil[a-z]*|smirks?|gasp[a-z]*|sniffl[a-z]*|grunt[a-z]*|clears? throat|beat)/i;
// Sensory/body nouns that anchor a wordless stage direction the verb list
// misses, e.g. "(heart beating)", "(voice trembling)", "(eyes welling up)".
const SPEECH_CUE_NOUNS = /\b(?:heart|breath|voice|chest|throat|eyes?|jaw|shoulders?|teeth|fists?|tears?|lips?|hands?)\b/i;

// Decide whether a parenthetical is a stage direction the voice model would
// read aloud, versus a real spoken aside we must keep. The expressive v3
// model leaks multi-word directions ("heart beating") that the single-verb
// check never caught. Guard the genuine cases first: anything with sentence
// punctuation or a digit (spelled numbers, suite/phone fragments) is content,
// and long parentheticals are sentences, not directions.
function isSpeechCueParenthetical(inner) {
  const trimmed = inner.trim();
  if (!trimmed) return false;
  if (/[.!?]/.test(trimmed)) return false;
  if (/\d/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 4) return false;
  if (SPEECH_CUE_VERBS.test(trimmed)) return true;
  // Short, subjectless physical/emotional descriptions read as directions:
  // a present participle ("beating"), a manner adverb ("softly"), or a
  // sensory noun ("heart"). Real asides ("the big one") have none of these.
  const hasParticiple = words.some((w) => /[a-z]{3,}ing$/i.test(w));
  const hasMannerAdverb = words.some((w) => /[a-z]{3,}ly$/i.test(w));
  return hasParticiple || hasMannerAdverb || SPEECH_CUE_NOUNS.test(trimmed);
}

function scrubForSpeech(text) {
  return String(text || '')
    .replace(/\*[^*\n]+\*/g, '')
    .replace(/\[[^\]\n]+\]/g, '')
    .replace(/\(\s*([^)\n]{1,40})\s*\)/g, (match, inner) =>
      isSpeechCueParenthetical(inner) ? '' : match)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/[,;:]+\s*([.?!])/g, '$1')
    .trim();
}

// Premium (eleven_v3) speech scrub: keep square-bracket delivery tags so
// the expressive model can perform them, but still strip asterisk
// directions and parenthetical cue phrases it would read aloud.
function scrubForSpeechKeepTags(text) {
  return String(text || '')
    .replace(/\*[^*\n]+\*/g, '')
    .replace(/\(\s*([^)\n]{1,40})\s*\)/g, (match, inner) =>
      isSpeechCueParenthetical(inner) ? '' : match)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/[,;:]+\s*([.?!])/g, '$1')
    .trim();
}

// Remove every delivery tag/stage direction for the on-screen transcript,
// so the reader never sees "[sighs]" even when v3 is performing it.
function stripVoiceTags(text) {
  return String(text || '')
    .replace(/\[[^\]\n]+\]/g, '')
    .replace(/\*[^*\n]+\*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

// Convert the AI's spelled-out phone numbers, emails, and account numbers
// back to their natural printed form for the transcript bubble. The AI is
// instructed to spell them digit-by-digit so the TTS pronounces them like a
// human would; the transcript is the only place where the spelled form
// looks awkward. Apply ONLY to display - the conversation history and TTS
// pipeline keep the original text.
const DIGIT_WORD_TO_CHAR = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};
const DIGIT_WORD_PATTERN = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)';

function normalizeForTranscript(text) {
  if (!text) return text;
  let result = String(text);

  // 10-digit phone numbers in 3-3-4 rhythm:
  //   "five one two, three three four, seven eight two one" -> "512-334-7821"
  result = result.replace(
    new RegExp(`\\b${DIGIT_WORD_PATTERN}(?:[,\\s]+${DIGIT_WORD_PATTERN}){9}\\b`, 'gi'),
    (match) => {
      const digits = match
        .match(new RegExp(DIGIT_WORD_PATTERN, 'gi'))
        .map((w) => DIGIT_WORD_TO_CHAR[w.toLowerCase()])
        .join('');
      if (digits.length === 10) {
        return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
      }
      return digits;
    }
  );

  // Email addresses spelled out (uppercase letters required so we don't
  // accidentally grab letters from words like "email's"):
  //   "M A R C U S, dot, chen, dot, dev, at gmail, dot com" -> "marcus.chen.dev@gmail.com"
  result = result.replace(
    /\b([A-Z](?:[,\s]+[A-Z]){2,}(?:[,\s]+(?:dot|\.)[,\s]+[a-z]+){0,5})[,\s]+at[,\s]+([a-z]+(?:[,\s]+(?:dot|\.)[,\s]+[a-z]+)+)\b/g,
    (_match, local, domain) => {
      const cleanLocal = local
        .toLowerCase()
        .replace(/[,\s]+(?:dot|\.)[,\s]+/g, '.')
        .replace(/[,\s]+/g, '');
      const cleanDomain = domain
        .toLowerCase()
        .replace(/[,\s]+(?:dot|\.)[,\s]+/g, '.');
      return `${cleanLocal}@${cleanDomain}`;
    }
  );

  // Account / confirmation numbers like "M R, dash, two seven nine four, dash, seven eight two one"
  // -> "MR-2794-7821". Leading letters must be uppercase (same reason).
  result = result.replace(
    new RegExp(
      `\\b([A-Z](?:[,\\s]+[A-Z]){0,2})((?:[,\\s]+(?:dash|-)[,\\s]+${DIGIT_WORD_PATTERN}(?:[,\\s]+${DIGIT_WORD_PATTERN}){2,9})+)\\b`,
      'g'
    ),
    (_match, letters, rest) => {
      const letterPart = letters.replace(/[,\s]+/g, '').toUpperCase();
      const digitChunks = rest
        .split(/[,\s]+(?:dash|-)[,\s]+/i)
        .slice(1)
        .map((chunk) =>
          chunk
            .match(new RegExp(DIGIT_WORD_PATTERN, 'gi'))
            .map((w) => DIGIT_WORD_TO_CHAR[w.toLowerCase()])
            .join('')
        );
      return `${letterPart}-${digitChunks.join('-')}`;
    }
  );

  return result;
}

init();
