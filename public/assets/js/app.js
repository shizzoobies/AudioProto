import { Conversation } from './conversation.js';
import { requestCoachingReport, renderReportHtml } from './coach.js';
import { AudioPlayer, attachVisualizer, synthesizeSentence, MicRecorder, transcribeAudio } from './audio.js';

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
  if (state.audioPlayer) {
    state.audioPlayer.destroy();
    state.audioPlayer = null;
  }
  if (state.micRecorder) {
    state.micRecorder.cancel();
    state.micRecorder = null;
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
        state.allPersonaIds.push(p.id);
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
    </section>
  `;

  dom.root.querySelectorAll('[data-call-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setCallMode(btn.dataset.callMode);
      renderPicker();
    });
  });
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
    await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
  } finally {
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
    .map(
      (t) => `
      <li class="scenario-card" data-scenario-id="${escapeAttr(t.id)}" tabindex="0" role="button" aria-label="Start scenario: ${escapeAttr(t.title)}">
        <div class="scenario-difficulty difficulty-${escapeAttr(t.difficulty)}">${capitalize(t.difficulty)}</div>
        <h2 class="scenario-title">${escapeHtml(t.title)}</h2>
        <p class="scenario-customer">${t.persona_count} different callers</p>
        <p class="scenario-description">${escapeHtml(t.description)}</p>
        <div class="scenario-cta">Start call <span aria-hidden="true">›</span></div>
      </li>
    `
    )
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

function startCall(typeOrPersonaId) {
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

  dom.root.innerHTML = `
    <section class="call" data-call-mode="${escapeAttr(state.callMode)}">
      <header class="call-header">
        <button class="ghost-button call-back" id="call-back" type="button">Back to scenarios</button>
        <div class="call-meta">
          <div class="call-customer-name">${escapeHtml(displayName)}</div>
          <div class="call-scenario-title">${escapeHtml(displayTitle)} <span class="call-mode-pill">${escapeHtml(modeBadge)}</span></div>
        </div>
        <button class="danger-button" id="end-call" type="button">End call</button>
      </header>
      ${isPhone ? `
      <div class="visualizer-wrap" id="visualizer-wrap" data-active="false">
        <canvas class="visualizer" id="visualizer"></canvas>
      </div>
      ` : ''}
      <ol class="transcript" id="transcript" aria-live="polite"></ol>
      <div class="composer-wrap" id="composer-wrap" data-mode="${escapeAttr(composerMode)}">
        <form class="composer" id="composer" autocomplete="off">
          <label class="visually-hidden" for="composer-input">Your message</label>
          <textarea
            id="composer-input"
            class="composer-input"
            placeholder="${escapeAttr(placeholder)}"
            rows="2"
          ></textarea>
          <button type="button" class="ptt-button" id="ptt-button" aria-label="Hold to talk" title="Hold to talk">
            <svg class="ptt-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/>
              <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
              <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span class="ptt-pulse" aria-hidden="true"></span>
            <span class="ptt-label">Hold to talk</span>
          </button>
          <button type="submit" class="composer-send" id="composer-send">Send</button>
        </form>
        <p class="composer-status" id="composer-status" aria-live="polite"></p>
      </div>
    </section>
  `;

  const transcript = document.getElementById('transcript');
  const visualizerWrap = document.getElementById('visualizer-wrap');
  const visualizerCanvas = document.getElementById('visualizer');

  const customerLabel = scenario.blind ? 'Caller' : scenario.customer_name;

  appendMessage(transcript, 'customer', customerLabel, scenario.opening_line);

  const composer = document.getElementById('composer');
  const composerWrap = document.getElementById('composer-wrap');
  const composerInput = document.getElementById('composer-input');
  const composerSend = document.getElementById('composer-send');
  const composerStatus = document.getElementById('composer-status');
  const pttButton = document.getElementById('ptt-button');
  const endCallBtn = document.getElementById('end-call');
  const backBtn = document.getElementById('call-back');

  const audioPlayer = new AudioPlayer({
    onStart: () => { if (visualizerWrap) visualizerWrap.dataset.active = 'true'; },
    onEnd: () => { if (visualizerWrap) visualizerWrap.dataset.active = 'false'; },
    onError: (err) => console.warn('audio error', err),
  });
  state.audioPlayer = audioPlayer;
  audioPlayer.setMuted(state.audioMuted);

  if (visualizerCanvas) {
    state.visualizerCleanup = attachVisualizer(
      visualizerCanvas,
      () => {
        if (state.micRecorder?.isRecording()) {
          return state.micRecorder.getAnalyser();
        }
        return audioPlayer.getAnalyser();
      },
      {
        getColor: () => state.micRecorder?.isRecording() ? '#60a5fa' : '#f5a524',
      }
    );
  }

  // Speak the opening line as soon as user lands in the call.
  speakSentence(scenario.opening_line);

  function speakSentence(text) {
    if (state.audioMuted) return;
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    const controller = new AbortController();
    state.ttsControllers.add(controller);
    synthesizeSentence({ scenarioId: scenario.id, text: trimmed, signal: controller.signal })
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

  function setInputMode(mode) {
    if (!['text', 'voice', 'both'].includes(mode)) return;
    state.inputMode = mode;
    composerWrap.dataset.mode = mode;
  }

  let recordingActive = false;
  let recordingCancelled = false;

  async function startRecording() {
    if (recordingActive) return;
    if (state.micDenied) {
      setStatus('Mic access was denied. Switch to Text mode or grant permission and reload.');
      return;
    }
    if (conversation.isStreaming()) {
      setStatus('Wait for the customer to finish before you talk.');
      return;
    }
    try {
      state.micRecorder = new MicRecorder();
      await state.micRecorder.start();
      recordingActive = true;
      recordingCancelled = false;
      pttButton.dataset.state = 'recording';
      pttButton.querySelector('.ptt-label').textContent = 'Listening...';
      setStatus('Recording. Release to send.');
      if (visualizerWrap) {
        visualizerWrap.dataset.active = 'true';
        visualizerWrap.dataset.source = 'mic';
      }
    } catch (err) {
      if (err.message === 'mic_denied') {
        state.micDenied = true;
        setStatus('Mic access denied. Switching to Text mode.');
        setInputMode('text');
      } else if (err.message === 'mic_unsupported') {
        setStatus('Your browser does not support mic input. Switching to Text mode.');
        setInputMode('text');
      } else {
        setStatus(`Could not start the mic (${err.message || 'unknown'}).`);
      }
      state.micRecorder = null;
      recordingActive = false;
    }
  }

  async function stopRecording() {
    if (!recordingActive || !state.micRecorder) return;
    recordingActive = false;
    pttButton.dataset.state = 'transcribing';
    pttButton.querySelector('.ptt-label').textContent = 'Transcribing...';
    setStatus('Transcribing...');
    if (visualizerWrap) {
      visualizerWrap.dataset.active = audioPlayer.playing ? 'true' : 'false';
      visualizerWrap.dataset.source = 'tts';
    }
    let blob;
    try {
      blob = await state.micRecorder.stop();
    } catch (err) {
      setStatus(`Recording stopped unexpectedly (${err.message || 'unknown'}).`);
      resetPttButton();
      state.micRecorder = null;
      return;
    }
    state.micRecorder = null;
    if (recordingCancelled || !blob || blob.size < 800) {
      setStatus(recordingCancelled ? '' : 'That was too short to transcribe. Try holding a bit longer.');
      resetPttButton();
      return;
    }
    const sttController = new AbortController();
    state.sttController = sttController;
    try {
      const transcript = await transcribeAudio(blob, { signal: sttController.signal });
      if (sttController.signal.aborted) return;
      if (!transcript) {
        setStatus('We could not hear anything in that clip.');
        resetPttButton();
        return;
      }
      composerInput.value = transcript;
      resetPttButton();
      setStatus('');
      // Auto-send after transcription
      composer.requestSubmit();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setStatus(`Transcription failed (${err.message || 'unknown'}).`);
      resetPttButton();
    } finally {
      if (state.sttController === sttController) state.sttController = null;
    }
  }

  function cancelRecording() {
    if (!recordingActive) return;
    recordingCancelled = true;
    if (state.micRecorder) {
      state.micRecorder.cancel();
      state.micRecorder = null;
    }
    recordingActive = false;
    if (visualizerWrap) {
      visualizerWrap.dataset.active = audioPlayer.playing ? 'true' : 'false';
      visualizerWrap.dataset.source = 'tts';
    }
    resetPttButton();
    setStatus('');
  }

  function resetPttButton() {
    pttButton.dataset.state = 'idle';
    pttButton.querySelector('.ptt-label').textContent = 'Hold to talk';
  }

  function setStatus(text) {
    composerStatus.textContent = text || '';
  }

  // PTT: mouse + touch + keyboard (Space)
  pttButton.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pttButton.setPointerCapture?.(e.pointerId);
    clearSilenceTimer();
    startRecording();
  });
  pttButton.addEventListener('pointerup', (e) => {
    e.preventDefault();
    pttButton.releasePointerCapture?.(e.pointerId);
    stopRecording();
  });
  pttButton.addEventListener('pointercancel', () => cancelRecording());
  pttButton.addEventListener('pointerleave', (e) => {
    if (recordingActive && !pttButton.hasPointerCapture?.(e.pointerId)) {
      // pointer dragged off without capture; let pointerup still handle it
    }
  });
  pttButton.addEventListener('contextmenu', (e) => e.preventDefault());

  state.pttKeyHandlers = { down: pttKeyHandler, up: pttKeyUpHandler };
  document.addEventListener('keydown', pttKeyHandler);
  document.addEventListener('keyup', pttKeyUpHandler);

  function pttKeyHandler(e) {
    if (state.view !== 'call') return;
    if (e.code !== 'Space') return;
    if (state.inputMode === 'text') return;
    if (document.activeElement === composerInput) return;
    if (e.repeat) return;
    e.preventDefault();
    startRecording();
  }
  function pttKeyUpHandler(e) {
    if (e.code !== 'Space') return;
    if (state.view !== 'call') return;
    if (!recordingActive) return;
    e.preventDefault();
    stopRecording();
  }

  function setComposerEnabled(enabled) {
    composerInput.disabled = !enabled;
    composerSend.disabled = !enabled;
    composerSend.textContent = enabled ? 'Send' : 'Sending';
  }
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

init();
