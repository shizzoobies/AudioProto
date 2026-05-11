import { Conversation } from './conversation.js';

const state = {
  scenarios: [],
  scenarioById: new Map(),
  view: 'picker',
  activeScenario: null,
  conversation: null,
};

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

  dom.root.innerHTML = `
    <section class="call">
      <header class="call-header">
        <button class="ghost-button call-back" id="call-back" type="button">Back to scenarios</button>
        <div class="call-meta">
          <div class="call-customer-name">${escapeHtml(scenario.customer_name)}</div>
          <div class="call-scenario-title">${escapeHtml(scenario.title)}</div>
        </div>
        <button class="danger-button" id="end-call" type="button">End call</button>
      </header>
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
  appendMessage(transcript, 'customer', scenario.customer_name, scenario.opening_line);

  const composer = document.getElementById('composer');
  const composerInput = document.getElementById('composer-input');
  const composerSend = document.getElementById('composer-send');
  const endCallBtn = document.getElementById('end-call');
  const backBtn = document.getElementById('call-back');

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
    conversation.cancel();
    renderEnded(scenario, conversation.getMessages());
  });

  backBtn.addEventListener('click', () => {
    conversation.cancel();
    renderPicker();
  });

  function setComposerEnabled(enabled) {
    composerInput.disabled = !enabled;
    composerSend.disabled = !enabled;
    composerSend.textContent = enabled ? 'Send' : 'Sending';
  }
}

function renderEnded(scenario, _messages) {
  state.view = 'ended';

  dom.root.innerHTML = `
    <section class="ended">
      <h1 class="ended-title">Call ended.</h1>
      <p class="ended-text">In Phase 3 this is where your coaching report will appear.</p>
      <div class="ended-actions">
        <button class="primary-button" id="new-call" type="button">New call</button>
      </div>
    </section>
  `;

  document.getElementById('new-call').addEventListener('click', renderPicker);
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
