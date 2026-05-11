import { Conversation } from './conversation.js';
import { requestCoachingReport, renderReportHtml } from './coach.js';
import { AudioPlayer, attachVisualizer, synthesizeSentence } from './audio.js';

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
}

const dom = {
  root: document.getElementById('app-root'),
  signOut: document.getElementById('sign-out'),
};

async function init() {
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
  renderPicker();

  dom.signOut.addEventListener('click', signOut);
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

  dom.root.innerHTML = `
    <section class="picker">
      <header class="picker-header">
        <h1 class="picker-title">Choose a scenario</h1>
        <p class="picker-subtitle">Each scenario is a different customer with a different problem. Pick one and step into the call.</p>
      </header>
      <ul class="scenario-grid">${cards}</ul>
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
  const scenario = state.scenarioById.get(scenarioId);
  if (!scenario) return;
  state.activeScenario = scenario;
  renderCall(scenario);
}

function renderCall(scenario) {
  state.view = 'call';
  teardownAudio();

  dom.root.innerHTML = `
    <section class="call">
      <header class="call-header">
        <button class="ghost-button call-back" id="call-back" type="button">Back to scenarios</button>
        <div class="call-meta">
          <div class="call-customer-name">${escapeHtml(scenario.customer_name)}</div>
          <div class="call-scenario-title">${escapeHtml(scenario.title)}</div>
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
      <form class="composer" id="composer" autocomplete="off">
        <label class="visually-hidden" for="composer-input">Your message</label>
        <textarea
          id="composer-input"
          class="composer-input"
          placeholder="Type your response..."
          rows="2"
        ></textarea>
        <button type="submit" class="composer-send" id="composer-send">Send</button>
      </form>
    </section>
  `;

  const transcript = document.getElementById('transcript');
  const visualizerWrap = document.getElementById('visualizer-wrap');
  const visualizerCanvas = document.getElementById('visualizer');
  const muteToggle = document.getElementById('mute-toggle');
  const muteLabel = muteToggle.querySelector('.mute-label');
  const muteIcon = muteToggle.querySelector('.mute-icon');

  appendMessage(transcript, 'customer', scenario.customer_name, scenario.opening_line);

  const composer = document.getElementById('composer');
  const composerInput = document.getElementById('composer-input');
  const composerSend = document.getElementById('composer-send');
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

  state.visualizerCleanup = attachVisualizer(visualizerCanvas, () => audioPlayer.getAnalyser());

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
    onAssistantStart: () => startStreamingBubble(scenario.customer_name),
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

  function setComposerEnabled(enabled) {
    composerInput.disabled = !enabled;
    composerSend.disabled = !enabled;
    composerSend.textContent = enabled ? 'Send' : 'Sending';
  }
}

async function runCoaching(scenario, messages) {
  state.view = 'analyzing';
  renderAnalyzing(scenario);

  try {
    const report = await requestCoachingReport(scenario.id, messages);
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
