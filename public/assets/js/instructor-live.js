// Instructor Live Mode: the instructor's screen. The top is a FULL clone of the
// trainee's POS (their actual screen, rendered in an isolated frame with the app
// stylesheet so it looks identical, polled ~1s). Below it is an expandable
// "Coaching notes & customer crib" whose sections auto-surface as the trainee
// reaches the step where they matter. A pop-out button opens just the screen in
// its own window for a second monitor. No AI, no audio. Talks only to
// /api/live/state and /api/live/dossier, gated by the cs_live instructor cookie.

const POLL_MS = 1200;
const POS_STEPS = ['Details', 'Equipment', 'Location', 'Time', 'Checkout'];
const PHASE_STEPS = { 1: [1], 2: [1], 3: [2], 4: [2, 3], 5: [3, 4], 6: [4], 7: [5], 8: [5] };
const STEP_HINTS = {
  1: 'Greeting + understand the move. Let them lead; you answer one thing at a time.',
  2: 'They size and price the truck. Watch for a confident 26ft recommendation and a clean quote.',
  3: 'Location / availability. Good moment to start building urgency on the real deadline.',
  4: 'Scheduling + the close. Surface your objections here, then let them ask for the business.',
  5: 'Checkout. Hand over contact + card one piece at a time. Watch for read-back and confirm.',
};

const SCREEN_ONLY = (() => {
  try {
    return new URLSearchParams(window.location.search).get('view') === 'screen';
  } catch {
    return false;
  }
})();

const root = document.getElementById('ilm-root');
let dossier = null;
let pollTimer = null;
let lastFocusStep = null;
let lastHtml = null;
let saving = false;

boot();

async function boot() {
  const data = await fetchState();
  if (!data || data.role !== 'instructor') {
    renderMessage(
      'Instructor view unavailable',
      data && data.active === false
        ? 'This practice session has ended. Ask whoever set it up to start a new one.'
        : 'This link is not active. It may have expired or been revoked. Open the instructor link again, or contact whoever set up the session.'
    );
    return;
  }
  if (!SCREEN_ONLY) {
    try {
      const r = await fetch('/api/live/dossier', { credentials: 'same-origin' });
      if (r.ok) dossier = await r.json();
    } catch {
      dossier = null;
    }
  }
  renderShell(data);
  if (!SCREEN_ONLY) {
    renderDossier();
    hydrateDebrief(data.instructor_meta);
  }
  renderMirror(data);
  startPolling();
}

async function fetchState() {
  try {
    const r = await fetch('/api/live/state', { credentials: 'same-origin' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    const data = await fetchState();
    if (!data) return;
    renderMirror(data);
    updateStatus(data);
    if (!data.active) stopPolling();
  }, POLL_MS);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ---- Shell -----------------------------------------------------------------

function renderShell(data) {
  const label = data.label ? ` · ${esc(data.label)}` : '';
  const popout = SCREEN_ONLY
    ? ''
    : `<button class="screen-popout" id="ilm-popout" title="Open the trainee screen in its own window">Pop out screen ⧉</button>`;
  const cribBelow = SCREEN_ONLY
    ? ''
    : `<details class="card crib" id="ilm-crib" open>
         <summary>Coaching notes &amp; customer crib</summary>
         <div class="crib-body">
           <div id="ilm-dossier"></div>
           <div class="card" id="ilm-debrief"></div>
         </div>
       </details>`;
  root.innerHTML = `
    <header class="ilm-header">
      <span class="ilm-brand"><span class="o">Live</span> Mode</span>
      <span class="ilm-sub">${SCREEN_ONLY ? 'Trainee screen' : 'Instructor view'}${label}</span>
      <div class="ilm-status">
        <span id="ilm-updated" class="ilm-sub"></span>
        <span class="pill" id="ilm-pill" data-state="active"><span class="dot"></span><span id="ilm-pill-text">Active</span></span>
      </div>
    </header>
    <div class="ilm-nowbar" id="ilm-nowbar"></div>
    <div class="ilm-wrap${SCREEN_ONLY ? ' screen-only' : ''}">
      <div class="screen-head">
        <div class="col-title">Trainee screen (live)</div>
        ${popout}
      </div>
      <div class="screen-shell"><iframe id="ilm-frame" title="Live trainee screen" scrolling="no"></iframe></div>
      ${cribBelow}
    </div>`;
  updateStatus(data);
  const pop = document.getElementById('ilm-popout');
  if (pop) {
    pop.addEventListener('click', () => {
      window.open(`${window.location.pathname}?view=screen`, 'ilm_screen', 'width=1180,height=940,noopener=0');
    });
  }
}

function updateStatus(data) {
  const pill = document.getElementById('ilm-pill');
  const pillText = document.getElementById('ilm-pill-text');
  const updated = document.getElementById('ilm-updated');
  if (pill) pill.dataset.state = data.active ? 'active' : 'ended';
  if (pillText) pillText.textContent = data.active ? 'Active' : 'Ended';
  if (updated) updated.textContent = data.updated_at ? `Updated ${timeAgo(data.updated_at)}` : 'Waiting for the trainee...';
}

// ---- Mirror (full POS clone in an isolated frame) --------------------------

function renderMirror(data) {
  const st = data && data.state;
  const stepN = (st && st.step && st.step.n) || 1;
  const stepTitle = (st && st.step && st.step.title) || POS_STEPS[stepN - 1] || '';
  updateNowBar(stepN, stepTitle);
  if (!SCREEN_ONLY) focusDossierForStep(stepN);
  renderScreen(st && typeof st.html === 'string' ? st.html : '');
}

function renderScreen(html) {
  const frame = document.getElementById('ilm-frame');
  if (!frame) return;
  if (!html) {
    if (lastHtml !== '') {
      lastHtml = '';
      writeFrame(frame, '<div style="font-family:Inter,system-ui,sans-serif;color:#5b6270;padding:28px;">Waiting for the trainee to open the reservation screen...</div>', false);
    }
    return;
  }
  if (html === lastHtml) {
    resizeFrame(frame); // late reflow / image load
    return;
  }
  lastHtml = html;
  writeFrame(frame, `<main class="app-main">${html}</main>`, true);
}

// Render content into the isolated about:blank iframe with the app stylesheet, so
// the POS clone looks exactly like the trainee's screen without the app styles
// leaking into the instructor chrome. Non-interactive (watch only).
function writeFrame(frame, bodyHtml, appContext) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const head = appContext
    ? `<link rel="stylesheet" href="/assets/css/styles.css">
       <style>
         html,body{margin:0;background:#fff;}
         .call-header .call-actions,#call-back,#call-dock,#orb-zone,#transcript,#visualizer-wrap{display:none!important;}
         .call,.call *{pointer-events:none!important;}
         .call-body{padding-bottom:10px!important;}
       </style>`
    : '<style>html,body{margin:0;background:#fff;}</style>';
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8">${head}</head><body class="app-page" data-app-state="ready" data-view="call">${bodyHtml}</body></html>`);
  doc.close();
  frame.onload = () => resizeFrame(frame);
  // The stylesheet loads async; re-measure a few times as it applies.
  [120, 450, 900, 1600].forEach((ms) => setTimeout(() => resizeFrame(frame), ms));
}

function resizeFrame(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return;
    const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight || 0);
    if (h > 0) frame.style.height = `${h + 4}px`;
  } catch {
    // cross-origin should never happen for about:blank; ignore
  }
}

function updateNowBar(stepN, stepTitle) {
  const bar = document.getElementById('ilm-nowbar');
  if (!bar) return;
  const hint = STEP_HINTS[stepN] || '';
  bar.innerHTML = `<span class="now-tag">Trainee is on</span> <strong>Step ${stepN}: ${esc(stepTitle || POS_STEPS[stepN - 1] || '')}</strong>${
    hint ? ` <span class="now-hint">${esc(hint)}</span>` : ''
  }`;
}

// ---- Dossier (step-aware collapsible, below the screen) --------------------

function renderDossier() {
  const el = document.getElementById('ilm-dossier');
  if (!el) return;
  if (!dossier) {
    el.innerHTML = `<div class="card"><div class="muted">Customer crib could not load. Refresh the page.</div></div>`;
    return;
  }
  const d = dossier;
  el.innerHTML = `
    <div class="card">
      <h3>${esc(d.customer_name || 'Robert')} · ${esc(d.title || '')}</h3>
      <p style="font-size:13px;margin:0 0 6px;color:var(--grey);">${esc(d.headline || '')}</p>
      <p style="font-size:13px;margin:0;">${esc(d.how_to_use || '')}</p>
    </div>
    ${section('Scenario snapshot', rows(d.snapshot, 'snap'), '1')}
    ${
      Array.isArray(d.opening_lines) && d.opening_lines.length
        ? section('Opening lines (he says one of these)', `<ul class="tips">${d.opening_lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`, '1')
        : ''
    }
    ${d.timeline ? section('Move timeline', `<div class="timeline">${esc(d.timeline)}</div>`, '1 2') : ''}
    ${section('Key facts (truck, price, contact, card)', `<div class="facts">${rows(d.key_facts, 'snap')}</div>`, '2 5')}
    ${
      Array.isArray(d.objections) && d.objections.length
        ? section(
            'The three objections (and what resolves each)',
            d.objections.map((o) => `<div class="obj"><div class="name">${esc(o.name)}</div><div class="res">${esc(o.resolves)}</div></div>`).join(''),
            '3 4'
          )
        : ''
    }
    ${
      Array.isArray(d.script) && d.script.length
        ? `<div class="card"><h3>Ideal-path script</h3>${d.script.map(renderPhase).join('')}</div>`
        : ''
    }
    ${
      Array.isArray(d.cheat_sheet) && d.cheat_sheet.length
        ? section(
            'Objection cheat sheet',
            `<table class="cheat"><thead><tr><th>He says</th><th>You say</th></tr></thead><tbody>${d.cheat_sheet
              .map((c) => `<tr><td class="says">${esc(c.says)}</td><td>${esc(c.reply)}</td></tr>`)
              .join('')}</tbody></table>`,
            '3 4 5'
          )
        : ''
    }
    ${
      Array.isArray(d.presenter_tips) && d.presenter_tips.length
        ? section('Presenter tips', `<ul class="tips">${d.presenter_tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`, '')
        : ''
    }`;
}

function section(title, inner, steps) {
  return `<details class="card guide" data-steps="${esc(steps || '')}"><summary>${esc(title)}</summary><div class="guide-body">${inner}</div></details>`;
}

function renderPhase(p) {
  const lines = (p.lines || [])
    .map((l) => `<div class="line ${l.who === 'agent' ? 'agent' : 'robert'}"><span class="who">${l.who === 'agent' ? 'AGENT' : 'ROBERT'}</span>${esc(l.text)}</div>`)
    .join('');
  const note = p.note ? `<div class="line"><span class="note-txt">▸ ${esc(p.note)}</span></div>` : '';
  const steps = (PHASE_STEPS[p.phase] || []).join(' ');
  return `<details class="phase guide" data-steps="${esc(steps)}"><summary><span class="pn">PHASE ${esc(String(p.phase))}</span>${esc(p.label || '')}</summary><div style="padding:8px 0;">${lines}${note}</div></details>`;
}

function focusDossierForStep(stepN) {
  if (stepN === lastFocusStep) return;
  lastFocusStep = stepN;
  document.querySelectorAll('[data-steps]').forEach((node) => {
    const raw = node.getAttribute('data-steps') || '';
    const relevant = raw.split(/\s+/).filter(Boolean).map(Number).includes(stepN);
    if (node.tagName === 'DETAILS') node.open = relevant;
    node.classList.toggle('active-guide', relevant);
  });
}

// ---- Debrief ---------------------------------------------------------------

function hydrateDebrief(meta) {
  const el = document.getElementById('ilm-debrief');
  if (!el) return;
  const criteria =
    dossier && Array.isArray(dossier.success_criteria) && dossier.success_criteria.length
      ? dossier.success_criteria
      : [
          'Understood the move before pitching',
          'Recommended and priced the right truck',
          'Built genuine urgency on the real deadline',
          'Handled the Beth stall and the big-truck nerves',
          'Clearly asked for the business',
          'Read back and confirmed the reservation',
        ];
  const checked = meta && Array.isArray(meta.checklist) ? meta.checklist : [];
  const notesVal = meta && typeof meta.notes === 'string' ? meta.notes : '';

  el.innerHTML = `
    <h3>End-of-session debrief</h3>
    <p style="font-size:12.5px;color:var(--grey);margin:0 0 8px;">Score against the call goals, jot a note, and save. This is for your records, no AI involved.</p>
    <ul class="check-list" id="ilm-checklist">
      ${criteria.map((c, i) => `<li><input type="checkbox" id="ck-${i}" ${checked.includes(i) ? 'checked' : ''}><label for="ck-${i}">${esc(c)}</label></li>`).join('')}
    </ul>
    <div style="margin-top:12px;">
      <textarea class="debrief" id="ilm-debrief-notes" placeholder="What went well, what to work on next time...">${esc(notesVal)}</textarea>
    </div>
    <div class="btn-row">
      <button class="primary" id="ilm-save">Save debrief</button>
      <button class="danger" id="ilm-end">End session</button>
    </div>
    <div class="save-note" id="ilm-save-note"></div>`;

  document.getElementById('ilm-save').addEventListener('click', () => saveDebrief(false));
  document.getElementById('ilm-end').addEventListener('click', () => {
    if (confirm('End this practice session? The trainee link will stop working.')) saveDebrief(true);
  });
}

function collectMeta() {
  const checklist = [];
  document.querySelectorAll('#ilm-checklist input[type="checkbox"]').forEach((cb, i) => {
    if (cb.checked) checklist.push(i);
  });
  const notes = document.getElementById('ilm-debrief-notes')?.value || '';
  return { checklist, notes, saved_at: Math.floor(Date.now() / 1000) };
}

async function saveDebrief(end) {
  if (saving) return;
  saving = true;
  const note = document.getElementById('ilm-save-note');
  const saveBtn = document.getElementById('ilm-save');
  const endBtn = document.getElementById('ilm-end');
  if (saveBtn) saveBtn.disabled = true;
  if (endBtn) endBtn.disabled = true;
  if (note) note.textContent = end ? 'Ending session...' : 'Saving...';
  try {
    const body = { instructor_meta: collectMeta() };
    if (end) body.end = true;
    const r = await fetch('/api/live/state', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`save_failed_${r.status}`);
    if (note) note.textContent = end ? 'Session ended. The trainee link is now inactive.' : 'Saved.';
    if (end) {
      stopPolling();
      const pill = document.getElementById('ilm-pill');
      const pillText = document.getElementById('ilm-pill-text');
      if (pill) pill.dataset.state = 'ended';
      if (pillText) pillText.textContent = 'Ended';
    }
  } catch (e) {
    if (note) note.textContent = 'Could not save. Check your connection and try again.';
  } finally {
    saving = false;
    if (saveBtn) saveBtn.disabled = false;
    if (endBtn) endBtn.disabled = false;
  }
}

// ---- helpers ---------------------------------------------------------------

function renderMessage(title, body) {
  root.innerHTML = `<div class="ilm-message"><div class="box"><h1>${esc(title)}</h1><p>${esc(body)}</p></div></div>`;
}

function rows(list, cls) {
  if (!Array.isArray(list) || !list.length) return '<div class="muted">—</div>';
  return list.map((r) => `<div class="snap-row ${cls || ''}"><span class="lbl">${esc(r.label)}</span><span>${esc(r.value)}</span></div>`).join('');
}

function timeAgo(unixSeconds) {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - Number(unixSeconds || 0));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
