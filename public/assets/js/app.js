import { Conversation } from './conversation.js';
import { requestCoachingReport, renderReportHtml } from './coach.js';
import { AudioPlayer, attachVisualizer, synthesizeSentence, MicRecorder, transcribeAudio } from './audio.js';

const state = {
  scenarios: [],
  scenarioById: new Map(),
  view: 'picker',
  activeScenario: null,
  conversation: null,
  audioPlayer: null,
  visualizerCleanup: null,
  audioMuted: false,
  ttsControllers: new Set(),
  micRecorder: null,
  micDenied: false,
  inputMode: 'both',
  pttKeyHandlers: null,
  sttController: null,
};

function teardownAudio() {
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
    state.scenarios = data.scenarios || [];
    state.scenarioById = new Map(state.scenarios.map((s) => [s.id, s]));
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
          Customers speak through your speakers as they think. You can speak back.
        </li>
        <li>
          <strong>Coaching report</strong>
          Six dimensions, quoted evidence, mood snapshot, and one thing to try next time.
        </li>
      </ul>

      <div class="welcome-grid">
        <div class="mode-card">
          <div class="mode-card-label">Your side</div>
          <h2 class="mode-card-title">How you respond</h2>
          <div class="mode-toggle mode-toggle-large" role="radiogroup" aria-label="Your input mode" data-group="input">
            <button class="mode-option" data-input-mode="text" role="radio" aria-checked="${state.inputMode === 'text'}" type="button">Type</button>
            <button class="mode-option" data-input-mode="both" role="radio" aria-checked="${state.inputMode === 'both'}" type="button">Either</button>
            <button class="mode-option" data-input-mode="voice" role="radio" aria-checked="${state.inputMode === 'voice'}" type="button">Speak</button>
          </div>
          <p class="mode-card-hint" id="welcome-input-hint"></p>
        </div>

        <div class="mode-card">
          <div class="mode-card-label">Their side</div>
          <h2 class="mode-card-title">How the customer responds</h2>
          <div class="mode-toggle mode-toggle-large" role="radiogroup" aria-label="Customer voice" data-group="customer">
            <button class="mode-option" data-customer-mode="voice" role="radio" aria-checked="${!state.audioMuted}" type="button">Voice</button>
            <button class="mode-option" data-customer-mode="text" role="radio" aria-checked="${state.audioMuted}" type="button">Text only</button>
          </div>
          <p class="mode-card-hint" id="welcome-customer-hint"></p>
        </div>
      </div>

      <div class="welcome-actions">
        <button class="primary-button welcome-cta" id="welcome-start" type="button">Pick a scenario <span aria-hidden="true">›</span></button>
      </div>
    </section>
  `;

  const inputButtons = dom.root.querySelectorAll('[data-input-mode]');
  const customerButtons = dom.root.querySelectorAll('[data-customer-mode]');
  const inputHint = document.getElementById('welcome-input-hint');
  const customerHint = document.getElementById('welcome-customer-hint');

  const inputHints = {
    text: 'You type. Fastest for quiet environments.',
    both: 'Type or hold the mic. Mix as you go.',
    voice: 'Hold to talk. Closest to a real phone call.',
  };
  const customerHints = {
    voice: 'You will hear each customer through your speakers.',
    text: 'The customer appears as text only. No audio.',
  };

  function refresh() {
    inputButtons.forEach((b) => {
      const active = b.dataset.inputMode === state.inputMode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', String(active));
    });
    customerButtons.forEach((b) => {
      const isVoice = b.dataset.customerMode === 'voice';
      const active = isVoice ? !state.audioMuted : state.audioMuted;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', String(active));
    });
    inputHint.textContent = inputHints[state.inputMode] || '';
    customerHint.textContent = customerHints[state.audioMuted ? 'text' : 'voice'];
  }
  refresh();

  inputButtons.forEach((b) => {
    b.addEventListener('click', () => {
      state.inputMode = b.dataset.inputMode;
      refresh();
    });
  });
  customerButtons.forEach((b) => {
    b.addEventListener('click', () => {
      state.audioMuted = b.dataset.customerMode === 'text';
      refresh();
    });
  });

  document.getElementById('welcome-start').addEventListener('click', renderPicker);
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

  const cards = state.scenarios
    .map(
      (s) => `
      <li class="scenario-card" data-scenario-id="${escapeAttr(s.id)}" tabindex="0" role="button" aria-label="Start scenario: ${escapeAttr(s.title)}">
        <div class="scenario-difficulty difficulty-${escapeAttr(s.difficulty)}">${capitalize(s.difficulty)}</div>
        <h2 class="scenario-title">${escapeHtml(s.title)}</h2>
        <p class="scenario-customer">${escapeHtml(s.customer_short)}</p>
        <p class="scenario-description">${escapeHtml(s.description)}</p>
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
      <p class="scenario-description">Pick one of the five at random. You will not know who is on the line until you take the call.</p>
      <div class="scenario-cta">Take the call <span aria-hidden="true">›</span></div>
    </li>
  `;

  dom.root.innerHTML = `
    <section class="picker">
      <header class="picker-header">
        <h1 class="picker-title">Choose a scenario</h1>
        <p class="picker-subtitle">Each scenario is a different customer with a different problem. Pick one, or hit Surprise me to be tested cold.</p>
      </header>
      <ul class="scenario-grid">${cards}${randomCard}</ul>
    </section>
  `;

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

function startCall(scenarioId) {
  let blind = false;
  let resolvedId = scenarioId;
  if (scenarioId === '__random__') {
    blind = true;
    const ids = state.scenarios.map((s) => s.id);
    if (!ids.length) return;
    resolvedId = ids[Math.floor(Math.random() * ids.length)];
  }
  const base = state.scenarioById.get(resolvedId);
  if (!base) return;
  const lines = Array.isArray(base.opening_lines) && base.opening_lines.length
    ? base.opening_lines
    : [base.opening_line || ''];
  const chosen = lines[Math.floor(Math.random() * lines.length)] || '';
  state.activeScenario = { ...base, opening_line: chosen, blind };
  renderCall(state.activeScenario);
}

function renderCall(scenario) {
  state.view = 'call';
  setDocumentTitle(scenario.blind ? 'Live call' : `Call: ${scenario.customer_name}`);
  teardownAudio();

  const displayName = scenario.blind ? 'Caller' : scenario.customer_name;
  const displayTitle = scenario.blind ? 'Incoming call' : scenario.title;

  dom.root.innerHTML = `
    <section class="call">
      <header class="call-header">
        <button class="ghost-button call-back" id="call-back" type="button">Back to scenarios</button>
        <div class="call-meta">
          <div class="call-customer-name">${escapeHtml(displayName)}</div>
          <div class="call-scenario-title">${escapeHtml(displayTitle)}</div>
        </div>
        <div class="call-actions">
          <button class="ghost-button mute-toggle" id="mute-toggle" type="button" aria-pressed="false" title="Mute customer audio">
            <span class="mute-icon mute-on" aria-hidden="true">●</span>
            <span class="mute-label">Audio on</span>
          </button>
          <button class="danger-button" id="end-call" type="button">End call</button>
        </div>
      </header>
      <div class="visualizer-wrap" id="visualizer-wrap" data-active="false">
        <canvas class="visualizer" id="visualizer"></canvas>
      </div>
      <ol class="transcript" id="transcript" aria-live="polite"></ol>
      <div class="composer-wrap" id="composer-wrap" data-mode="${escapeAttr(state.inputMode)}">
        <div class="mode-toggle" role="radiogroup" aria-label="Input mode">
          <button class="mode-option" data-mode="text" role="radio" aria-checked="${state.inputMode === 'text'}" type="button">Text</button>
          <button class="mode-option" data-mode="both" role="radio" aria-checked="${state.inputMode === 'both'}" type="button">Both</button>
          <button class="mode-option" data-mode="voice" role="radio" aria-checked="${state.inputMode === 'voice'}" type="button">Voice</button>
        </div>
        <form class="composer" id="composer" autocomplete="off">
          <label class="visually-hidden" for="composer-input">Your message</label>
          <textarea
            id="composer-input"
            class="composer-input"
            placeholder="Type your response, or hold the mic to speak..."
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
  const muteToggle = document.getElementById('mute-toggle');
  const muteLabel = muteToggle.querySelector('.mute-label');
  const muteIcon = muteToggle.querySelector('.mute-icon');

  const customerLabel = scenario.blind ? 'Caller' : scenario.customer_name;

  appendMessage(transcript, 'customer', customerLabel, scenario.opening_line);

  const composer = document.getElementById('composer');
  const composerWrap = document.getElementById('composer-wrap');
  const composerInput = document.getElementById('composer-input');
  const composerSend = document.getElementById('composer-send');
  const composerStatus = document.getElementById('composer-status');
  const pttButton = document.getElementById('ptt-button');
  const modeButtons = composerWrap.querySelectorAll('.mode-option');
  const endCallBtn = document.getElementById('end-call');
  const backBtn = document.getElementById('call-back');

  const audioPlayer = new AudioPlayer({
    onStart: () => visualizerWrap.dataset.active = 'true',
    onEnd: () => visualizerWrap.dataset.active = 'false',
    onError: (err) => console.warn('audio error', err),
  });
  state.audioPlayer = audioPlayer;
  audioPlayer.setMuted(state.audioMuted);
  updateMuteUI();

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

  muteToggle.addEventListener('click', () => {
    state.audioMuted = !state.audioMuted;
    audioPlayer.setMuted(state.audioMuted);
    updateMuteUI();
  });

  // Speak the opening line as soon as user lands in the call.
  speakSentence(scenario.opening_line);

  function updateMuteUI() {
    const muted = state.audioMuted;
    muteToggle.setAttribute('aria-pressed', String(muted));
    muteLabel.textContent = muted ? 'Audio off' : 'Audio on';
    muteIcon.classList.toggle('mute-on', !muted);
    muteIcon.classList.toggle('mute-off', muted);
    muteIcon.textContent = muted ? '○' : '●';
  }

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

  const conversation = new Conversation({
    scenario,
    onAssistantStart: () => startStreamingBubble(customerLabel),
    onAssistantDelta: (text) => appendToStreamingBubble(text),
    onAssistantEnd: () => endStreamingBubble(),
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

  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setInputMode(btn.dataset.mode);
    });
  });

  function setInputMode(mode) {
    if (!['text', 'voice', 'both'].includes(mode)) return;
    state.inputMode = mode;
    composerWrap.dataset.mode = mode;
    modeButtons.forEach((b) => {
      const active = b.dataset.mode === mode;
      b.setAttribute('aria-checked', String(active));
      b.classList.toggle('active', active);
    });
    if (mode === 'voice') {
      composerInput.value = '';
    }
    if (mode !== 'text') {
      composerInput.placeholder = 'Type, or hold the mic to speak...';
    } else {
      composerInput.placeholder = 'Type your response...';
    }
  }

  setInputMode(state.inputMode);

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
      visualizerWrap.dataset.active = 'true';
      visualizerWrap.dataset.source = 'mic';
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
    visualizerWrap.dataset.active = audioPlayer.playing ? 'true' : 'false';
    visualizerWrap.dataset.source = 'tts';
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
    visualizerWrap.dataset.active = audioPlayer.playing ? 'true' : 'false';
    visualizerWrap.dataset.source = 'tts';
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
