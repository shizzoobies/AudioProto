// Rise/Reach embed orchestrator. A lean, standalone flow that reuses the
// shared modules (pos-tool.js, voice-agent.js, coach.js) so the in-course
// Robert experience is the SAME experience as the live demo:
//
//   inactive -> intro -> ring -> live call (POS + voice agent) -> analyzing
//   -> report -> done ("return to the course"), plus capped / error states.
//
// Auth: every API call carries the course token (ct) in the request body or
// query string - never cookies (third-party iframe context). Completion and
// score are signaled UP to the course wrapper via postMessage; the wrapper's
// xAPI bridge relays them to Reach. This file never talks to the LMS directly.

import { posToolHtml, wirePosTool } from './pos-tool.js?v=20260718-3';
import { createVoiceAgent } from './voice-agent.js?v=20260718-4';
import { renderReportHtml } from './coach.js';

const BUILD = '20260718-4 voice-agent-start-headers';
console.log('[First Call embed] build', BUILD);

// ---- boot context ---------------------------------------------------------

const params = new URLSearchParams(window.location.search);
const CT = params.get('ct') || '';
const SID = params.get('sid') || 'demo_sales';
const LEARNER = (params.get('learner') || '').trim().slice(0, 120);

let embedConfig = { parentOrigins: [] };
try {
  embedConfig = JSON.parse(document.body.dataset.embedConfig || '{}');
} catch { /* keep defaults */ }

const root = document.getElementById('embed-root');

const state = {
  scenario: null,     // display-safe scenario from /api/embed/scenario
  agent: null,
  posCtl: null,
  fieldTip: null,
  usageId: null,
  ringtone: null,
  timer: null,        // { accMs, runningSince, intervalId }
  held: false,
  completed: false,   // completion signal sent once per page load
};

// ---- postMessage to the course wrapper ------------------------------------

function postToParent(message) {
  if (window.parent === window) return;
  const targets = new Set(embedConfig.parentOrigins || []);
  // The direct parent's origin (the Mighty block page) via the referrer, when
  // the browser exposes it.
  try {
    if (document.referrer) targets.add(new URL(document.referrer).origin);
  } catch { /* unparseable referrer */ }
  for (const origin of targets) {
    try { window.parent.postMessage(message, origin); } catch { /* skip */ }
  }
}

// ---- tiny utils -----------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function formatPhoneDisplay(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return String(raw || '');
}

function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---- ringtone (same asset + single-instance guard as the app) -------------

function stopRingtone() {
  if (state.ringtone) {
    try {
      state.ringtone.pause();
      state.ringtone.currentTime = 0;
      state.ringtone.src = '';
      state.ringtone.load();
    } catch { /* already gone */ }
    state.ringtone = null;
  }
}

function startRingtone() {
  stopRingtone();
  try {
    const audio = new Audio('/assets/audio/ring-sunrise.wav');
    audio.loop = true;
    state.ringtone = audio;
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    state.ringtone = null;
  }
}

// ---- call timer (simplified: accrues while live and not on hold) ----------

function startTimer() {
  stopTimer();
  state.timer = { accMs: 0, runningSince: null, intervalId: null };
  state.timer.intervalId = setInterval(renderTimer, 500);
}

function timerElapsedMs() {
  const t = state.timer;
  if (!t) return 0;
  return t.accMs + (t.runningSince ? Date.now() - t.runningSince : 0);
}

function setTimerRunning(running) {
  const t = state.timer;
  if (!t) return;
  if (running && !t.runningSince) {
    t.runningSince = Date.now();
  } else if (!running && t.runningSince) {
    t.accMs += Date.now() - t.runningSince;
    t.runningSince = null;
  }
  renderTimer();
}

function renderTimer() {
  const el = document.getElementById('call-timer');
  if (el) el.textContent = fmtDuration(timerElapsedMs());
}

function stopTimer() {
  if (state.timer?.intervalId) clearInterval(state.timer.intervalId);
  if (state.timer) setTimerRunning(false);
  const t = state.timer;
  state.timer = null;
  return t ? t.accMs : 0;
}

// ---- teardown between states ----------------------------------------------

function teardownCall() {
  stopRingtone();
  stopTimer();
  if (state.agent) {
    try { state.agent.stop(); } catch { /* already stopped */ }
    state.agent = null;
  }
  if (state.posCtl) {
    try { state.posCtl.destroy(); } catch { /* already gone */ }
    state.posCtl = null;
  }
  if (state.fieldTip) {
    try { state.fieldTip.remove(); } catch { /* already gone */ }
    state.fieldTip = null;
  }
}

// ---- server calls ---------------------------------------------------------

async function fetchScenario() {
  const qs = `ct=${encodeURIComponent(CT)}&sid=${encodeURIComponent(SID)}`;
  const r = await fetch(`/api/embed/scenario?${qs}`);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error((data && data.error) || `http_${r.status}`);
  return data;
}

async function postComplete(durationS, conversationId) {
  // No usage id means the mint never completed client-side (e.g. the mic was
  // denied right after minting); there is nothing to close out.
  if (!state.usageId) return;
  try {
    await fetch('/api/embed/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ct: CT,
        usage_id: state.usageId,
        duration_s: durationS,
        conversation_id: conversationId || null,
      }),
    });
  } catch { /* best-effort; the score write in coach still lands */ }
}

async function postCoach(transcript) {
  const r = await fetch('/api/embed/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ct: CT,
      sid: SID,
      usage_id: state.usageId,
      transcript,
    }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error((data && data.error) || `http_${r.status}`);
  return data;
}

// ---- states ---------------------------------------------------------------

function renderMessageCard({ eyebrow, title, text, buttonLabel, onButton }) {
  teardownCall();
  root.innerHTML = `
    <div class="embed-card">
      ${eyebrow ? `<div class="precall-eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
      <h2 class="embed-card-title">${escapeHtml(title)}</h2>
      <p class="embed-card-text">${escapeHtml(text)}</p>
      ${buttonLabel ? `<div class="precall-actions"><button type="button" class="primary-button" id="embed-card-btn">${escapeHtml(buttonLabel)}</button></div>` : ''}
    </div>
  `;
  if (buttonLabel && onButton) {
    document.getElementById('embed-card-btn')?.addEventListener('click', onButton);
  }
}

function renderInactive() {
  renderMessageCard({
    title: "This exercise isn't available.",
    text: 'The access link for this course may have been changed or turned off. Please let your course administrator know.',
  });
}

function renderCapped() {
  renderMessageCard({
    title: 'The line is busy today.',
    text: 'This course has reached its practice-call limit for the day. Come back tomorrow to take the call.',
  });
  postToParent({ type: 'firstcall:error', code: 'limit_reached' });
}

function renderError(detail) {
  renderMessageCard({
    title: 'Something went wrong.',
    text: 'We could not start the exercise. Check your connection and try again.' + (detail ? ` (${detail})` : ''),
    buttonLabel: 'Try again',
    onButton: () => renderIntro(),
  });
}

function renderIntro() {
  teardownCall();
  const sc = state.scenario;
  root.innerHTML = `
    <div class="precall-overlay embed-overlay">
      <div class="precall-scrim"></div>
      <div class="precall-card" role="dialog" aria-labelledby="precall-title">
        <div class="precall-eyebrow">${escapeHtml(sc.type_title || '')}</div>
        <h2 class="precall-name" id="precall-title">${escapeHtml(sc.customer_name || 'Caller')}</h2>
        ${sc.customer_short ? `<p class="precall-short">${escapeHtml(sc.customer_short)}</p>` : ''}
        ${sc.tagline ? `<p class="precall-tagline">${escapeHtml(sc.tagline)}</p>` : ''}
        <p class="embed-mic-note">This exercise is a live voice call: you talk, the customer talks back. Your browser will ask to use your microphone when you answer.</p>
        <div class="precall-actions">
          <button type="button" class="primary-button precall-start" id="precall-start">Start <span aria-hidden="true">&rsaquo;</span></button>
        </div>
      </div>
    </div>
  `;
  const startBtn = document.getElementById('precall-start');
  startBtn?.addEventListener('click', () => renderRing());
  setTimeout(() => startBtn?.focus(), 50);
}

function renderRing() {
  const sc = state.scenario;
  const callerNumber = sc.phone ? formatPhoneDisplay(sc.phone) : '';
  const phonePath = 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z';
  root.innerHTML = `
    <div class="precall-overlay precall-ringing embed-overlay">
      <div class="precall-scrim"></div>
      <div class="ring-screen" role="dialog" aria-labelledby="ring-name" aria-describedby="ring-status">
        <div class="ring-status" id="ring-status">Incoming call&hellip;</div>
        <div class="ring-avatar" aria-hidden="true">
          <span class="ring-pulse ring-pulse-1"></span>
          <span class="ring-pulse ring-pulse-2"></span>
          <span class="ring-avatar-core">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true"><path d="${phonePath}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </div>
        <div class="ring-name" id="ring-name">${escapeHtml(sc.customer_name || 'Caller')}</div>
        ${callerNumber ? `<div class="ring-number mono">${escapeHtml(callerNumber)}</div>` : ''}
        <div class="ring-sub">${escapeHtml(sc.type_title || 'Incoming call')}</div>
        <div class="ring-actions">
          <button type="button" class="ring-btn ring-decline" id="ring-decline" aria-label="Decline call">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"><path d="${phonePath}" fill="currentColor" stroke="none"/></svg>
          </button>
          <button type="button" class="ring-btn ring-answer" id="ring-answer">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"><path d="${phonePath}" fill="currentColor" stroke="none"/></svg>
            <span class="ring-answer-label">Answer</span>
          </button>
        </div>
      </div>
    </div>
  `;
  // The Start click is the user gesture, so autoplay of the looped ring is OK.
  startRingtone();
  document.getElementById('ring-decline')?.addEventListener('click', () => {
    stopRingtone();
    renderIntro();
  });
  const answerBtn = document.getElementById('ring-answer');
  answerBtn?.addEventListener('click', () => {
    stopRingtone();
    renderLiveCall();
  });
  setTimeout(() => answerBtn?.focus(), 50);
}

function renderLiveCall() {
  // Idempotent guard: a rapid double-click on Answer must not mint twice or
  // leak the first agent's mic/socket.
  teardownCall();
  const sc = state.scenario;
  const callerNumber = sc.phone ? formatPhoneDisplay(sc.phone) : '';
  root.innerHTML = `
    <section class="call embed-call" data-call-mode="phone">
      <header class="call-header">
        <div class="call-meta">
          <div class="call-customer-name">${escapeHtml(sc.customer_name || 'Caller')}</div>
          <div class="call-scenario-title">${escapeHtml(sc.title || '')} <span class="call-mode-pill">Phone call</span>${sc.premium ? '<span class="call-mode-pill call-mode-pill-premium" title="Premium voice (Eleven v3)">Premium voice</span>' : ''}</div>
        </div>
        <div class="call-actions">
          ${callerNumber ? `<span class="call-number mono" title="Caller ID"><span class="call-number-dot" aria-hidden="true"></span>${escapeHtml(callerNumber)}</span>` : ''}
          <span class="call-timer" id="call-timer" role="timer" aria-label="Call duration" title="Call duration">00:00</span>
          <button class="ghost-button call-pause" id="call-pause" type="button" aria-pressed="false" title="Ask the caller's permission before placing them on a brief hold">Hold</button>
          <button class="danger-button" id="end-call" type="button">End call</button>
        </div>
      </header>
      <div class="call-body">
        <div class="embed-connecting" id="embed-connecting">Connecting you to ${escapeHtml(sc.customer_name || 'the caller')}&hellip;</div>
        ${posToolHtml()}
      </div>
    </section>
  `;

  state.posCtl = wirePosTool(root, {
    scenario: sc,
    onFieldTip: (el) => { state.fieldTip = el; },
    // The cookie-gated /api/geocode and /api/staticmap 401 inside the iframe;
    // these token-authed proxies delegate to the same handlers server-side.
    endpoints: {
      geocode: `/api/embed/geocode?ct=${encodeURIComponent(CT)}`,
      staticmap: `/api/embed/staticmap?ct=${encodeURIComponent(CT)}`,
    },
  });

  startTimer();
  state.held = false;

  const connectingEl = document.getElementById('embed-connecting');
  const agent = createVoiceAgent({
    scenarioId: SID,
    startUrl: '/api/embed/start',
    startExtra: { ct: CT, sid: SID, learner: LEARNER },
    onStatus: (s) => {
      if (s === 'live') {
        if (connectingEl) connectingEl.hidden = true;
        if (!state.held) setTimerRunning(true);
        postToParent({ type: 'firstcall:started' });
      } else if (s === 'mic_denied') {
        if (connectingEl) {
          connectingEl.hidden = false;
          connectingEl.textContent = 'Microphone access was blocked. Allow the microphone for this page and reload to take the call.';
        }
        setTimerRunning(false);
      }
    },
    onError: () => { /* status handler covers the user-facing side */ },
    onEnd: () => { /* End call drives the flow; ws-close alone changes nothing */ },
  });
  state.agent = agent;

  // The Answer click is the user gesture the AudioContext + mic need.
  agent.start().then((data) => {
    if (data && data.usage_id) state.usageId = data.usage_id;
  }).catch((err) => {
    const code = String(err && err.message || '');
    if (code === 'limit_reached') { renderCapped(); return; }
    if (code === 'invalid_token' || code === 'forbidden_scenario') { renderInactive(); return; }
    if (code !== 'mic_denied' && !String(code).includes('Permission')) {
      renderError(code);
    }
  });

  document.getElementById('call-pause')?.addEventListener('click', () => {
    state.held = !state.held;
    try { agent.setPaused(state.held); } catch { /* agent gone */ }
    setTimerRunning(!state.held);
    const btn = document.getElementById('call-pause');
    if (btn) {
      btn.textContent = state.held ? 'Take off hold' : 'Hold';
      btn.setAttribute('aria-pressed', String(state.held));
      btn.classList.toggle('is-paused', state.held);
    }
  });

  document.getElementById('end-call')?.addEventListener('click', () => endCall());
}

async function endCall() {
  const agent = state.agent;
  const transcript = agent ? agent.getTranscript() : [];
  const conversationId = agent ? agent.getConversationId() : null;
  const reservationNotes = state.posCtl ? state.posCtl.getCallbackNotes() : '';
  const durationS = Math.round(stopTimer() / 1000);
  teardownCall();

  // Log the call end regardless of how the scoring goes.
  postComplete(durationS, conversationId);

  if (transcript.length < 2) {
    renderMessageCard({
      title: 'That call was a little short.',
      text: 'There was not enough conversation to coach on. Take the call again and go at least a few exchanges before ending it.',
      buttonLabel: 'Take the call again',
      onButton: () => renderIntro(),
    });
    return;
  }

  renderMessageCard({
    eyebrow: 'Call complete',
    title: 'Analyzing your call…',
    text: 'Your coach is reviewing the conversation and the reservation you built. This takes a few seconds.',
  });

  let report;
  try {
    report = await postCoach(transcript);
  } catch (err) {
    renderMessageCard({
      title: 'The report did not come back.',
      text: 'Your call was recorded and counted, but the coaching report failed to generate. You can close this activity and continue the course.',
    });
    // The call itself still completes for the LMS, without a score.
    sendCompletion(null, durationS);
    return;
  }

  renderReport(report, reservationNotes, durationS);
}

function renderReport(report, reservationNotes, durationS) {
  root.innerHTML = `
    <div class="embed-report-wrap">
      <div class="embed-done-bar">
        <div class="embed-done-text">
          <strong>Nice work, you are done.</strong>
          <span>Your call and score have been recorded. Scroll through your coaching report below, then return to the course to continue.</span>
        </div>
      </div>
      <div id="embed-report-mount"></div>
    </div>
  `;
  const mount = document.getElementById('embed-report-mount');
  const reportEl = renderReportHtml(state.scenario, report, { reservationNotes });
  mount.appendChild(reportEl);
  // The report's own action buttons target the full app's navigation; the
  // embed's next step is "return to the course", so they are hidden in CSS.
  sendCompletion(Number(report.overall_score), durationS);
}

function sendCompletion(score, durationS) {
  if (state.completed) return;
  state.completed = true;
  postToParent({
    type: 'firstcall:complete',
    score: Number.isFinite(score) ? score : null,
    usageId: state.usageId,
    durationS: durationS || 0,
  });
}

// If the learner closes the course tab mid-call, best-effort close out the
// usage row so duration is not left open. sendBeacon survives page teardown;
// the server reads the same JSON body shape as a normal complete.
window.addEventListener('pagehide', () => {
  if (!state.agent || !state.usageId || state.completed) return;
  try {
    const payload = JSON.stringify({
      ct: CT,
      usage_id: state.usageId,
      duration_s: Math.round(timerElapsedMs() / 1000),
      conversation_id: state.agent.getConversationId ? state.agent.getConversationId() : null,
    });
    navigator.sendBeacon('/api/embed/complete', new Blob([payload], { type: 'application/json' }));
  } catch { /* page is going away; nothing else to do */ }
});

// ---- boot -----------------------------------------------------------------

async function boot() {
  postToParent({ type: 'firstcall:ready' });
  if (!CT) { renderInactive(); return; }
  try {
    state.scenario = await fetchScenario();
  } catch (err) {
    const code = String(err && err.message || '');
    if (code === 'invalid_token' || code === 'forbidden_scenario') renderInactive();
    else renderError(code);
    return;
  }
  renderIntro();
}

boot();
