// Instructor Live Mode: the instructor's screen. Read-only mirror of the
// trainee's sales POS (polled ~1s) plus the customer dossier / role-play crib so
// the instructor can BE Robert live. No AI, no audio. Self-contained: it talks
// only to /api/live/state and /api/live/dossier, both gated by the cs_live
// instructor cookie set when the instructor link was opened.

const POLL_MS = 1200;
const POS_STEPS = ['Details', 'Equipment', 'Location', 'Time', 'Checkout'];

const root = document.getElementById('ilm-root');
let dossier = null;
let pollTimer = null;
let lastState = null;
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
  lastState = data;
  try {
    const r = await fetch('/api/live/dossier', { credentials: 'same-origin' });
    if (r.ok) dossier = await r.json();
  } catch {
    dossier = null;
  }
  renderShell(data);
  renderMirror(data);
  renderDossier();
  hydrateDebrief(data.instructor_meta);
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
    lastState = data;
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
  root.innerHTML = `
    <header class="ilm-header">
      <span class="ilm-brand"><span class="o">Live</span> Mode</span>
      <span class="ilm-sub">Instructor view${label}</span>
      <div class="ilm-status">
        <span id="ilm-updated" class="ilm-sub"></span>
        <span class="pill" id="ilm-pill" data-state="active"><span class="dot"></span><span id="ilm-pill-text">Active</span></span>
      </div>
    </header>
    <div class="ilm-wrap">
      <div>
        <div class="col-title">Trainee screen (live)</div>
        <div class="card">
          <h3>Reservation progress</h3>
          <div class="stepper" id="ilm-stepper"></div>
        </div>
        <div class="card" id="ilm-mirror"></div>
        <div class="card">
          <h3>Reservation notes</h3>
          <div class="notes-box" id="ilm-notes"></div>
        </div>
      </div>
      <div>
        <div class="col-title">Your customer: role-play crib</div>
        <div id="ilm-dossier"></div>
        <div class="card" id="ilm-debrief"></div>
      </div>
    </div>`;
  updateStatus(data);
}

function updateStatus(data) {
  const pill = document.getElementById('ilm-pill');
  const pillText = document.getElementById('ilm-pill-text');
  const updated = document.getElementById('ilm-updated');
  if (pill) pill.dataset.state = data.active ? 'active' : 'ended';
  if (pillText) pillText.textContent = data.active ? 'Active' : 'Ended';
  if (updated) updated.textContent = data.updated_at ? `Updated ${timeAgo(data.updated_at)}` : 'Waiting for the trainee...';
}

// ---- Mirror ----------------------------------------------------------------

function renderMirror(data) {
  renderStepper(data?.state?.step?.n || 1);
  const mirror = document.getElementById('ilm-mirror');
  const notes = document.getElementById('ilm-notes');
  const st = data?.state;
  if (!mirror) return;

  if (!st) {
    mirror.innerHTML = `<h3>Live fields</h3><div class="mirror-empty">Waiting for the trainee to start working the reservation...</div>`;
    if (notes) notes.textContent = '';
    return;
  }

  const rec =
    st.rec && (st.rec.truck || st.rec.rate)
      ? `<div class="rec-line"><span class="truck">${esc(st.rec.truck || '')}</span><span class="rate">${esc(st.rec.rate || '')}</span></div>`
      : '<div class="muted">No truck recommended yet.</div>';

  const lookup =
    st.lookup && (st.lookup.query || st.lookup.result)
      ? `<div class="kv"><dt>Lookup</dt><dd>${esc(st.lookup.query || '')}</dd>${
          st.lookup.result ? `<dt>Result</dt><dd>${esc(st.lookup.result)}</dd>` : ''
        }</div>`
      : '';

  const fields = st.fields && typeof st.fields === 'object' ? st.fields : {};
  const fieldKeys = Object.keys(fields).filter((k) => String(fields[k]).trim() !== '');
  const fieldsHtml = fieldKeys.length
    ? `<div class="kv">${fieldKeys
        .map((k) => `<dt>${esc(humanize(k))}</dt><dd>${esc(String(fields[k]))}</dd>`)
        .join('')}</div>`
    : '<div class="muted">No fields entered yet.</div>';

  const equip =
    Array.isArray(st.equipment) && st.equipment.length
      ? `<div class="kv"><dt>Add-ons</dt><dd>${esc(st.equipment.map(humanize).join(', '))}</dd></div>`
      : '';

  const cardStatus = st.card_status ? `<div class="kv"><dt>Checkout</dt><dd>${esc(st.card_status)}</dd></div>` : '';

  mirror.innerHTML = `
    <h3>Live fields <span class="muted" style="font-weight:400;">· Step ${esc(String(st.step?.n || 1))}${
    st.step?.title ? ` · ${esc(st.step.title)}` : ''
  }</span></h3>
    <div style="margin-bottom:10px;">${rec}</div>
    ${lookup}
    ${fieldsHtml}
    ${equip}
    ${cardStatus}`;

  if (notes) notes.textContent = st.notes ? st.notes : '';
}

function renderStepper(activeN) {
  const el = document.getElementById('ilm-stepper');
  if (!el) return;
  el.innerHTML = POS_STEPS.map((label, i) => {
    const n = i + 1;
    const cls = n === activeN ? 'active' : n < activeN ? 'done' : '';
    return `<div class="s ${cls}">${n}. ${esc(label)}</div>`;
  }).join('');
}

// ---- Dossier ---------------------------------------------------------------

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

    ${section('Scenario snapshot', rows(d.snapshot, 'snap'))}
    ${section('Key facts (for the on-screen reservation)', `<div class="facts">${rows(d.key_facts, 'snap')}</div>`)}
    ${d.timeline ? section('Move timeline', `<div class="timeline">${esc(d.timeline)}</div>`) : ''}
    ${
      Array.isArray(d.opening_lines) && d.opening_lines.length
        ? section('Opening lines (he says one of these)', `<ul class="tips">${d.opening_lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`)
        : ''
    }
    ${
      Array.isArray(d.objections) && d.objections.length
        ? section(
            'The three objections (and what resolves each)',
            d.objections.map((o) => `<div class="obj"><div class="name">${esc(o.name)}</div><div class="res">${esc(o.resolves)}</div></div>`).join('')
          )
        : ''
    }
    ${
      Array.isArray(d.script) && d.script.length
        ? section('Ideal-path script', d.script.map(renderPhase).join(''))
        : ''
    }
    ${
      Array.isArray(d.cheat_sheet) && d.cheat_sheet.length
        ? section(
            'Objection cheat sheet',
            `<table class="cheat"><thead><tr><th>He says</th><th>You say</th></tr></thead><tbody>${d.cheat_sheet
              .map((c) => `<tr><td class="says">${esc(c.says)}</td><td>${esc(c.reply)}</td></tr>`)
              .join('')}</tbody></table>`
          )
        : ''
    }
    ${
      Array.isArray(d.presenter_tips) && d.presenter_tips.length
        ? section('Presenter tips', `<ul class="tips">${d.presenter_tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`)
        : ''
    }`;
}

function renderPhase(p) {
  const lines = (p.lines || [])
    .map((l) => `<div class="line ${l.who === 'agent' ? 'agent' : 'robert'}"><span class="who">${l.who === 'agent' ? 'AGENT' : 'ROBERT'}</span>${esc(l.text)}</div>`)
    .join('');
  const note = p.note ? `<div class="line"><span class="note-txt">▸ ${esc(p.note)}</span></div>` : '';
  return `<details class="phase"><summary><span class="pn">PHASE ${esc(String(p.phase))}</span>${esc(p.label || '')}</summary><div style="padding:8px 0;">${lines}${note}</div></details>`;
}

function section(title, inner) {
  return `<div class="card"><h3>${esc(title)}</h3>${inner}</div>`;
}
function rows(list, cls) {
  if (!Array.isArray(list) || !list.length) return '<div class="muted">—</div>';
  return list.map((r) => `<div class="snap-row ${cls || ''}"><span class="lbl">${esc(r.label)}</span><span>${esc(r.value)}</span></div>`).join('');
}

// ---- Debrief (end-of-session checklist) ------------------------------------

function hydrateDebrief(meta) {
  const el = document.getElementById('ilm-debrief');
  if (!el) return;
  const criteria = (dossier && Array.isArray(dossier.success_criteria) && dossier.success_criteria.length)
    ? dossier.success_criteria
    : ['Understood the move before pitching', 'Recommended and priced the right truck', 'Built genuine urgency on the real deadline', 'Handled the Beth stall and the big-truck nerves', 'Clearly asked for the business', 'Read back and confirmed the reservation'];
  const checked = (meta && Array.isArray(meta.checklist)) ? meta.checklist : [];
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

function humanize(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
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
