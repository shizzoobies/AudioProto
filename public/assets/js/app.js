import { Conversation } from './conversation.js';
import { requestCoachingReport, renderReportHtml } from './coach.js';
import { AudioPlayer, attachVisualizer, synthesizeSentence, ContinuousRecorder, transcribeAudio } from './audio.js';
import { createDemoOrb } from './demo-orb.js';

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
  demoOrb: null,
  ringtone: null,
  precallOverlay: null,
  precallStash: null,
  callPaused: false,
  callTimer: null,
};

// Meridian's San Antonio branch network. Surfaced in the CSR panel so the
// agent can match the pickup branch to where the customer is loading.
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

// Call states during which the call clock accrues time. Everything else
// (connecting, processing, thinking, paused) is treated as simulator latency
// and is NOT counted, so the duration reflects real conversational time.
const TIMER_LIVE_STATES = new Set(['your_turn', 'listening', 'customer_talking']);

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
  // Defensive: the ringtone is normally stopped on Answer/Decline/Esc, but any
  // view transition that tears down audio must also kill a stray ring so it
  // can never loop into a call or another screen.
  stopRingtone();
  if (state.callTimer?.intervalId) {
    clearInterval(state.callTimer.intervalId);
  }
  state.callTimer = null;
  state.callPaused = false;
  if (state.fieldTip) {
    try { state.fieldTip.remove(); } catch {}
    state.fieldTip = null;
  }
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
  // The demo-home "Living Voice" WebGL orb: dispose cancels its rAF so the
  // shader loop never runs during a call or any other view.
  if (state.demoOrb) {
    try { state.demoOrb.dispose(); } catch {}
    state.demoOrb = null;
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

  // Scoped cookies WIN over a normal session. A kiosk magic link or an
  // invite/demo recipient cookie means the visitor is in a sealed, scoped
  // experience and must see it even if a trainee session also exists in the
  // same browser (e.g. an admin opening the demo link). Only when neither
  // scoped cookie is active do we fall back to the normal trainee session.
  let magic = null;
  try {
    const r = await fetch('/api/magic-status', { credentials: 'same-origin' });
    if (r.ok) magic = await r.json();
  } catch {
    magic = null;
  }
  if (magic && magic.active && typeof magic.scenario === 'string') {
    state.kiosk = true;
    state.kioskScenario = magic.scenario;
    document.body.dataset.kiosk = 'true';
  } else {
    // Invite recipient / demo (D1-backed, multi-scenario, scoped).
    let me = null;
    try {
      const r = await fetch('/api/me/status', { credentials: 'same-origin' });
      if (r.ok) me = await r.json();
    } catch {
      me = null;
    }
    if (me && me.active && Array.isArray(me.scenarios)) {
      // Hide sign-out for any scoped link.
      document.body.dataset.recipient = 'true';
      if (me.is_preview) {
        // Full-library preview link: roams the WHOLE library like a normal
        // agent (full home/picker nav, in-call back/cancel all behave), just
        // with no sign-out. Intentionally NOT a sealed recipient, so we leave
        // state.recipient unset and let routing fall through to renderHome().
        state.previewMode = true;
      } else {
        state.recipient = me;
        // The demo is a sealed pitch surface: drop the global app header chrome.
        if (me.is_demo) document.body.dataset.demo = 'true';
      }
    } else {
      // No scoped cookie - require a normal trainee session, else bounce to login.
      let sessionOk = false;
      try {
        const sessionRes = await fetch('/api/session', { credentials: 'same-origin' });
        sessionOk = sessionRes.ok;
      } catch {
        sessionOk = false;
      }
      if (!sessionOk) {
        window.location.replace('/');
        return;
      }
    }
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
        // Showcase and the section tracks (sales / post-reservation) are
        // launched from their own entries; keep them out of the Explore More
        // random pool and picker grid.
        if (t.id !== 'showcase' && !t.section) state.allPersonaIds.push(p.id);
      }
    }
  } catch (err) {
    document.body.dataset.appState = 'ready';
    renderError('We could not load the scenarios. Refresh to try again.');
    return;
  }

  document.body.dataset.appState = 'ready';
  if (state.kiosk && state.kioskScenario) {
    // Magic-link visitor: show the intro splash (persona card + mic
    // disclaimer + Take-the-call button) instead of dumping them straight into
    // a live call. Phone mode is the kiosk default; the splash button kicks
    // off startCall, which initializes the mic on first user gesture.
    setCallMode('phone');
    renderKioskSplash(state.kioskScenario);
  } else if (state.recipient) {
    // Invite recipient: their personal simulation page lists the scenarios the
    // admin assigned them. Same phone default. The pitch-demo recipient gets
    // the bespoke bright-editorial landing instead.
    setCallMode('phone');
    if (state.recipient.is_demo) renderDemoHome();
    else renderRecipientHome();
  } else {
    renderHome();
  }

  dom.signOut.addEventListener('click', signOut);
}

// The Education & Development landing. Two scenario tracks (still being built) plus an
// entry into the full existing library (renderWelcome -> picker -> call).
function renderHome() {
  state.view = 'home';
  state.activeScenario = null;
  setDocumentTitle('');
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  teardownAudio();

  dom.root.innerHTML = `
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
        <button class="mode-choice" data-home-section="sales" type="button">
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
        <button class="mode-choice" data-home-section="post_reservation" type="button">
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
        <button class="mode-choice mode-choice-showcase" data-action="explore-more" type="button">
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

  dom.root.querySelectorAll('[data-home-section]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.homeSection;
      const built = (state.scenarioTypes || []).some((t) => t.section === section);
      if (built) {
        renderSectionScenarios(section);
      } else {
        renderComingSoon(section === 'sales' ? 'Sales Scenarios' : 'Post Reservation Situations');
      }
    });
  });
  const exploreBtn = dom.root.querySelector('[data-action="explore-more"]');
  if (exploreBtn) exploreBtn.addEventListener('click', renderWelcome);
}

// Placeholder for a track that isn't built out yet.
function renderComingSoon(title) {
  state.view = 'coming_soon';
  setDocumentTitle(title);
  dom.root.innerHTML = `
    <section class="welcome">
      <div class="welcome-back">
        <button class="ghost-button" data-action="home" type="button"><span aria-hidden="true">‹</span> Back to home</button>
      </div>
      <header class="welcome-hero">
        <div class="welcome-eyebrow">Coming soon</div>
        <h1 class="welcome-title">${escapeHtml(title)}</h1>
        <p class="welcome-lead">This track is being built. Its scenarios will live here.</p>
      </header>
    </section>
  `;
  dom.root.querySelector('[data-action="home"]').addEventListener('click', renderHome);
}

// Magic-link recipients land here first instead of dropping straight into the
// call: a single intro card (same shape as the Sales picker cards) plus a
// microphone disclaimer, with a Take-the-call button to actually start.
function renderKioskSplash(scenarioId) {
  state.view = 'kiosk_splash';
  state.activeScenario = null;
  setDocumentTitle('');
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  teardownAudio();

  const persona = state.personaById.get(scenarioId);
  if (!persona) {
    // Shouldn't happen (scenarios are loaded before this runs), but fail open
    // to a direct call rather than a blank screen.
    startCall(scenarioId);
    return;
  }

  const typeTitle = persona.type_title || 'Overcoming Objections';
  dom.root.innerHTML = `
    <section class="kiosk-splash">
      <header class="kiosk-splash-header">
        <div class="kiosk-eyebrow">Sales simulation</div>
        <h1 class="kiosk-title">${escapeHtml(typeTitle)}</h1>
        <p class="kiosk-subtitle">Practice the three-point method: build genuine urgency, acknowledge the objection, and ask for the business again.</p>
      </header>
      <article class="kiosk-card">
        ${persona.premium ? '<div class="scenario-difficulty difficulty-premium">Premium</div>' : ''}
        <h2 class="kiosk-card-name">${escapeHtml(persona.customer_name || '')}</h2>
        <p class="kiosk-card-short">${escapeHtml(persona.customer_short || '')}</p>
        <p class="kiosk-card-tagline">${escapeHtml(persona.tagline || '')}</p>
      </article>
      <div class="kiosk-disclaimer" role="note">
        <strong>This is a voice call.</strong> When prompted, please allow microphone access for this page so the customer can hear you.
      </div>
      <button class="primary-button kiosk-cta" id="kiosk-take-call" type="button">Take the call <span aria-hidden="true">›</span></button>
    </section>
  `;

  document.getElementById('kiosk-take-call').addEventListener('click', () => startCall(scenarioId));
}

// Invite recipient's personal simulation page. They land here from /me/<token>
// (D1-backed invite link). Lists the scenarios the admin assigned them, with
// the same card UI as the Sales picker, plus a greeting and mic disclaimer.
// Clicking a card launches the scenario directly (no per-card splash - the
// click itself is the user gesture the mic permission needs, and the
// disclaimer is right here on the page).
function renderRecipientHome() {
  state.view = 'recipient_home';
  state.activeScenario = null;
  setDocumentTitle('');
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  teardownAudio();

  const r = state.recipient || {};
  const scenarios = Array.isArray(r.scenarios) ? r.scenarios : [];
  const isDemo = !!r.is_demo;
  const name = typeof r.recipient_name === 'string' && r.recipient_name.trim()
    ? r.recipient_name.trim()
    : '';
  const eyebrow = isDemo ? 'Simulation' : 'Sales simulation';
  const greeting = isDemo
    ? 'Simulation Demo'
    : (name ? `Hi ${escapeHtml(name)}` : 'Welcome to your simulations');
  const countLine = isDemo
    ? 'Choose a call to begin.'
    : scenarios.length === 0
      ? 'No scenarios have been assigned yet.'
      : scenarios.length === 1
        ? 'You have one simulation to take.'
        : `You have ${scenarios.length} simulations to take.`;

  const cardsHtml = scenarios.map((p) => `
    <li class="scenario-card" data-persona-id="${escapeAttr(p.id)}" tabindex="0" role="button" aria-label="Start the call with ${escapeAttr(p.customer_name || p.id)}">
      ${p.premium ? '<div class="scenario-difficulty difficulty-premium">Premium</div>' : ''}
      <h2 class="scenario-title">${escapeHtml(p.customer_name || '')}</h2>
      <p class="scenario-customer">${escapeHtml(p.customer_short || '')}</p>
      <p class="scenario-description">${escapeHtml(p.tagline || '')}</p>
      <div class="scenario-cta">Take the call <span aria-hidden="true">›</span></div>
    </li>
  `).join('');

  dom.root.innerHTML = `
    <section class="recipient-home">
      <header class="recipient-header">
        <div class="recipient-eyebrow">${eyebrow}</div>
        <h1 class="recipient-title">${greeting}</h1>
        <p class="recipient-subtitle">${escapeHtml(countLine)}</p>
      </header>
      <div class="recipient-disclaimer" role="note">
        <strong>These are voice calls.</strong> When prompted, please allow microphone access for this page so the customer can hear you.
      </div>
      <ul class="scenario-grid">${cardsHtml}</ul>
    </section>
  `;

  dom.root.querySelectorAll('.scenario-card').forEach((card) => {
    const go = () => startCall(card.dataset.personaId);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
}

// "The Living Voice" — a cinematic, sealed landing for the pitch demo recipient
// (is_demo). The hero centerpiece is a luminous, organically breathing WebGL
// voice orb (demo-orb.js) that reads as a live call on the line. The two
// scenarios surface as glowing "lines open" entries (Sales vs Customer Service)
// rather than equal white boxes. Sealed loop: only the two entries are
// actionable — no nav, no links, no escape. Mirrors renderRecipientHome's
// pre-amble (view/scenario reset, conversation cancel, teardownAudio, title)
// and reuses the exact same click + keydown wiring to startCall(personaId).
//
// Bulletproof for a live room: a CSS radial-gradient poster paints instantly
// behind the canvas; the WebGL canvas fades in only once initialized. On any
// failure (no WebGL / shader compile / prefers-reduced-motion) the orb factory
// returns null or throws, we keep the static poster, and never start a loop.
function renderDemoHome() {
  state.view = 'recipient_home';
  state.activeScenario = null;
  setDocumentTitle('');
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  // teardownAudio() also disposes any prior demoOrb (cancels its rAF), so we
  // never stack two shader loops when re-entering the demo home.
  teardownAudio();

  const r = state.recipient || {};
  const scenarios = Array.isArray(r.scenarios) ? r.scenarios : [];

  // Each entry is a luminous "line open" node, not a boxed card. A pulsing
  // signal dot + waveform mark ties it to the voice field; visuals branch on
  // the persona id so Sales (maroon) and Customer service (terracotta) read
  // distinctly. The whole node is the button (data-persona-id + role=button).
  const waveMark = (id) => {
    if (id === 'demo_sales') {
      // Rising waveform — the upward energy of a close.
      return `<svg class="demo-entry-wave" viewBox="0 0 64 24" fill="none" aria-hidden="true">
        <path d="M2 16 L8 16 L12 8 L16 19 L20 4 L24 14 L28 11 L34 11 L38 6 L42 18 L46 9 L50 13 L54 13 L62 13"
          stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    }
    // Calmer, steadier waveform — the reassuring cadence of support.
    return `<svg class="demo-entry-wave" viewBox="0 0 64 24" fill="none" aria-hidden="true">
      <path d="M2 12 L10 12 L14 7 L18 17 L22 9 L26 15 L30 11 L34 13 L38 8 L42 16 L46 11 L50 12 L62 12"
        stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  };

  const pointsHtml = (p) => (Array.isArray(p.points) ? p.points : [])
    .map((pt) => `<li>${escapeHtml(pt)}</li>`).join('');

  const entriesHtml = scenarios.map((p, i) => `
    <li class="demo-entry demo-entry-${escapeAttr(p.id)}" data-persona-id="${escapeAttr(p.id)}" tabindex="0" role="button" style="--demo-entry-index:${i}" aria-label="Take the call: ${escapeAttr(p.customer_name || p.id)}">
      <span class="demo-entry-aura" aria-hidden="true"></span>
      <div class="demo-entry-flip">
        <div class="demo-entry-face demo-entry-front">
          <div class="demo-entry-head">
            <span class="demo-entry-signal" aria-hidden="true"><span class="demo-entry-dot"></span></span>
            <span class="demo-entry-status" aria-hidden="true">Line open</span>
          </div>
          <div class="demo-entry-body">
            <h2 class="demo-entry-name">${escapeHtml(p.customer_name || '')}</h2>
            <p class="demo-entry-customer">${escapeHtml(p.customer_short || '')}</p>
            <p class="demo-entry-tagline">${escapeHtml(p.tagline || '')}</p>
          </div>
          <div class="demo-entry-foot">
            <span class="demo-entry-cta">Take the call <span class="demo-entry-arrow" aria-hidden="true">→</span></span>
            <span class="demo-entry-wave-wrap" aria-hidden="true">${waveMark(p.id)}</span>
          </div>
        </div>
        <div class="demo-entry-face demo-entry-back" aria-hidden="true">
          <p class="demo-entry-back-label">In this call</p>
          <ul class="demo-entry-points">${pointsHtml(p)}</ul>
          <span class="demo-entry-cta">Take the call <span class="demo-entry-arrow" aria-hidden="true">→</span></span>
        </div>
      </div>
    </li>
  `).join('');

  dom.root.innerHTML = `
    <section class="demo-home demo-living" data-splash="active">
      <!-- Orb field is a page-level background layer: first child of demo-home
           so it spans behind BOTH the hero and the entries grid. Pointer-events
           none + z-index 0 so all content above it stays fully clickable. -->
      <div class="demo-orb-field" aria-hidden="true">
        <div class="demo-orb-poster"></div>
        <canvas class="demo-orb-canvas" id="demo-orb-canvas"></canvas>
      </div>
      <!-- Cinematic video backdrop (optional, drop-in). Hidden until a real
           clip exists at /assets/video/demo-backdrop.{webm,mp4} (+ optional
           poster demo-backdrop-poster.jpg). On successful playback it fades in
           and the orb above is retired; if the file is absent, fails, or the
           visitor prefers reduced motion, the orb stays the backdrop. Served
           same-origin, allowed by the existing CSP (media-src 'self'). -->
      <div class="demo-video-field" id="demo-video-field" data-active="false" aria-hidden="true">
        <video class="demo-video" id="demo-video" muted playsinline preload="auto" poster="/assets/video/demo-backdrop-poster.jpg">
          <source src="/assets/video/demo-backdrop.webm" type="video/webm">
          <source src="/assets/video/demo-backdrop.mp4" type="video/mp4">
        </video>
        <video class="demo-video" muted playsinline preload="auto">
          <source src="/assets/video/demo-backdrop-2.webm" type="video/webm">
          <source src="/assets/video/demo-backdrop-2.mp4" type="video/mp4">
        </video>
        <video class="demo-video" muted playsinline preload="auto">
          <source src="/assets/video/demo-backdrop-3.webm" type="video/webm">
          <source src="/assets/video/demo-backdrop-3.mp4" type="video/mp4">
        </video>
        <video class="demo-video" muted playsinline preload="auto">
          <source src="/assets/video/demo-backdrop-4.webm" type="video/webm">
          <source src="/assets/video/demo-backdrop-4.mp4" type="video/mp4">
        </video>
        <div class="demo-video-scrim" aria-hidden="true"></div>
      </div>
      <div class="demo-stage">
        <div class="demo-hero-content">
          <div class="demo-logo" id="demo-landing-logo" data-state="hidden" aria-label="First Call">
            <img class="demo-logo-img" src="/assets/img/first-call-landing.png" alt="First Call" width="1080" height="476" />
            <div class="demo-logo-shatter" id="demo-logo-shatter" aria-hidden="true"></div>
          </div>
        </div>
        <div class="demo-tenets">
          <button class="demo-tenet" type="button" aria-expanded="false" style="--tenet-accent:#F26522">
            <span class="demo-tenet-line">Real enough to sweat.</span>
            <span class="demo-tenet-reveal"><span class="demo-tenet-detail">Live AI voice with real-time reasoning. The customer listens, hesitates, and pushes back like a real person on the line.</span></span>
          </button>
          <button class="demo-tenet" type="button" aria-expanded="false" style="--tenet-accent:#D2541A">
            <span class="demo-tenet-line">Safe enough to fail.</span>
            <span class="demo-tenet-reveal"><span class="demo-tenet-detail">Risk-free, fully controlled scenarios. Fumble the open, try the bold line, blow the close — never a real customer, never real trust on the line.</span></span>
          </button>
          <button class="demo-tenet" type="button" aria-expanded="false" style="--tenet-accent:#1b1f2a">
            <span class="demo-tenet-line">Fast enough to fix it.</span>
            <span class="demo-tenet-reveal"><span class="demo-tenet-detail">The moment you hang up, a scored, customizable coaching report is waiting — so the very next call is already sharper.</span></span>
          </button>
        </div>
      </div>
      <div class="demo-lines">
        <p class="demo-lines-label" aria-hidden="true">Two lines open</p>
        <ul class="demo-entries">${entriesHtml}</ul>
      </div>
      <footer class="demo-footer">
        <div class="demo-footer-inner">
          <div class="demo-footer-brandcol">
            <img class="demo-footer-logo" src="/assets/img/first-call-light.png" alt="First Call" width="600" height="265" />
            <span class="demo-footer-tagline">Realistic call simulation and instant coaching.</span>
          </div>
          <span class="demo-footer-note" role="note">Real voice calls — please allow microphone access when prompted.</span>
        </div>
      </footer>
      <div class="demo-splash" id="demo-splash">
        <div class="demo-splash-inner">
          <h1 class="demo-splash-wordmark">
            <img class="demo-splash-logo" src="/assets/img/first-call-landing.png" alt="First Call" width="1080" height="476" />
          </h1>
          <p class="demo-splash-tagline">Realistic call simulation and instant coaching.</p>
          <button type="button" class="demo-splash-enter" id="demo-splash-enter">Get Started! <span aria-hidden="true">&rsaquo;</span></button>
        </div>
      </div>
    </section>
  `;

  // Progressive enhancement: try to bring the orb to life. Any failure
  // (no WebGL context, shader compile error, reduced-motion) leaves the static
  // poster in place — the hero is never blank. All WebGL is wrapped in
  // try/catch and the factory also guards internally.
  try {
    const canvas = dom.root.querySelector('#demo-orb-canvas');
    if (canvas) {
      const orb = createDemoOrb({ canvas });
      if (orb) state.demoOrb = orb;
    }
  } catch {
    state.demoOrb = null; // silent fallback to poster
  }

  // Optional cinematic video backdrop. We always render the <video> markup but
  // only switch to it once a real clip actually starts playing. Absent file
  // (404), playback failure, or reduced-motion all leave the orb backdrop in
  // place — so the page is correct now and "lights up" the moment a clip is
  // dropped at /assets/video/demo-backdrop.{webm,mp4}, no code change needed.
  // Four cinematic clips that rotate with a soft dissolve instead of one clip
  // hard-looping (the loop seam glitches). The first clip (HeaderOriginal) plays
  // for a few seconds, crossfades to the next (Header2 -> 3 -> 4 -> back to 1),
  // and so on — the hidden clip's loop/restart always happens at opacity 0, so
  // the seam is never visible. On Enter we freeze whichever clip is showing.
  let backdropCtl = null;
  try {
    const videoField = dom.root.querySelector('#demo-video-field');
    const videos = videoField ? Array.from(videoField.querySelectorAll('video.demo-video')) : [];
    const primary = videos[0];
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (videoField && videos.length && primary && !reduceMotion) {
      let settled = false;
      let stopped = false;
      let current = 0;            // index of the clip currently showing
      let swapTimer = null;
      // Slower than real time for a calmer, cinematic feel. Browsers sometimes
      // reset the rate on source load, so re-assert it.
      const BACKDROP_RATE = 0.6;
      const SEGMENT_MS = 5600;   // visible time per clip before the next dissolve
      const CROSSFADE_MS = 2400; // matches the CSS opacity transition
      const setRate = (v) => { try { v.defaultPlaybackRate = BACKDROP_RATE; v.playbackRate = BACKDROP_RATE; } catch {} };
      videos.forEach((v) => { setRate(v); v.addEventListener('loadeddata', () => setRate(v)); });

      // Crossfade from the showing clip to the next one in the rotation.
      const swap = () => {
        if (stopped) return;
        // Demo DOM was replaced (navigated into a call) — end the loop cleanly.
        if (!videoField.isConnected) { stopped = true; return; }
        const outgoing = videos[current];
        const nextIdx = (current + 1) % videos.length;
        const next = videos[nextIdx];
        // Never let the *visible* segment run into a clip's end (a hard freeze):
        // if too little runway remains, restart it from the top first.
        try {
          const remainingReal = (next.duration - next.currentTime) / BACKDROP_RATE;
          if (!Number.isFinite(remainingReal) || remainingReal < (SEGMENT_MS + CROSSFADE_MS) / 1000 + 0.5) {
            next.currentTime = 0;
          }
        } catch { try { next.currentTime = 0; } catch {} }
        setRate(next);
        try { next.play(); } catch {}
        next.classList.add('is-showing');
        outgoing.classList.remove('is-showing');
        current = nextIdx;
        // Pause the now-hidden clip once it has fully faded (saves CPU; it
        // resumes mid-clip next time for continuity).
        window.setTimeout(() => { if (!stopped && videos[current] !== outgoing) { try { outgoing.pause(); } catch {} } }, CROSSFADE_MS + 80);
        swapTimer = window.setTimeout(swap, SEGMENT_MS);
      };

      const activate = () => {
        if (settled) return;
        settled = true;
        setRate(primary);
        const home = dom.root.querySelector('.demo-home');
        if (home) home.dataset.video = 'ready';
        videoField.dataset.active = 'true';
        current = 0;
        primary.classList.add('is-showing');
        // Retire the orb: stop its WebGL loop now that the video is the backdrop.
        try { state.demoOrb?.dispose(); } catch {}
        state.demoOrb = null;
        // Begin the rotation.
        swapTimer = window.setTimeout(swap, SEGMENT_MS);
      };

      // Freeze the backdrop on whichever clip is showing (used on Enter).
      backdropCtl = {
        freeze() {
          stopped = true;
          if (swapTimer) { window.clearTimeout(swapTimer); swapTimer = null; }
          videos.forEach((v) => { try { v.pause(); } catch {} });
        },
      };

      primary.addEventListener('playing', activate, { once: true });
      // All sources failed (e.g. the file isn't there yet) — keep the orb.
      primary.addEventListener('error', () => { settled = true; }, { once: true });
      // Muted autoplay needs an explicit kick in some browsers; a rejection
      // (no playable source) just leaves the orb up.
      const p = primary.play && primary.play();
      if (p && typeof p.catch === 'function') p.catch(() => { settled = true; });
      // Safety net: stop waiting after a few seconds if nothing ever plays.
      setTimeout(() => { settled = true; }, 4000);
    }
  } catch {
    // Any failure here is non-fatal — the orb backdrop remains.
  }

  // Splash gate: the demo opens behind a "First Call" splash over the playing
  // clip; clicking Enter reveals the landing and is the user gesture that
  // guarantees the muted video plays through (and freezes on its last frame).
  const splashHome = dom.root.querySelector('.demo-home');
  const splashEnter = dom.root.querySelector('#demo-splash-enter');

  // The landing headline is the flat First Call logo, assembled from shards that
  // rain down and lock into place — so when the splash's 3D logo "falls and
  // shatters" on Enter, the pieces reform into this mark. Built hidden; on Enter
  // the shards animate in (forming), then we swap to the crisp image (formed).
  const landingLogo = dom.root.querySelector('#demo-landing-logo');
  const shatterBox = dom.root.querySelector('#demo-logo-shatter');
  const reduceMotionLogo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (landingLogo && shatterBox) {
    if (reduceMotionLogo) {
      landingLogo.dataset.state = 'formed'; // no shatter — just show the logo
    } else {
      buildLogoShatter(shatterBox, 9, 4);
    }
  }

  if (splashEnter) {
    splashEnter.addEventListener('click', () => {
      if (splashHome) splashHome.dataset.splash = 'done';
      // The clips ping-pong on the splash; entering freezes whichever one is
      // showing to a crisp still frame as the landing backdrop.
      try { backdropCtl?.freeze?.(); } catch {}
      // As the 3D splash logo falls and breaks apart, the landing shards rain in
      // and assemble; then swap to the crisp logo.
      if (landingLogo && !reduceMotionLogo) {
        window.setTimeout(() => { landingLogo.dataset.state = 'forming'; }, 240);
        window.setTimeout(() => { landingLogo.dataset.state = 'formed'; }, 240 + 1500);
      }
    });
    setTimeout(() => { try { splashEnter.focus(); } catch {} }, 60);
  }

  dom.root.querySelectorAll('.demo-entry').forEach((card) => {
    const go = () => startCall(card.dataset.personaId);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  // Hero tenets: click/tap pins a tenet open (desktop also peeks on hover via
  // CSS). Independent toggles — the presenter can fan them all open.
  dom.root.querySelectorAll('.demo-tenet').forEach((t) => {
    t.addEventListener('click', () => {
      const open = t.getAttribute('aria-expanded') === 'true';
      t.setAttribute('aria-expanded', String(!open));
      t.classList.toggle('is-open', !open);
    });
  });
}

// Build a cols x rows grid of image shards over the landing logo. Each shard is
// a div whose background is the logo, sprite-positioned to show just its cell,
// with a randomized "fallen" start (above the page, scattered, rotated) handed
// to the CSS animation via custom properties. Staggered top-to-bottom so the
// pieces rain into place and assemble the mark.
function buildLogoShatter(container, cols, rows) {
  if (!container) return;
  const frag = document.createDocumentFragment();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const shard = document.createElement('div');
      shard.className = 'demo-shard';
      shard.style.left = `${(c / cols) * 100}%`;
      shard.style.top = `${(r / rows) * 100}%`;
      shard.style.width = `${100 / cols}%`;
      shard.style.height = `${100 / rows}%`;
      // CSS sprite math: scale the bg to cols x rows tiles, then position the
      // cell. The (n-1) divisor is the correct percentage-positioning formula.
      shard.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
      const bx = cols > 1 ? (c / (cols - 1)) * 100 : 0;
      const by = rows > 1 ? (r / (rows - 1)) * 100 : 0;
      shard.style.backgroundPosition = `${bx}% ${by}%`;
      // Fallen start: from above (negative Y), scattered X, random spin.
      const sx = Math.round((Math.random() * 2 - 1) * 46);
      const sy = Math.round(-130 - Math.random() * 170);
      const sr = Math.round((Math.random() * 2 - 1) * 70);
      shard.style.setProperty('--sx', `${sx}px`);
      shard.style.setProperty('--sy', `${sy}px`);
      shard.style.setProperty('--sr', `${sr}deg`);
      // Rain top rows in first, with a little jitter so it doesn't march.
      const delay = Math.round(r * 70 + Math.random() * 130);
      shard.style.setProperty('--delay', `${delay}ms`);
      frag.appendChild(shard);
    }
  }
  container.appendChild(frag);
}

// A built-out home track (e.g. Sales: Overcoming Objections). Lists the
// track's personas as individually selectable scenario cards, with a phone/chat
// toggle (phone default, since these premium drills are about the spoken close).
function renderSectionScenarios(section) {
  const type = (state.scenarioTypes || []).find((t) => t.section === section);
  if (!type) {
    renderComingSoon(section === 'sales' ? 'Sales Scenarios' : 'Post Reservation Situations');
    return;
  }
  state.view = 'section';
  state.activeScenario = null;
  setDocumentTitle(type.title);
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  teardownAudio();
  setCallMode('phone');

  const cards = (type.personas || []).map((p) => `
    <li class="scenario-card" data-persona-id="${escapeAttr(p.id)}" tabindex="0" role="button" aria-label="Start the call with ${escapeAttr(p.customer_name)}">
      ${p.premium ? '<div class="scenario-difficulty difficulty-premium">Premium</div>' : ''}
      <h2 class="scenario-title">${escapeHtml(p.customer_name)}</h2>
      <p class="scenario-customer">${escapeHtml(p.customer_short || '')}</p>
      <p class="scenario-description">${escapeHtml(p.tagline || '')}</p>
      <div class="scenario-cta">Take the call <span aria-hidden="true">›</span></div>
    </li>
  `).join('');

  dom.root.innerHTML = `
    <section class="picker">
      <div class="welcome-back">
        <button class="ghost-button" data-action="home" type="button"><span aria-hidden="true">‹</span> Back to home</button>
      </div>
      <header class="picker-header">
        <div class="picker-format-row">
          <div class="section-format-toggle" role="group" aria-label="Call format">
            <button type="button" class="section-format-btn" data-section-format="phone">Phone</button>
            <button type="button" class="section-format-btn" data-section-format="chat">Chat</button>
          </div>
        </div>
        <h1 class="picker-title">${escapeHtml(type.title)}</h1>
        <p class="picker-subtitle">${escapeHtml(type.description || '')}</p>
      </header>
      <ul class="scenario-grid">${cards}</ul>
    </section>
  `;

  dom.root.querySelector('[data-action="home"]').addEventListener('click', renderHome);

  const updateToggle = () => {
    dom.root.querySelectorAll('[data-section-format]').forEach((b) => {
      b.classList.toggle('active', b.dataset.sectionFormat === state.callMode);
    });
  };
  dom.root.querySelectorAll('[data-section-format]').forEach((b) => {
    b.addEventListener('click', () => { setCallMode(b.dataset.sectionFormat); updateToggle(); });
  });
  updateToggle();

  dom.root.querySelectorAll('.scenario-card').forEach((card) => {
    const go = () => startCall(card.dataset.personaId);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
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
      <div class="welcome-back">
        <button class="ghost-button" data-action="home" type="button"><span aria-hidden="true">‹</span> Back to home</button>
      </div>
      <header class="welcome-hero">
        <div class="welcome-eyebrow">Simulation</div>
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

  dom.root.querySelector('[data-action="home"]')?.addEventListener('click', renderHome);

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
    .filter((t) => t.id !== 'showcase' && !t.section)
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
  // New start sequence: the pre-call modal opens over the FULL scenario shell,
  // blurred — so the trainee sees the call they're about to take, not the
  // picker list. Flow: preview backdrop -> modal -> ring -> Answer (mic init +
  // the live call). For agents/kiosk we stash the live view (a detached
  // fragment keeps its wired listeners) so Cancel/Decline restores it intact;
  // recipient/demo homes are re-rendered on return so their WebGL orb re-inits.
  state.precallStash = null;
  if (!state.recipient) {
    const frag = document.createDocumentFragment();
    while (dom.root.firstChild) frag.appendChild(dom.root.firstChild);
    state.precallStash = { frag, view: state.view };
  }
  renderCall(state.activeScenario, { preview: true });
  openPreCall(state.activeScenario);
}

// ---- Pre-call start sequence: modal -> ring -> answer -> connect ----
//
// state.ringtone holds the single live Audio() instance so we never stack
// rings; stopRingtone() is the one cleanup path called from Answer, Decline,
// Esc, backdrop, and teardown. state.precallOverlay holds the modal/ring DOM
// so any view transition can tear it down.

function stopRingtone() {
  if (state.ringtone) {
    try {
      state.ringtone.pause();
      state.ringtone.currentTime = 0;
      state.ringtone.src = '';
      state.ringtone.load();
    } catch {}
    state.ringtone = null;
  }
}

function startRingtone() {
  // Single-instance guard: stop any prior ring before starting a new one.
  stopRingtone();
  try {
    const audio = new Audio('/assets/audio/ring-sunrise.wav');
    audio.loop = true;
    state.ringtone = audio;
    // Start on the user gesture (Start click) so autoplay is permitted. If the
    // promise rejects (rare), we keep the visual ring screen working anyway.
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    state.ringtone = null;
  }
}

function dismissPreCall() {
  stopRingtone();
  const overlay = state.precallOverlay;
  state.precallOverlay = null;
  if (overlay) {
    if (overlay._cleanup) overlay._cleanup();
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
}

// Returns the visitor to wherever they were when they tapped the card,
// without starting a call. The sealed demo returns to the demo home (no
// nav/escape), recipients to their home, everyone else to the picker.
function returnFromPreCall() {
  dismissPreCall();
  if (state.recipient) {
    // Re-render so the sealed home (and its WebGL orb) rebuilds cleanly; the
    // stashed backdrop, if any, is discarded.
    state.precallStash = null;
    if (state.recipient.is_demo) renderDemoHome();
    else renderRecipientHome();
    return;
  }
  // Agents / kiosk: the preview backdrop replaced their view, so reattach the
  // stashed (still-wired) DOM and restore the view marker.
  const stash = state.precallStash;
  state.precallStash = null;
  if (stash) {
    while (dom.root.firstChild) dom.root.removeChild(dom.root.firstChild);
    dom.root.appendChild(stash.frag);
    state.view = stash.view;
    setDocumentTitle('');
  } else {
    renderHome();
  }
}

// Step 1: the pre-call modal over a blurred version of the current page. We do
// NOT navigate yet — the existing view stays mounted and gets blurred via the
// body data-attr so the modal reads as an overlay on "where they were".
function openPreCall(scenario) {
  const displayName = scenario.blind ? 'Caller' : (scenario.customer_name || 'Caller');
  const displayShort = scenario.blind ? '' : (scenario.customer_short || '');
  const displayTagline = scenario.blind ? "You won't know who's on the line until you answer." : (scenario.tagline || '');
  const typeTitle = scenario.blind ? 'Incoming call' : (scenario.type_title || scenario.title || '');

  const overlay = document.createElement('div');
  overlay.className = 'precall-overlay';
  overlay.innerHTML = `
    <div class="precall-scrim" data-precall-dismiss></div>
    <div class="precall-card" role="dialog" aria-modal="true" aria-labelledby="precall-title">
      <button type="button" class="precall-close" data-precall-dismiss aria-label="Cancel">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
      <div class="precall-eyebrow">${escapeHtml(typeTitle)}</div>
      <h2 class="precall-name" id="precall-title">${escapeHtml(displayName)}</h2>
      ${displayShort ? `<p class="precall-short">${escapeHtml(displayShort)}</p>` : ''}
      ${displayTagline ? `<p class="precall-tagline">${escapeHtml(displayTagline)}</p>` : ''}
      <div class="precall-actions">
        <button type="button" class="ghost-button precall-cancel" data-precall-dismiss>Cancel</button>
        <button type="button" class="primary-button precall-start" id="precall-start">Start <span aria-hidden="true">›</span></button>
      </div>
    </div>
  `;
  mountPreCall(overlay, () => beginRinging(scenario), scenario);
  const startBtn = overlay.querySelector('#precall-start');
  if (startBtn) setTimeout(() => startBtn.focus(), 50);
}

// Step 2: the incoming-call / ringing screen. Replaces the modal card with a
// ringing view in the same overlay; the ringtone loops (started here on the
// Start gesture). Answer -> connect; Decline -> back to where they were.
function beginRinging(scenario) {
  // Reuse the overlay shell but swap its content for the ring screen.
  dismissPreCall();

  const displayName = scenario.blind ? 'Caller' : (scenario.customer_name || 'Caller');
  const typeTitle = scenario.blind ? 'Incoming call' : (scenario.type_title || scenario.title || 'Incoming call');

  const overlay = document.createElement('div');
  overlay.className = 'precall-overlay precall-ringing';
  overlay.innerHTML = `
    <div class="precall-scrim"></div>
    <div class="ring-screen" role="dialog" aria-modal="true" aria-labelledby="ring-name" aria-describedby="ring-status">
      <div class="ring-status" id="ring-status">Incoming call…</div>
      <div class="ring-avatar" aria-hidden="true">
        <span class="ring-pulse ring-pulse-1"></span>
        <span class="ring-pulse ring-pulse-2"></span>
        <span class="ring-avatar-core">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </div>
      <div class="ring-name" id="ring-name">${escapeHtml(displayName)}</div>
      <div class="ring-sub">${escapeHtml(typeTitle)}</div>
      <div class="ring-actions">
        <button type="button" class="ring-btn ring-decline" id="ring-decline" aria-label="Decline call">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" fill="currentColor" stroke="none"/></svg>
        </button>
        <button type="button" class="ring-btn ring-answer" id="ring-answer">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" fill="currentColor" stroke="none"/></svg>
          <span class="ring-answer-label">Answer</span>
        </button>
      </div>
    </div>
  `;
  mountPreCall(overlay, null, scenario);
  // The ringtone starts here — beginRinging runs from the Start click, a real
  // user gesture, so autoplay of looped media is allowed.
  startRingtone();

  const answerBtn = overlay.querySelector('#ring-answer');
  const declineBtn = overlay.querySelector('#ring-decline');
  if (declineBtn) declineBtn.addEventListener('click', returnFromPreCall);
  if (answerBtn) {
    answerBtn.addEventListener('click', () => answerCall(scenario));
    setTimeout(() => answerBtn.focus(), 50);
  }
}

// Step 3: Answer. Stops the ring, tears down the overlay, then connects the
// live call. This click is the user gesture renderCall uses for mic init and
// audio unlock (mic permission is requested inside renderCall's first turn,
// exactly as before — never on the modal or ring step).
function answerCall(scenario) {
  // The call is going live — drop the stashed backdrop view; renderCall builds
  // the real, fully-wired call over the (about-to-be-replaced) preview shell.
  state.precallStash = null;
  dismissPreCall();
  renderCall(scenario);
}

// Shared mounting for the modal and ring overlays: blurs the underlying page,
// traps focus, and wires Esc + backdrop dismissal. onPrimary (when provided)
// is the Start handler; dismissal always returns the visitor to where they
// were. We only auto-dismiss-to-previous-view for backdrop/Esc/Cancel; Answer
// and Start call their own handlers and tear the overlay down themselves.
function mountPreCall(overlay, onPrimary, scenario) {
  // Tear down any prior overlay first (single instance).
  dismissPreCall();
  document.body.appendChild(overlay);
  document.body.dataset.precall = 'true';
  state.precallOverlay = overlay;

  const focusable = () => Array.from(
    overlay.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.disabled && el.offsetParent !== null);

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      returnFromPreCall();
      return;
    }
    if (e.key === 'Tab') {
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener('keydown', onKey);

  overlay.querySelectorAll('[data-precall-dismiss]').forEach((el) => {
    el.addEventListener('click', returnFromPreCall);
  });

  const startBtn = overlay.querySelector('#precall-start');
  if (startBtn && onPrimary) startBtn.addEventListener('click', onPrimary);

  overlay._cleanup = () => {
    document.removeEventListener('keydown', onKey);
    delete document.body.dataset.precall;
  };
}

function renderCall(scenario, opts = {}) {
  // Preview mode renders the call shell as a static, blurred backdrop for the
  // pre-call modal. It builds the DOM exactly like a live call but performs NO
  // live wiring (no audio, conversation, mic, timer, or event handlers) — those
  // only spin up when the trainee Answers and renderCall runs for real.
  const preview = !!opts.preview;
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
  const isPremium = !!scenario.premium || (isShowcaseCall && state.demoUnlocked);
  const premiumVoice = isPremium;
  const premiumBadge = isPremium
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

  // ---- CSF chrome (matches preview.js) ----
  // Per-step display title for the topbar + charcoal panel head. Step 1 shows
  // "U-Move" in the panel head (it's the equipment category) but "Reservation
  // Details" in the topbar title.
  const STEP_TITLES = {
    1: 'Reservation Details',
    2: 'Choose Equipment',
    3: 'Select Pick Up Location',
    4: 'Scheduling',
    5: 'Checkout',
  };
  const CSF_TABS = ['U-Move', 'U-Box', 'Storage', 'Hitch', 'Moving Help', 'Ready-To-Go Box', 'Hookup'];
  const SCRIPT_ICON = `<svg class="csf-script-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-4 3v-3H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  const EDIT_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M9.5 3 L13 6.5 L6 13.5 L2.5 13.5 L2.5 10 Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  const BACK_ICON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 5 L6 8 L9 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const NEXT_ICON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M7 5 L10 8 L7 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const CLOSE_ICON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const INFO_ICON = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2v3.6M8 5.2v.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const TRASH_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const csfTabsHtml = CSF_TABS.map((t, i) =>
    `<button type="button" class="csf-tab${i === 0 ? ' active' : ''}">${escapeHtml(t)}</button>`
  ).join('');

  dom.root.innerHTML = `
    <section class="call" data-call-mode="${escapeAttr(state.callMode)}"${useOrb ? ' data-orb-mode="meta"' : ''}${isShowcaseCall ? ' data-showcase-stage="meet"' : ''}>
      <header class="call-header">
        <button class="ghost-button call-back" id="call-back" type="button">Back to scenarios</button>
        <div class="call-meta">
          <div class="call-customer-name">${escapeHtml(displayName)}</div>
          <div class="call-scenario-title">${escapeHtml(displayTitle)} <span class="call-mode-pill">${escapeHtml(modeBadge)}</span>${premiumBadge}</div>
        </div>
        <div class="call-actions">
          <span class="call-timer" id="call-timer" role="timer" aria-label="Call duration" title="Call duration">00:00</span>
          <button class="ghost-button call-pause" id="call-pause" type="button" aria-pressed="false">Pause</button>
          <button class="danger-button" id="end-call" type="button">End call</button>
        </div>
      </header>
      <div class="call-body">
        ${useOrb ? `
        <div class="orb-zone" id="orb-zone" data-orb-mode="meta" data-active="false">
          <div class="orb-mount" id="orb-mount"></div>
        </div>
        ` : ''}

        <div class="csf-topbar" id="pos-topbar">
          <div class="csf-topbar-titles">
            <div class="csf-eyebrow">Customer Service Form</div>
            <div class="csf-title" id="pos-topbar-title">${escapeHtml(STEP_TITLES[1])}</div>
          </div>
          <div class="csf-topbar-nav">
            <div class="csf-nav-row">
              <a class="csf-nav-link">FAQs</a>
              <a class="csf-nav-link">POS Dashboard</a>
            </div>
            <div class="csf-topbar-action" id="pos-topbar-action">
              <button type="button" class="csf-new-btn" id="pos-top-new">New Reservation</button>
              <div class="csf-topbar-actions" id="pos-top-steps" hidden>
                <button type="button" class="csf-topbtn" id="pos-top-back">${BACK_ICON} Back</button>
                <button type="button" class="csf-topbtn" id="pos-top-next">${NEXT_ICON} Next</button>
                <button type="button" class="csf-topbtn" id="pos-top-save">${CLOSE_ICON} Save/Close Quote</button>
              </div>
            </div>
          </div>
        </div>

        <div class="pos" id="pos">
          <aside class="pos-rail pos-rail-left" aria-label="Customer and reservation context">
            <section class="pos-card" id="pos-customer-card">
              <div class="pos-card-head">
                <span class="pos-card-title" id="pos-customer-title">Customer Contact Information</span>
                <span class="pos-verified" id="pos-verified" hidden>Verified Customer</span>
              </div>
              <div class="pos-card-body" id="pos-customer-body">
                <div class="pos-script">
                  <svg class="pos-script-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-4 3v-3H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
                  <div class="pos-script-lines">
                    <p class="pos-script-line">Thank you for calling Meridian Moving and Storage, this is your name. How may I help you?</p>
                    <p class="pos-script-suggest">No problem! May I start with your cell phone number?</p>
                  </div>
                </div>
                <div class="pos-lookup">
                  <input class="pos-input" id="pos-lookup-input" type="text" placeholder="Phone number or email address">
                  <button type="button" class="pos-lookup-btn" id="pos-lookup-btn" aria-label="Search">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5 L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                  </button>
                </div>
                <div class="pos-lookup-result" id="pos-lookup-result" hidden></div>
              </div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Checklist</span></div>
              <div class="pos-card-body">
                <div class="pos-check-item">U-Move</div>
              </div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Reservation Details</span>${EDIT_ICON}</div>
              <div class="pos-card-body" id="pos-rsvdetails-body">
                <p class="pos-card-empty">Details fill in as you build the reservation.</p>
              </div>
            </section>

            <section class="pos-card" id="pos-entity-card" hidden>
              <div class="pos-card-head"><span class="pos-card-title" id="pos-entity-title">Entity</span></div>
              <div class="pos-card-body" id="pos-entity-body"></div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Reservation Notes</span>${EDIT_ICON}</div>
              <div class="pos-card-body">
                <div class="csf-notes-label">Customer Notes</div>
                <p class="csf-notes-text pos-note-text" id="pos-customer-notes">No cautionary notes</p>
                <div class="csf-notes-label">Callback Notes</div>
                <p class="csf-notes-text pos-note-text">None on file</p>
              </div>
            </section>
          </aside>

          <div class="pos-stage">
            <ol class="pos-stepper" id="pos-stepper" aria-label="Reservation steps" hidden>
              <li class="pos-stepper-item active" data-step="1"><span class="pos-stepper-num">1</span><span class="pos-stepper-label">Details</span></li>
              <li class="pos-stepper-item" data-step="2"><span class="pos-stepper-num">2</span><span class="pos-stepper-label">Equipment</span></li>
              <li class="pos-stepper-item" data-step="3"><span class="pos-stepper-num">3</span><span class="pos-stepper-label">Location</span></li>
              <li class="pos-stepper-item" data-step="4"><span class="pos-stepper-num">4</span><span class="pos-stepper-label">Time</span></li>
              <li class="pos-stepper-item" data-step="5"><span class="pos-stepper-num">5</span><span class="pos-stepper-label">Checkout</span></li>
            </ol>

            <div class="csf-tabs" id="pos-tabs">${csfTabsHtml}</div>

            <div class="csf-panel" id="pos-panel">
              <div class="csf-panel-head" id="pos-panel-head"><span id="pos-panel-head-text">U-Move</span>${INFO_ICON}</div>
              <div class="csf-panel-body">
            <form class="pos-form" id="pos-form" autocomplete="off" novalidate>
              <section class="pos-step" data-step="1">
                <div class="pos-grid-3">
                  <label class="pos-field">
                    <span class="pos-field-label">Moving From</span>
                    <input class="pos-input" data-rsv="moving_from" type="text" placeholder="Zip, city, or landmark">
                  </label>
                  <label class="pos-field">
                    <span class="pos-field-label">Moving To (Optional)</span>
                    <input class="pos-input" data-rsv="moving_to" type="text" placeholder="Zip, city, or landmark">
                  </label>
                  <div class="pos-field">
                    <span class="pos-field-label">Move Type</span>
                    <div class="pos-radio-row">
                      <label class="pos-radio"><input type="radio" name="move_type" data-rsv="move_type" value="in_town" checked> In Town</label>
                      <label class="pos-radio"><input type="radio" name="move_type" data-rsv="move_type" value="one_way"> One Way</label>
                    </div>
                  </div>
                </div>

                <div class="pos-grid-2">
                  <label class="pos-field">
                    <span class="pos-field-label">Move/Pickup Date</span>
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
                <div class="csf-script">
                  <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text" id="pos-equip-hint">Most families need a truck this size. How many days do you need it?</p></div>
                  <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">Families who rent a truck find adding a Utility Dolly and a dozen Furniture Pads make their move easier. Can I add this to your rental for $17.00?</p></div>
                </div>
                <div class="csf-objection">Is the customer not ready to book? <a class="csf-link">Click for help to overcome their objections</a> to book now!</div>

                <div class="pos-equip-rec" id="pos-equip-rec" data-size="?">
                  <div class="pos-equip-badge">Recommended</div>
                  <div class="pos-equip-body">
                    <div class="pos-equip-name" id="pos-equip-name">Add a load size on the previous step to see a fit.</div>
                    <div class="pos-equip-rate mono" id="pos-equip-rate"></div>
                    <div class="pos-grid-2 pos-field-inline">
                      <label class="pos-field" id="pos-field-rental">
                        <span class="pos-field-label">Rental Length (24-hr periods)</span>
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
                  <summary>+ Show all moving equipment</summary>
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
                <div class="csf-script">
                  <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">The closest pickup spot to you is the location below. Does that work?</p></div>
                </div>
                <p class="csf-loc-note">Based on the selections, rates may have been updated for this quote. If rates were updated, make sure to inform the customer of any changes before proceeding.</p>
                <p class="pos-hint" id="pos-loc-hint">Pick the location nearest where the customer is loading. Sorted by distance.</p>
                <div class="csf-loc-controls">
                  <span class="csf-loc-sort">Sort by: <a class="csf-link">Distance to Customer &#9662;</a></span>
                  <div class="csf-loc-legend">
                    <span><i class="csf-legend-sq" style="background:#16a34a;"></i> Available</span>
                    <span><i class="csf-legend-sq" style="background:#ea7a1d;"></i> Alternate Models</span>
                    <span><i class="csf-legend-sq" style="background:#dc2626;"></i> No Availability</span>
                  </div>
                </div>
                <div class="pos-loc-map" id="pos-loc-map" hidden></div>
                <div class="pos-loc-list" id="pos-loc-list"></div>
              </section>

              <section class="pos-step" data-step="4" hidden>
                <div class="csf-sched-grid">
                  <div class="csf-sched-left">
                    <div class="pos-sched-truck" id="pos-sched-truck"></div>
                    <div class="csf-sched-addlinks">
                      <a class="csf-link">+ Add Coverage</a>
                      <a class="csf-link">+ Add Dollies/Furniture Pads</a>
                      <a class="csf-link">+ Add Trailer / Towing</a>
                    </div>
                    <div class="pos-sched-loc" id="pos-sched-loc"></div>
                  </div>
                  <div class="csf-sched-right">
                    <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">What time would you like to pick up?</p></div>
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
                    <a class="csf-link" style="display:inline-block;margin-bottom:12px;">Check Other Locations</a>
                    <label class="pos-check"><input type="checkbox" data-rsv-flag="send_to_traffic"> Send to Traffic</label>
                  </div>
                </div>
              </section>

              <section class="pos-step csf-checkout" data-step="5" hidden>
                <div class="pos-test-banner">Simulation mode. Card details are not stored or charged.</div>
                <div class="pos-card-status" id="pos-card-status">Enter the card in the Credit Card panel to confirm.</div>

                <section class="pos-card">
                  <div class="pos-card-head" style="display:flex;align-items:center;justify-content:space-between;"><span class="pos-card-title">Additional Products and Services</span>${INFO_ICON}</div>
                  <div class="pos-card-body">
                    <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">Will you need storage before or after your move?</p></div>
                    <label class="pos-field">
                      <span class="pos-field-label">Will you need storage before or after the move?</span>
                      <select class="pos-input" data-rsv="storage">
                        <option value="no">No storage needed</option>
                        <option value="before">Yes, before the move</option>
                        <option value="after">Yes, after the move</option>
                      </select>
                    </label>
                  </div>
                </section>

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
                      <label class="pos-field">
                        <span class="pos-field-label">Email for Reservation Receipt</span>
                        <input class="pos-input" data-rsv="receipt_email" type="text" inputmode="email" placeholder="name@example.com">
                      </label>
                      <label class="pos-field">
                        <span class="pos-field-label">Phone Number</span>
                        <input class="pos-input" data-rsv="receipt_phone" type="tel" placeholder="555-123-4567">
                      </label>
                      <div class="pos-field">
                        <span class="pos-field-label">Preferred Contact Method</span>
                        <div class="pos-check-row">
                          <label class="pos-check"><input type="checkbox" data-rsv-contact="email"> Email</label>
                          <label class="pos-check"><input type="checkbox" data-rsv-contact="phone"> Phone</label>
                          <label class="pos-check"><input type="checkbox" data-rsv-contact="text" checked> Text</label>
                        </div>
                      </div>
                    </div>
                    <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">May I please have your current address?</p></div>
                    <div class="pos-grid-2">
                      <label class="pos-field">
                        <span class="pos-field-label">Current Address</span>
                        <input class="pos-input" data-rsv="current_address" type="text" placeholder="Optional">
                      </label>
                      <div class="pos-field">
                        <span class="pos-field-label">Preferred Language</span>
                        <div class="pos-radio-row">
                          <label class="pos-radio"><input type="radio" name="language" data-rsv="language" value="english" checked> English</label>
                          <label class="pos-radio"><input type="radio" name="language" data-rsv="language" value="french"> French</label>
                          <label class="pos-radio"><input type="radio" name="language" data-rsv="language" value="spanish"> Spanish</label>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </section>

              <div class="pos-error" id="pos-error" hidden></div>
            </form>
                <div class="pos-nav csf-panel-foot">
                  <button type="button" class="ghost-button" id="pos-back" hidden>Back</button>
                  <button type="submit" class="primary-button" id="pos-next" form="pos-form">Continue</button>
                </div>
              </div>
            </div>

            <div class="pos-result" id="pos-result"></div>
          </div>

          <aside class="pos-rail pos-rail-right" aria-label="Cart and payment">
            <section class="pos-card pos-cart-card">
              <div class="pos-card-head pos-card-head-accent"><span class="pos-card-title">Shopping Cart</span><span style="cursor:pointer;">${TRASH_ICON}</span></div>
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

  // Preview backdrop: DOM is built; stop before any live wiring. The shell sits
  // blurred behind the pre-call modal (pointer-events are disabled by the
  // body[data-precall] blur rule), so unwired controls are inert by design.
  if (preview) {
    const callEl = dom.root.querySelector('.call');
    if (callEl) callEl.dataset.preview = 'true';
    return;
  }

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
  const callTimerEl = document.getElementById('call-timer');
  const callPauseBtn = document.getElementById('call-pause');

  // Drives the call clock: the timer only accrues time during these states.
  // 'connecting', 'processing', and 'thinking' are simulator latency (STT +
  // model + TTS warmup) and are intentionally NOT counted, so the duration
  // reflects real conversational time for call-efficiency measurement.
  let currentPhoneState = 'connecting';
  let chatStreaming = false;

  function setPhoneState(s, text, hint) {
    if (!phoneStatus) return;
    phoneStatus.dataset.state = s;
    currentPhoneState = s;
    if (text != null) phoneStatusText.textContent = text;
    if (hint != null) phoneStatusHint.textContent = hint;
    updateCallClock();
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

  // Agent-first start. For all normal scenarios the AGENT greets first: we do
  // NOT auto-play the customer opening line and do NOT push a customer opening
  // bubble — the trainee's greeting is the first turn. The ONLY exception is
  // the showcase persona (Elena), which is built to introduce HERSELF; for the
  // showcase we keep the original opening-line behavior so she still opens.
  let openingMessage = null;
  if (isShowcaseCall) {
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
    // Agent-first: normal scenarios send NO opening_line, so the server's
    // openingContinuationBlock stays empty and the model simply responds to
    // the trainee's greeting (it never opened the call). Only the showcase
    // persona, which opens with a client-side line, anchors that line here so
    // she continues rather than re-introducing herself.
    openingLine: isShowcaseCall ? scenario.opening_line : '',
    onAssistantStart: () => {
      clearSilenceTimer();
      // Chat mode shows text as it streams. Phone mode creates the
      // bubble lazily on first audio-segment play so text never
      // beats the voice.
      if (!isPhone) {
        chatStreaming = true;
        updateCallClock();
        ensureStreamingBubble(customerLabel);
      }
    },
    onAssistantDelta: (text) => {
      if (!isPhone) appendToStreamingBubble(text);
    },
    onAssistantEnd: () => {
      // Chat mode finalizes immediately. Phone mode finalizes when the
      // audio queue drains (audioPlayer.onEnd above) so the trailing
      // sentences land in sync.
      if (!isPhone) {
        finalizeTurnBubble();
        chatStreaming = false;
        updateCallClock();
      }
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
      // Showcase: keep the reservation workspace hidden while the trainee is
      // just chatting with Elena (meet). It only appears once she steps into the
      // customer scenario ([mode:scenario]); a return to [mode:meta] hides it
      // again. Independent of the premium orb, so it works either way.
      if (callEl && isShowcaseCall) {
        callEl.dataset.showcaseStage = (mode === 'scenario') ? 'scenario' : 'meet';
      }
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
      chatStreaming = false;
      updateCallClock();
      setComposerEnabled(true);
    },
  });
  state.conversation = conversation;

  // ---- Mode-specific wiring ----

  if (isPhone) {
    setPhoneState('connecting', `Connecting you to ${customerLabel}...`, 'Putting the call through.');
    // Agent-first: the trainee greets first. For the showcase persona Elena
    // opens (her opening-line audio plays, and audioPlayer.onEnd hands the
    // turn back), so we don't start listening here. For every normal scenario
    // there's no customer audio to wait on — open the mic now so the trainee
    // can greet. The Answer click was the user gesture, so startListening's
    // getUserMedia call has a valid gesture chain.
    if (!isShowcaseCall) {
      setPhoneState('your_turn', 'Your turn — greet the caller.', 'They just picked up. Say hello and introduce yourself.');
      startListening();
    }
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
    if (state.callPaused) return;
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
    if (state.recipient) {
      if (state.recipient.is_demo) renderDemoHome();
      else renderRecipientHome();
    } else renderPicker();
  });

  function setComposerEnabled(enabled) {
    if (!composerInput || !composerSend) return;
    composerInput.disabled = !enabled;
    composerSend.disabled = !enabled;
    composerSend.textContent = enabled ? 'Send' : 'Sending';
  }

  // ---- Call timer + pause ----
  // The clock is a "conversational time" measure for call efficiency: it only
  // accrues while the call is in a LIVE state (the trainee's turn, the trainee
  // talking, or the customer talking). It freezes during simulator latency
  // ('connecting' / 'processing' / 'thinking'), during model streaming in chat
  // mode, and while manually paused. Internally we fold each running span into
  // accMs and null runningSince to stop it; the displayed value freezes and
  // later resumes exactly where it left off. The clock therefore starts on the
  // first spoken turn (when the conversation first goes live), not at mount.
  function fmtDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  function callElapsedMs() {
    const t = state.callTimer;
    if (!t) return 0;
    return t.accMs + (t.runningSince ? Date.now() - t.runningSince : 0);
  }
  function renderCallTimer() {
    if (callTimerEl) callTimerEl.textContent = fmtDuration(callElapsedMs());
  }
  function clockShouldRun() {
    if (state.callPaused) return false;
    if (isPhone) return TIMER_LIVE_STATES.has(currentPhoneState);
    // Chat mode: count whenever the model is not actively generating.
    return !chatStreaming;
  }
  function setClockRunning(running) {
    const t = state.callTimer;
    if (!t) return;
    if (running && !t.runningSince) {
      t.runningSince = Date.now();
    } else if (!running && t.runningSince) {
      t.accMs += Date.now() - t.runningSince;
      t.runningSince = null;
    }
    renderCallTimer();
  }
  function updateCallClock() {
    setClockRunning(clockShouldRun());
  }
  function startCallTimer() {
    if (state.callTimer?.intervalId) clearInterval(state.callTimer.intervalId);
    // Initialize stopped at 00:00; updateCallClock() starts it once the call
    // is in a live state (i.e. the first spoken turn).
    state.callTimer = { accMs: 0, runningSince: null, intervalId: null };
    updateCallClock();
    renderCallTimer();
    state.callTimer.intervalId = setInterval(renderCallTimer, 500);
  }

  function setCallPaused(paused) {
    if (paused === state.callPaused) return;
    state.callPaused = paused;
    if (paused) {
      // Stop everything that would advance the conversation: silence timeout,
      // the live mic, any in-flight transcription, and the customer's voice.
      clearSilenceTimer();
      if (state.continuousRecorder) {
        state.continuousRecorder.cancel();
        state.continuousRecorder = null;
      }
      if (state.sttController) {
        try { state.sttController.abort(); } catch {}
        state.sttController = null;
      }
      state.audioPlayer?.cancel();
      if (isPhone) setPhoneState('paused', 'Call paused', 'Resume when you are ready.');
      else setComposerEnabled(false);
    } else {
      if (isPhone) {
        if (!conversation.isStreaming()) {
          setPhoneState('your_turn', 'Your turn.', 'Just start talking. The line auto-detects your pause.');
          startListening();
        }
      } else {
        setComposerEnabled(true);
        composerInput?.focus();
      }
    }
    // Re-evaluate the clock against the new pause + state (setPhoneState above
    // already did this for phone; this covers chat and the pause-on path).
    updateCallClock();
    if (callPauseBtn) {
      callPauseBtn.textContent = paused ? 'Resume' : 'Pause';
      callPauseBtn.setAttribute('aria-pressed', String(paused));
      callPauseBtn.classList.toggle('is-paused', paused);
    }
    const callEl = dom.root.querySelector('.call');
    if (callEl) callEl.dataset.paused = String(paused);
  }

  callPauseBtn?.addEventListener('click', () => setCallPaused(!state.callPaused));
  startCallTimer();

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
  // CSF chrome refs
  const posTopbarTitle = document.getElementById('pos-topbar-title');
  const posTopNewBtn = document.getElementById('pos-top-new');
  const posTopStepsWrap = document.getElementById('pos-top-steps');
  const posTopBackBtn = document.getElementById('pos-top-back');
  const posTopNextBtn = document.getElementById('pos-top-next');
  const posTabs = document.getElementById('pos-tabs');
  const posPanel = document.getElementById('pos-panel');
  const posPanelHeadText = document.getElementById('pos-panel-head-text');
  const posCustomerTitle = document.getElementById('pos-customer-title');

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
  // mileage. Null until the agent picks a place from the city typeahead.
  let originGeo = null;
  let destGeo = null;

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
    // CSF itemized cart: a U-Move sub-row, the quote line items, a U-Move
    // subtotal, the total, and the action links. The Show Taxes toggle keeps
    // the tax line behind a click like the preview's link affordance.
    const lineHtml = q.lines.map((l) => `
      <div class="csf-cart-line">
        <div class="csf-cart-line-label">${escapeHtml(l.label)}</div>
        <div class="csf-cart-line-amt">${fmtMoney(l.amount)}${l.sub ? `<span class="csf-cart-line-sub">${escapeHtml(l.sub)}</span>` : ''}</div>
      </div>
    `).join('');
    posCartBody.innerHTML = `
      <div class="csf-cart-sub"><span>U-Move</span><span style="cursor:pointer;">${TRASH_ICON}</span></div>
      ${lineHtml}
      <div class="csf-cart-subtotal"><span>U-Move Total:</span><span>${fmtMoney(q.subtotal)}</span></div>
      <details class="pos-cart-taxes"><summary>Show Taxes</summary>
        <div class="csf-cart-line csf-cart-line-muted"><div class="csf-cart-line-label">Estimated tax (8.25%)</div><div class="csf-cart-line-amt">${fmtMoney(q.tax)}</div></div>
      </details>
      <div class="csf-cart-total"><span>Total</span><span>${fmtMoney(q.total)}</span></div>
      <div class="csf-cart-links">
        <a class="csf-link">Estimate Price w/ Mileage</a>
        <a class="csf-link csf-cart-taxes-link">Show Taxes</a>
        <a class="csf-link">View Coverage Rates</a>
      </div>
    `;
    // Wire the Show Taxes link to the (visually hidden) details toggle so the
    // tax line still surfaces on click without a second markup path.
    const taxesDetails = posCartBody.querySelector('.pos-cart-taxes');
    const taxesLink = posCartBody.querySelector('.csf-cart-taxes-link');
    if (taxesDetails && taxesLink) {
      taxesLink.addEventListener('click', (e) => {
        e.preventDefault();
        taxesDetails.open = !taxesDetails.open;
      });
    }
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

    // Static map of the customer's area with the nearest branches pinned.
    // Proxied through /api/staticmap so the Google key stays server-side; the
    // image only appears once we have a geocoded origin to center on.
    const mapEl = document.getElementById('pos-loc-map');
    if (mapEl) {
      if (originGeo && Number.isFinite(originGeo.lat) && Number.isFinite(originGeo.lng)) {
        const pts = items
          .filter((it) => Number.isFinite(it.loc.lat) && Number.isFinite(it.loc.lng))
          .slice(0, 5)
          .map((it) => `${it.loc.lat},${it.loc.lng}`)
          .join('|');
        const src = `/api/staticmap?c=${encodeURIComponent(originGeo.lat + ',' + originGeo.lng)}`
          + (pts ? `&pts=${encodeURIComponent(pts)}` : '')
          + '&w=600&h=200';
        mapEl.innerHTML = '<img class="pos-loc-map-img" alt="Map of nearby pickup locations" loading="lazy">';
        const img = mapEl.querySelector('img');
        img.addEventListener('error', () => { mapEl.hidden = true; });
        mapEl.hidden = false;
        img.src = src;
      } else {
        mapEl.hidden = true;
        mapEl.innerHTML = '';
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

  // "San Antonio, TX" for the Location-step suggestion copy.
  function cityLabelOf(geo, fallback) {
    if (!geo || !geo.city) return fallback;
    return geo.state ? `${geo.city}, ${geo.state}` : geo.city;
  }

  // Look up candidate places for the city typeahead.
  async function geocodeSearch(query) {
    const q = (query || '').trim();
    if (!q) return [];
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.results) ? data.results : [];
    } catch {
      return [];
    }
  }

  // Recompute the one-way distance from the two resolved places. Only acts on a
  // one-way move with both endpoints known; in-town leaves mileage manual.
  function autoFillOneWayMiles() {
    if (getRsv('move_type') !== 'one_way' || !originGeo || !destGeo) return;
    const tripMi = Math.max(1, Math.round(haversineMiles(originGeo, destGeo)));
    setRsv('miles', String(tripMi));
    onPosChange();
  }

  // Turn a Moving From/To input into a city typeahead: type a place, pick from
  // the dropdown, and the field fills with "City, ST" while we keep the
  // coordinates. Nothing about branches shows here - the suggestion lives on
  // the Location step. onResolve gets the picked place, or null when the field
  // is cleared or edited so it no longer matches the last pick.
  function attachCityAutocomplete(input, onResolve) {
    if (!input) return;
    const wrap = document.createElement('div');
    wrap.className = 'pos-ac';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const menu = document.createElement('ul');
    menu.className = 'pos-ac-menu';
    menu.hidden = true;
    wrap.appendChild(menu);

    let items = [];
    let activeIdx = -1;
    let seq = 0;
    let resolvedDisplay = null;
    let timer = null;

    // The menu is position:fixed (so .pos-stage's scroll can't clip it), so we
    // pin it under the input and keep it there while scrolling/resizing.
    function position() {
      const r = input.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${r.left}px`;
      menu.style.width = `${r.width}px`;
    }
    function onReposition() { if (!menu.hidden) position(); }
    function hide() {
      menu.hidden = true;
      activeIdx = -1;
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    }
    function render() {
      if (!items.length) { hide(); return; }
      menu.innerHTML = items.map((it, i) =>
        `<li class="pos-ac-item${i === activeIdx ? ' active' : ''}" data-idx="${i}" role="option">${escapeHtml(it.display)}</li>`
      ).join('');
      menu.hidden = false;
      position();
      window.addEventListener('scroll', onReposition, true);
      window.addEventListener('resize', onReposition);
    }
    function pick(i) {
      const it = items[i];
      if (!it) return;
      input.value = it.display;
      resolvedDisplay = it.display;
      hide();
      onResolve(it);
    }
    async function search(q) {
      const mine = ++seq;
      const results = await geocodeSearch(q);
      if (mine !== seq) return;
      items = results;
      activeIdx = -1;
      render();
    }

    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const v = input.value.trim();
      if (v === resolvedDisplay) return;
      // The text no longer matches a pick, so any stored coordinates are stale.
      resolvedDisplay = null;
      onResolve(null);
      if (v.length < 3) { items = []; hide(); return; }
      timer = setTimeout(() => search(v), 250);
    });
    input.addEventListener('keydown', (e) => {
      if (menu.hidden || !items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); render(); }
      else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(activeIdx); }
      else if (e.key === 'Escape') { hide(); }
    });
    // mousedown (not click) so the pick lands before the input's blur hides it.
    menu.addEventListener('mousedown', (e) => {
      const li = e.target.closest('.pos-ac-item');
      if (!li) return;
      e.preventDefault();
      pick(Number(li.dataset.idx));
    });
    input.addEventListener('blur', () => {
      // Let a click settle, then resolve free-typed text to the best match so
      // ranking still works if the agent tabbed past the dropdown.
      setTimeout(async () => {
        hide();
        const v = input.value.trim();
        if (!v || v === resolvedDisplay) return;
        const results = await geocodeSearch(v);
        if (!results.length) { onResolve(null); return; }
        input.value = results[0].display;
        resolvedDisplay = results[0].display;
        onResolve(results[0]);
      }, 150);
    });
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
    // CSF post-lookup profile: the card head flips to "Customer" and the body
    // shows the name/phone/email + Verified + Past Rentals, driven by the live
    // lookup record. This replaces the pre-lookup script + lookup field.
    if (posCustomerTitle) posCustomerTitle.textContent = 'Customer';
    const hasHistory = (r.past_rentals || []).length || (r.active_reservations || []).length || (r.claims_cases || []).length;
    const checkSvg = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.3 8 L7 9.7 L10.7 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const clockSvg = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5 V8 L10.5 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    posCustomerBody.innerHTML = `
      <div class="csf-cust-name">${escapeHtml(r.full_name || '')}</div>
      ${r.phone ? `<div class="csf-cust-line">${escapeHtml(r.phone)}</div>` : ''}
      ${r.email ? `<div class="csf-cust-line">${escapeHtml(r.email)}</div>` : ''}
      ${r.account_id ? `<div class="csf-cust-line">Account ${escapeHtml(r.account_id)}</div>` : ''}
      ${r.member_since ? `<div class="csf-cust-line">Member since ${escapeHtml(String(r.member_since))}</div>` : ''}
      <div class="csf-verified">${checkSvg} Verified Customer</div>
      ${hasHistory ? `<button type="button" class="csf-pastrentals" id="pos-history-link">${clockSvg} Past Rentals/Reservations</button>` : ''}
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
  // agent is never dead-ended on an unrelated field. The Details and Time
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
    // CSF chrome per step: topbar title, panel head ("U-Move" on step 1, else
    // the step title), category tabs (step 1 only), panel standalone border
    // (steps 2-5), and the topbar action group (New Reservation vs Back/Next).
    if (posTopbarTitle) posTopbarTitle.textContent = STEP_TITLES[posStep] || '';
    if (posPanelHeadText) posPanelHeadText.textContent = posStep === 1 ? 'U-Move' : (STEP_TITLES[posStep] || '');
    if (posTabs) posTabs.hidden = posStep !== 1;
    if (posPanel) posPanel.dataset.standalone = posStep === 1 ? 'false' : 'true';
    if (posTopNewBtn) posTopNewBtn.hidden = posStep !== 1;
    if (posTopStepsWrap) posTopStepsWrap.hidden = posStep === 1;
    if (posTopBackBtn) posTopBackBtn.disabled = posStep === 1;
    if (posStep === 2) renderEquip();
    if (posStep === 4) renderSched();
    if (posStep === 5) updateCardStatus();
    const stage = posForm.closest('.pos-stage');
    if (stage) stage.scrollTop = 0;
  }

  posBackBtn.addEventListener('click', () => showStep(posStep - 1));

  // CSF topbar Back/Next mirror the in-panel nav so the agent can drive the
  // reservation from the header too. Next routes through requestSubmit so it
  // hits the same validation/storage-modal flow as the panel Continue button.
  posTopBackBtn?.addEventListener('click', () => { if (posStep > 1) showStep(posStep - 1); });
  posTopNextBtn?.addEventListener('click', () => posForm.requestSubmit());

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

  // City typeahead on the move addresses. Picking a place stores its
  // coordinates, which drive the branch ranking on the Location step and the
  // one-way mileage. No branch info is shown on the Details step itself.
  attachCityAutocomplete(pos.querySelector('[data-rsv="moving_from"]'), (place) => {
    originGeo = place ? { lat: place.lat, lng: place.lng, city: place.city, state: place.state, postcode: place.postcode } : null;
    renderLocations();
    renderLeftRail();
    autoFillOneWayMiles();
  });
  attachCityAutocomplete(pos.querySelector('[data-rsv="moving_to"]'), (place) => {
    destGeo = place ? { lat: place.lat, lng: place.lng, city: place.city, state: place.state, postcode: place.postcode } : null;
    autoFillOneWayMiles();
    renderLeftRail();
  });
  pos.querySelectorAll('[data-rsv="move_type"]').forEach((el) => {
    el.addEventListener('change', autoFillOneWayMiles);
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

  // ---- Per-field CSR script tooltips ---------------------------------------
  // As the rep tabs/clicks from field to field, a floating "what to say" bubble
  // follows focus (mirrors the live U-Haul CSF). It's pure focus UI on the POS
  // form, so it behaves identically in phone and chat mode. Delegated on the
  // POS container so it survives per-step re-renders.
  const FIELD_SCRIPTS = {
    __lookup__: 'May I start with your cell phone number or email address?',
    moving_from: 'What zip code, city, or landmark are you moving from?',
    moving_to: 'And where are you moving to?',
    pickup_date: 'What day would you like to pick up?',
    load_size: 'How many bedrooms are you moving?',
    rental_length: 'How many days do you need the truck?',
    miles: 'About how many miles is the move?',
    pickup_time: 'What time would you like to pick up?',
    storage: 'Will you need storage before or after your move?',
    receipt_email: "What's the best email for the reservation receipt?",
    receipt_phone: 'And the best phone number to reach you?',
    current_address: 'May I please have your current address?',
    card_number: 'Which credit card would you like to use to confirm the reservation?',
    card_zip: 'And the billing zip code for that card?',
  };
  if (state.fieldTip) { try { state.fieldTip.remove(); } catch {} }
  const fieldTip = document.createElement('div');
  fieldTip.className = 'pos-fieldtip';
  fieldTip.hidden = true;
  fieldTip.innerHTML = `<span class="pos-fieldtip-icon" aria-hidden="true">${SCRIPT_ICON}</span><span class="pos-fieldtip-text"></span>`;
  document.body.appendChild(fieldTip);
  state.fieldTip = fieldTip;
  const fieldTipText = fieldTip.querySelector('.pos-fieldtip-text');

  function showFieldTip(el) {
    const key = el.getAttribute('data-rsv') || (el.id === 'pos-lookup-input' ? '__lookup__' : '');
    const script = key && FIELD_SCRIPTS[key];
    if (!script) { fieldTip.hidden = true; return; }
    fieldTipText.textContent = script;
    fieldTip.hidden = false;
    const r = el.getBoundingClientRect();
    const th = fieldTip.offsetHeight;
    let top = r.top - th - 8;
    if (top < 8) top = r.bottom + 8; // not enough room above → drop below
    fieldTip.style.top = `${Math.round(top)}px`;
    fieldTip.style.left = `${Math.round(r.left)}px`;
  }
  pos.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-rsv], #pos-lookup-input');
    if (el) showFieldTip(el);
    else fieldTip.hidden = true;
  });
  pos.addEventListener('focusout', () => { fieldTip.hidden = true; });

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
    if (posPanel) posPanel.hidden = true;
    if (posTabs) posTabs.hidden = true;
    posResult.innerHTML = `
      <div class="csf-complete">
        <div class="csf-complete-banner">
          <div class="csf-complete-banner-title">&#9989; Reservation Complete</div>
          <p class="csf-complete-banner-text">The reservation has been completed!</p>
          <p class="csf-complete-banner-text">A confirmation ${getRsv('receipt_phone') ? `has been sent via text to <span class="mono">${escapeHtml(getRsv('receipt_phone'))}</span>` : 'has been sent to the customer'}. Confirmation number <strong class="mono">${escapeHtml(conf)}</strong>.</p>
        </div>
        <div class="pos-card csf-complete-card">
          <div class="pos-card-body">
            <h3 class="csf-complete-name">Customer Name: ${escapeHtml(custName)}</h3>
            <div class="csf-complete-grid">
              <div class="csf-complete-col">
                <div class="csf-complete-subhead">Reservation Summary</div>
                <div class="csf-complete-model">${escapeHtml(q.truck ? q.truck.label.toUpperCase() : 'TRUCK')}</div>
                <dl class="csf-complete-facts">
                  <div><dt>Pick Up Date:</dt><dd>${escapeHtml(getRsv('pickup_date') || 'TBD')}</dd></div>
                  <div><dt>Pick Up Time:</dt><dd>${escapeHtml(getRsv('pickup_time') || 'TBD')}</dd></div>
                  <div><dt>Rental Length:</dt><dd>${escapeHtml(q.oneWay ? `${q.ow ? q.ow.days : 1} days (one-way)` : (rl ? rl.label : '1 day'))}</dd></div>
                  <div><dt>Rental Type:</dt><dd>${q.oneWay ? 'One Way' : 'In Town'}</dd></div>
                  ${ls ? `<div><dt>Move:</dt><dd>${escapeHtml(ls.label)}</dd></div>` : ''}
                </dl>
                <div class="csf-complete-loc">
                  <div class="csf-complete-map" aria-hidden="true"></div>
                  <div class="csf-complete-loc-info">
                    <em>${escapeHtml(loc.name ? 'Meridian of ' + loc.name : 'Pickup location TBD')}</em>
                    ${loc.address ? `<span>${escapeHtml(loc.address)}</span>` : ''}
                    ${loc.phone ? `<span class="mono">${escapeHtml(loc.phone)}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="csf-complete-col">
                <div class="csf-complete-subhead">Summary of Charges</div>
                <div class="csf-complete-charges">
                  ${q.lines.map((l) => `<div class="csf-complete-charge"><span class="csf-complete-charge-label">${escapeHtml(l.label)}</span><span class="csf-complete-charge-amt mono">${fmtMoney(l.amount)}</span></div>`).join('')}
                  <div class="csf-complete-charge"><span class="csf-complete-charge-label">Estimated Tax</span><span class="csf-complete-charge-amt mono">${fmtMoney(q.tax)}</span></div>
                  <div class="csf-complete-charge csf-complete-total"><span class="csf-complete-charge-label">Total:</span><span class="csf-complete-charge-amt mono">${fmtMoney(q.total)}</span></div>
                  <div class="pos-cc-chip" data-brand="${escapeAttr(brand)}" style="margin-top:8px;">
                    <span class="pos-cc-brand">${escapeHtml(brand === 'unknown' ? 'CARD' : brand.toUpperCase())}</span>
                    <span class="mono">•••• ${escapeHtml(last4)}</span>
                    <span class="mono">exp ${escapeHtml(exp)}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="pos-receipt-readback" style="margin-top:16px;">
              <div class="pos-receipt-readback-title">Read back to the caller</div>
              <p>"Your confirmation number is <strong class="mono">${escapeHtml(conf)}</strong>. We're holding a ${escapeHtml(q.truck ? q.truck.label : 'truck')} for you at the ${escapeHtml(loc.name || 'pickup')} location on ${escapeHtml(getRsv('pickup_date'))} at ${escapeHtml(getRsv('pickup_time') || 'your selected time')}. Your total comes to ${escapeHtml(fmtMoney(q.total))} on the card ending in ${escapeHtml(last4)}. Is there anything else I can help you with?"</p>
            </div>
          </div>
        </div>
        <div class="csf-complete-foot">
          <span class="csf-complete-foot-note">Does this same customer need to make another reservation?</span>
          <button class="ghost-button" type="button" id="pos-new">Start another reservation</button>
        </div>
      </div>
    `;
    document.getElementById('pos-new')?.addEventListener('click', () => {
      posResult.innerHTML = '';
      posForm.reset();
      posForm.hidden = false;
      // Stepper stays hidden in the CSF chrome; the panel/tabs come back.
      posStepper.hidden = true;
      if (posNav) posNav.hidden = false;
      if (posPanel) posPanel.hidden = false;
      if (posTabs) posTabs.hidden = false;
      truckOverride = null;
      selectedLocation = null;
      storageAsked = false;
      originGeo = null;
      destGeo = null;
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
  // Kiosk visitors have nowhere to go but back into the same scenario - even
  // if the "Back to scenarios" button shows for any reason, it just retries.
  // Recipients go to their personal simulation page; agents go to the picker.
  const onNewCall = state.kiosk
    ? () => startCall(scenario.id)
    : state.recipient
      ? (state.recipient.is_demo ? renderDemoHome : renderRecipientHome)
      : renderPicker;
  const node = renderReportHtml(scenario, report, {
    onNewCall,
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
  document.getElementById('ended-back').addEventListener('click',
    state.kiosk ? () => startCall(scenario.id)
    : state.recipient ? (state.recipient.is_demo ? renderDemoHome : renderRecipientHome)
    : renderPicker);
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
  document.getElementById('error-back').addEventListener('click',
    state.kiosk ? () => startCall(scenario.id)
    : state.recipient ? (state.recipient.is_demo ? renderDemoHome : renderRecipientHome)
    : renderPicker);
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

// Branch picker modal. Lets the agent see each branch's full details
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
