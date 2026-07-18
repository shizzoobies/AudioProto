import { Conversation } from './conversation.js';
import { requestCoachingReport, renderReportHtml } from './coach.js';
import { AudioPlayer, attachVisualizer, synthesizeSentence, ContinuousRecorder, transcribeAudio } from './audio.js';
import { createDemoOrb } from './demo-orb.js';
import { createVoiceAgent } from './voice-agent.js?v=20260718-2';
import { csToolHtml, wireCsTool } from './cs-tool.js?v=20260610-9';
import { posToolHtml, wirePosTool } from './pos-tool.js?v=20260718-3';
import { renderLandingContentHtml } from './coaching-landing-view.js?v=20260610-9';

// Bump this whenever app.js changes meaningfully; it prints on load so we can
// confirm which build a browser is actually running (cache-bust verification).
const BUILD_ID = '20260718-3 embed-geocode-proxy';
console.log('[First Call] build', BUILD_ID);

// Demo scenarios that run the real-time ElevenLabs voice agent (phone mode only).
// Flip VOICE_AGENT_ENABLED to false to fall back to the turn-based pipeline.
const VOICE_AGENT_ENABLED = true;
const VOICE_AGENT_SCENARIOS = new Set(['demo_sales', 'demo_service', 'coaching_practice']);

// Back-to-back demo reel: five real personas played on the voice agent in this
// exact order, auto-advancing with no report between calls. Mirrors
// REEL_SCENARIO_IDS in shared/scenarios.js. Only meaningful while state.reel is
// set (the reel share-link scope); every other code path is byte-for-byte
// unchanged when state.reel is falsy.
const REEL_SEQUENCE = ['demo_sales', 'lost_reservation_marcus', 'damage_dispute_vincent', 'price_shopper_greta', 'first_time_mover_jordan'];
const REEL_SCENARIO_IDS = new Set(REEL_SEQUENCE);

// A coaching id is either the hardcoded coaching_practice (Taylor) or any
// admin-authored coaching agent (ids start with ca_). Coaching ids run the
// soft-skills voice stage (no POS, no inbound ring) on the shared coaching
// ElevenLabs agent. Used everywhere the old code special-cased coaching_practice.
function isCoachingId(id) {
  return id === 'coaching_practice' || (typeof id === 'string' && id.startsWith('ca_'));
}
// True when a scenario should run the real-time ElevenLabs voice agent: the demo
// personas + any coaching id (hardcoded or authored).
function isVoiceAgentScenario(id) {
  // In reel mode the four library reel personas also run on the voice agent
  // (they are turn-based everywhere else). Guarded by state.reel so no non-reel
  // path is affected.
  return VOICE_AGENT_SCENARIOS.has(id) || isCoachingId(id) || (!!state.reel && REEL_SCENARIO_IDS.has(id));
}

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
  // Instructor Live Mode (trainee side): set only when entered via /app?live=1.
  liveMode: false,
  liveSession: null,
  liveEmit: null,
};

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
  if (state.voiceAgent) {
    try { state.voiceAgent.stop(); } catch {}
    state.voiceAgent = null;
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

// ---------------------------------------------------------------------------
// Instructor Live Mode (trainee side). A /live/<token> trainee link lands the
// browser at /app?live=1 carrying a cs_live cookie. This path is fully
// self-contained: it skips the normal auth probes, /api/scenarios, the voice
// agent, and the AI coaching report. The trainee drives the real sales POS while
// a human instructor (on the paired instructor screen) plays the customer by
// voice. We snapshot the POS state to /api/live/state ~1s for the instructor
// mirror. None of this touches the normal demo path: it only runs when ?live=1.
// ---------------------------------------------------------------------------

const LIVE_EMIT_DEBOUNCE_MS = 800;
const LIVE_EMIT_HEARTBEAT_MS = 4000;

async function maybeBootLiveTrainee() {
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return false;
  }
  if (params.get('live') !== '1') return false;

  // This IS a live trainee entry. Handle it fully here (success or inactive) and
  // never fall through to the normal boot, even on failure.
  let data = null;
  try {
    const r = await fetch('/api/live/state', { credentials: 'same-origin' });
    if (r.ok) data = await r.json();
  } catch {
    data = null;
  }

  if (!data || data.active !== true || data.role !== 'trainee' || !data.scenario) {
    renderLiveInactive(data && data.active === false);
    return true;
  }

  state.liveMode = true;
  state.liveSession = { id: data.session_id, label: data.label || '' };
  document.body.dataset.live = 'true';
  document.body.dataset.recipient = 'true'; // hide the global sign-out chrome
  document.body.dataset.appState = 'ready';
  setCallMode('phone');
  state.activeScenario = data.scenario;
  renderCall(data.scenario, { live: true });
  startLiveEmit();
  return true;
}

// Mask anything that looks like card data, by field name or value shape. The
// server (maskTraineeState) repeats this as the trust boundary.
function liveMaskValue(name, raw) {
  const val = String(raw == null ? '' : raw);
  const lower = String(name || '').toLowerCase();
  const digits = val.replace(/\D/g, '');
  if (lower.includes('card') && lower.includes('num')) return digits ? `•••• ${digits.slice(-4)}` : '';
  if (lower.includes('cvv') || lower.includes('cvc') || lower.includes('cid')) return val ? '•••' : '';
  if (digits.length >= 13 && digits.length <= 19 && digits.length === val.replace(/[\s-]/g, '').length) {
    return `•••• ${digits.slice(-4)}`;
  }
  return val;
}

// Reduce any PAN-shaped run (13-19 digits, spaces/dashes allowed) in a string to
// its last 4. A backstop over the serialized HTML so no full card number can
// slip through in a value attribute or an echoed preview.
function liveScrubDigits(text) {
  return String(text == null ? '' : text).replace(/(?:\d[ -]?){13,19}/g, (m) => {
    const d = m.replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 ? `•••• ${d.slice(-4)}` : m;
  });
}

// Build a sanitized, value-reflected HTML clone of the trainee's POS work surface
// so the instructor sees the exact screen. cloneNode does NOT copy live control
// values, so we reflect each control's current value into attributes, mask card
// data, and strip the call chrome (orb, dock, transcript, action buttons) the
// instructor does not need. The instructor renders this inside an isolated frame
// with the app stylesheet so it looks identical.
function clonePosHtml() {
  const live = document.querySelector('.call');
  if (!live) return '';
  const clone = live.cloneNode(true);
  const liveControls = live.querySelectorAll('input, select, textarea');
  const cloneControls = clone.querySelectorAll('input, select, textarea');
  const n = Math.min(liveControls.length, cloneControls.length);
  for (let i = 0; i < n; i++) {
    const lc = liveControls[i];
    const cc = cloneControls[i];
    const name = lc.getAttribute('data-rsv') || lc.id || lc.name || '';
    if (lc.tagName === 'SELECT') {
      Array.from(cc.options).forEach((o) => o.removeAttribute('selected'));
      if (lc.selectedIndex >= 0 && cc.options[lc.selectedIndex]) {
        cc.options[lc.selectedIndex].setAttribute('selected', 'selected');
      }
    } else if (lc.type === 'checkbox' || lc.type === 'radio') {
      if (lc.checked) cc.setAttribute('checked', 'checked');
      else cc.removeAttribute('checked');
    } else if (lc.tagName === 'TEXTAREA') {
      cc.textContent = liveScrubDigits(lc.value || '');
    } else {
      cc.setAttribute('value', liveMaskValue(name, lc.value || ''));
    }
  }
  clone
    .querySelectorAll('#orb-zone, #call-dock, #visualizer-wrap, #transcript, .call-actions, #call-back')
    .forEach((el) => el.remove());
  return liveScrubDigits(clone.outerHTML);
}

// Snapshot the POS for the instructor: the current step (drives the dossier
// focus) plus a full HTML clone of the screen.
function snapshotLivePos() {
  const q = (sel) => document.querySelector(sel);
  const txt = (el) => (el && el.textContent ? el.textContent : '').trim();
  let stepN = 1;
  const activeStep = q('.pos-step:not([hidden])');
  if (activeStep) stepN = Number(activeStep.getAttribute('data-step')) || 1;
  const activeItem = q('.pos-stepper-item.active');
  const stepTitle =
    txt(q('#pos-topbar-title')) || (activeItem ? txt(activeItem.querySelector('.pos-stepper-label')) : '');
  // The width the POS actually rendered at on the trainee's screen, so the
  // instructor view can reproduce the exact layout (and scale to fit).
  const callEl = q('.call');
  const width = Math.round((callEl && callEl.getBoundingClientRect().width) || window.innerWidth || 1200);
  return { step: { n: stepN, title: stepTitle }, width, html: clonePosHtml() };
}

async function postLiveSnapshot() {
  if (!state.liveMode || !state.liveSession) return;
  try {
    await fetch('/api/live/state', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: snapshotLivePos() }),
    });
  } catch {
    // best-effort; the next heartbeat retries
  }
}

function startLiveEmit() {
  stopLiveEmit();
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      postLiveSnapshot();
    }, LIVE_EMIT_DEBOUNCE_MS);
  };
  // Any POS interaction (typing, selecting, stepper/nav clicks) schedules a push.
  document.addEventListener('input', schedule, true);
  document.addEventListener('change', schedule, true);
  document.addEventListener('click', schedule, true);
  // Heartbeat so the instructor view sees "live" and a moving updated_at even
  // while the trainee pauses to talk.
  const heartbeat = setInterval(postLiveSnapshot, LIVE_EMIT_HEARTBEAT_MS);
  state.liveEmit = {
    stop() {
      if (timer) clearTimeout(timer);
      clearInterval(heartbeat);
      document.removeEventListener('input', schedule, true);
      document.removeEventListener('change', schedule, true);
      document.removeEventListener('click', schedule, true);
    },
  };
  // Push the initial state right away.
  postLiveSnapshot();
}

function stopLiveEmit() {
  if (state.liveEmit && typeof state.liveEmit.stop === 'function') state.liveEmit.stop();
  state.liveEmit = null;
}

async function handleLiveEnd() {
  // Trainee ends their side: push one last snapshot, stop emitting, and show a
  // calm end card. The session row stays for the instructor's debrief; the
  // instructor controls the formal end.
  await postLiveSnapshot();
  stopLiveEmit();
  renderLiveEnded();
}

function renderLiveInactive(ended) {
  document.body.dataset.appState = 'ready';
  const msg = ended
    ? 'This practice session has ended. Ask your instructor to start a new one.'
    : 'This link is not active. It may have expired or been revoked. Please contact your instructor.';
  dom.root.innerHTML = `
    <section class="live-message">
      <div class="live-message-card">
        <h1>Practice session unavailable</h1>
        <p>${escapeHtml(msg)}</p>
      </div>
    </section>`;
}

function renderLiveEnded() {
  state.view = 'live_ended';
  document.body.dataset.view = 'live_ended';
  dom.root.innerHTML = `
    <section class="live-message">
      <div class="live-message-card">
        <h1>Session ended</h1>
        <p>Nice work. You can close this tab. Your instructor has the recap on their screen.</p>
      </div>
    </section>`;
}

async function init() {
  // Instructor Live Mode trainee entry (?live=1). Handled fully and returns;
  // otherwise this is a no-op and the normal boot below runs unchanged.
  if (await maybeBootLiveTrainee()) return;

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
      } else if (me.is_reel) {
        // Back-to-back demo reel: a sealed premium experience (intro splash ->
        // five auto-advancing voice calls -> a complete screen), NOT a recipient
        // card list. Kept OFF state.recipient so no recipient/demo code path is
        // touched; the reel drives everything through state.reel. Reuses the
        // demo's chrome-drop for a clean pitch surface.
        state.reel = {
          seq: REEL_SEQUENCE.slice(),
          index: 0,
          scenarios: Array.isArray(me.scenarios) ? me.scenarios : [],
        };
        document.body.dataset.demo = 'true';
        document.body.dataset.reel = 'true';
      } else {
        state.recipient = me;
        // The demo is a sealed pitch surface: drop the global app header chrome.
        if (me.is_demo) document.body.dataset.demo = 'true';
        // Coaching-test invite: a sealed single-scenario sub-page (auto-loads
        // one scenario, ends in the report). Treated like the demo for chrome.
        if (me.is_coaching) {
          state.coachingTest = true;
          document.body.dataset.coaching = 'true';
        }
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
  } else if (state.reel) {
    // Reel visitor: the intro splash, then five auto-advancing voice calls.
    setCallMode('phone');
    // Merge the five reel scenarios into personaById so startReelCall/renderCall
    // resolve them. The four library personas are already loaded via
    // /api/scenarios; this brings in demo_sales (which is in no scenario TYPE).
    for (const s of (state.reel.scenarios || [])) {
      if (!s || !s.id) continue;
      if (!state.personaById.has(s.id)) state.personaById.set(s.id, { ...s });
    }
    renderReelIntro();
  } else if (state.recipient) {
    // Invite recipient: their personal simulation page lists the scenarios the
    // admin assigned them. Same phone default. The pitch-demo recipient gets
    // the bespoke bright-editorial landing instead.
    setCallMode('phone');
    // startCall() resolves a persona from personaById. Normal recipients'
    // scenarios are already there (they're part of the library that
    // /api/scenarios builds), but the demo placeholders (demo_sales /
    // demo_service) live in no scenario TYPE, so they were never added — merge
    // the recipient's scenarios in so "Take the call" actually starts them.
    for (const s of (state.recipient.scenarios || [])) {
      if (!s || !s.id) continue;
      // Authored coaching agents (kind:'coaching_agent') aren't part of the
      // library; register them as persona-like objects so startCall/renderCall
      // can run them like coaching_practice.
      if (s.kind === 'coaching_agent') {
        state.personaById.set(s.id, coachingAgentToPersona(s));
      } else if (!state.personaById.has(s.id)) {
        state.personaById.set(s.id, { ...s });
      }
    }
    if (state.coachingTest) renderCoachingTest();
    else if (state.recipient.is_demo) renderDemoHome();
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

// ---- Back-to-back demo reel (state.reel only) ------------------------------
//
// Five real-time voice calls played back to back, auto-advancing, with no
// coaching report between them. Entered when /api/me/status reports is_reel
// (the reel share link). Everything below is inert unless state.reel is set.

// The premium intro splash: reuses the kiosk-splash aesthetic. Start begins the
// first call. Renders on reel entry and again on "Restart the reel".
function renderReelIntro() {
  state.view = 'reel_intro';
  document.body.dataset.view = 'home';
  state.activeScenario = null;
  setDocumentTitle('');
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  teardownAudio();
  if (state.reel) state.reel.index = 0;

  dom.root.innerHTML = `
    <section class="kiosk-splash reel-splash">
      <header class="kiosk-splash-header">
        <div class="kiosk-eyebrow">Live demo</div>
        <h1 class="kiosk-title">Five calls, back to back.</h1>
        <p class="kiosk-subtitle">Each one a different customer, on a real voice line. Answer, handle it, hang up: the next call is already ringing. No breaks, no scorecards, just five straight conversations.</p>
      </header>
      <div class="kiosk-disclaimer" role="note">
        <strong>These are voice calls.</strong> When prompted, please allow microphone access for this page so each customer can hear you.
      </div>
      <button class="primary-button kiosk-cta" id="reel-start" type="button">Take the first call <span aria-hidden="true">›</span></button>
    </section>
  `;

  const startBtn = document.getElementById('reel-start');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      state.reel.index = 0;
      startReelCall(state.reel.seq[0]);
    });
  }
}

// Launch one reel call: build the active scenario for this persona and go
// straight to the incoming-call ring (no pre-call modal - the reel is a
// continuous sequence). Answering runs renderCall exactly like the Robert demo,
// with the POS reset fresh and the header reflecting this caller.
function startReelCall(personaId) {
  const persona = state.personaById.get(personaId);
  if (!persona) {
    // A missing persona should never happen (all five are merged on reel entry),
    // but fail forward to the completion screen rather than a blank view.
    renderReelComplete();
    return;
  }
  const lines = Array.isArray(persona.opening_lines) && persona.opening_lines.length
    ? persona.opening_lines
    : [persona.opening_line || ''];
  const chosen = lines[Math.floor(Math.random() * lines.length)] || '';
  state.activeScenario = {
    ...persona,
    title: persona.type_title || persona.title || '',
    opening_line: chosen,
    blind: false,
    coachingMode: 'fresh',
    priorTranscript: [],
    participant: '',
    asRole: '',
  };
  // Render the live call shell as a blurred backdrop, then ring over it. Answer
  // -> renderCall live (fresh POS, fresh voice agent). A fresh renderCall is what
  // resets the reservation POS to step 1 for each new call.
  state.precallStash = null;
  renderCall(state.activeScenario, { preview: true });
  beginRinging(state.activeScenario);
}

// Called from End Call in reel mode instead of the coaching report. The current
// call's audio + voice agent are already torn down by teardownAudio(); step to
// the next call (a fresh ring) or, past the last one, the completion screen.
function advanceReel() {
  if (!state.reel) return;
  state.reel.index += 1;
  if (state.reel.index < state.reel.seq.length) {
    startReelCall(state.reel.seq[state.reel.index]);
  } else {
    renderReelComplete();
  }
}

// The premium "that's the reel" screen after call five. Restart replays from the
// first call.
function renderReelComplete() {
  state.view = 'reel_complete';
  document.body.dataset.view = 'home';
  state.activeScenario = null;
  setDocumentTitle('');
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  teardownAudio();

  dom.root.innerHTML = `
    <section class="kiosk-splash reel-splash">
      <header class="kiosk-splash-header">
        <div class="kiosk-eyebrow">Demo reel</div>
        <h1 class="kiosk-title">That's the reel.</h1>
        <p class="kiosk-subtitle">Five customers, five live conversations, one continuous take. Run it again whenever you're ready.</p>
      </header>
      <button class="primary-button kiosk-cta" id="reel-restart" type="button">Restart the reel <span aria-hidden="true">›</span></button>
    </section>
  `;

  const restartBtn = document.getElementById('reel-restart');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      state.reel.index = 0;
      startReelCall(state.reel.seq[0]);
    });
  }
}

// Invite recipient's personal simulation page. They land here from /me/<token>
// (D1-backed invite link). Lists the scenarios the admin assigned them, with
// the same card UI as the Sales picker, plus a greeting and mic disclaimer.
// Clicking a card launches the scenario directly (no per-card splash - the
// click itself is the user gesture the mic permission needs, and the
// disclaimer is right here on the page).
function renderRecipientHome() {
  state.view = 'recipient_home';
  document.body.dataset.view = 'home';
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

// ── "The Living Voice" cinematic shell ───────────────────────────────────────
// The shared chrome behind BOTH the pitch demo landing (renderDemoHome, two
// scenario lines) and the coaching-test page (renderCoachingTest, one centered
// entry): the WebGL orb field, the crossfading cinematic video backdrop, the
// First Call branding + splash→landing transition, the sealed footer with the
// "test your mic" button, and the mic-test modal. Keeping the markup + wiring in
// ONE place means the demo and the coaching page can never drift apart.
//
// renderLivingVoiceShell({ entriesHtml, linesLabel, entriesModifier }) returns
// the full <section> HTML string. The caller supplies only the contents of the
// .demo-lines block (the label + the <li> entries), so the demo can pass two
// entries and the coaching page can pass one centered entry — everything else
// (orb, video, hero, splash, footer, modal) is identical.
function renderLivingVoiceShell({ entriesHtml = '', linesLabel = '', entriesModifier = '' } = {}) {
  return `
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
            <span class="demo-tenet-reveal"><span class="demo-tenet-detail">Risk-free, fully controlled scenarios. Fumble the open, try the bold line, blow the close, never a real customer, never real trust on the line.</span></span>
          </button>
          <button class="demo-tenet" type="button" aria-expanded="false" style="--tenet-accent:#1b1f2a">
            <span class="demo-tenet-line">Fast enough to fix it.</span>
            <span class="demo-tenet-reveal"><span class="demo-tenet-detail">The moment you hang up, a scored, customizable coaching report is waiting, so the very next call is already sharper.</span></span>
          </button>
        </div>
      </div>
      <div class="demo-lines">
        ${linesLabel ? `<p class="demo-lines-label" aria-hidden="true">${escapeHtml(linesLabel)}</p>` : ''}
        <ul class="demo-entries${entriesModifier ? ` ${entriesModifier}` : ''}">${entriesHtml}</ul>
      </div>
      <footer class="demo-footer">
        <div class="demo-footer-inner">
          <div class="demo-footer-brandcol">
            <img class="demo-footer-logo" src="/assets/img/first-call-light.png" alt="First Call" width="600" height="265" />
          </div>
          <button type="button" class="demo-footer-mictest" id="demo-mic-test">Click <span class="demo-footer-mictest-here">HERE</span> to test your mic</button>
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
      <div class="mic-test" id="mic-test" data-open="false" data-state="" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Test your microphone">
        <div class="mic-test-backdrop" data-mic-close></div>
        <div class="mic-test-card" tabindex="-1">
          <button type="button" class="mic-test-close" id="mic-test-close" aria-label="Close">&times;</button>
          <div class="mic-test-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </div>
          <h2 class="mic-test-title">Test your microphone</h2>
          <p class="mic-test-sub">Say something out loud and watch the bar move. The scenarios use real voice, so make sure your mic is working before you start.</p>
          <div class="mic-test-meter" aria-hidden="true"><span class="mic-test-meter-fill" id="mic-test-fill"></span></div>
          <p class="mic-test-status" id="mic-test-status" role="status" aria-live="polite">Requesting microphone access&hellip;</p>
          <select class="mic-test-devices" id="mic-test-devices" aria-label="Microphone" hidden></select>
          <button type="button" class="primary-button mic-test-done" id="mic-test-done">Done</button>
        </div>
      </div>
    </section>
  `;
}

// Bring the Living Voice shell to life after its markup is in the DOM: orb
// progressive enhancement, crossfading video backdrop, splash→landing logo
// shatter, hero tenets, and the footer mic test. Called by BOTH renderDemoHome
// and renderCoachingTest so they behave identically. The per-entry click/keydown
// startCall wiring is left to each caller (their entries differ).
function wireLivingVoiceShell() {
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

  // Splash gate: the page opens behind a "First Call" splash over the playing
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
  }

  // Hero tenets: click/tap pins a tenet open (desktop also peeks on hover via
  // CSS). Independent toggles — the presenter can fan them all open.
  dom.root.querySelectorAll('.demo-tenet').forEach((t) => {
    t.addEventListener('click', () => {
      const open = t.getAttribute('aria-expanded') === 'true';
      t.setAttribute('aria-expanded', String(!open));
      t.classList.toggle('is-open', !open);
    });
  });

  // Footer mic / device test: lets the visitor confirm their microphone works
  // before starting a voice scenario.
  setupMicTest(dom.root);
}

// Coaching-test page (is_coaching invite). A sealed, minimal sub-page: it
// auto-loads the FIRST assigned scenario into a SINGLE centered "Living Voice"
// entry (the orb is the centerpiece, the entry is the one actionable element)
// and runs the normal call, which flows into the coaching report. It reuses the
// exact demo shell (renderLivingVoiceShell / wireLivingVoiceShell) so it looks
// and feels like the pitch landing — just one line instead of two. No scenario
// list, no library nav. The post-report "New call" path returns here (see
// renderReport). Mirrors renderRecipientHome's pre-amble (view/scenario reset,
// conversation cancel, teardownAudio, title) and reuses startCall(personaId).
// Map an authored coaching agent (kind:'coaching_agent', from /api/me/status)
// into a persona-like object so startCall/renderCall treat it like
// coaching_practice. Only the manager-facing fields are present (the prompt-only
// fields never leave the server). `coaching:true` routes it through the coaching
// voice stage (no POS, no ring).
function coachingAgentToPersona(s) {
  return {
    id: s.id,
    customer_name: s.name || '',
    coaching: true,
    kind: 'coaching_agent',
    title: s.role_title || 'Coaching Practice',
    tagline: '',
    scenario_name: s.scenario_name || '',
    age: s.age ?? null,
    role_title: s.role_title || '',
    demeanor: s.demeanor || '',
    incident: s.incident || '',
    image_id: s.image_id || '',
    accent_color: s.accent_color || '',
    modes: s.modes || { assessment: false, coaching: true, followup: false },
    opening_lines: Array.isArray(s.opening_lines) ? s.opening_lines : [],
    progress: s.progress || { call_count: 0, has_prior: false, modes_done: { assessment: false, coaching: false, followup: false } },
  };
}

// Initials avatar text from a name ("Taylor Brooks" -> "TB", "Taylor" -> "TA").
function coachingInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Manager coaching home (is_coaching invite). Handles ONE or MANY granted
// coaching agents (authored ca_ agents and/or the legacy coaching_practice).
//   - 0 agents  -> empty state.
//   - 1 agent   -> its profile card directly (with a mode picker).
//   - 2+ agents -> a list of agent cards; clicking one opens its profile card
//                  (with a back link). No library nav.
// The profile card shows an initials avatar, name/age/role, a demeanor line, the
// incident, the optional "Your name" field, and one button per ENABLED mode
// (Assessment / Coaching / Follow-up). Follow-up is disabled until a prior call
// has been saved for that agent. Each mode button calls
// startCall(agent.id, { mode, participant }). The post-call path returns here.
function renderCoachingTest(selectedId) {
  state.view = 'recipient_home';
  // Minimal coaching page: no demo shell/orb/splash/logo — a clean screen.
  delete document.body.dataset.demo;
  document.body.dataset.coaching = 'true';
  document.body.dataset.view = 'home';
  state.activeScenario = null;
  setDocumentTitle('Coaching Practice');
  if (state.conversation) {
    state.conversation.cancel();
    state.conversation = null;
  }
  teardownAudio();

  const r = state.recipient || {};
  const all = Array.isArray(r.scenarios) ? r.scenarios : [];
  // The coaching agents granted to this recipient: authored agents (kind ===
  // 'coaching_agent') PLUS the legacy single coaching_practice if assigned.
  const agents = all.filter((s) => s && (s.kind === 'coaching_agent' || s.id === 'coaching_practice'));

  // A chosen scenario drills into the focused profile + mode picker (with a back
  // link to the landing). With no selection we show the elevated landing — even
  // for a single scenario, so the splash + content always front the experience.
  const sel = typeof selectedId === 'string' ? selectedId : '';
  const selected = sel ? agents.find((a) => a.id === sel) || null : null;
  if (selected) {
    renderCoachingProfile(selected, { multi: true });
    return;
  }

  // Scenario PREVIEW (a builder testing via the Test button): show the single
  // scenario card directly, NOT the cohort course dashboard. The preview invite
  // carries exactly one authored scenario.
  const isPreview = !!(state.recipient && state.recipient.coaching_preview);
  if (isPreview) {
    const previewAgent = agents.find((a) => a && a.kind === 'coaching_agent') || agents[0];
    if (previewAgent) { renderCoachingProfile(previewAgent, { multi: false }); return; }
  }

  // Top-level coaching home. Cohort managers with an assigned AUTHORED agent (ca_)
  // get the Development by Design course DASHBOARD; everyone else (legacy
  // coaching_practice, empty state) keeps the existing landing. We fetch
  // /api/coaching/dashboard: a non-null `agent` ⇒ dashboard; else ⇒ legacy.
  // Paint a NEUTRAL loading state (not the legacy landing, which would flash for
  // a beat before the dashboard resolves), then fetch. fetchCoachingDashboard
  // paints the course dashboard, or falls back to the legacy landing only if this
  // manager has no authored agent.
  renderCoachingLoading();
  fetchCoachingDashboard(agents);
}

function renderCoachingLoading() {
  dom.root.innerHTML =
    '<div class="coaching-loading" style="min-height:60vh;display:flex;align-items:center;justify-content:center;color:#7e7764;font-family:var(--font-mono,monospace);font-size:13px;letter-spacing:0.02em;">Loading…</div>';
}

// Fetch /api/coaching/dashboard and, if this manager has an authored agent,
// swap the legacy landing for the course dashboard. Guarded by a render token
// so a stale fetch (e.g. user navigated away) can't clobber a newer view.
async function fetchCoachingDashboard(agents) {
  const token = (state.coachingDashToken = (state.coachingDashToken || 0) + 1);
  let data = null;
  try {
    const res = await fetch('/api/coaching/dashboard', { credentials: 'same-origin' });
    if (res.ok) data = await res.json();
  } catch {
    data = null;
  }
  // A newer render started while we were fetching — abandon this result.
  if (token !== state.coachingDashToken) return;
  // No authored agent (or the call failed): fall back to the legacy landing now
  // (painted here, after the fetch — never optimistically — so dashboard users
  // never see it flash).
  if (!data || !data.active || !data.agent) {
    renderCoachingLanding(Array.isArray(agents) ? agents : []);
    return;
  }
  renderCoachingDashboard(data);
}

// The elevated coaching landing: an admin-authored splash (hero) + free-form
// content sections, with the assigned scenarios as cards beneath. Hero/sections
// come from /api/me/status (state.recipient.coaching_landing); sensible defaults
// render when the admin hasn't authored anything yet. Handles 0 / 1 / many.
// Curated font stacks for landing blocks (keys are validated server-side; the
// families are loaded via the Google Fonts link in app.html). '' = inherit.
const COACHING_FONT_STACKS = {
  default: '',
  sans: "'Inter', system-ui, sans-serif",
  serif: "'Playfair Display', Georgia, serif",
  geometric: "'Poppins', system-ui, sans-serif",
  modern: "'Space Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};
function coachingFontStack(key) { return COACHING_FONT_STACKS[key] || ''; }

// All color/font/image values below come from server-validated content (hex
// colors, whitelisted font keys, id-shaped image refs), so they're safe to drop
// into inline styles (CSP allows 'unsafe-inline' styles).
function imgUrl(id) { return `/coaching-image/${encodeURIComponent(id)}`; }

function renderLandingBlock(s) {
  if (!s || typeof s !== 'object') return '';
  const type = s.type || 'text';
  const heading = typeof s.heading === 'string' ? s.heading : '';
  const body = typeof s.body === 'string' ? s.body : '';
  const imgId = s.imageId || '';
  const fontStack = coachingFontStack(s.font);
  const textColor = s.textColor || '';
  const bgColor = s.bgColor || '';
  const colorStyle = textColor ? ` style="color:${textColor}"` : '';

  const textInner = `
    ${heading ? `<h2 class="coaching-landing-section-h"${colorStyle}>${escapeHtml(heading)}</h2>` : ''}
    ${body ? `<div class="coaching-landing-section-body"${colorStyle}>${paragraphsHtml(body)}</div>` : ''}`;

  if (type === 'image_overlay' && imgId) {
    const overlay = (Math.max(0, Math.min(100, Number(s.overlay) || 0)) / 100);
    const tint = bgColor || '#000000';
    const wrap = [`background-image:url('${imgUrl(imgId)}')`];
    if (fontStack) wrap.push(`font-family:${fontStack}`);
    const inner = textColor ? ` style="color:${textColor}"` : ' style="color:#fff"';
    return `
      <section class="coaching-landing-block coaching-block-overlay" style="${wrap.join(';')}">
        <span class="coaching-block-tint" style="background:${tint};opacity:${overlay}"></span>
        <div class="coaching-block-overlay-inner"${inner}>
          ${heading ? `<h2 class="coaching-block-overlay-h">${escapeHtml(heading)}</h2>` : ''}
          ${body ? `<div class="coaching-block-overlay-body">${paragraphsHtml(body)}</div>` : ''}
        </div>
      </section>`;
  }

  if (type === 'image_split' && imgId) {
    const sideClass = s.imageSide === 'right' ? 'is-right' : 'is-left';
    const wrap = [];
    if (fontStack) wrap.push(`font-family:${fontStack}`);
    if (bgColor) wrap.push(`background:${bgColor}`);
    return `
      <section class="coaching-landing-block coaching-block-split ${sideClass}"${wrap.length ? ` style="${wrap.join(';')}"` : ''}>
        <div class="coaching-block-split-img" style="background-image:url('${imgUrl(imgId)}')"></div>
        <div class="coaching-block-split-text">${textInner}</div>
      </section>`;
  }

  // Plain text block.
  if (!heading && !body) return '';
  const wrap = [];
  if (fontStack) wrap.push(`font-family:${fontStack}`);
  if (bgColor) wrap.push(`background:${bgColor}`);
  return `
    <section class="coaching-landing-section${bgColor ? ' has-bg' : ''}"${wrap.length ? ` style="${wrap.join(';')}"` : ''}>
      ${textInner}
    </section>`;
}

function renderCoachingLanding(agents) {
  const landing = (state.recipient && state.recipient.coaching_landing) || null;
  // Hero + content blocks come from the shared renderer (single source of truth
  // with the admin live preview). A hero background image makes the whole landing
  // top edge-to-edge (full width), so flag the wrapper.
  const hasHeroImg = !!(landing && landing.hero && landing.hero.imageId);
  const contentHtml = renderLandingContentHtml(landing);

  const cardsHtml = agents.map((a) => {
    const isLegacy = a.id === 'coaching_practice';
    const name = isLegacy ? (a.customer_name || a.title || 'Coaching Practice') : (a.name || 'Coaching agent');
    const role = isLegacy ? (a.title || '') : (a.role_title || '');
    const scenarioName = isLegacy ? '' : (a.scenario_name || '');
    const cc = Number(a.progress?.call_count) || 0;
    const status = cc > 0 ? `${cc} call${cc === 1 ? '' : 's'} taken` : 'Not started';
    const imgId = (!isLegacy && a.image_id) ? a.image_id : '';
    const accent = (!isLegacy && a.accent_color) ? a.accent_color : '';
    const sty = [];
    if (accent) sty.push(`--accent:${accent}`);
    if (imgId) sty.push(`background-image:linear-gradient(180deg, rgba(15,15,20,0.10), rgba(15,15,20,0.66)), url('/coaching-image/${encodeURIComponent(imgId)}')`);
    const styAttr = sty.length ? ` style="${sty.join(';')}"` : '';
    return `
      <li class="coaching-scn-card${imgId ? ' has-image' : ''}" data-agent-id="${escapeAttr(a.id)}" tabindex="0" role="button" aria-label="Open ${escapeAttr(name)}"${styAttr}>
        ${imgId ? '' : `<span class="coaching-scn-avatar" aria-hidden="true">${escapeHtml(coachingInitials(name))}</span>`}
        <span class="coaching-scn-meta">
          ${scenarioName ? `<span class="coaching-scn-eyebrow">${escapeHtml(scenarioName)}</span>` : ''}
          <span class="coaching-scn-name">${escapeHtml(name)}</span>
          ${role ? `<span class="coaching-scn-role">${escapeHtml(role)}</span>` : ''}
          <span class="coaching-scn-status">${escapeHtml(status)}</span>
        </span>
        <span class="coaching-scn-arrow" aria-hidden="true">&rsaquo;</span>
      </li>`;
  }).join('');

  const scenariosBlock = agents.length
    ? `<div class="coaching-landing-scenarios">
         <h2 class="coaching-landing-section-h">${agents.length > 1 ? 'Your scenarios' : 'Your scenario'}</h2>
         <ul class="coaching-scn-list">${cardsHtml}</ul>
       </div>`
    : `<div class="coaching-landing-scenarios"><p class="coaching-landing-section-body">No scenarios assigned yet. Please contact whoever sent you this link.</p></div>`;

  dom.root.innerHTML = `
    <div class="coaching-landing${hasHeroImg ? ' has-hero-image' : ''}">
      ${contentHtml}
      ${scenariosBlock}
    </div>
  `;

  dom.root.querySelectorAll('.coaching-scn-card').forEach((card) => {
    const go = () => renderCoachingTest(card.dataset.agentId);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
}

// Split admin-authored body text into escaped paragraphs (blank line = new
// paragraph; single newlines become <br>). Safe: all text is HTML-escaped.
function paragraphsHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Render one agent's profile card with the mode picker. `multi` adds a back link
// to the agent list.
function renderCoachingProfile(agent, { multi = false } = {}) {
  const legacy = agent.id === 'coaching_practice';
  const name = legacy ? (agent.customer_name || agent.title || 'Coaching Practice') : (agent.name || 'Coaching agent');
  const role = legacy ? (agent.title || '') : (agent.role_title || '');
  const age = agent.age ?? null;
  const demeanor = legacy ? '' : (agent.demeanor || '');
  const incident = legacy ? '' : (agent.incident || '');
  // The optional admin-chosen scenario label (authored ca_ scenarios only).
  const scenarioName = legacy ? '' : (agent.scenario_name || '');
  // Prior-call gate. Authored scenarios use server-side per-manager progress
  // (survives browser/device); legacy coaching_practice keeps its localStorage
  // memory.
  const callCount = legacy ? 0 : Number(agent.progress?.call_count) || 0;
  const hasPrior = legacy ? hasSavedCoaching(agent.id) : !!agent.progress?.has_prior;
  const savedName = loadCoachingParticipant();

  // The mode buttons to render. Legacy coaching_practice keeps its 'fresh' +
  // 'followup' pair; authored agents render one button per ENABLED mode
  // (assessment / coaching / followup). Follow-up always renders so it can carry
  // the "available after a call" hint, but is disabled until a prior call exists.
  const m = agent.modes || {};
  // Per-mode completion (server-side, per manager). Authored scenarios unlock in
  // order: each mode is available only once every earlier ENABLED mode has a
  // completed call. Legacy coaching_practice keeps its original simpler rule.
  const modesDone = agent.progress?.modes_done || {};
  // Admin preview link: every mode is directly launchable (no gating) and the
  // call isn't saved — for testing a scenario while building it.
  const preview = !!(state.recipient && state.recipient.coaching_preview);
  const accent = (!legacy && agent.accent_color) ? agent.accent_color : '';
  const imgId = (!legacy && agent.image_id) ? agent.image_id : '';
  const modeDefs = legacy
    ? [
        { mode: 'fresh', label: 'Start fresh call' },
        { mode: 'followup', label: 'Follow-up' },
      ]
    : [
        ...(m.assessment ? [{ mode: 'assessment', label: 'Assessment' }] : []),
        ...(m.coaching ? [{ mode: 'coaching', label: 'Coaching' }] : []),
        ...(m.followup ? [{ mode: 'followup', label: 'Follow-up' }] : []),
      ];

  const backHtml = multi ? '<button class="ghost-button coaching-back" type="button"><span aria-hidden="true">‹</span> Back</button>' : '';
  const nameFieldHtml = `
    <label class="coaching-test-name">
      <span class="coaching-test-name-label">Your name</span>
      <input class="coaching-test-name-input" id="coaching-name" type="text" autocomplete="name"
        placeholder="So this session can be reviewed later" value="${escapeAttr(savedName)}" maxlength="60">
    </label>`;

  if (legacy) {
    // Legacy coaching_practice keeps the simple button list.
    const buttonsHtml = modeDefs.map((def) => {
      const isFollow = def.mode === 'followup';
      const cls = isFollow ? 'ghost-button' : 'primary-button';
      const locked = isFollow ? !hasPrior : false;
      const hint = (isFollow && !hasPrior)
        ? `<span class="coaching-opt-hint">Available after you finish a call. Then ${escapeHtml(name)} will remember it.</span>`
        : '';
      return `<button class="${cls} coaching-test-mode" data-mode="${escapeAttr(def.mode)}" data-persona-id="${escapeAttr(agent.id)}" type="button"${locked ? ' disabled' : ''}>
          <span class="coaching-opt-label">${escapeHtml(def.label)}</span>${hint}
        </button>`;
    }).join('');
    dom.root.innerHTML = `
      <section class="coaching-test">
        <div class="coaching-test-card">
          ${backHtml}
          <div class="coaching-profile">
            <span class="coaching-agent-avatar coaching-agent-avatar-lg" aria-hidden="true">${escapeHtml(coachingInitials(name))}</span>
            <h1 class="coaching-test-title">${escapeHtml(name)}</h1>
            <p class="coaching-profile-sub">${escapeHtml([role, age ? `age ${age}` : ''].filter(Boolean).join(' · '))}</p>
            ${callCount > 0 ? `<p class="coaching-profile-progress">You've taken ${callCount} call${callCount === 1 ? '' : 's'} in this scenario.</p>` : ''}
          </div>
          ${nameFieldHtml}
          <div class="coaching-test-options">${buttonsHtml}</div>
        </div>
      </section>
    `;
  } else {
    // Authored scenario → the "growth" scenario card (Bobbie's Dashboard assets).
    const unlockedStage = Number(agent.progress?.unlocked_stage) || 1;
    const accentVar = accent ? `--scn-accent:${accent}` : '';
    const IMG = '/assets/img/coaching';
    // Button icon: the original leaf art (1 leaf assessment, 2 leaves coaching)
    // and the calendar for follow-up. On the amber follow-up button the icon +
    // arrow are forced black via CSS to match the black text.
    const iconFor = (mode) => mode === 'followup' ? `${IMG}/icon-calendar.png`
      : mode === 'coaching' ? `${IMG}/leaf-2.png`
      : `${IMG}/leaf-1.png`;

    // One action per ENABLED mode. assessment=green (1 leaf), coaching=orange
    // (2 leaves), follow-up=amber; a call that isn't available yet renders as a
    // muted locked tile with the calendar icon.
    const actionsHtml = modeDefs.map((def, i) => {
      const prevAllDone = preview ? true : modeDefs.slice(0, i).every((d) => modesDone[d.mode]);
      const adminAllowed = preview ? true : i < unlockedStage;
      const available = prevAllDone && adminAllowed;
      const done = !preview && !!modesDone[def.mode];
      const tone = def.mode === 'assessment' ? 'green' : def.mode === 'coaching' ? 'orange' : 'amber';
      if (!available) {
        const why = !prevAllDone ? 'Available after you finish a call.' : 'Your coach will open this.';
        return `
          <div class="scn-action scn-action-locked">
            <img class="scn-action-icon" src="${IMG}/icon-calendar.png" alt="" aria-hidden="true">
            <span class="scn-action-body">
              <span class="scn-action-label">${escapeHtml(def.label)}</span>
              <span class="scn-action-hint">${why}</span>
            </span>
          </div>`;
      }
      const label = preview ? `Test ${def.label}` : done ? `${def.label} &middot; retake` : def.label;
      return `
        <button type="button" class="scn-action scn-action-${tone} coaching-test-mode" data-mode="${escapeAttr(def.mode)}" data-persona-id="${escapeAttr(agent.id)}">
          <img class="scn-action-icon" src="${iconFor(def.mode)}" alt="" aria-hidden="true">
          <span class="scn-action-label">${label}</span>
          <img class="scn-action-arrow" src="${IMG}/icon-arrow.png" alt="" aria-hidden="true">
        </button>`;
    }).join('');

    const rowHtml = (iconFile, label, text) => `
      <div class="scn-row">
        <img class="scn-row-icon" src="${IMG}/${iconFile}" alt="" aria-hidden="true">
        <div class="scn-row-body">
          <span class="scn-row-label">${escapeHtml(label)}</span>
          <p class="scn-row-text">${escapeHtml(text)}</p>
        </div>
      </div>`;

    // Preview affordances: a "test as" role toggle (defaults to the role the
    // scenario opens up to) + a "start fresh test" reset, mirroring the dashboard.
    const previewRole = agent.receptive_to === 'senior_agent' ? 'Senior Agent' : 'Manager';
    const asRoleOpts = ['Manager', 'Senior Agent']
      .map((r) => `<option value="${r}"${r === previewRole ? ' selected' : ''}>${r}</option>`).join('');

    dom.root.innerHTML = `
      <section class="scn-page"${accentVar ? ` style="${accentVar}"` : ''}>
        ${backHtml}
        ${preview ? `
          <div class="scn-preview">
            <span class="scn-preview-text">Preview: testing this scenario. Calls remember each other so you can check the agent's memory. Nothing here is saved for real participants.</span>
            <label class="scn-preview-role">Test as
              <select class="coaching-preview-asrole">${asRoleOpts}</select>
            </label>
            <button type="button" class="ghost-button coaching-preview-reset">Start fresh test</button>
          </div>` : ''}
        <div class="scn-bg" aria-hidden="true"></div>
        <div class="scn-quote"><svg class="scn-quote-ico" viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="5" width="38" height="30" rx="9" fill="currentColor"/><path d="M14 32 L14 44 L26 33 Z" fill="currentColor"/><path d="M15 14 h8 v7 c0 4 -2.5 6.5 -6.2 7.6 l-1.3 -2.6 c2.1 -0.7 3.3 -1.8 3.5 -3.2 H15 Z" fill="#fcf9f3"/><path d="M25 14 h8 v7 c0 4 -2.5 6.5 -6.2 7.6 l-1.3 -2.6 c2.1 -0.7 3.3 -1.8 3.5 -3.2 H25 Z" fill="#fcf9f3"/></svg><p>Great managers grow people,<br>not just performance.</p></div>
        <div class="scn-card">
          <span class="scn-avatar">${escapeHtml(coachingInitials(name))}</span>
          <p class="scn-eyebrow">${escapeHtml(scenarioName || 'Scenario')}</p>
          <h1 class="scn-name">${escapeHtml(name)}</h1>
          <p class="scn-sub">${escapeHtml([role, age ? `Age ${age}` : ''].filter(Boolean).join('  •  '))}</p>
          ${callCount > 0 && !preview ? `<p class="scn-progress">${callCount} call${callCount === 1 ? '' : 's'} taken</p>` : ''}
          ${demeanor ? rowHtml('icon-profile.png', 'Typical performance & demeanor', demeanor) : ''}
          ${(demeanor && incident) ? '<div class="scn-divider"></div>' : ''}
          ${incident ? rowHtml('icon-help.png', 'What happened', incident) : ''}
          ${nameFieldHtml}
          <div class="scn-actions">${actionsHtml}</div>
        </div>
      </section>
    `;
  }

  const nameInput = dom.root.querySelector('#coaching-name');
  dom.root.querySelectorAll('.coaching-test-mode').forEach((btn) => {
    const go = () => {
      if (btn.disabled) return;
      const participant = nameInput ? nameInput.value.trim() : '';
      saveCoachingParticipant(participant);
      // In preview, the "Test as" toggle lets the builder spoof their role to
      // exercise role-gated scenarios. Honored server-side only for preview links.
      const asRole = (state.recipient && state.recipient.coaching_preview)
        ? (dom.root.querySelector('.coaching-preview-asrole')?.value || '')
        : '';
      startCall(btn.dataset.personaId, { mode: btn.dataset.mode, participant, asRole });
    };
    btn.addEventListener('click', go);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  const back = dom.root.querySelector('.coaching-back');
  if (back) back.addEventListener('click', () => renderCoachingTest());
  // Preview: wipe this preview invite's memory/recordings and repaint the card.
  const resetBtn = dom.root.querySelector('.coaching-preview-reset');
  if (resetBtn) resetBtn.addEventListener('click', async () => {
    if (!confirm('Clear this test\'s memory and recordings and start over? Only this preview is affected.')) return;
    resetBtn.disabled = true;
    resetBtn.textContent = 'Resetting...';
    try { await fetch('/api/coaching/preview-reset', { method: 'POST', credentials: 'same-origin' }); } catch {}
    await refreshRecipientStatus();
    renderCoachingTest();
  });
}

// ---- Coaching DASHBOARD (the 3-week / 8-section manager course view) -------
// Rendered for managers with an assigned AUTHORED agent (ca_). Consumes
// GET /api/coaching/dashboard (see fetchCoachingDashboard). Layout, top→bottom:
//   1. Agent profile card (always visible)
//   2. Week progress strip (current unlocked stage highlighted)
//   3. Sections grouped by week — locked cards stay visible but inert; unlocked
//      cards render by type (incident / form / call / activities)
//   4. Export Development Plan (PDF) via a print-only DOM + @media print.
// A section is UNLOCKED when data.stage >= section.stage.

// An initials avatar for the dashboard profile when no photo is set. Mirrors the
// existing .coaching-agent-avatar look used elsewhere.
function dashAvatarHtml(agent) {
  const photo = agent.photo || '';
  if (photo) {
    // `photo` is an admin-supplied data URL or asset URL (stored verbatim).
    return `<img class="dash-profile-photo" src="${escapeAttr(photo)}" alt="${escapeAttr(agent.name || 'Agent')}">`;
  }
  return `<span class="dash-profile-photo dash-profile-initials" aria-hidden="true">${escapeHtml(coachingInitials(agent.name))}</span>`;
}

function renderCoachingDashboard(data) {
  const agent = data.agent || {};
  // Preview mode (a scenario author testing without a cohort): unlock every week
  // so they can exercise the whole journey, and nothing is persisted.
  const isPreview = !!(state.recipient && state.recipient.coaching_preview);
  const stage = isPreview ? Number.MAX_SAFE_INTEGER : (Number(data.stage) || 1);
  // Preview "test as" role: default the toggle to the role the scenario is
  // receptive to (so the open/matching path shows first), else Manager.
  const previewExpectRole = (() => {
    const sc = ((state.recipient && state.recipient.scenarios) || []).find((s) => s && s.id === agent.id);
    return sc && sc.receptive_to === 'senior_agent' ? 'Senior Agent' : 'Manager';
  })();
  const asRoleOptionsHtml = ['Manager', 'Senior Agent']
    .map((r) => `<option value="${r}"${r === previewExpectRole ? ' selected' : ''}>${r}</option>`)
    .join('');
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const fields = Array.isArray(data.fields) ? data.fields : [];
  const answers = (data && typeof data.answers === 'object' && data.answers) || {};
  const calls = (data && typeof data.calls === 'object' && data.calls) || {};
  const savedName = loadCoachingParticipant();
  const blocks = (data && typeof data.blocks === 'object' && data.blocks) || {};
  const practicumPhases = Array.isArray(data.practicum_phases) ? data.practicum_phases : [];

  // ---- 1. Agent profile card ----
  const rows = [
    ['Name', agent.name || ''],
    ['Age', agent.age != null && agent.age !== '' ? String(agent.age) : ''],
    ['Position', agent.role_title || ''],
    ['Personality', agent.personality || ''],
  ].filter(([, v]) => v !== '');
  const profileHtml = `
    <div class="dash-profile">
      <div class="dash-profile-media">${dashAvatarHtml(agent)}</div>
      <div class="dash-profile-body">
        ${agent.scenario_name ? `<p class="dash-profile-eyebrow">${escapeHtml(agent.scenario_name)}</p>` : ''}
        <dl class="dash-profile-rows">
          ${rows.map(([label, val]) => `
            <div class="dash-profile-row">
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(val)}</dd>
            </div>`).join('')}
        </dl>
        ${agent.incident ? `
          <div class="dash-profile-incident">
            <p class="dash-profile-incident-h">A recent incident</p>
            ${paragraphsHtml(agent.incident)}
            ${agent.incident_image ? `<img class="dash-incident-img" src="${escapeAttr(agent.incident_image)}" alt="">` : ''}
          </div>` : ''}
      </div>
    </div>`;

  // ---- 2. Week progress strip ----
  // The highest unlocked week = the week of the highest-stage unlocked section.
  let unlockedWeek = 1;
  for (const s of sections) {
    if (stage >= Number(s.stage) && Number(s.week) > unlockedWeek) unlockedWeek = Number(s.week);
  }
  // Friendly heading per week + the Final group (mirrors WEEK_TITLES in
  // shared/coaching-dashboard.js; app.js can't import the server module).
  const WEEK_LABELS = {
    1: 'Week 1 · Define Success',
    2: 'Week 2 · Assess Capability',
    3: 'Week 3 · Design the Plan',
    4: 'Week 4 · Prepare & Conduct the Conversation',
    5: 'Week 5 · Follow Up & Reinforce',
    6: 'Real World Practicum',
  };
  const stripWeeks = [1, 2, 3, 4, 5];
  const stripHtml = `
    <div class="dash-strip" role="list">
      ${stripWeeks.map((w) => `
        <span class="dash-strip-week${w <= unlockedWeek ? ' is-on' : ' is-dim'}" role="listitem">Week ${w}</span>`).join('<span class="dash-strip-sep" aria-hidden="true">·</span>')}
      <span class="dash-strip-sep" aria-hidden="true">·</span>
      <span class="dash-strip-week${unlockedWeek >= 6 ? ' is-on' : ' is-dim'}" role="listitem">Practicum</span>
    </div>`;

  // ---- 3. Sections grouped by week (weeks 1-5, then the Final assignment) ----
  const sectionHtml = (section) => {
    const unlocked = stage >= Number(section.stage);
    const titleText = section.part ? `Part ${section.part}: ${section.title || ''}` : (section.title || '');
    if (!unlocked) {
      const where = Number(section.week) >= 6 ? 'the Practicum' : `Week ${escapeHtml(String(section.week))}`;
      return `
        <div class="dash-section is-locked">
          <div class="dash-section-head">
            <h3 class="dash-section-title">${escapeHtml(titleText)}</h3>
            <span class="dash-lock-chip">🔒 Unlocks in ${where}</span>
          </div>
        </div>`;
    }
    return `
      <div class="dash-section" data-section-key="${escapeAttr(section.section_key || section.key || '')}">
        <div class="dash-section-head">
          <h3 class="dash-section-title">${escapeHtml(titleText)}</h3>
        </div>
        <div class="dash-section-body">${dashSectionBody(section, { agent, fields, answers, calls, savedName, blocks, practicumPhases })}</div>
      </div>`;
  };

  const weekGroupsHtml = [1, 2, 3, 4, 5, 6].map((w) => {
    const inWeek = sections.filter((s) => Number(s.week) === w);
    if (!inWeek.length) return '';
    const isFinal = w === 6;
    return `
      <section class="dash-week-group${isFinal ? ' dash-week-final' : ''}">
        <h2 class="dash-week">${escapeHtml(WEEK_LABELS[w] || ('Week ' + w))}</h2>
        ${isFinal ? '<p class="dash-week-intro">Apply the Development by Design process with one of your own team members.</p>' : ''}
        ${inWeek.map(sectionHtml).join('')}
      </section>`;
  }).join('');

  // ---- 4. Export button (acts on the live form fields) ----
  const exportHtml = `
    <div class="dash-export">
      <button class="primary-button dash-export-btn" type="button">Export Workbook (PDF)</button>
    </div>`;

  // ---- Syllabus (Pre-Week 1): admin-authored, read-only, collapsed by default.
  const syl = (data.syllabus && typeof data.syllabus === 'object') ? data.syllabus : null;
  const sylSections = syl && Array.isArray(syl.sections) ? syl.sections : [];
  const syllabusHtml = (syl && (syl.title || sylSections.length)) ? `
    <details class="dash-syllabus">
      <summary class="dash-syllabus-summary">
        <span class="dash-syllabus-label">${escapeHtml(syl.title || 'Program Syllabus')}</span>
        <span class="dash-syllabus-hint">View</span>
      </summary>
      <div class="dash-syllabus-body">
        ${sylSections.map((s) => `
          <section class="dash-syllabus-section">
            ${s.heading ? `<h3 class="dash-syllabus-h">${escapeHtml(s.heading)}</h3>` : ''}
            ${s.body ? paragraphsHtml(s.body) : ''}
          </section>`).join('')}
      </div>
    </details>` : '';

  // Program welcome (top of the dashboard): editable intro + the fixed 5-step
  // process list. Hidden when the admin clears the welcome copy.
  const welcomeIntro = (blocks.welcome && blocks.welcome.intro) || '';
  const WELCOME_STEPS = ['Define Success', 'Assess Capability', 'Design the Plan', 'Execute the Plan', 'Follow Up & Reinforce'];
  const welcomeHtml = welcomeIntro
    ? `<section class="dash-welcome" style="background:var(--scn-card,#fcf9f3);border:1px solid var(--scn-tan,#e2cca8);border-radius:16px;box-shadow:0 14px 36px rgba(60,45,20,0.1);padding:20px;">
        <p class="dash-narrative-h">Welcome</p>
        <div class="dash-narrative">${paragraphsHtml(welcomeIntro)}</div>
        <ol class="dash-phases">${WELCOME_STEPS.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      </section>`
    : '';

  dom.root.innerHTML = `
    <div class="coaching-dash">
      ${isPreview ? `
        <div class="coaching-preview-banner">
          <span class="coaching-preview-banner-text">Preview: testing this scenario. Every week is unlocked, and calls in this test remember each other so you can check the agent's memory. This sandbox is private to this scenario and is never seen by real participants.</span>
          <label class="coaching-preview-asrole-label">Test as
            <select class="coaching-preview-asrole">${asRoleOptionsHtml}</select>
          </label>
          <button type="button" class="coaching-preview-reset ghost-button">Start fresh test</button>
        </div>` : ''}
      ${syllabusHtml}
      ${welcomeHtml}
      ${profileHtml}
      ${stripHtml}
      ${weekGroupsHtml}
      ${exportHtml}
    </div>
  `;

  // The print container must be a DIRECT child of <body> so the @media print
  // rule (body.printing > *:not(#coaching-print)) can hide the rest of the page.
  let printHost = document.getElementById('coaching-print');
  if (!printHost) {
    printHost = document.createElement('div');
    printHost.id = 'coaching-print';
    printHost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(printHost);
  }

  wireCoachingDashboard(data);
}

// Render one UNLOCKED section's interactive body: its editable narrative blocks
// (Story / Assignment / Info / Leadership / Final Prompt / Completion) plus its
// questions (textarea / checklist / yes-no), keyed off ctx.blocks + ctx.fields.
function dashSectionBody(section, ctx) {
  const type = section.type;
  // Call sections key blocks off `key` (they have no section_key); form/info use
  // section_key (which equals key). Fall back so the call's story block resolves.
  const blocks = (ctx.blocks && ctx.blocks[section.section_key || section.key]) || {};

  // --- Call section: story (prep-complete note) then the call UI ---
  if (type === 'call') {
    const mode = section.mode;
    const call = (ctx.calls && ctx.calls[mode]) || {};
    const storyHtml = blocks.story ? `<div class="dash-narrative">${paragraphsHtml(blocks.story)}</div>` : '';
    if (call.completed) {
      const takenBy = call.taken_by || '';
      return `${storyHtml}
        <div class="dash-call dash-call-done" data-mode="${escapeAttr(mode)}">
          <p class="dash-call-label">Recording</p>
          <audio class="dash-rec-audio" controls preload="none" src="/api/coaching/recording?mode=${encodeURIComponent(mode)}"></audio>
          <p class="dash-rec-err" hidden>Recording is still processing. Check back in a minute. <button type="button" class="ghost-button dash-rec-retry">Retry</button></p>
          <div class="dash-call-foot">
            <a class="ghost-button dash-rec-download" href="/api/coaching/recording?mode=${encodeURIComponent(mode)}&download=1">Download recording</a>
            ${takenBy ? `<span class="dash-call-takenby">Taken by: ${escapeHtml(takenBy)}</span>` : ''}
          </div>
        </div>`;
    }
    return `${storyHtml}
      <div class="dash-call" data-mode="${escapeAttr(mode)}">
        <label class="dash-call-name">
          <span class="dash-call-name-label">Who is taking this call?</span>
          <input class="dash-call-name-input" type="text" autocomplete="name" maxlength="60"
            placeholder="So this session can be reviewed later" value="${escapeAttr(ctx.savedName)}">
        </label>
        <button class="primary-button dash-call-btn" type="button" data-mode="${escapeAttr(mode)}">Start the conversation</button>
      </div>`;
  }

  // --- Info section (Real World Practicum): documented phases + final reflection ---
  if (type === 'info') {
    const story = blocks.practicum_story || blocks.story || '';
    const phases = Array.isArray(ctx.practicumPhases) ? ctx.practicumPhases : [];
    const phasesHtml = phases.length
      ? `<ol class="dash-phases">${phases.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ol>`
      : '';
    const q = dashQuestionsHtml(section, ctx, false);
    return `
      ${story ? `<div class="dash-narrative">${paragraphsHtml(story)}</div>` : ''}
      ${phasesHtml}
      ${q ? `<div class="dash-practicum-reflect"><p class="dash-narrative-h">Final reflection</p>${q}</div>` : ''}`;
  }

  // --- Form section: story + assignment + info + questions + leadership + prompt ---
  if (type === 'form') {
    const parts = [];
    if (blocks.story) parts.push(`<div class="dash-narrative">${paragraphsHtml(blocks.story)}</div>`);
    if (blocks.assignment) parts.push(`<div class="dash-assignment"><p class="dash-narrative-h">Your assignment</p>${paragraphsHtml(blocks.assignment)}</div>`);
    if (blocks.info) parts.push(`<div class="dash-info">${paragraphsHtml(blocks.info)}</div>`);

    const main = dashQuestionsHtml(section, ctx, false);
    if (main) parts.push(main);

    // Leadership Reflection: its intro block + the leadership-group questions.
    const lead = dashQuestionsHtml(section, ctx, true);
    if (blocks.leadership_intro || lead) {
      parts.push(`<div class="dash-leadership">
        <p class="dash-leadership-h">Leadership reflection</p>
        ${blocks.leadership_intro ? `<div class="dash-narrative">${paragraphsHtml(blocks.leadership_intro)}</div>` : ''}
        ${lead}
      </div>`);
    }

    if (blocks.final_prompt) parts.push(`<div class="dash-prompt">${paragraphsHtml(blocks.final_prompt)}</div>`);
    if (blocks.completion) parts.push(`<div class="dash-completion">${paragraphsHtml(blocks.completion)}</div>`);

    if (!parts.length) return '<p class="dash-muted">No content yet.</p>';
    return parts.join('');
  }

  return '';
}

// Render a section's questions. `leadership` selects the leadership-group fields
// (group === 'leadership') vs the rest, and honors the Week-4 part split.
function dashQuestionsHtml(section, ctx, leadership) {
  const partOk = (f) => section.part == null || f.part == null || Number(f.part) === Number(section.part);
  const mine = ctx.fields
    .filter((f) => f.section_key === section.section_key)
    .filter((f) => (leadership ? f.group === 'leadership' : f.group !== 'leadership'))
    .filter(partOk)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return mine.map((f) => dashFieldHtml(f, ctx)).join('');
}

// One editable field: textarea (default), checklist, or yes/no. A `hint` renders
// as a "Consider:" bullet list. Answers autosave by data-field-key.
function dashFieldHtml(f, ctx) {
  const val = ctx.answers[f.key] || '';
  const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

  if (f.type === 'checklist') {
    const items = lines(f.hint);
    const checked = new Set(lines(val));
    const list = items.map((item) => `
      <label class="dash-check-item">
        <input type="checkbox" class="dash-check" data-field-key="${escapeAttr(f.key)}" value="${escapeAttr(item)}"${checked.has(item) ? ' checked' : ''}>
        <span>${escapeHtml(item)}</span>
      </label>`).join('');
    return `
      <div class="dash-form-field dash-checklist" data-field-key="${escapeAttr(f.key)}">
        <span class="dash-form-label">${escapeHtml(f.label || '')}</span>
        ${list}
        <span class="dash-save-note" data-for="${escapeAttr(f.key)}" aria-live="polite"></span>
      </div>`;
  }

  if (f.type === 'yesno') {
    const v = String(val);
    return `
      <div class="dash-form-field dash-yesno">
        <span class="dash-form-label">${escapeHtml(f.label || '')}</span>
        <span class="dash-yesno-opts">
          <label class="dash-yesno-opt"><input type="radio" class="dash-radio" name="yn_${escapeAttr(f.key)}" data-field-key="${escapeAttr(f.key)}" value="Yes"${v === 'Yes' ? ' checked' : ''}> Yes</label>
          <label class="dash-yesno-opt"><input type="radio" class="dash-radio" name="yn_${escapeAttr(f.key)}" data-field-key="${escapeAttr(f.key)}" value="No"${v === 'No' ? ' checked' : ''}> No</label>
        </span>
        <span class="dash-save-note" data-for="${escapeAttr(f.key)}" aria-live="polite"></span>
      </div>`;
  }

  const hint = f.hint
    ? `<ul class="dash-consider">${lines(f.hint).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
    : '';
  return `
    <label class="dash-form-field">
      <span class="dash-form-label">${escapeHtml(f.label || '')}</span>
      ${hint}
      <textarea class="dash-form-input" data-field-key="${escapeAttr(f.key)}" rows="3">${escapeHtml(val)}</textarea>
      <span class="dash-save-note" data-for="${escapeAttr(f.key)}" aria-live="polite"></span>
    </label>`;
}

// Wire autosave (form), recording retry/error (calls), call buttons, and the
// PDF export for a freshly-rendered dashboard.
function wireCoachingDashboard(data) {
  const root = dom.root;

  // --- Autosave dev-plan fields (debounced per field) ---
  root.querySelectorAll('.dash-form-input').forEach((ta) => {
    let timer = null;
    const note = root.querySelector(`.dash-save-note[data-for="${cssEscape(ta.dataset.fieldKey)}"]`);
    ta.addEventListener('input', () => {
      if (note) note.textContent = 'Saving…';
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const res = await fetch('/api/coaching/answer', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field_key: ta.dataset.fieldKey, value: ta.value }),
          });
          if (note) note.textContent = res.ok ? 'Saved' : 'Save failed';
        } catch {
          if (note) note.textContent = 'Save failed';
        }
      }, 600);
    });
  });

  // --- Checklist autosave: value = newline-joined checked items ---
  root.querySelectorAll('.dash-checklist').forEach((wrap) => {
    const key = wrap.dataset.fieldKey;
    const note = root.querySelector(`.dash-save-note[data-for="${cssEscape(key)}"]`);
    wrap.querySelectorAll('.dash-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const value = Array.from(wrap.querySelectorAll('.dash-check'))
          .filter((c) => c.checked).map((c) => c.value).join('\n');
        saveDashboardField(key, value, note);
      });
    });
  });

  // --- Yes/No autosave ---
  root.querySelectorAll('.dash-radio').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const key = radio.dataset.fieldKey;
      const note = root.querySelector(`.dash-save-note[data-for="${cssEscape(key)}"]`);
      saveDashboardField(key, radio.value, note);
    });
  });

  // --- Recording players: error/retry handling (audio still processing → 202) ---
  root.querySelectorAll('.dash-call-done').forEach((wrap) => {
    const audio = wrap.querySelector('.dash-rec-audio');
    const err = wrap.querySelector('.dash-rec-err');
    const retry = wrap.querySelector('.dash-rec-retry');
    if (!audio) return;
    const baseSrc = audio.getAttribute('src');
    let retryCount = 0;
    audio.addEventListener('error', () => { if (err) err.hidden = false; });
    if (retry) {
      retry.addEventListener('click', () => {
        retryCount += 1;
        if (err) err.hidden = true;
        audio.setAttribute('src', `${baseSrc}&t=${retryCount}`);
        audio.load();
      });
    }
  });

  // --- Call buttons: save the name, then start the call in this mode ---
  root.querySelectorAll('.dash-call-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wrap = btn.closest('.dash-call');
      const input = wrap ? wrap.querySelector('.dash-call-name-input') : null;
      const participant = input ? input.value.trim() : '';
      saveCoachingParticipant(participant);
      // In preview, the "Test as" toggle lets the builder spoof their role so
      // they can exercise both the matching and wrong-role behavior. Honored
      // server-side ONLY for preview links.
      const asRole = root.querySelector('.coaching-preview-asrole')?.value || '';
      startCall(data.agent.id, { mode: btn.dataset.mode, participant, asRole });
    });
  });

  // --- Export Development Plan (PDF) ---
  const exportBtn = root.querySelector('.dash-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportCoachingPlan(data));
  }

  // --- Preview: "Start fresh test" wipes THIS preview invite's memory/calls ---
  // (server-side, scoped to the preview link only) and repaints the dashboard so
  // the builder can re-run the journey from a clean slate without confusing the
  // next test.
  const resetBtn = root.querySelector('.coaching-preview-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (!confirm('Clear this test\'s memory and recordings and start over? Only this preview is affected.')) return;
      resetBtn.disabled = true;
      const orig = resetBtn.textContent;
      resetBtn.textContent = 'Resetting…';
      try {
        await fetch('/api/coaching/preview-reset', { method: 'POST', credentials: 'same-origin' });
      } catch {
        // best-effort — repaint regardless
      }
      await refreshRecipientStatus();
      renderCoachingTest();
    });
  }
}

// Build a print-only DOM of ALL dev-plan answers (reading the live textareas so
// unsaved edits are included), grouped by section, with the agent header, then
// print. CSP-safe: no libraries; a `body.printing` class + @media print rules
// hide everything except #coaching-print.
function exportCoachingPlan(data) {
  const host = document.getElementById('coaching-print');
  if (!host) return;
  const agent = data.agent || {};
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const fields = Array.isArray(data.fields) ? data.fields : [];

  // Current values from the live textareas (fall back to saved answers).
  const liveVal = (key) => {
    const ta = dom.root.querySelector(`.dash-form-input[data-field-key="${cssEscape(key)}"]`);
    if (ta) return ta.value;
    return (data.answers && data.answers[key]) || '';
  };

  const formSections = sections.filter((s) => s.type === 'form');
  const groupsHtml = formSections.map((s) => {
    const mine = fields
      .filter((f) => f.section_key === s.section_key)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (!mine.length) return '';
    const qa = mine.map((f) => `
      <div class="print-qa">
        <p class="print-q">${escapeHtml(f.label || '')}</p>
        <div class="print-a">${paragraphsHtml(liveVal(f.key)) || '<p class="print-empty">-</p>'}</div>
      </div>`).join('');
    return `
      <section class="print-section">
        <h2 class="print-section-h">${escapeHtml(s.title || '')}</h2>
        ${qa}
      </section>`;
  }).join('');

  host.innerHTML = `
    <header class="print-header">
      <h1 class="print-title">Development by Design Workbook</h1>
      <p class="print-sub">${escapeHtml(agent.name || '')}${agent.role_title ? ` · ${escapeHtml(agent.role_title)}` : ''}</p>
    </header>
    ${groupsHtml || '<p>No development-plan answers yet.</p>'}`;

  const cleanup = () => {
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  document.body.classList.add('printing');
  window.print();
}

// Autosave one dashboard answer (checklist joins checked items; yes/no saves the
// choice). Mirrors the textarea autosave path in wireCoachingDashboard.
async function saveDashboardField(key, value, note) {
  if (note) note.textContent = 'Saving…';
  try {
    const res = await fetch('/api/coaching/answer', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_key: key, value }),
    });
    if (note) note.textContent = res.ok ? 'Saved' : 'Save failed';
  } catch {
    if (note) note.textContent = 'Save failed';
  }
}

// Minimal CSS.escape fallback for attribute selectors built from our own
// field keys (alnum + underscore by construction). Avoids a hard dependency on
// CSS.escape in older engines.
function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(s));
  return String(s).replace(/["\\]/g, '\\$&');
}

// The participant's name (optional) — labels their ElevenLabs recording so the
// manager can tell whose practice session is whose. Per-browser.
function loadCoachingParticipant() {
  try { return localStorage.getItem('coaching:participant') || ''; } catch { return ''; }
}
function saveCoachingParticipant(name) {
  try {
    if (name) localStorage.setItem('coaching:participant', name);
    else localStorage.removeItem('coaching:participant');
  } catch {}
}

// ---- Coaching transcript memory (for follow-up calls) ---------------------
// Stored locally so a "Follow-up call" can replay the last one-on-one into
// Taylor's prompt. Keyed per scenario; survives reloads, scoped to this browser.
function coachingKey(scenarioId) { return `coaching:last:${scenarioId}`; }

function saveCoachingTranscript(scenarioId, messages) {
  try {
    const slim = (messages || [])
      .filter((m) => m && m.content)
      .map((m) => ({ role: m.role === 'assistant' || m.role === 'customer' ? 'assistant' : 'user', content: String(m.content) }));
    if (slim.length < 2) return;
    localStorage.setItem(coachingKey(scenarioId), JSON.stringify({ messages: slim }));
  } catch {}
}

function loadCoachingTranscript(scenarioId) {
  try {
    const raw = localStorage.getItem(coachingKey(scenarioId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.messages) ? parsed.messages : [];
  } catch { return []; }
}

function hasSavedCoaching(scenarioId) {
  return loadCoachingTranscript(scenarioId).length >= 2;
}

// Re-fetch /api/me/status and refresh state.recipient.scenarios in place so the
// coaching home reflects updated server-side progress (e.g. new call_count /
// has_prior after a call). Also re-registers each authored coaching agent in
// personaById so startCall keeps working. Best-effort: silently keeps the old
// scenarios on any failure.
async function refreshRecipientStatus() {
  if (!state.recipient) return;
  try {
    const r = await fetch('/api/me/status', { credentials: 'same-origin' });
    if (!r.ok) return;
    const me = await r.json();
    if (!me || !me.active || !Array.isArray(me.scenarios)) return;
    state.recipient.scenarios = me.scenarios;
    if ('coaching_landing' in me) state.recipient.coaching_landing = me.coaching_landing;
    for (const s of me.scenarios) {
      if (!s || !s.id) continue;
      if (s.kind === 'coaching_agent') {
        state.personaById.set(s.id, coachingAgentToPersona(s));
      } else if (!state.personaById.has(s.id)) {
        state.personaById.set(s.id, { ...s });
      }
    }
  } catch {
    // keep the existing scenarios on any error
  }
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
  document.body.dataset.view = 'home';
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
    <li class="demo-entry demo-entry-${escapeAttr(p.id)}" data-persona-id="${escapeAttr(p.id)}" tabindex="0" role="button" style="--demo-entry-index:${i}" aria-label="Take the call: ${escapeAttr(p.card_title || p.customer_name || p.id)}">
      <span class="demo-entry-aura" aria-hidden="true"></span>
      <div class="demo-entry-flip">
        <div class="demo-entry-face demo-entry-front">
          <div class="demo-entry-head">
            <span class="demo-entry-signal" aria-hidden="true"><span class="demo-entry-dot"></span></span>
            <span class="demo-entry-status" aria-hidden="true">Line open</span>
          </div>
          <div class="demo-entry-body">
            <h2 class="demo-entry-name">${escapeHtml(p.card_title || p.customer_name || '')}</h2>
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

  // Render the shared Living Voice shell with the two scenario lines, then wire
  // up the orb / video / splash / tenets / mic test (all shared) and the
  // per-entry startCall handlers (specific to this page's entries).
  dom.root.innerHTML = renderLivingVoiceShell({
    entriesHtml,
    linesLabel: 'Two lines open',
  });

  wireLivingVoiceShell();

  // Same click + keydown wiring to startCall(personaId) as before.
  dom.root.querySelectorAll('.demo-entry').forEach((card) => {
    const go = () => startCall(card.dataset.personaId);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
}

// Microphone / device test modal. Opened from the footer "test your mic" link.
// Requests mic access, draws a live input-level meter (Web Audio RMS), lists the
// available input devices, and reports clear status / errors. Self-contained:
// it acquires its own stream and tears it down on close, so it never collides
// with the scenario's own microphone use.
function setupMicTest(root) {
  const openBtn = root.querySelector('#demo-mic-test');
  const modal = root.querySelector('#mic-test');
  if (!openBtn || !modal) return;
  const fill = modal.querySelector('#mic-test-fill');
  const statusEl = modal.querySelector('#mic-test-status');
  const deviceSel = modal.querySelector('#mic-test-devices');
  const card = modal.querySelector('.mic-test-card');
  const closeEls = [
    modal.querySelector('#mic-test-close'),
    modal.querySelector('#mic-test-done'),
    modal.querySelector('[data-mic-close]'),
  ].filter(Boolean);

  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let buffer = null;
  let raf = null;
  let gotSignal = false;

  const setStatus = (text, state) => {
    if (statusEl) statusEl.textContent = text;
    modal.dataset.state = state || '';
  };

  const stop = () => {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch {} stream = null; }
    if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
    analyser = null; buffer = null;
    if (fill) fill.style.width = '0%';
  };

  const tick = () => {
    if (!analyser || !buffer) return;
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = (buffer[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buffer.length);
    const pct = Math.max(0, Math.min(100, Math.round(rms * 320)));
    if (fill) fill.style.width = `${pct}%`;
    if (pct > 8 && !gotSignal) {
      gotSignal = true;
      setStatus('Looking good, your microphone is working.', 'ok');
    }
    raf = requestAnimationFrame(tick);
  };

  const populateDevices = async () => {
    if (!deviceSel || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === 'audioinput');
      if (mics.length <= 1) { deviceSel.hidden = true; return; }
      deviceSel.hidden = false;
      deviceSel.innerHTML = mics
        .map((d, i) => `<option value="${escapeAttr(d.deviceId)}">${escapeHtml(d.label || `Microphone ${i + 1}`)}</option>`)
        .join('');
      const active = stream && stream.getAudioTracks && stream.getAudioTracks()[0];
      const activeId = active && active.getSettings && active.getSettings().deviceId;
      if (activeId) deviceSel.value = activeId;
    } catch {}
  };

  const start = async (deviceId) => {
    stop();
    gotSignal = false;
    setStatus('Requesting microphone access…', '');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('This browser cannot access the microphone.', 'error');
      return;
    }
    try {
      const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      setStatus('Microphone connected. Say something to see the level move.', '');
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      // Contexts created outside a direct gesture start suspended; resume so the
      // graph actually runs (otherwise the analyser only ever sees silence).
      try { await audioCtx.resume(); } catch {}
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.4;
      buffer = new Uint8Array(analyser.fftSize);
      // Chrome will not "pull" audio from a MediaStreamSource unless the graph
      // reaches a destination, so route the analyser through a MUTED gain node
      // to the speakers. Gain 0 means no feedback, but the graph stays live and
      // the meter actually moves.
      const sink = audioCtx.createGain();
      sink.gain.value = 0;
      src.connect(analyser);
      analyser.connect(sink);
      sink.connect(audioCtx.destination);
      raf = requestAnimationFrame(tick);
      populateDevices();
    } catch (err) {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('Microphone blocked. Allow mic access in your browser, then try again.', 'error');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setStatus('No microphone found. Plug one in and try again.', 'error');
      } else {
        setStatus('Could not access the microphone. Check your device settings.', 'error');
      }
    }
  };

  const open = () => {
    modal.dataset.open = 'true';
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => { try { card && card.focus(); } catch {} }, 30);
    start();
  };
  const close = () => {
    modal.dataset.open = 'false';
    modal.setAttribute('aria-hidden', 'true');
    stop();
  };

  openBtn.addEventListener('click', open);
  closeEls.forEach((el) => el.addEventListener('click', close));
  if (deviceSel) deviceSel.addEventListener('change', () => start(deviceSel.value));
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
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

async function startCall(typeOrPersonaId, opts = {}) {
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
  // Coaching mode. Authored agents (ca_) support 'assessment' | 'coaching' |
  // 'followup'; the hardcoded coaching_practice keeps its 'fresh' | 'followup'.
  // Only a follow-up carries the prior call's transcript so the agent "remembers"
  // the last one-on-one. Default to 'coaching' (authored) / 'fresh' (legacy path
  // passes its own opts.mode explicitly).
  const coachingMode = opts.mode || 'coaching';
  // Authored coaching scenarios (ca_) load their prior transcript SERVER-SIDE
  // (keyed to the invite link) in /api/voice-agent/start, so the client attaches
  // none. Only the legacy coaching_practice replays its localStorage transcript
  // into a follow-up call.
  const priorTranscript =
    (personaId === 'coaching_practice' && coachingMode === 'followup')
      ? loadCoachingTranscript(personaId)
      : [];
  state.activeScenario = {
    ...persona,
    title: persona.type_title || persona.title || '',
    opening_line: chosen,
    blind,
    coachingMode,
    priorTranscript,
    participant: typeof opts.participant === 'string' ? opts.participant : '',
    asRole: typeof opts.asRole === 'string' ? opts.asRole : '',
  };
  // New start sequence: the pre-call modal opens over the FULL scenario shell,
  // blurred — so the trainee sees the call they're about to take, not the
  // picker list. Flow: preview backdrop -> modal -> ring -> Answer (mic init +
  // the live call). For agents/kiosk we stash the live view (a detached
  // fragment keeps its wired listeners) so Cancel/Decline restores it intact;
  // recipient/demo homes are re-rendered on return so their WebGL orb re-inits.
  state.precallStash = null;
  // Coaching is a voice-practice session, not an inbound call: skip the pre-call
  // modal and the incoming-call ring entirely and connect straight away. The
  // "Start the call" click is the user gesture renderCall relies on to unlock the
  // microphone and audio, so we go live directly.
  if (persona.coaching || isCoachingId(personaId)) {
    renderCall(state.activeScenario);
    return;
  }
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
  if (state.reel) {
    // Declining or dismissing mid-ring in the reel just re-rings the same call:
    // the reel is a continuous sequence with no picker to fall back to.
    startReelCall(state.reel.seq[state.reel.index]);
    return;
  }
  if (state.recipient) {
    // Re-render so the sealed home (and its WebGL orb) rebuilds cleanly; the
    // stashed backdrop, if any, is discarded.
    state.precallStash = null;
    if (state.coachingTest) renderCoachingTest();
    else if (state.recipient.is_demo) renderDemoHome();
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
  const callerNumber = scenario.phone ? formatPhoneDisplay(scenario.phone) : '';

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
      ${callerNumber ? `<div class="ring-number mono">${escapeHtml(callerNumber)}</div>` : ''}
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
  // Mark the call view so the demo's home-only page lock releases and the POS
  // can scroll. Skip in preview (the blurred backdrop behind the precall modal).
  if (!preview) document.body.dataset.view = 'call';
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
  // Customer Service demo (caller "Lauren"): instead of the reservation POS this
  // call renders a de-branded replica of the Meridian intranet Customer
  // Management flow (a 4-view client-side tool). The call header, dock, timer,
  // hold/end-call, and the voice-agent session are all shared with the POS path;
  // only the in-call work surface differs. All POS-specific markup + wiring is
  // skipped on this branch (see the isServiceDemo guards below).
  const isServiceDemo = scenario.id === 'demo_service';
  // Coaching practice is a voice-only soft-skills session (manager coaching the
  // team member Taylor), NOT an inbound customer call — so it drops the
  // reservation POS and the phone chrome and shows a clean centered voice stage.
  const isCoaching = isCoachingId(scenario.id) || !!scenario.coaching;
  // Phone/voice calls hide the live transcript ("captions") — a real call
  // wouldn't show them, and coaching is a full voice-only experience (no text on
  // screen). The transcript <ol> stays in the DOM but is never displayed; saved
  // progress reads the voice agent's own transcript, not this element. Text-mode
  // chats keep their conversation visible.
  const hideCaptions = isPhone;
  // Demo (voice-agent) phone calls hide the entire call dock — the floating,
  // chat-style panel — so the trainee just sees the POS, like a real rep on a
  // live call. The status/transcript elements stay in the DOM (JS still updates
  // them; coaching still reads the transcript) but the panel is not shown. The
  // call header keeps the timer, Pause, and End call controls.
  // Coaching keeps the dock visible (it IS the voice stage); demo phone calls
  // hide it so the trainee sees only the POS.
  const hideDock = isPhone && isVoiceAgentScenario(scenario.id) && !isCoaching;
  const useOrb = isPhone && isShowcaseCall && state.demoUnlocked;
  // Caller ID for the header (phone calls only) — mirrors a real CSF that shows
  // the inbound number next to the call duration.
  const callerNumber = isPhone && scenario.phone ? formatPhoneDisplay(scenario.phone) : '';
  // Premium voice (eleven_v3) performs square-bracket delivery tags. When
  // active we keep those tags in the text we send to TTS but strip them
  // from the transcript. Standard tier strips them everywhere.
  const isPremium = !!scenario.premium || (isShowcaseCall && state.demoUnlocked);
  const premiumVoice = isPremium;
  const premiumBadge = isPremium
    ? '<span class="call-mode-pill call-mode-pill-premium" title="Premium voice (Eleven v3)">Premium voice</span>'
    : '';

  dom.root.innerHTML = `
    <section class="call" data-call-mode="${escapeAttr(state.callMode)}"${isCoaching ? ' data-coaching="true"' : ''}${isServiceDemo ? ' data-cs="true"' : ''}${useOrb ? ' data-orb-mode="meta"' : ''}${isShowcaseCall ? ' data-showcase-stage="meet"' : ''}>
      <header class="call-header">
        <button class="ghost-button call-back" id="call-back" type="button">Back to scenarios</button>
        <div class="call-meta">
          <div class="call-customer-name">${escapeHtml(displayName)}</div>
          <div class="call-scenario-title">${escapeHtml(displayTitle)} <span class="call-mode-pill">${escapeHtml(modeBadge)}</span>${premiumBadge}</div>
        </div>
        <div class="call-actions">
          ${callerNumber ? `<span class="call-number mono" title="Caller ID"><span class="call-number-dot" aria-hidden="true"></span>${escapeHtml(callerNumber)}</span>` : ''}
          <span class="call-timer" id="call-timer" role="timer" aria-label="Call duration" title="Call duration">00:00</span>
          <button class="ghost-button call-pause" id="call-pause" type="button" aria-pressed="false" title="Ask the caller's permission before placing them on a brief hold">Hold</button>
          <button class="danger-button" id="end-call" type="button">End call</button>
        </div>
      </header>
      <div class="call-body">
        ${useOrb ? `
        <div class="orb-zone" id="orb-zone" data-orb-mode="meta" data-active="false">
          <div class="orb-mount" id="orb-mount"></div>
        </div>
        ` : ''}

        ${isServiceDemo ? csToolHtml() : posToolHtml()}

        <div class="call-dock" id="call-dock" data-mode="${isPhone ? 'phone' : 'chat'}" data-collapsed="false"${hideDock ? ' hidden' : ''}>
          <button type="button" class="call-dock-head" id="call-dock-head" aria-expanded="true">
            <span class="call-dock-dot" id="call-dock-dot"></span>
            <span class="call-dock-title">${escapeHtml(displayName)}</span>
            <span class="call-dock-sub">${isPhone ? 'Live call' : 'Chat'}</span>
            <span class="call-dock-chevron" aria-hidden="true">&#9662;</span>
          </button>
          <div class="call-dock-body" id="call-dock-body">
            <div class="call-dock-convo"${hideCaptions ? ' hidden' : ''}>
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
        getColor: () => {
          const speaking = state.continuousRecorder?.isSpeaking();
          // Coaching calls wear the warm botanical palette (green = you, orange =
          // the employee); demo/trainee calls keep the original blue/amber.
          if (isCoaching) return speaking ? '#6a7f46' : '#e7a23d';
          return speaking ? '#60a5fa' : '#f5a524';
        },
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

  const useVoiceAgent = isPhone && VOICE_AGENT_ENABLED && isVoiceAgentScenario(scenario.id);

  if (state.liveMode) {
    // Instructor Live Mode: NO AI. The instructor plays the customer by voice on
    // the paired screen, so there is no voice agent, no mic, and no turn loop.
    // The POS stays fully interactive; we only observe and emit its state.
    setPhoneState(
      'your_turn',
      'Live with your instructor',
      'Your instructor is playing the customer. Work the reservation as they talk you through it.'
    );
  } else if (isPhone) {
    setPhoneState('connecting', `Connecting you to ${customerLabel}...`, 'Putting the call through.');
    // Demo scenarios use the real-time ElevenLabs agent (full-duplex, streaming).
    // Everything else uses the agent-first turn loop: the trainee greets first,
    // so we open the mic now (the Answer click is the gesture). Elena (showcase)
    // opens herself, so we don't start listening for her.
    if (useVoiceAgent) {
      startAgentSession();
    } else if (!isShowcaseCall) {
      setPhoneState('your_turn', 'Your turn: greet the caller.', 'They just picked up. Say hello and introduce yourself.');
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

  // Real-time ElevenLabs voice agent session (demo phone calls). Full-duplex:
  // the agent client owns the mic + playback; we just mirror its transcript into
  // the call UI and keep the call timer in a live state. If it fails to start
  // for any reason, we fall back to the turn-based pipeline so the demo never
  // breaks.
  function startAgentSession() {
    const agent = createVoiceAgent({
      scenarioId: scenario.id,
      mode: scenario.coachingMode || 'fresh',
      priorTranscript: Array.isArray(scenario.priorTranscript) ? scenario.priorTranscript : [],
      participant: scenario.participant || '',
      asRole: scenario.asRole || '',
      onStatus: (s) => {
        if (state.view !== 'call') return;
        if (s === 'connecting') setPhoneState('connecting', `Connecting you to ${customerLabel}...`, 'Putting the call through.');
        else if (s === 'live') setPhoneState('your_turn', 'On the line: just talk.', 'The line is open. Speak naturally and pause when you finish.');
        else if (s === 'mic_denied') setPhoneState('error', 'Mic access denied', 'Reload the page and allow the mic, or switch to Chat mode.');
      },
      onUserText: (t) => { if (state.view === 'call') appendMessage(transcript, 'agent', 'You', t); },
      onAgentText: (t) => {
        if (state.view !== 'call') return;
        appendMessage(transcript, 'customer', customerLabel, t);
        setPhoneState('customer_talking', `${customerLabel} is talking...`, 'Listen until they finish.');
      },
      onError: (e) => { console.warn('voice agent error', e); },
      onEnd: () => {},
    });
    state.voiceAgent = agent;
    agent.start().catch((err) => {
      if (state.voiceAgent === agent) state.voiceAgent = null;
      // Coaching calls have NO turn-based fallback. The most common failure here
      // is the server stage-gate (call_locked) — a call the manager's cohort hasn't
      // unlocked yet. Show a clear message and return to the dashboard rather than
      // dropping into the (wrong) turn-based pipeline.
      if (isCoaching) {
        const locked = String(err && err.message) === 'call_locked';
        teardownAudio();
        alert(locked
          ? "This call isn't unlocked yet. Your study group hasn't reached this part of the program."
          : 'Could not start the call. Please try again in a moment.');
        renderCoachingTest();
        return;
      }
      console.warn('voice agent failed; falling back to turn-based', err);
      if (state.view === 'call' && !state.callPaused) {
        setPhoneState('your_turn', 'Your turn: greet the caller.', 'They just picked up. Say hello and introduce yourself.');
        startListening();
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

  endCallBtn.addEventListener('click', async () => {
    // Instructor Live Mode: no transcript, no AI report. End the trainee side and
    // show a calm recap card.
    if (state.liveMode) {
      teardownAudio();
      await handleLiveEnd();
      return;
    }
    // Voice-agent calls carry their transcript on the agent; turn-based calls on
    // the conversation. teardownAudio() stops the agent.
    const messages = state.voiceAgent ? state.voiceAgent.getTranscript() : conversation.getMessages();
    // Snapshot whatever the agent typed into the reservation Callback Notes (POS
    // scenarios only) so it can be shown back in the coaching report. Local memory
    // only, never persisted; empty string for non-POS scenarios where the field
    // does not exist. Read before teardown while the POS DOM is still mounted.
    state.reservationNotes = (document.getElementById('pos-callback-notes')?.value || '').trim();
    conversation.cancel();
    teardownAudio();
    // Reel mode: NO coaching report between calls. The voice agent + audio are
    // already torn down above; advance straight to the next call's ring (or the
    // completion screen after the last). This is the guard that keeps the reel
    // seamless; every non-reel path below is unchanged.
    if (state.reel) {
      advanceReel();
      return;
    }
    // Coaching practice has NO scored report — it's an open soft-skills rehearsal.
    // Authored (ca_) scenarios persist progress SERVER-SIDE (keyed to the invite
    // link) so the agent remembers every prior call across browsers/devices; the
    // legacy coaching_practice keeps its localStorage follow-up memory.
    if (isCoaching) {
      if (scenario.id && scenario.id.startsWith('ca_')) {
        // Preview calls DO save — but only ever to the throwaway per-scenario
        // preview invite (a __cvprev__ sentinel link), which is isolated from
        // real participants and from other scenarios. That isolation is what
        // lets a builder run call 1 then call 2 and have the agent remember the
        // first, while "Start fresh test" / re-launching wipes it clean.
        if (messages.length >= 2) {
          try {
            await fetch('/api/coaching/progress', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                scenario_id: scenario.id,
                messages,
                mode: scenario.coachingMode || 'coaching',
                conversation_id: state.voiceAgent?.getConversationId?.() || null,
                taken_by: scenario.participant || '',
              }),
            });
          } catch {
            // fire-and-forget — ignore network failure
          }
        }
        // Reflect the new progress (call_count / follow-up unlock) on the home.
        await refreshRecipientStatus();
      } else if (messages.length >= 2) {
        saveCoachingTranscript(scenario.id, messages);
      }
      renderCoachingTest();
      return;
    }
    if (messages.length < 2) {
      renderShortCall(scenario);
      return;
    }
    runCoaching(scenario, messages);
  });

  backBtn.addEventListener('click', () => {
    conversation.cancel();
    teardownAudio();
    if (state.liveMode) {
      handleLiveEnd();
      return;
    }
    if (state.reel) {
      // No picker in the reel: back returns to the reel intro splash.
      renderReelIntro();
      return;
    }
    if (state.recipient) {
      if (state.coachingTest) renderCoachingTest();
      else if (state.recipient.is_demo) renderDemoHome();
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
    // Real-time voice agent (demo phone calls): it owns its own mic + playback,
    // so pause/resume it directly. The turn-based teardown below is a no-op for
    // it, and on resume we must NOT start the turn-based recorder.
    const usingAgent = !!state.voiceAgent;
    if (usingAgent) { try { state.voiceAgent.setPaused(paused); } catch {} }
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
      if (isPhone) setPhoneState('paused', 'On hold', 'The caller is on hold. Be sure you asked first, then take them off hold when you are ready.');
      else setComposerEnabled(false);
    } else {
      if (usingAgent) {
        // The agent kept the WebSocket open; just restore the live status.
        if (isPhone) setPhoneState('your_turn', 'On the line: just talk.', 'The line is open. Speak naturally and pause when you finish.');
      } else if (isPhone) {
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
      callPauseBtn.textContent = paused ? 'Take off hold' : 'Hold';
      callPauseBtn.setAttribute('aria-pressed', String(paused));
      callPauseBtn.classList.toggle('is-paused', paused);
    }
    const callEl = dom.root.querySelector('.call');
    if (callEl) callEl.dataset.paused = String(paused);
  }

  callPauseBtn?.addEventListener('click', () => setCallPaused(!state.callPaused));
  startCallTimer();

  // Floating call dock collapse toggle (shared by the POS and CS work surfaces).
  const callDock = document.getElementById('call-dock');
  const callDockHead = document.getElementById('call-dock-head');
  callDockHead?.addEventListener('click', () => {
    const collapsed = callDock.dataset.collapsed === 'true';
    callDock.dataset.collapsed = String(!collapsed);
    callDockHead.setAttribute('aria-expanded', String(collapsed));
  });

  // Customer Service demo: wire the Meridian Customer Management tool (4 static
  // views with client-side view switching) and skip ALL of the POS reservation
  // wiring below — the POS DOM does not exist on this branch, so touching it
  // would throw. The voice-agent session, timer, hold, end-call, back, and dock
  // are already wired above and are shared.
  if (isServiceDemo) {
    wireCsTool(dom.root.querySelector('.cs-tool'));
    return;
  }

  // ---- POS reservation system ----
  // Extracted into pos-tool.js (posToolHtml + wirePosTool) so the live app and
  // the Rise embed run the SAME markup + wiring (cs-tool.js precedent). The
  // fieldTip handoff keeps teardownAudio() as the single owner of its removal.
  wirePosTool(dom.root, { scenario, onFieldTip: (el) => { state.fieldTip = el; } });
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
  document.body.dataset.view = 'report';
  // Temporary diagnostic for the "No score / No evidence" report bug.
  try { console.warn('[coach diag]', report && report._diag, 'scoreKeys:', Object.keys(report?.scores || {}).slice(0, 3)); } catch {}
  setDocumentTitle(`Report: ${scenario.customer_name}`);
  // Kiosk visitors have nowhere to go but back into the same scenario - even
  // if the "Back to scenarios" button shows for any reason, it just retries.
  // Recipients go to their personal simulation page; agents go to the picker.
  const onNewCall = state.kiosk
    ? () => startCall(scenario.id)
    : state.recipient
      ? (state.coachingTest ? renderCoachingTest : state.recipient.is_demo ? renderDemoHome : renderRecipientHome)
      : renderPicker;
  const node = renderReportHtml(scenario, report, {
    onNewCall,
    onRetry: () => startCall(scenario.id),
    reservationNotes: state.reservationNotes,
  });
  dom.root.replaceChildren(node);
}

function renderShortCall(scenario) {
  state.view = 'ended';
  document.body.dataset.view = 'report';
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
    : state.recipient ? (state.coachingTest ? renderCoachingTest : state.recipient.is_demo ? renderDemoHome : renderRecipientHome)
    : renderPicker);
  document.getElementById('ended-retry').addEventListener('click', () => startCall(scenario.id));
}

function renderCoachingError(scenario, messages, err) {
  state.view = 'coaching_error';
  document.body.dataset.view = 'report';
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
    : state.recipient ? (state.coachingTest ? renderCoachingTest : state.recipient.is_demo ? renderDemoHome : renderRecipientHome)
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

// Normalize a stored persona phone (e.g. "513-555-2840" or "(513) 555-2840")
// into a consistent caller-ID display "(513) 555-2840". Non-10-digit values
// (or empty) are returned as-is so nothing breaks.
function formatPhoneDisplay(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return String(raw || '');
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
