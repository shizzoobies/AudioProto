import { Conversation } from './conversation.js';
import { requestCoachingReport, renderReportHtml } from './coach.js';
import { AudioPlayer, attachVisualizer, synthesizeSentence, MicRecorder, ContinuousRecorder, transcribeAudio } from './audio.js';

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
  micRecorder: null,
  micDenied: false,
  inputMode: 'voice',
  pttKeyHandlers: null,
  sttController: null,
  callMode: 'phone',
  silenceTimer: null,
  demoUnlocked: false,
  orb: null,
};

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
  if (state.micRecorder) {
    state.micRecorder.cancel();
    state.micRecorder = null;
  }
  if (state.continuousRecorder) {
    state.continuousRecorder.cancel();
    state.continuousRecorder = null;
  }
  if (state.pttKeyHandlers) {
    document.removeEventListener('keydown', state.pttKeyHandlers.down);
    document.removeEventListener('keyup', state.pttKeyHandlers.up);
    state.pttKeyHandlers = null;
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
  const premiumBadge = (isShowcaseCall && state.demoUnlocked)
    ? '<span class="call-mode-pill call-mode-pill-premium" title="Premium voice (Eleven v3)">Premium voice</span>'
    : '';

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
        <div class="call-main">
          ${isPhone ? (useOrb ? `
          <div class="orb-zone" id="orb-zone" data-orb-mode="meta" data-active="false">
            <div class="orb-mount" id="orb-mount"></div>
          </div>
          ` : `
          <div class="visualizer-wrap" id="visualizer-wrap" data-active="false">
            <canvas class="visualizer" id="visualizer"></canvas>
          </div>
          `) : ''}
          <ol class="transcript" id="transcript" aria-live="polite"></ol>
          ${isPhone ? `
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
              <textarea
                id="composer-input"
                class="composer-input"
                placeholder="${escapeAttr(placeholder)}"
                rows="2"
              ></textarea>
              <button type="submit" class="composer-send" id="composer-send">Send</button>
            </form>
            <p class="composer-status" id="composer-status" aria-live="polite"></p>
          </div>
          `}
        </div>
        <aside class="crm-panel" id="crm-panel" aria-label="CSR system">
          <header class="crm-header">
            <div class="crm-eyebrow">Meridian CSR</div>
            <div class="crm-tabs" role="tablist">
              <button class="crm-tab active" data-tab="lookup" role="tab" type="button" aria-selected="true">Lookup</button>
              <button class="crm-tab" data-tab="reservation" role="tab" type="button" aria-selected="false">New Reservation</button>
            </div>
          </header>

          <div class="crm-pane" data-tab="lookup">
            <form class="crm-form" id="crm-form" autocomplete="off">
              <label class="crm-field">
                <span class="crm-field-label">Phone</span>
                <input class="crm-input" id="crm-phone" type="tel" placeholder="555-123-4567">
              </label>
              <label class="crm-field">
                <span class="crm-field-label">Email</span>
                <input class="crm-input" id="crm-email" type="text" inputmode="email" placeholder="name@example.com">
              </label>
              <label class="crm-field">
                <span class="crm-field-label">Last name</span>
                <input class="crm-input" id="crm-name" type="text" placeholder="Chen">
              </label>
              <button type="submit" class="crm-submit">Search</button>
            </form>
            <div class="crm-result" id="crm-result" data-state="empty">
              <p class="crm-empty">Enter phone, email, or last name to look up the caller. Any one field works; partial matches are fine.</p>
            </div>
          </div>

          <div class="crm-pane crm-pane-reservation" data-tab="reservation" hidden>
            <div class="rsv-wizard" id="rsv-wizard" data-step="1">
              <ol class="rsv-stepper" aria-label="Reservation steps">
                <li class="rsv-stepper-item active" data-step="1">
                  <span class="rsv-stepper-num">1</span>
                  <span class="rsv-stepper-label">Customer</span>
                </li>
                <li class="rsv-stepper-item" data-step="2">
                  <span class="rsv-stepper-num">2</span>
                  <span class="rsv-stepper-label">Trip</span>
                </li>
                <li class="rsv-stepper-item" data-step="3">
                  <span class="rsv-stepper-num">3</span>
                  <span class="rsv-stepper-label">Equipment</span>
                </li>
                <li class="rsv-stepper-item" data-step="4">
                  <span class="rsv-stepper-num">4</span>
                  <span class="rsv-stepper-label">Payment</span>
                </li>
              </ol>

              <form class="crm-reservation" id="crm-reservation" autocomplete="off" novalidate>
                <section class="rsv-step" data-step="1">
                  <header class="rsv-step-head">
                    <div class="rsv-step-eyebrow">Step 1 of 4</div>
                    <h3 class="rsv-step-title">Who's on the line?</h3>
                  </header>
                  <p class="crm-hint">Try: "Can I get your full name, the best phone number for you, and an email for the confirmation?"</p>
                  <label class="crm-field">
                    <span class="crm-field-label">Full name</span>
                    <input class="crm-input" data-rsv="full_name" type="text" placeholder="Customer name">
                  </label>
                  <label class="crm-field">
                    <span class="crm-field-label">Phone</span>
                    <input class="crm-input" data-rsv="phone" type="tel" placeholder="555-123-4567">
                  </label>
                  <label class="crm-field">
                    <span class="crm-field-label">Email</span>
                    <input class="crm-input" data-rsv="email" type="text" inputmode="email" placeholder="name@example.com">
                  </label>
                </section>

                <section class="rsv-step" data-step="2" hidden>
                  <header class="rsv-step-head">
                    <div class="rsv-step-eyebrow">Step 2 of 4</div>
                    <h3 class="rsv-step-title">Trip details</h3>
                  </header>
                  <p class="crm-hint">Try: "When are you picking up, when are you bringing it back, and how far are you going?"</p>
                  <div class="rsv-row">
                    <label class="crm-field">
                      <span class="crm-field-label">Pickup date</span>
                      <input class="crm-input" data-rsv="pickup_date" type="date">
                    </label>
                    <label class="crm-field">
                      <span class="crm-field-label">Pickup time</span>
                      <input class="crm-input" data-rsv="pickup_time" type="time" value="09:00">
                    </label>
                  </div>
                  <label class="crm-field">
                    <span class="crm-field-label">Pickup location</span>
                    <select class="crm-input" data-rsv="location">
                      <option value="">Choose a branch...</option>
                      <option>Downtown</option>
                      <option>Northgate</option>
                      <option>Riverside</option>
                      <option>Westside</option>
                      <option>Airport</option>
                    </select>
                  </label>
                  <div class="rsv-row">
                    <label class="crm-field">
                      <span class="crm-field-label">Return date</span>
                      <input class="crm-input" data-rsv="return_date" type="date">
                    </label>
                    <label class="crm-field">
                      <span class="crm-field-label">Return time</span>
                      <input class="crm-input" data-rsv="return_time" type="time" value="17:00">
                    </label>
                  </div>
                  <label class="crm-check-row">
                    <input type="checkbox" id="rsv-same-location" checked>
                    <span>Returning to the same location</span>
                  </label>
                  <label class="crm-field" id="rsv-return-loc-field" hidden>
                    <span class="crm-field-label">Return location</span>
                    <select class="crm-input" data-rsv="return_location">
                      <option value="">Choose a branch...</option>
                      <option>Downtown</option>
                      <option>Northgate</option>
                      <option>Riverside</option>
                      <option>Westside</option>
                      <option>Airport</option>
                    </select>
                  </label>
                  <label class="crm-field">
                    <span class="crm-field-label">Estimated miles</span>
                    <input class="crm-input" data-rsv="miles" data-numeric="1" type="number" min="0" step="1" placeholder="e.g. 12" value="0">
                  </label>
                </section>

                <section class="rsv-step" data-step="3" hidden>
                  <header class="rsv-step-head">
                    <div class="rsv-step-eyebrow">Step 3 of 4</div>
                    <h3 class="rsv-step-title">Equipment and add-ons</h3>
                  </header>
                  <p class="crm-hint">Try: "Walk me through the biggest stuff. How many bedrooms? Any appliances?"</p>
                  <label class="crm-field">
                    <span class="crm-field-label">Bedrooms</span>
                    <select class="crm-input" data-rsv="bedrooms" data-numeric="1">
                      <option value="0">Studio</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4+</option>
                    </select>
                  </label>
                  <fieldset class="crm-checks">
                    <legend class="crm-field-label">Major furniture</legend>
                    <label><input type="checkbox" data-rsv-furniture="bed_queenking"> Queen or king bed</label>
                    <label><input type="checkbox" data-rsv-furniture="bed_other"> Full or twin bed</label>
                    <label><input type="checkbox" data-rsv-furniture="sofa"> Sofa / sectional</label>
                    <label><input type="checkbox" data-rsv-furniture="dining"> Dining set</label>
                    <label><input type="checkbox" data-rsv-furniture="dresser"> Dresser / armoire</label>
                    <label><input type="checkbox" data-rsv-furniture="bookshelves"> Bookshelves</label>
                  </fieldset>
                  <fieldset class="crm-checks">
                    <legend class="crm-field-label">Major appliances</legend>
                    <label><input type="checkbox" data-rsv-appliance="washer"> Washer</label>
                    <label><input type="checkbox" data-rsv-appliance="dryer"> Dryer</label>
                    <label><input type="checkbox" data-rsv-appliance="fridge"> Fridge</label>
                    <label><input type="checkbox" data-rsv-appliance="other"> Other large item</label>
                  </fieldset>
                  <label class="crm-field">
                    <span class="crm-field-label">Boxes (estimate)</span>
                    <input class="crm-input" data-rsv="boxes" data-numeric="1" type="number" min="0" step="1" placeholder="e.g. 25" value="0">
                  </label>

                  <div class="rsv-truck" id="rsv-truck" data-size="?">
                    <div class="rsv-truck-head">
                      <span class="rsv-truck-tag" id="rsv-truck-tag">Recommendation</span>
                      <span class="rsv-truck-label" id="rsv-truck-label">Add inventory to see a fit.</span>
                    </div>
                    <div class="rsv-truck-rate" id="rsv-truck-rate"></div>
                    <label class="crm-field">
                      <span class="crm-field-label">Override truck size</span>
                      <select class="crm-input" data-rsv="truck_override">
                        <option value="">Use system recommendation</option>
                        <option value="10">10-foot ($19.95/day + $0.79/mi)</option>
                        <option value="15">15-foot ($29.95/day + $0.89/mi)</option>
                        <option value="20">20-foot ($39.95/day + $0.99/mi)</option>
                        <option value="26">26-foot ($49.95/day + $1.19/mi)</option>
                      </select>
                    </label>
                  </div>

                  <fieldset class="crm-section-block">
                    <legend class="crm-section-title">Damage waiver</legend>
                    <p class="crm-hint">Try: "Want me to add the damage waiver? Basic is $15 a day for $5k, premium is $25 a day for $25k."</p>
                    <label class="crm-field">
                      <span class="crm-field-label">Coverage</span>
                      <select class="crm-input" data-rsv="waiver">
                        <option value="none">Decline coverage</option>
                        <option value="basic">Basic ($15/day, up to $5k)</option>
                        <option value="premium">Premium ($25/day, up to $25k)</option>
                      </select>
                    </label>
                  </fieldset>

                  <fieldset class="crm-checks">
                    <legend class="crm-field-label">Equipment add-ons</legend>
                    <label><input type="checkbox" data-rsv-equipment="pads"> Furniture pads ($10/pack)</label>
                    <label><input type="checkbox" data-rsv-equipment="dolly"> Utility dolly ($7/day)</label>
                  </fieldset>
                </section>

                <section class="rsv-step" data-step="4" hidden>
                  <header class="rsv-step-head">
                    <div class="rsv-step-eyebrow">Step 4 of 4</div>
                    <h3 class="rsv-step-title">Payment</h3>
                  </header>
                  <div class="rsv-test-banner">
                    <span class="rsv-test-icon" aria-hidden="true">i</span>
                    Training mode. Card details are not stored or charged.
                  </div>

                  <div class="rsv-summary" id="rsv-summary"></div>

                  <p class="crm-hint">Try: "To secure the truck I'll just need a card. Can I get the number, the expiration, and the security code on the back?"</p>

                  <div class="card-preview" id="card-preview" data-brand="unknown">
                    <div class="card-preview-band">
                      <span class="card-preview-issuer">Meridian · Card on File</span>
                      <span class="card-preview-brand" id="card-preview-brand">CARD</span>
                    </div>
                    <div class="card-preview-number" id="card-preview-number">•••• •••• •••• ••••</div>
                    <div class="card-preview-row">
                      <div>
                        <div class="card-preview-key">Cardholder</div>
                        <div class="card-preview-val" id="card-preview-name">FULL NAME</div>
                      </div>
                      <div>
                        <div class="card-preview-key">Expires</div>
                        <div class="card-preview-val" id="card-preview-exp">MM/YY</div>
                      </div>
                    </div>
                  </div>

                  <label class="crm-field">
                    <span class="crm-field-label">Cardholder name</span>
                    <input class="crm-input" data-rsv="card_name" type="text" autocomplete="cc-name" placeholder="As it appears on the card">
                  </label>
                  <label class="crm-field">
                    <span class="crm-field-label">Card number</span>
                    <input class="crm-input" data-rsv="card_number" type="text" inputmode="numeric" autocomplete="cc-number" placeholder="4111 1111 1111 1111" maxlength="23">
                  </label>
                  <div class="rsv-row rsv-row-3">
                    <label class="crm-field">
                      <span class="crm-field-label">Expiry</span>
                      <input class="crm-input" data-rsv="card_exp" type="text" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" maxlength="5">
                    </label>
                    <label class="crm-field">
                      <span class="crm-field-label">CVV</span>
                      <input class="crm-input" data-rsv="card_cvv" type="text" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4">
                    </label>
                    <label class="crm-field">
                      <span class="crm-field-label">Billing ZIP</span>
                      <input class="crm-input" data-rsv="card_zip" type="text" inputmode="numeric" autocomplete="postal-code" placeholder="98101" maxlength="5">
                    </label>
                  </div>
                </section>

                <div class="rsv-error" id="rsv-error" hidden></div>

                <div class="rsv-nav">
                  <button type="button" class="ghost-button" id="rsv-back" hidden>Back</button>
                  <div class="rsv-nav-total" id="rsv-nav-total" hidden></div>
                  <button type="submit" class="primary-button rsv-next-btn" id="rsv-next">Continue</button>
                </div>
              </form>
            </div>
            <div class="crm-rsv-result" id="crm-rsv-result"></div>
          </div>
        </aside>
      </div>
    </section>
  `;

  const transcript = document.getElementById('transcript');
  const visualizerWrap = document.getElementById('visualizer-wrap');
  const visualizerCanvas = document.getElementById('visualizer');
  const orbZone = document.getElementById('orb-zone');
  const orbMount = document.getElementById('orb-mount');

  const customerLabel = scenario.blind ? 'Caller' : scenario.customer_name;

  appendMessage(transcript, 'customer', customerLabel, normalizeForTranscript(scenario.opening_line));

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

  // Speak the opening line as soon as user lands in the call.
  speakSentence(scenario.opening_line);

  function speakSentence(text) {
    if (state.audioMuted) return;
    const cleaned = scrubForSpeech(text);
    if (!cleaned) return;
    const controller = new AbortController();
    state.ttsControllers.add(controller);
    synthesizeSentence({ scenarioId: scenario.id, text: cleaned, signal: controller.signal })
      .then((blob) => {
        state.ttsControllers.delete(controller);
        return audioPlayer.enqueueBlob(blob);
      })
      .catch((err) => {
        state.ttsControllers.delete(controller);
        if (err?.name !== 'AbortError') {
          console.warn('tts error', err.message || err);
        }
      });
  }

  let streamingBubble = null;
  const startStreamingBubble = (label) => {
    const li = appendMessage(transcript, 'customer', label, '');
    streamingBubble = li.querySelector('.message-bubble');
    streamingBubble.classList.add('streaming');
  };
  const appendToStreamingBubble = (text) => {
    if (!streamingBubble) return;
    streamingBubble.textContent += text;
    transcript.scrollTop = transcript.scrollHeight;
  };
  const endStreamingBubble = () => {
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
    onAssistantStart: () => {
      clearSilenceTimer();
      startStreamingBubble(customerLabel);
    },
    onAssistantDelta: (text) => appendToStreamingBubble(text),
    onAssistantEnd: () => {
      endStreamingBubble();
      armSilenceTimer();
    },
    onSentence: (sentence) => speakSentence(sentence),
    onMode: (mode) => {
      if (orbZone) orbZone.dataset.orbMode = mode;
      const callEl = dom.root.querySelector('.call');
      if (callEl && useOrb) callEl.dataset.orbMode = mode;
      state.orb?.setMode(mode);
    },
    onError: (err) => {
      endStreamingBubble();
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

  // ---- CRM lookup panel ----
  const crmForm = document.getElementById('crm-form');
  const crmPhone = document.getElementById('crm-phone');
  const crmEmail = document.getElementById('crm-email');
  const crmName = document.getElementById('crm-name');
  const crmResult = document.getElementById('crm-result');

  crmForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = {
      phone: crmPhone.value,
      email: crmEmail.value,
      name: crmName.value,
    };
    if (!query.phone.trim() && !query.email.trim() && !query.name.trim()) {
      renderCrmEmpty('Enter at least one field to search.');
      return;
    }
    const record = scenario.customer_record;
    const match = matchCustomerRecord(record, query);
    if (match) {
      renderCrmCard(record);
    } else if (record && record.found === false) {
      renderCrmNotFound(record.notes, true);
    } else {
      renderCrmNotFound('No customer matches those details. Ask the caller to confirm their info.', false);
    }
  });

  function renderCrmEmpty(text) {
    crmResult.dataset.state = 'empty';
    crmResult.innerHTML = `<p class="crm-empty">${escapeHtml(text)}</p>`;
  }

  function renderCrmNotFound(notes, isProspect) {
    crmResult.dataset.state = isProspect ? 'prospect' : 'notfound';
    crmResult.innerHTML = `
      <div class="crm-card crm-card-empty">
        <div class="crm-card-status">${isProspect ? 'New prospect' : 'No match'}</div>
        <p class="crm-card-blurb">${escapeHtml(notes || (isProspect ? 'No record in the system.' : 'No customer matched those details.'))}</p>
        <button type="button" class="crm-card-cta" data-action="start-reservation">
          Start a new reservation
          <span aria-hidden="true">›</span>
        </button>
      </div>
    `;
    crmResult.querySelector('[data-action="start-reservation"]')?.addEventListener('click', () => switchCrmTab('reservation'));
  }

  function renderCrmCard(r) {
    crmResult.dataset.state = 'found';
    const past = (r.past_rentals || []);
    const reservations = (r.active_reservations || []);
    const claims = (r.claims_cases || []);
    crmResult.innerHTML = `
      <div class="crm-card">
        <div class="crm-card-status crm-card-status-found">Record found</div>
        <div class="crm-section">
          <div class="crm-section-title">Identity</div>
          <dl class="crm-kv">
            <div><dt>Name</dt><dd>${escapeHtml(r.full_name)}</dd></div>
            <div><dt>Phone</dt><dd class="mono">${escapeHtml(r.phone)}</dd></div>
            <div><dt>Email</dt><dd class="mono">${escapeHtml(r.email)}</dd></div>
            <div><dt>Account</dt><dd class="mono">${escapeHtml(r.account_id)}</dd></div>
            <div><dt>Member since</dt><dd>${escapeHtml(String(r.member_since))}</dd></div>
          </dl>
        </div>
        ${reservations.length ? `
        <div class="crm-section crm-section-accent">
          <div class="crm-section-title">Active reservations</div>
          <ul class="crm-list">
            ${reservations.map((res) => `
              <li>
                <div class="crm-list-head"><span class="mono">${escapeHtml(res.confirmation)}</span></div>
                <div class="crm-list-body">${escapeHtml(res.truck)} · ${escapeHtml(res.location)} · ${escapeHtml(res.date)}</div>
                <div class="crm-list-meta">${escapeHtml(res.total)} · <em>${escapeHtml(res.status)}</em></div>
              </li>
            `).join('')}
          </ul>
        </div>
        ` : ''}
        ${claims.length ? `
        <div class="crm-section crm-section-warn">
          <div class="crm-section-title">Open Claims cases</div>
          <ul class="crm-list">
            ${claims.map((c) => `
              <li>
                <div class="crm-list-head"><span class="mono">${escapeHtml(c.case_id)}</span> · <strong>${escapeHtml(c.amount)}</strong></div>
                <div class="crm-list-body">${escapeHtml(c.description)}</div>
                <div class="crm-list-meta">Opened ${escapeHtml(c.opened)} · <em>${escapeHtml(c.status)}</em></div>
              </li>
            `).join('')}
          </ul>
        </div>
        ` : ''}
        ${past.length ? `
        <div class="crm-section">
          <div class="crm-section-title">Past rentals (${past.length})</div>
          <ul class="crm-list crm-list-compact">
            ${past.map((p) => `
              <li>
                <span class="mono">${escapeHtml(p.date)}</span> · ${escapeHtml(p.truck)} · ${escapeHtml(p.location)} · ${escapeHtml(p.total)} · <em>${escapeHtml(p.status)}</em>
              </li>
            `).join('')}
          </ul>
        </div>
        ` : ''}
        ${r.notes ? `
        <div class="crm-section crm-section-notes">
          <div class="crm-section-title">Agent notes</div>
          <p>${escapeHtml(r.notes)}</p>
        </div>
        ` : ''}
      </div>
    `;
  }

  function matchCustomerRecord(record, query) {
    if (!record || record.found === false) return false;
    const phoneDigits = (s) => String(s || '').replace(/\D/g, '');
    const norm = (s) => String(s || '').toLowerCase().trim();
    const qPhone = phoneDigits(query.phone);
    const qEmail = norm(query.email);
    const qName = norm(query.name);
    if (qPhone && phoneDigits(record.phone).includes(qPhone) && qPhone.length >= 4) return true;
    if (qEmail && norm(record.email).includes(qEmail) && qEmail.length >= 3) return true;
    if (qName && norm(record.full_name).includes(qName) && qName.length >= 2) return true;
    return false;
  }

  // ---- CRM tabs + reservation builder ----
  const crmTabs = dom.root.querySelectorAll('.crm-tab');
  const crmPanes = dom.root.querySelectorAll('.crm-pane');
  function switchCrmTab(name) {
    const target = crmTabs && Array.from(crmTabs).find((b) => b.dataset.tab === name);
    if (target) target.click();
  }
  crmTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      crmTabs.forEach((b) => {
        const active = b.dataset.tab === target;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });
      crmPanes.forEach((p) => {
        p.hidden = p.dataset.tab !== target;
      });
    });
  });

  const rsvWizard = document.getElementById('rsv-wizard');
  const rsvForm = document.getElementById('crm-reservation');
  const rsvResult = document.getElementById('crm-rsv-result');
  const rsvNextBtn = document.getElementById('rsv-next');
  const rsvBackBtn = document.getElementById('rsv-back');
  const rsvNavTotal = document.getElementById('rsv-nav-total');
  const rsvErrorEl = document.getElementById('rsv-error');
  const rsvSummary = document.getElementById('rsv-summary');
  const rsvTruckBox = document.getElementById('rsv-truck');
  const rsvTruckTag = document.getElementById('rsv-truck-tag');
  const rsvTruckLabel = document.getElementById('rsv-truck-label');
  const rsvTruckRate = document.getElementById('rsv-truck-rate');
  const cardPreview = document.getElementById('card-preview');
  const cardPrevBrand = document.getElementById('card-preview-brand');
  const cardPrevNumber = document.getElementById('card-preview-number');
  const cardPrevName = document.getElementById('card-preview-name');
  const cardPrevExp = document.getElementById('card-preview-exp');
  const sameLocCheck = document.getElementById('rsv-same-location');
  const returnLocField = document.getElementById('rsv-return-loc-field');

  const TRUCK_INFO = {
    10: { label: '10-foot truck', daily: 19.95, per_mile: 0.79 },
    15: { label: '15-foot truck', daily: 29.95, per_mile: 0.89 },
    20: { label: '20-foot truck', daily: 39.95, per_mile: 0.99 },
    26: { label: '26-foot truck', daily: 49.95, per_mile: 1.19 },
  };

  const WAIVER_INFO = {
    none: { label: 'Waiver declined', daily: 0 },
    basic: { label: 'Basic waiver', daily: 15 },
    premium: { label: 'Premium waiver', daily: 25 },
  };

  const TAX_RATE = 0.09;
  const TOTAL_STEPS = 4;
  let rsvStep = 1;

  function getRsv(name) {
    const el = rsvForm.querySelector(`[data-rsv="${name}"]`);
    return el?.value || '';
  }

  function fmtMoney(n) {
    return '$' + Number(n || 0).toFixed(2);
  }

  function computeRecommendedTruck() {
    const bedrooms = Number(getRsv('bedrooms') || 0);
    const boxes = Number(getRsv('boxes') || 0);
    const furnitureCount = rsvForm.querySelectorAll('[data-rsv-furniture]:checked').length;
    const applianceCount = rsvForm.querySelectorAll('[data-rsv-appliance]:checked').length;
    const score = bedrooms * 2 + furnitureCount + applianceCount * 2 + boxes / 10;
    let size;
    if (score < 4) size = 10;
    else if (score < 9) size = 15;
    else if (score < 16) size = 20;
    else size = 26;
    return { size, score };
  }

  function currentTruckSize() {
    const override = getRsv('truck_override');
    if (override) return Number(override);
    return computeRecommendedTruck().size;
  }

  function computeRentalDays() {
    const pd = getRsv('pickup_date');
    const rd = getRsv('return_date');
    if (!pd || !rd) return 1;
    const start = new Date(pd + 'T00:00:00');
    const end = new Date(rd + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 1;
    const ms = end - start;
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    return Math.max(1, days || 1);
  }

  function computeQuote() {
    const days = computeRentalDays();
    const miles = Number(getRsv('miles') || 0);
    const truckSize = currentTruckSize();
    const truck = TRUCK_INFO[truckSize];
    const recommended = computeRecommendedTruck();
    const waiverKey = getRsv('waiver') || 'none';
    const waiver = WAIVER_INFO[waiverKey] || WAIVER_INFO.none;
    const padsChecked = !!rsvForm.querySelector('[data-rsv-equipment="pads"]:checked');
    const dollyChecked = !!rsvForm.querySelector('[data-rsv-equipment="dolly"]:checked');

    const truckCost = truck.daily * days;
    const milesCost = truck.per_mile * miles;
    const waiverCost = waiver.daily * days;
    const padsCost = padsChecked ? 10 : 0;
    const dollyCost = dollyChecked ? 7 * days : 0;

    const subtotal = truckCost + milesCost + waiverCost + padsCost + dollyCost;
    const tax = subtotal * TAX_RATE;
    const total = subtotal + tax;

    const lines = [];
    lines.push({ label: `${truck.label} × ${days} day${days === 1 ? '' : 's'}`, amount: truckCost });
    if (miles > 0) lines.push({ label: `Mileage (${miles} mi × $${truck.per_mile.toFixed(2)})`, amount: milesCost });
    if (waiverCost > 0) lines.push({ label: `${waiver.label} × ${days} day${days === 1 ? '' : 's'}`, amount: waiverCost });
    if (padsChecked) lines.push({ label: 'Furniture pads (1 pack)', amount: padsCost });
    if (dollyChecked) lines.push({ label: `Utility dolly × ${days} day${days === 1 ? '' : 's'}`, amount: dollyCost });

    return {
      days, miles, truckSize, truck, recommended, waiver, waiverKey,
      padsChecked, dollyChecked, lines, subtotal, tax, total,
    };
  }

  function recomputeReservation() {
    const quote = computeQuote();

    if (rsvTruckBox) {
      rsvTruckBox.dataset.size = String(quote.truckSize);
      const override = getRsv('truck_override');
      const hasInventory = quote.recommended.score > 0;
      if (!hasInventory && !override) {
        rsvTruckTag.textContent = 'Recommendation';
        rsvTruckLabel.textContent = 'Add inventory to see a fit.';
        rsvTruckRate.textContent = '';
      } else {
        rsvTruckTag.textContent = override ? 'Override' : 'Recommendation';
        rsvTruckLabel.textContent = quote.truck.label;
        rsvTruckRate.textContent = `$${quote.truck.daily.toFixed(2)}/day + $${quote.truck.per_mile.toFixed(2)}/mile`;
      }
    }

    if (rsvNavTotal) {
      const hasInventory = quote.recommended.score > 0 || Boolean(getRsv('truck_override'));
      if (hasInventory) {
        rsvNavTotal.innerHTML = `
          <span class="rsv-nav-total-label">Est. total</span>
          <span class="rsv-nav-total-amount mono">${fmtMoney(quote.total)}</span>
        `;
        rsvNavTotal.hidden = false;
      } else {
        rsvNavTotal.hidden = true;
      }
    }

    if (rsvSummary) {
      const linesHtml = quote.lines.map((l) => `
        <div class="rsv-summary-line"><span>${escapeHtml(l.label)}</span><span class="mono">${fmtMoney(l.amount)}</span></div>
      `).join('');
      rsvSummary.innerHTML = `
        <div class="rsv-summary-head">
          <span>Authorization hold</span>
          <span class="rsv-summary-head-amount mono">${fmtMoney(quote.total)}</span>
        </div>
        <div class="rsv-summary-body">
          ${linesHtml || '<p class="rsv-summary-empty">No charges yet.</p>'}
          <div class="rsv-summary-rule"></div>
          <div class="rsv-summary-line"><span>Subtotal</span><span class="mono">${fmtMoney(quote.subtotal)}</span></div>
          <div class="rsv-summary-line rsv-summary-line-muted"><span>Estimated tax (${(TAX_RATE * 100).toFixed(0)}%)</span><span class="mono">${fmtMoney(quote.tax)}</span></div>
          <div class="rsv-summary-rule"></div>
          <div class="rsv-summary-line rsv-summary-total"><span>Total to authorize</span><span class="mono">${fmtMoney(quote.total)}</span></div>
        </div>
      `;
    }

    if (rsvStep === TOTAL_STEPS && rsvNextBtn) {
      rsvNextBtn.textContent = `Authorize ${fmtMoney(quote.total)} & save`;
    }
  }

  function showStep(n) {
    rsvStep = Math.max(1, Math.min(TOTAL_STEPS, n));
    rsvWizard.dataset.step = String(rsvStep);
    rsvForm.querySelectorAll('.rsv-step').forEach((sec) => {
      sec.hidden = Number(sec.dataset.step) !== rsvStep;
    });
    rsvWizard.querySelectorAll('.rsv-stepper-item').forEach((it) => {
      const stepNum = Number(it.dataset.step);
      it.classList.toggle('active', stepNum === rsvStep);
      it.classList.toggle('done', stepNum < rsvStep);
    });
    rsvBackBtn.hidden = rsvStep === 1;
    rsvErrorEl.hidden = true;
    if (rsvStep === TOTAL_STEPS) {
      const quote = computeQuote();
      rsvNextBtn.textContent = `Authorize ${fmtMoney(quote.total)} & save`;
    } else {
      rsvNextBtn.textContent = 'Continue';
    }
    recomputeReservation();
    const pane = rsvWizard.closest('.crm-pane');
    if (pane) pane.scrollTop = 0;
  }

  function validateStep(n) {
    if (n === 1) {
      if (!getRsv('full_name').trim()) return 'Confirm the customer\'s full name before continuing.';
      if (!getRsv('phone').trim()) return 'Confirm a phone number before continuing.';
    } else if (n === 2) {
      if (!getRsv('pickup_date')) return 'Set the pickup date.';
      if (!getRsv('location')) return 'Choose the pickup location.';
      if (!getRsv('return_date')) return 'Set the return date.';
      const pd = new Date(getRsv('pickup_date'));
      const rd = new Date(getRsv('return_date'));
      if (rd < pd) return 'Return date must be on or after the pickup date.';
      if (!sameLocCheck.checked && !getRsv('return_location')) return 'Choose the return location, or check "Returning to the same location".';
    } else if (n === 3) {
      if (computeRecommendedTruck().score === 0 && !getRsv('truck_override')) {
        return 'Add at least one inventory item, or override the truck size.';
      }
    } else if (n === 4) {
      if (!getRsv('card_name').trim()) return 'Cardholder name is required.';
      const num = getRsv('card_number').replace(/\D/g, '');
      if (num.length < 13) return 'Card number looks too short.';
      const exp = getRsv('card_exp');
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(exp)) return 'Expiry must be MM/YY.';
      const cvv = getRsv('card_cvv');
      if (!/^\d{3,4}$/.test(cvv)) return 'CVV should be 3 or 4 digits.';
      const zip = getRsv('card_zip');
      if (!/^\d{5}$/.test(zip)) return 'Billing ZIP should be 5 digits.';
    }
    return null;
  }

  function showRsvError(text) {
    rsvErrorEl.textContent = text;
    rsvErrorEl.hidden = false;
  }

  rsvBackBtn.addEventListener('click', () => showStep(rsvStep - 1));

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
    const brand = detectBrand(digits);
    let groups;
    if (brand === 'amex') {
      groups = [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)];
    } else {
      groups = digits.match(/.{1,4}/g) || [];
    }
    return groups.filter(Boolean).join(' ');
  }

  function formatExp(raw) {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    return digits.slice(0, 2) + '/' + digits.slice(2);
  }

  function updateCardPreview() {
    const num = getRsv('card_number').replace(/\D/g, '');
    const brand = detectBrand(num);
    cardPreview.dataset.brand = brand;
    cardPrevBrand.textContent = brand === 'unknown' ? 'CARD' : brand.toUpperCase();
    const last4 = num.slice(-4);
    let masked;
    if (brand === 'amex') {
      masked = '•••• •••••• ' + (last4.length === 4 ? last4 + '•' : (last4 || '•••••'));
    } else {
      masked = '•••• •••• •••• ' + (last4 || '••••');
    }
    cardPrevNumber.textContent = masked;
    const name = getRsv('card_name').trim().toUpperCase() || 'FULL NAME';
    cardPrevName.textContent = name;
    cardPrevExp.textContent = getRsv('card_exp') || 'MM/YY';
  }

  const cardNumInput = rsvForm.querySelector('[data-rsv="card_number"]');
  const cardExpInput = rsvForm.querySelector('[data-rsv="card_exp"]');
  const cardCvvInput = rsvForm.querySelector('[data-rsv="card_cvv"]');
  const cardZipInput = rsvForm.querySelector('[data-rsv="card_zip"]');
  const cardNameInput = rsvForm.querySelector('[data-rsv="card_name"]');

  cardNumInput.addEventListener('input', (e) => {
    e.target.value = formatCardNumber(e.target.value);
    updateCardPreview();
  });
  cardExpInput.addEventListener('input', (e) => {
    e.target.value = formatExp(e.target.value);
    updateCardPreview();
  });
  cardCvvInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  });
  cardZipInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
  });
  cardNameInput.addEventListener('input', () => updateCardPreview());

  sameLocCheck?.addEventListener('change', () => {
    returnLocField.hidden = sameLocCheck.checked;
  });

  rsvForm.addEventListener('input', recomputeReservation);
  rsvForm.addEventListener('change', recomputeReservation);

  // Prefill from persona record
  const rec = scenario.customer_record || {};
  if (rec.full_name) {
    rsvForm.querySelector('[data-rsv="full_name"]').value = rec.full_name;
    cardNameInput.value = rec.full_name;
  }
  if (rec.phone) rsvForm.querySelector('[data-rsv="phone"]').value = rec.phone;
  if (rec.email) rsvForm.querySelector('[data-rsv="email"]').value = rec.email;
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  rsvForm.querySelector('[data-rsv="pickup_date"]').value = todayStr;
  rsvForm.querySelector('[data-rsv="return_date"]').value = tomorrowStr;

  rsvForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = validateStep(rsvStep);
    if (err) {
      showRsvError(err);
      return;
    }
    if (rsvStep < TOTAL_STEPS) {
      showStep(rsvStep + 1);
      return;
    }
    saveReservation();
  });

  function saveReservation() {
    const quote = computeQuote();
    const cardNumDigits = getRsv('card_number').replace(/\D/g, '');
    const data = {
      full_name: getRsv('full_name'),
      phone: getRsv('phone'),
      email: getRsv('email'),
      pickup_date: getRsv('pickup_date'),
      pickup_time: getRsv('pickup_time'),
      location: getRsv('location'),
      return_date: getRsv('return_date'),
      return_time: getRsv('return_time'),
      return_location: sameLocCheck.checked ? getRsv('location') : getRsv('return_location'),
      miles: getRsv('miles') || '0',
      card_brand: detectBrand(cardNumDigits),
      card_last4: cardNumDigits.slice(-4),
      card_exp: getRsv('card_exp'),
      card_name: getRsv('card_name'),
      confirmation: 'MR-' + Math.floor(100000 + Math.random() * 900000),
    };

    const linesHtml = quote.lines.map((l) => `
      <div class="rsv-summary-line"><span>${escapeHtml(l.label)}</span><span class="mono">${fmtMoney(l.amount)}</span></div>
    `).join('');

    rsvWizard.hidden = true;
    rsvResult.innerHTML = `
      <div class="rsv-receipt">
        <div class="rsv-receipt-head">
          <div class="rsv-receipt-tag">
            <span class="rsv-receipt-check" aria-hidden="true">✓</span>
            Reservation confirmed
          </div>
          <div class="rsv-receipt-confirmation">
            <span class="rsv-receipt-confirmation-label">Confirmation number</span>
            <span class="rsv-receipt-confirmation-num mono">${escapeHtml(data.confirmation)}</span>
          </div>
        </div>

        <div class="rsv-receipt-grid">
          <div class="rsv-receipt-section">
            <div class="rsv-receipt-section-title">Customer</div>
            <div class="rsv-receipt-section-body">
              <div class="rsv-receipt-line"><span>Name</span><span>${escapeHtml(data.full_name)}</span></div>
              <div class="rsv-receipt-line"><span>Phone</span><span class="mono">${escapeHtml(data.phone)}</span></div>
              ${data.email ? `<div class="rsv-receipt-line"><span>Email</span><span class="mono">${escapeHtml(data.email)}</span></div>` : ''}
            </div>
          </div>
          <div class="rsv-receipt-section">
            <div class="rsv-receipt-section-title">Trip</div>
            <div class="rsv-receipt-section-body">
              <div class="rsv-receipt-line"><span>Pickup</span><span>${escapeHtml(data.pickup_date)} · ${escapeHtml(data.pickup_time)}</span></div>
              <div class="rsv-receipt-line"><span>From</span><span>${escapeHtml(data.location)}</span></div>
              <div class="rsv-receipt-line"><span>Return</span><span>${escapeHtml(data.return_date)} · ${escapeHtml(data.return_time)}</span></div>
              <div class="rsv-receipt-line"><span>Drop-off</span><span>${escapeHtml(data.return_location)}</span></div>
              <div class="rsv-receipt-line"><span>Mileage est.</span><span class="mono">${escapeHtml(String(data.miles))} mi</span></div>
            </div>
          </div>
          <div class="rsv-receipt-section">
            <div class="rsv-receipt-section-title">Equipment</div>
            <div class="rsv-receipt-section-body">
              <div class="rsv-receipt-line"><span>Truck</span><span>${escapeHtml(quote.truck.label)}</span></div>
              <div class="rsv-receipt-line"><span>Waiver</span><span>${escapeHtml(quote.waiver.label)}</span></div>
              ${(quote.padsChecked || quote.dollyChecked) ? `<div class="rsv-receipt-line"><span>Add-ons</span><span>${[quote.padsChecked && 'Pads', quote.dollyChecked && 'Dolly'].filter(Boolean).join(', ')}</span></div>` : ''}
            </div>
          </div>
        </div>

        <div class="rsv-summary rsv-summary-final">
          <div class="rsv-summary-head">
            <span>Card on file · authorized</span>
            <span class="rsv-summary-head-amount mono">${fmtMoney(quote.total)}</span>
          </div>
          <div class="rsv-summary-body">
            ${linesHtml}
            <div class="rsv-summary-rule"></div>
            <div class="rsv-summary-line"><span>Subtotal</span><span class="mono">${fmtMoney(quote.subtotal)}</span></div>
            <div class="rsv-summary-line rsv-summary-line-muted"><span>Estimated tax</span><span class="mono">${fmtMoney(quote.tax)}</span></div>
            <div class="rsv-summary-rule"></div>
            <div class="rsv-summary-line rsv-summary-total"><span>Authorized</span><span class="mono">${fmtMoney(quote.total)}</span></div>
          </div>
          <div class="rsv-card-chip" data-brand="${escapeAttr(data.card_brand)}">
            <span class="rsv-card-chip-brand">${escapeHtml(data.card_brand === 'unknown' ? 'CARD' : data.card_brand.toUpperCase())}</span>
            <span class="mono">•••• ${escapeHtml(data.card_last4 || '••••')}</span>
            <span class="rsv-card-chip-exp mono">exp ${escapeHtml(data.card_exp || 'MM/YY')}</span>
          </div>
        </div>

        <div class="rsv-receipt-readback">
          <div class="rsv-receipt-readback-title">Read back to the caller</div>
          <p>"Your confirmation number is <strong class="mono">${escapeHtml(data.confirmation)}</strong>. We're holding a ${escapeHtml(quote.truck.label)} for you at the ${escapeHtml(data.location)} location on ${escapeHtml(data.pickup_date)} at ${escapeHtml(data.pickup_time)}, due back ${escapeHtml(data.return_date)} at ${escapeHtml(data.return_time)}. Total comes to ${escapeHtml(fmtMoney(quote.total))} on the card ending in ${escapeHtml(data.card_last4 || '....')}. Anything else I can help you with?"</p>
        </div>

        <div class="rsv-receipt-actions">
          <button class="ghost-button" type="button" id="rsv-new">Start another reservation</button>
        </div>
      </div>
    `;

    document.getElementById('rsv-new').addEventListener('click', () => {
      rsvResult.innerHTML = '';
      rsvWizard.hidden = false;
      showStep(1);
    });
  }

  showStep(1);
  updateCardPreview();
  recomputeReservation();
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
function scrubForSpeech(text) {
  return String(text || '')
    .replace(/\*[^*\n]+\*/g, '')
    .replace(/\[[^\]\n]+\]/g, '')
    .replace(/\(\s*([^)\n]{1,30})\s*\)/g, (match, inner) => {
      const trimmed = inner.trim();
      if (/[.!?]/.test(trimmed)) return match;
      return SPEECH_CUE_VERBS.test(trimmed) ? '' : match;
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/[,;:]+\s*([.?!])/g, '$1')
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
