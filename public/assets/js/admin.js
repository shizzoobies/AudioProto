// Admin dashboard SPA. On boot probes /api/admin/session to decide between
// login and dashboard. The dashboard shows a Scenarios panel up top (pick the
// curriculum once) and an inline single-row recipient form below
// (Name | Email | Expiry | Send invite). The picked scenarios stay sticky so
// the admin can fan one set out to multiple recipients without re-picking.
//
// Invites live below as card rows with revoke buttons. The URL of a newly
// generated invite is shown above the list with a Copy button — we don't
// store plaintext tokens, so it's only available at generation time.

// Reuse the real coaching-report renderer so the rubric preview is pixel-identical
// to what a trainee sees after a call.
import { renderReportHtml } from './coach.js';

const root = document.getElementById('admin-root');
const logoutBtn = document.getElementById('admin-logout');
const body = document.body;

const state = {
  scenarioTypes: [],   // [{id, title, difficulty, description, persona_count, personas:[...]}]
  invites: [],         // [{id, recipient_email, recipient_name, scenarios:[], created_at, expires_at, revoked, created_by, ...}]
  lastGenerated: [],   // [{id, email, name, url, scenario_ids, expires_at, reused}]
  admin: null,         // { email, name, is_owner } — who is signed in
  admins: [],          // [{id, email, name, created_at, last_login_at, revoked, created_by}] (owner only)
  lastAdminInvite: null, // { id, email, name, url, email_sent, email_error?, reused }
  demo: null,          // { active, scenarios:[{id,customer_name,tagline}], created_at }
  lastDemoUrl: null,   // last generated demo URL (shown once with a Copy button)
  charts: null,        // { active, created_at, last_click_at }
  lastChartsUrl: null, // last generated charts URL (shown once with a Copy button)
  preview: null,       // { active, created_at, last_click_at, scenario_count }
  lastPreviewUrl: null,// last generated full-library preview URL (shown once)
  rubric: null,        // { sections:[{key,label}], items:[{key,section,label,guidance,enabled,is_custom,position}] }
  review: null,        // { active, created_at, last_click_at } — the scoped review-editor share link
  lastReviewUrl: null, // last generated review-editor URL (shown once with a Copy button)
  reviewer: false,     // true when signed in via a scoped review link (rubric-only view)
};

init();

async function init() {
  body.dataset.appState = 'ready';
  const sessionRes = await fetch('/api/admin/session', { credentials: 'same-origin' });
  if (sessionRes.ok) {
    const data = await sessionRes.json().catch(() => null);
    state.admin = data?.admin || null;
    await renderDashboard();
    return;
  }
  // Not a full admin — maybe a scoped review-editor link (cs_review).
  try {
    const rev = await fetch('/api/admin/review-session', { credentials: 'same-origin' });
    if (rev.ok) {
      const d = await rev.json().catch(() => null);
      if (d?.reviewer) {
        state.reviewer = true;
        await renderReviewerDashboard();
        return;
      }
    }
  } catch {}
  renderLogin();
}

// ---- Login ----------------------------------------------------------------

function renderLogin(errorMsg) {
  logoutBtn.hidden = true;
  root.innerHTML = `
    <section class="admin-login">
      <header class="admin-login-head">
        <h1 class="admin-login-title">Admin login</h1>
        <p class="admin-login-sub">Enter the admin password to manage simulation invites.</p>
      </header>
      <form id="admin-login-form" autocomplete="off">
        <label class="admin-field">
          <span class="admin-field-label">Admin password</span>
          <input type="password" id="admin-pw" class="admin-input" autocomplete="current-password" required>
        </label>
        ${errorMsg ? `<div class="admin-alert admin-alert-error">${escapeHtml(errorMsg)}</div>` : ''}
        <button class="primary-button admin-login-btn" type="submit">Sign in</button>
      </form>
    </section>
  `;
  const form = document.getElementById('admin-login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('admin-pw').value;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        await renderDashboard();
      } else {
        renderLogin('Wrong password.');
      }
    } catch (err) {
      renderLogin('Network error: ' + (err?.message || err));
    }
  });
}

async function logout() {
  try {
    if (state.reviewer) {
      await fetch('/api/admin/review-session', { method: 'DELETE', credentials: 'same-origin' });
    } else {
      await fetch('/api/admin/login', { method: 'DELETE', credentials: 'same-origin' });
    }
  } catch {}
  state.reviewer = false;
  state.rubric = null;
  state.review = null;
  state.lastReviewUrl = null;
  state.scenarioTypes = [];
  state.invites = [];
  state.lastGenerated = [];
  state.admin = null;
  state.admins = [];
  state.lastAdminInvite = null;
  state.demo = null;
  state.lastDemoUrl = null;
  state.charts = null;
  state.lastChartsUrl = null;
  state.preview = null;
  state.lastPreviewUrl = null;
  renderLogin();
}

logoutBtn.addEventListener('click', logout);

// ---- Dashboard ------------------------------------------------------------

async function renderDashboard() {
  logoutBtn.hidden = false;
  await loadData();
  paintDashboard();
}

async function loadData() {
  // Identity (also fetched on boot, but re-fetch here so it's fresh after a
  // login and so renderDashboard called from the login form has it populated).
  try {
    const s = await fetch('/api/admin/session', { credentials: 'same-origin' });
    if (s.ok) {
      const data = await s.json();
      state.admin = data.admin || null;
    }
  } catch (e) {
    console.warn('session load failed', e);
  }

  try {
    const sc = await fetch('/api/scenarios', { credentials: 'same-origin' });
    if (sc.ok) {
      const data = await sc.json();
      state.scenarioTypes = (data.scenario_types || [])
        .filter((t) => t.id !== 'showcase')
        .map((t) => ({
          id: t.id,
          title: t.title,
          difficulty: t.difficulty || 'standard',
          description: t.description || '',
          persona_count: (t.personas || []).length,
          personas: (t.personas || []).map((p) => ({
            id: p.id,
            customer_name: p.customer_name,
            customer_short: p.customer_short || '',
            tagline: p.tagline || '',
            premium: !!p.premium,
          })),
        }));
    }
  } catch (e) {
    console.warn('scenarios load failed', e);
  }

  try {
    const r = await fetch('/api/admin/invites', { credentials: 'same-origin' });
    if (r.ok) {
      const data = await r.json();
      state.invites = data.invites || [];
    }
  } catch (e) {
    console.warn('invites load failed', e);
  }

  try {
    const r = await fetch('/api/admin/demo', { credentials: 'same-origin' });
    if (r.ok) {
      state.demo = await r.json();
    }
  } catch (e) {
    console.warn('demo load failed', e);
  }

  try {
    const r = await fetch('/api/admin/charts', { credentials: 'same-origin' });
    if (r.ok) {
      state.charts = await r.json();
    }
  } catch (e) {
    console.warn('charts load failed', e);
  }

  try {
    const r = await fetch('/api/admin/preview', { credentials: 'same-origin' });
    if (r.ok) {
      state.preview = await r.json();
    }
  } catch (e) {
    console.warn('preview load failed', e);
  }

  try {
    const r = await fetch('/api/admin/rubric', { credentials: 'same-origin' });
    if (r.ok) {
      state.rubric = await r.json();
    }
  } catch (e) {
    console.warn('rubric load failed', e);
  }

  try {
    const r = await fetch('/api/admin/review', { credentials: 'same-origin' });
    if (r.ok) {
      state.review = await r.json();
    }
  } catch (e) {
    console.warn('review link load failed', e);
  }

  // Team roster is owner-only; non-owners get a 403 we simply skip.
  if (state.admin?.is_owner) {
    try {
      const r = await fetch('/api/admin/admins', { credentials: 'same-origin' });
      if (r.ok) {
        const data = await r.json();
        state.admins = data.admins || [];
      }
    } catch (e) {
      console.warn('admins load failed', e);
    }
  } else {
    state.admins = [];
  }
}

function paintDashboard() {
  const typesHtml = state.scenarioTypes.length
    ? state.scenarioTypes.map((t) => renderType(t)).join('')
    : '<div class="admin-empty">No scenarios available.</div>';

  root.innerHTML = `
    ${renderSignedInBar()}

    ${renderAdminNav()}

    <section class="admin-section" id="sec-invite">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Invite recipients</p>
        <h1 class="admin-section-title">Send a simulation invite</h1>
        <p class="admin-section-sub">Pick the scenarios you want this batch of recipients to practice, then send invites one at a time. The selection stays put between sends.</p>
      </header>

      <form id="admin-create-form" autocomplete="off">
        <div class="admin-scenarios-panel">
          <div class="admin-scenarios-head">
            <span class="admin-scenarios-label">Scenarios</span>
            <span class="admin-selected-badge" id="selected-count" hidden>0 selected</span>
          </div>
          <label class="admin-all-scenarios">
            <input type="checkbox" id="admin-all-scenarios">
            <span class="admin-all-scenarios-text"><strong>Entire library</strong> — give this person every scenario. Set an expiry below to keep it temporary.</span>
          </label>
          <div class="admin-types-list">${typesHtml}</div>
        </div>

        <div class="admin-invite-form">
          <div class="admin-field">
            <label class="admin-field-label" for="admin-name">Name</label>
            <input type="text" id="admin-name" class="admin-input" placeholder="Full name" autocomplete="off">
          </div>
          <div class="admin-field">
            <label class="admin-field-label" for="admin-email">Email</label>
            <input type="email" id="admin-email" class="admin-input" placeholder="name@firm.com" autocomplete="off" required>
          </div>
          <div class="admin-field">
            <label class="admin-field-label" for="admin-expiry">Expiry</label>
            <select id="admin-expiry" class="admin-select">
              <option value="7" selected>7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="never">Never</option>
            </select>
          </div>
          <div class="admin-send-cell">
            <button type="submit" class="primary-button" id="admin-generate-btn" disabled>Send invite</button>
          </div>
        </div>
      </form>

      <div id="admin-generated" class="admin-generated"></div>
    </section>

    <section class="admin-section" id="sec-invites">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Members</p>
        <h2 class="admin-section-title">Active invites</h2>
        <p class="admin-section-sub">Every recipient with a live or past link. Revoke to disable a link immediately.</p>
      </header>
      <div id="admin-invite-list-wrap">${renderInviteList(state.invites)}</div>
    </section>

    ${renderDemoSection()}

    ${renderChartsSection()}

    ${renderPreviewSection()}

    ${renderRubricSection()}

    ${renderReviewLinkSection()}

    ${renderTeamSection()}

    <section class="admin-section" id="sec-usage">
      <header class="admin-section-head" style="flex-direction:row;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <p class="admin-eyebrow">Observability</p>
          <h2 class="admin-section-title">API usage</h2>
          <p class="admin-section-sub">Anthropic chat + coaching token usage. Cache hit rate shows how well prompt caching is working.</p>
        </div>
        <button type="button" class="ghost-button" id="admin-usage-refresh" style="flex-shrink:0;margin-top:4px;">Refresh</button>
      </header>
      <div id="admin-usage-wrap">Loading…</div>
    </section>
  `;

  const form = document.getElementById('admin-create-form');
  form.addEventListener('submit', onGenerate);
  form.addEventListener('change', updateSelectionCount);
  const allBox = document.getElementById('admin-all-scenarios');
  if (allBox) {
    allBox.addEventListener('change', () => {
      form.querySelectorAll('input[name="scenario_id"]').forEach((cb) => { cb.checked = allBox.checked; });
      updateSelectionCount();
    });
  }
  updateSelectionCount();
  attachAdminNav();
  attachInviteListHandlers();
  attachDemoHandlers();
  attachChartsHandlers();
  attachPreviewHandlers();
  attachRubricHandlers();
  attachReviewLinkHandlers();
  attachTeamHandlers();

  // Load usage section and wire refresh button.
  loadUsage();
  const refreshBtn = document.getElementById('admin-usage-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', loadUsage);
}

// ---- Section navigation ---------------------------------------------------
// A sticky chip bar that jumps between dashboard sections, with scroll-spy
// highlighting whichever section is currently in view.
const ADMIN_NAV_ITEMS = [
  { id: 'sec-invite', label: 'Send invite' },
  { id: 'sec-invites', label: 'Active invites' },
  { id: 'sec-demo', label: 'Demo link' },
  { id: 'sec-charts', label: 'Charts link' },
  { id: 'sec-preview', label: 'Preview link' },
  { id: 'sec-rubric', label: 'Call Review' },
  { id: 'sec-reviewlink', label: 'Review access' },
  { id: 'sec-team', label: 'Team', ownerOnly: true },
  { id: 'sec-usage', label: 'Usage' },
];

function renderAdminNav() {
  const items = ADMIN_NAV_ITEMS.filter((it) => !it.ownerOnly || state.admin?.is_owner);
  return `
    <nav class="admin-nav" id="admin-nav" aria-label="Dashboard sections">
      ${items.map((it, i) => `<a class="admin-nav-link${i === 0 ? ' is-active' : ''}" href="#${escapeAttr(it.id)}" data-nav="${escapeAttr(it.id)}">${escapeHtml(it.label)}</a>`).join('')}
    </nav>
  `;
}

function attachAdminNav() {
  const nav = document.getElementById('admin-nav');
  if (!nav) return;
  const links = Array.from(nav.querySelectorAll('.admin-nav-link'));
  const setActive = (id) => links.forEach((a) => a.classList.toggle('is-active', a.dataset.nav === id));

  nav.addEventListener('click', (e) => {
    const a = e.target.closest('.admin-nav-link');
    if (!a) return;
    e.preventDefault();
    const target = document.getElementById(a.dataset.nav);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(a.dataset.nav);
  });

  // Scroll-spy: highlight the topmost section currently in the upper viewport.
  const sections = links.map((a) => document.getElementById(a.dataset.nav)).filter(Boolean);
  if (!('IntersectionObserver' in window) || !sections.length) return;
  const io = new IntersectionObserver((entries) => {
    const vis = entries
      .filter((en) => en.isIntersecting)
      .sort((a, b) => a.target.offsetTop - b.target.offsetTop);
    if (vis.length) setActive(vis[0].target.id);
  }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });
  sections.forEach((s) => io.observe(s));
}

// ---- Call Review rubric ---------------------------------------------------
// Admin control over what the AI scores and what shows on each call's Call
// Review. Unchecking turns an item OFF everywhere (dropped from the AI prompt +
// tool schema and hidden on the report). Add custom items per section; default
// items can be disabled but not deleted.

function renderRubricSection() {
  return `
    <section class="admin-section" id="sec-rubric">
      <header class="admin-section-head" style="flex-direction:row;align-items:flex-start;justify-content:space-between;gap:16px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <p class="admin-eyebrow">Call Review</p>
          <h2 class="admin-section-title">Scorecard rubric</h2>
          <p class="admin-section-sub">Choose what the AI scores and what appears on each call's Call Review. Uncheck an item to turn it off everywhere; add your own items to any section. Changes apply to the next call scored.</p>
        </div>
        <button type="button" class="primary-button" id="admin-rubric-preview" style="flex-shrink:0;margin-top:2px;">Preview review</button>
      </header>
      <div id="admin-rubric-wrap">${renderRubricBody(state.rubric)}</div>
    </section>
  `;
}

function renderRubricBody(rubric) {
  if (!rubric || !Array.isArray(rubric.items)) {
    return '<div class="admin-empty">Loading rubric…</div>';
  }
  const sections = Array.isArray(rubric.sections) ? rubric.sections : [];
  const items = rubric.items || [];
  return sections.map((sec) => {
    const list = items
      .filter((it) => it.section === sec.key)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    const on = list.filter((it) => it.enabled).length;
    return `
      <div class="admin-rubric-section">
        <div class="admin-rubric-sechead">
          <span class="admin-rubric-seclabel">${escapeHtml(sec.label)}</span>
          <span class="admin-rubric-seccount">${on}/${list.length} on</span>
        </div>
        <div class="admin-rubric-items">
          ${list.map((it) => renderRubricItem(it)).join('') || '<div class="admin-empty">No items in this section.</div>'}
        </div>
        <details class="admin-rubric-add">
          <summary class="admin-rubric-addbtn">+ Add item</summary>
          <div class="admin-rubric-editform" data-add-section="${escapeAttr(sec.key)}">
            ${rubricFieldsHtml({})}
            <button type="button" class="primary-button" data-add>Add item</button>
          </div>
        </details>
      </div>
    `;
  }).join('');
}

function renderRubricItem(it) {
  const custom = !!it.is_custom;
  return `
    <div class="admin-rubric-item${it.enabled ? '' : ' is-off'}" data-key="${escapeAttr(it.key)}">
      <label class="admin-rubric-toggle" title="${it.enabled ? 'Showing — uncheck to turn off' : 'Off — check to turn on'}">
        <input type="checkbox" data-toggle ${it.enabled ? 'checked' : ''}>
      </label>
      <div class="admin-rubric-main">
        <div class="admin-rubric-label">${escapeHtml(it.label)}${custom ? ' <span class="admin-pill">custom</span>' : ''}</div>
        <div class="admin-rubric-guide">${escapeHtml(it.guidance)}</div>
        ${rubricMetaHtml(it)}
        <details class="admin-rubric-edit">
          <summary class="admin-rubric-editbtn">Edit</summary>
          <div class="admin-rubric-editform">
            ${rubricFieldsHtml(it)}
            <div class="admin-rubric-editactions">
              <button type="button" class="primary-button" data-save>Save changes</button>
              ${custom
                ? '<button type="button" class="ghost-button admin-rubric-del" data-delete>Delete</button>'
                : '<span class="admin-rubric-note">Default item — uncheck above to turn it off.</span>'}
            </div>
          </div>
        </details>
      </div>
    </div>
  `;
}

// The editable fields for a rubric item, shared by the edit and add forms. The
// label/guidance are core; the score guide, policy reference, and required list
// are the policy-grounding fields injected into the AI prompt for this item.
function rubricFieldsHtml(it = {}) {
  return `
    <label class="admin-rubric-fl">Label</label>
    <input class="admin-input" data-field="label" value="${escapeAttr(it.label || '')}" placeholder="Item label (e.g. Active listening)">
    <label class="admin-rubric-fl">What to look for</label>
    <textarea class="admin-input admin-rubric-guidance" data-field="guidance" rows="2" placeholder="The core instruction the AI scores against">${escapeHtml(it.guidance || '')}</textarea>
    <label class="admin-rubric-fl">Score guide <span class="admin-rubric-fl-hint">what a 1, 3, 5 look like</span></label>
    <textarea class="admin-input admin-rubric-guidance" data-field="anchors" rows="3" placeholder="5: ...&#10;3: ...&#10;1: ...">${escapeHtml(it.anchors || '')}</textarea>
    <label class="admin-rubric-fl">Policy / criteria <span class="admin-rubric-fl-hint">the company standard to hold them to</span></label>
    <textarea class="admin-input admin-rubric-guidance" data-field="policy" rows="2" placeholder="The Meridian standard, figures, rules, or disclosures for this item">${escapeHtml(it.policy_ref || '')}</textarea>
    <label class="admin-rubric-fl">Required / must-say <span class="admin-rubric-fl-hint">flagged if missing</span></label>
    <textarea class="admin-input admin-rubric-guidance" data-field="required" rows="2" placeholder="Things the agent must say or do (e.g. company name; confirmation number)">${escapeHtml(it.required || '')}</textarea>
  `;
}

// Small chips on the item row showing which policy-guidance fields are filled in.
function rubricMetaHtml(it) {
  const chips = [
    ['Score guide', it.anchors],
    ['Policy', it.policy_ref],
    ['Required', it.required],
  ]
    .filter(([, v]) => v && String(v).trim())
    .map(([label]) => `<span class="admin-rubric-metachip">${label}</span>`)
    .join('');
  return chips ? `<div class="admin-rubric-meta">${chips}</div>` : '';
}

function attachRubricHandlers() {
  // Preview button lives in the section header (outside the re-rendered wrap).
  const previewBtn = document.getElementById('admin-rubric-preview');
  if (previewBtn && previewBtn.dataset.wired !== '1') {
    previewBtn.dataset.wired = '1';
    previewBtn.addEventListener('click', openReviewPreview);
  }

  const wrap = document.getElementById('admin-rubric-wrap');
  if (!wrap || wrap.dataset.wired === '1') return;
  wrap.dataset.wired = '1'; // the wrap element persists across body re-renders

  wrap.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-toggle]');
    if (!cb) return;
    const key = cb.closest('[data-key]')?.dataset.key;
    if (key) rubricOp({ op: 'toggle', key, enabled: cb.checked });
  });

  wrap.addEventListener('click', (e) => {
    const saveBtn = e.target.closest('[data-save]');
    const delBtn = e.target.closest('[data-delete]');
    const addBtn = e.target.closest('[data-add]');

    if (saveBtn) {
      const row = saveBtn.closest('[data-key]');
      const key = row?.dataset.key;
      const form = saveBtn.closest('.admin-rubric-editform');
      const fv = (f) => (form.querySelector(`[data-field="${f}"]`)?.value || '').trim();
      const label = fv('label');
      const guidance = fv('guidance');
      const item = (state.rubric?.items || []).find((i) => i.key === key);
      const section = item?.section;
      const enabled = row.querySelector('input[data-toggle]')?.checked ? 1 : 0;
      if (!key || !section || !label || !guidance) return;
      rubricOp({ op: 'upsert', item: {
        key, section, label, guidance, enabled,
        anchors: fv('anchors'), policy_ref: fv('policy'), required: fv('required'),
      } });
      return;
    }
    if (delBtn) {
      const key = delBtn.closest('[data-key]')?.dataset.key;
      if (!key) return;
      if (!confirm('Delete this custom item? This cannot be undone.')) return;
      rubricOp({ op: 'delete', key });
      return;
    }
    if (addBtn) {
      const form = addBtn.closest('[data-add-section]');
      const section = form?.dataset.addSection;
      const fv = (f) => (form.querySelector(`[data-field="${f}"]`)?.value || '').trim();
      const label = fv('label');
      const guidance = fv('guidance');
      if (!section || !label || !guidance) {
        alert('Add a label and what to look for first.');
        return;
      }
      rubricOp({ op: 'upsert', item: {
        section, label, guidance, enabled: 1,
        anchors: fv('anchors'), policy_ref: fv('policy'), required: fv('required'),
      } });
    }
  });
}

async function rubricOp(payload) {
  try {
    const res = await fetch('/api/admin/rubric', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const parts = [data?.error, data?.detail].filter(Boolean);
      alert(`Rubric update failed: ${parts.join(' — ') || res.status}`);
      return;
    }
  } catch (err) {
    alert(`Network error: ${err?.message || err}`);
    return;
  }
  await refreshRubricBody();
}

async function refreshRubricBody() {
  try {
    const r = await fetch('/api/admin/rubric', { credentials: 'same-origin' });
    if (r.ok) state.rubric = await r.json();
  } catch {
    // keep prior state on a failed refresh
  }
  const wrap = document.getElementById('admin-rubric-wrap');
  if (wrap) wrap.innerHTML = renderRubricBody(state.rubric);
}

// Build a mock coaching report from the CURRENTLY ENABLED rubric, with sample
// scores/evidence, so the admin can preview exactly what a trainee's Call Review
// will look like with their current selection.
function buildReviewPreview(rubric) {
  const sections = Array.isArray(rubric?.sections) ? rubric.sections : [];
  const enabled = (rubric?.items || []).filter((it) => it.enabled);

  // Display structure: enabled items grouped by section, in order.
  const display = sections
    .map((sec) => ({
      label: sec.label,
      items: enabled
        .filter((it) => it.section === sec.key)
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map((it) => ({ key: it.key, label: it.label })),
    }))
    .filter((s) => s.items.length);

  // Sample scores — varied so the cards don't all look identical.
  const cycle = [4, 5, 3, 4, 5, 4, 3, 5];
  const scores = {};
  enabled.forEach((it, i) => {
    scores[it.key] = {
      score: cycle[i % cycle.length],
      evidence: `Sample evidence for "${it.label}" — a short quote from the call would appear here.`,
      suggestion: 'Sample suggestion — one concrete thing to try next time would appear here.',
    };
  });
  const vals = Object.values(scores).map((s) => s.score);
  const overall = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

  return {
    overall_score: Math.round(overall * 10) / 10,
    scores,
    rubric: display,
    strengths: ['Sample strength — a real one from the call would appear here.', 'Sample strength — clear, confident close.'],
    growth_areas: ['Sample growth area — something to tighten next time.', 'Sample growth area — confirm details back more often.'],
    one_thing_to_try_next_time: 'This is sample coaching text. The single most impactful thing to try next time would appear here.',
    final_mood: 'satisfied',
    final_mood_note: 'Sample note — how the customer felt at the end of the call.',
  };
}

function openReviewPreview() {
  if (!state.rubric) { alert('Rubric is still loading — try again in a moment.'); return; }
  const report = buildReviewPreview(state.rubric);
  const scenario = { title: 'Call Review preview', customer_name: 'Sample Customer' };
  const node = renderReportHtml(scenario, report, { onNewCall: closeReviewPreview, onRetry: closeReviewPreview });

  let overlay = document.getElementById('admin-review-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'admin-review-modal';
    overlay.className = 'admin-modal';
    overlay.dataset.open = 'false';
    overlay.innerHTML = `
      <div class="admin-modal-backdrop" data-close></div>
      <div class="admin-modal-card" role="dialog" aria-modal="true" aria-label="Call Review preview">
        <div class="admin-modal-head">
          <span class="admin-modal-title">Call Review preview <span class="admin-modal-badge">Sample data</span></span>
          <button type="button" class="admin-modal-x" data-close aria-label="Close">&times;</button>
        </div>
        <div class="admin-modal-body" id="admin-review-body"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeReviewPreview(); });
    document.addEventListener('keydown', reviewEscHandler);
  }
  const bodyEl = overlay.querySelector('#admin-review-body');
  bodyEl.innerHTML = '';
  bodyEl.appendChild(node);
  bodyEl.scrollTop = 0;
  overlay.dataset.open = 'true';
  document.body.style.overflow = 'hidden';
}

function closeReviewPreview() {
  const overlay = document.getElementById('admin-review-modal');
  if (overlay) overlay.dataset.open = 'false';
  document.body.style.overflow = '';
}

function reviewEscHandler(e) {
  if (e.key === 'Escape') closeReviewPreview();
}

// ---- Review access (scoped share link) ------------------------------------
// A no-password link that opens ONLY the Call Review rubric editor. Backed by
// the invites sentinel pattern (like the demo/charts links): generate rotates
// the token, revoke kills it instantly.

function renderReviewLinkSection() {
  const r = state.review;
  const active = !!r?.active;
  const statusHtml = active
    ? '<span class="admin-pill admin-pill-active">Active</span> <span class="admin-muted">Opens the Call Review editor only</span>'
    : '<span class="admin-muted">No review link yet</span>';
  return `
    <section class="admin-section" id="sec-reviewlink">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Review access</p>
        <h2 class="admin-section-title">Share the Call Review editor</h2>
        <p class="admin-section-sub">A no-password link that opens ONLY the Call Review rubric editor, not the rest of the admin panel. Share it with someone who should tune scoring without full admin access. Revoke any time.</p>
      </header>
      <div class="admin-invite-card is-active" style="flex-direction:column;align-items:stretch;gap:14px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;">${statusHtml}</div>
        <div class="admin-invite-actions" style="justify-content:flex-start;">
          <button type="button" class="primary-button" id="admin-review-generate-btn">${active ? 'Regenerate review link' : 'Generate review link'}</button>
          ${active ? '<button type="button" class="ghost-button" id="admin-review-revoke-btn">Revoke</button>' : ''}
        </div>
        <div id="admin-review-generated" class="admin-generated"></div>
      </div>
    </section>
  `;
}

function attachReviewLinkHandlers() {
  const genBtn = document.getElementById('admin-review-generate-btn');
  if (genBtn) genBtn.addEventListener('click', onGenerateReviewLink);
  const revokeBtn = document.getElementById('admin-review-revoke-btn');
  if (revokeBtn) revokeBtn.addEventListener('click', onRevokeReviewLink);
  paintReviewGenerated();
}

async function onGenerateReviewLink() {
  const btn = document.getElementById('admin-review-generate-btn');
  const out = document.getElementById('admin-review-generated');
  if (out) out.innerHTML = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
  try {
    const res = await fetch('/api/admin/review', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      const errMsg = parts.length ? parts.join(' — ') : (res.statusText || 'no message');
      if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Error ${res.status}: ${escapeHtml(errMsg)}</div>`;
      return;
    }
    state.lastReviewUrl = data.url;
    await loadData();
    refreshReviewLinkSection();
    paintReviewGenerated();
  } catch (err) {
    if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

async function onRevokeReviewLink() {
  if (!confirm('Revoke the review link? Anyone holding it will lose access immediately.')) return;
  const btn = document.getElementById('admin-review-revoke-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Revoking...'; }
  try {
    const res = await fetch('/api/admin/review', { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok) {
      state.lastReviewUrl = null;
      await loadData();
      refreshReviewLinkSection();
    } else {
      alert('Revoke failed.');
      if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
    }
  } catch {
    alert('Network error.');
    if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
  }
}

function refreshReviewLinkSection() {
  const sections = root.querySelectorAll('.admin-section');
  for (const sec of sections) {
    const eyebrow = sec.querySelector('.admin-eyebrow');
    if (eyebrow && eyebrow.textContent.trim() === 'Review access') {
      const tmp = document.createElement('div');
      tmp.innerHTML = renderReviewLinkSection();
      sec.replaceWith(tmp.firstElementChild);
      break;
    }
  }
  attachReviewLinkHandlers();
}

function paintReviewGenerated() {
  const out = document.getElementById('admin-review-generated');
  if (!out) return;
  if (!state.lastReviewUrl) { out.innerHTML = ''; return; }
  out.innerHTML = `
    <div class="admin-alert admin-alert-success"><strong>Review link ready.</strong> It opens only the Call Review editor — no password, no other admin access.</div>
    <div class="admin-generated-list">
      <div class="admin-generated-row">
        <div class="admin-generated-url-row">
          <input class="admin-input admin-generated-url" readonly value="${escapeAttr(state.lastReviewUrl)}">
          <button type="button" class="ghost-button admin-copy-btn" data-url="${escapeAttr(state.lastReviewUrl)}">Copy</button>
        </div>
      </div>
    </div>`;
  out.querySelectorAll('.admin-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch {
        alert('Copy failed. Select the URL and copy it manually.');
      }
    });
  });
}

// The rubric-only view shown to someone who arrived via a scoped review link.
// Reuses the exact rubric editor + preview; no other admin endpoints are loaded.
async function renderReviewerDashboard() {
  logoutBtn.hidden = false;
  try {
    const r = await fetch('/api/admin/rubric', { credentials: 'same-origin' });
    if (r.ok) state.rubric = await r.json();
  } catch (e) {
    console.warn('rubric load failed', e);
  }
  root.innerHTML = `
    <div class="admin-reviewer-head">
      <p class="admin-eyebrow">Call Review</p>
      <h1 class="admin-reviewer-title">Review editor</h1>
      <p class="admin-section-sub">Adjust what the AI scores and what appears on each call's Call Review. Changes apply to the next call scored.</p>
    </div>
    ${renderRubricSection()}
  `;
  attachRubricHandlers();
}

// One scenario type rendered as a <details>. Description is shown on expand,
// persona checkboxes underneath. Default collapsed — admins open the tracks
// they're working with and ignore the rest.
function renderType(t) {
  const diff = (t.difficulty || '').toLowerCase();
  const diffLabel = diff ? diff[0].toUpperCase() + diff.slice(1) : '';
  return `
    <details class="admin-type" data-type="${escapeAttr(t.id)}">
      <summary class="admin-type-summary">
        <span class="admin-type-info">
          <span class="admin-type-title">${escapeHtml(t.title)}</span>
          <span class="admin-type-meta">${t.persona_count} scenarios${diffLabel ? ' · ' + escapeHtml(diffLabel) : ''}</span>
        </span>
        <span class="admin-type-selected" data-type-count="${escapeAttr(t.id)}" hidden>0</span>
        <svg class="admin-chev" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 2 L8 6 L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </summary>
      <div class="admin-type-body">
        ${t.description ? `<p class="admin-type-desc">${escapeHtml(t.description)}</p>` : ''}
        <div class="admin-scenario-list">
          ${t.personas.map((p) => `
            <label class="admin-scenario-row">
              <input type="checkbox" name="scenario_id" value="${escapeAttr(p.id)}" data-type="${escapeAttr(t.id)}">
              <span class="admin-scenario-info">
                <span class="admin-scenario-name">${escapeHtml(p.customer_name)}${p.premium ? ' <span class="admin-pill admin-pill-premium">Premium</span>' : ''}</span>
                ${p.tagline ? `<span class="admin-scenario-tagline">${escapeHtml(p.tagline)}</span>` : (p.customer_short ? `<span class="admin-scenario-tagline">${escapeHtml(p.customer_short)}</span>` : '')}
              </span>
            </label>
          `).join('')}
        </div>
      </div>
    </details>
  `;
}

function updateSelectionCount() {
  const form = document.getElementById('admin-create-form');
  if (!form) return;
  const all = form.querySelectorAll('input[name="scenario_id"]');
  const total = form.querySelectorAll('input[name="scenario_id"]:checked').length;

  // Keep the "Entire library" master in sync: checked only when literally every
  // scenario is selected; indeterminate when some-but-not-all are.
  const allBox = document.getElementById('admin-all-scenarios');
  if (allBox) {
    allBox.checked = all.length > 0 && total === all.length;
    allBox.indeterminate = total > 0 && total < all.length;
  }

  const badge = document.getElementById('selected-count');
  if (badge) {
    badge.hidden = total === 0;
    badge.textContent = total === 1 ? '1 selected' : `${total} selected`;
  }

  const btn = document.getElementById('admin-generate-btn');
  if (btn) btn.disabled = total === 0;

  document.querySelectorAll('[data-type-count]').forEach((el) => {
    const tid = el.dataset.typeCount;
    const c = form.querySelectorAll(`input[data-type="${CSS.escape(tid)}"]:checked`).length;
    el.hidden = c === 0;
    el.textContent = c;
  });
}

// ---- Invite list ----------------------------------------------------------

function renderInviteList(invites) {
  if (!invites.length) {
    return '<div class="admin-empty">No invites yet. Send your first one above.</div>';
  }
  const now = Math.floor(Date.now() / 1000);
  const rows = invites.map((inv) => {
    const status = inviteStatus(inv, now);
    const scenarios = (inv.scenarios || []);
    const chips = scenarios.length
      ? scenarios.slice(0, 4).map((s) => `<span class="admin-chip" title="${escapeAttr(s.tagline || '')}">${escapeHtml(s.customer_name || s.id)}</span>`).join('')
        + (scenarios.length > 4 ? `<span class="admin-chip">+${scenarios.length - 4}</span>` : '')
      : '<span class="admin-muted">no scenarios</span>';

    const expiresText = inv.expires_at
      ? `expires ${fmtDate(inv.expires_at)}`
      : 'never expires';
    const usageText = inv.last_click_at
      ? `clicked ${fmtRelative(inv.last_click_at, now)}`
      : 'no clicks yet';

    return `
      <div class="admin-invite-card ${status.cls}" data-id="${escapeAttr(inv.id)}">
        <div class="admin-invite-recipient">
          <div class="admin-invite-name">${escapeHtml(inv.recipient_name || inv.recipient_email)}</div>
          ${inv.recipient_name ? `<div class="admin-invite-email">${escapeHtml(inv.recipient_email)}</div>` : ''}
        </div>
        <div class="admin-invite-scenarios">${chips}</div>
        <div class="admin-invite-meta">
          <div class="admin-invite-meta-line"><strong>${inv.total_calls || 0}</strong> ${inv.total_calls === 1 ? 'call' : 'calls'} · ${escapeHtml(usageText)}</div>
          <div class="admin-invite-meta-line">${escapeHtml(expiresText)}</div>
          <div class="admin-invite-meta-line">Created by ${escapeHtml(inv.created_by || '—')}</div>
        </div>
        <span class="admin-pill admin-pill-${status.tag}">${status.label}</span>
        <div class="admin-invite-actions">
          ${status.tag === 'active' ? `<button type="button" class="ghost-button admin-revoke-btn" data-revoke="${escapeAttr(inv.id)}">Revoke</button>` : ''}
          ${status.tag === 'active' ? `<button type="button" class="ghost-button" data-resend="${escapeAttr(inv.id)}">Resend</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  return `<div class="admin-invite-list">${rows}</div>`;
}

function inviteStatus(inv, now) {
  if (inv.revoked) return { tag: 'revoked', label: 'Revoked', cls: 'is-revoked' };
  if (inv.expires_at && inv.expires_at < now) return { tag: 'expired', label: 'Expired', cls: 'is-expired' };
  return { tag: 'active', label: 'Active', cls: 'is-active' };
}

function attachInviteListHandlers() {
  root.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.revoke;
      if (!confirm("Revoke this invite? The recipient's link will stop working immediately.")) return;
      btn.disabled = true;
      btn.textContent = 'Revoking...';
      try {
        const res = await fetch(`/api/admin/invites/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (res.ok) {
          await loadData();
          const wrap = document.getElementById('admin-invite-list-wrap');
          if (wrap) {
            wrap.innerHTML = renderInviteList(state.invites);
            attachInviteListHandlers();
          }
        } else {
          alert('Revoke failed.');
          btn.disabled = false;
          btn.textContent = 'Revoke';
        }
      } catch {
        alert('Network error.');
        btn.disabled = false;
        btn.textContent = 'Revoke';
      }
    });
  });

  root.querySelectorAll('[data-resend]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.resend;
      if (!confirm('Resend this invite? This generates a fresh link — the previous link will stop working.')) return;
      btn.disabled = true;
      btn.textContent = 'Resending…';
      try {
        const res = await fetch(`/api/admin/invites/${encodeURIComponent(id)}/resend`, {
          method: 'POST',
          credentials: 'same-origin',
        });
        const data = await res.json().catch(() => null);
        if (res.ok) {
          // Refresh invite list.
          await loadData();
          const wrap = document.getElementById('admin-invite-list-wrap');
          if (wrap) {
            wrap.innerHTML = renderInviteList(state.invites);
            attachInviteListHandlers();
          }
          // Surface new URL + email status in the generated panel.
          const inv = state.invites.find((i) => i.id === id);
          state.lastGenerated = [{
            id,
            email: inv?.recipient_email || '',
            name: inv?.recipient_name || null,
            url: data.url,
            email_sent: data.email_sent,
            email_error: data.email_error,
            reused: true,
          }];
          paintGenerated();
        } else {
          alert('Resend failed: ' + (data?.error || res.statusText));
          btn.disabled = false;
          btn.textContent = 'Resend';
        }
      } catch {
        alert('Network error.');
        btn.disabled = false;
        btn.textContent = 'Resend';
      }
    });
  });
}

// ---- Demo link ------------------------------------------------------------

// One shareable, no-password link to the two demo scenarios. Backed by the
// invites system (sentinel recipient_email), so generate rotates the token,
// revoke kills the link immediately. Mirrors the generated-URL + Copy + Revoke
// patterns used for invites.
function renderDemoSection() {
  const demo = state.demo;
  const active = !!demo?.active;
  const scenarios = demo?.scenarios || [];
  const scenarioNames = scenarios.length
    ? scenarios.map((s) => escapeHtml(s.customer_name || s.id)).join(' · ')
    : '';

  const statusHtml = active
    ? `<span class="admin-pill admin-pill-active">Active</span>${scenarioNames ? ` <span class="admin-muted">${scenarioNames}</span>` : ''}`
    : `<span class="admin-muted">No demo link yet</span>${scenarioNames ? ` <span class="admin-muted">· ${scenarioNames}</span>` : ''}`;

  return `
    <section class="admin-section" id="sec-demo">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Demo</p>
        <h2 class="admin-section-title">Demo link</h2>
        <p class="admin-section-sub">One shareable link to the Sales + Customer Service demo scenarios. No password — anyone with the link can try it.</p>
      </header>

      <div class="admin-invite-card is-active" style="flex-direction:column;align-items:stretch;gap:14px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;">
          ${statusHtml}
        </div>
        <div class="admin-invite-actions" style="justify-content:flex-start;">
          <button type="button" class="primary-button" id="admin-demo-generate-btn">${active ? 'Regenerate demo link' : 'Generate demo link'}</button>
          ${active ? '<button type="button" class="ghost-button" id="admin-demo-revoke-btn">Revoke</button>' : ''}
        </div>
        <div id="admin-demo-generated" class="admin-generated"></div>
      </div>
    </section>
  `;
}

function attachDemoHandlers() {
  const genBtn = document.getElementById('admin-demo-generate-btn');
  if (genBtn) genBtn.addEventListener('click', onGenerateDemo);
  const revokeBtn = document.getElementById('admin-demo-revoke-btn');
  if (revokeBtn) revokeBtn.addEventListener('click', onRevokeDemo);
  // Re-render the last generated URL (if any) so a paintDashboard re-run keeps it.
  paintDemoGenerated();
}

async function onGenerateDemo() {
  const btn = document.getElementById('admin-demo-generate-btn');
  const out = document.getElementById('admin-demo-generated');
  if (out) out.innerHTML = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
  try {
    const res = await fetch('/api/admin/demo', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      const errMsg = parts.length ? parts.join(' — ') : (res.statusText || 'no message');
      if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Error ${res.status}: ${escapeHtml(errMsg)}</div>`;
      return;
    }
    state.lastDemoUrl = data.url;
    await loadData();
    refreshDemoSection();
    paintDemoGenerated();
  } catch (err) {
    if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

async function onRevokeDemo() {
  if (!confirm('Revoke the demo link? Anyone holding it will lose access immediately.')) return;
  const btn = document.getElementById('admin-demo-revoke-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Revoking...'; }
  try {
    const res = await fetch('/api/admin/demo', { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok) {
      state.lastDemoUrl = null;
      await loadData();
      refreshDemoSection();
    } else {
      alert('Revoke failed.');
      if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
    }
  } catch {
    alert('Network error.');
    if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
  }
}

// Swap just the Demo section's DOM in place and re-wire its handlers, so the
// rest of the dashboard (and the generated URL state) is left untouched.
function refreshDemoSection() {
  const sections = root.querySelectorAll('.admin-section');
  for (const sec of sections) {
    const eyebrow = sec.querySelector('.admin-eyebrow');
    if (eyebrow && eyebrow.textContent.trim() === 'Demo') {
      const tmp = document.createElement('div');
      tmp.innerHTML = renderDemoSection();
      sec.replaceWith(tmp.firstElementChild);
      break;
    }
  }
  attachDemoHandlers();
}

function paintDemoGenerated() {
  const out = document.getElementById('admin-demo-generated');
  if (!out) return;
  if (!state.lastDemoUrl) { out.innerHTML = ''; return; }
  out.innerHTML = `
    <div class="admin-alert admin-alert-success"><strong>Demo link ready.</strong> Share it with anyone — no password needed.</div>
    <div class="admin-generated-list">
      <div class="admin-generated-row">
        <div class="admin-generated-url-row">
          <input class="admin-input admin-generated-url" readonly value="${escapeAttr(state.lastDemoUrl)}">
          <button type="button" class="ghost-button admin-copy-btn" data-url="${escapeAttr(state.lastDemoUrl)}">Copy</button>
        </div>
      </div>
    </div>`;
  out.querySelectorAll('.admin-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch {
        alert('Copy failed. Select the URL and copy it manually.');
      }
    });
  });
}

// ---- Charts link ----------------------------------------------------------

// One token-gated, no-password link to the standalone Cost & ROI charts page
// (the built React app served at /charts). Backed by the invites system
// (sentinel recipient_email), so generate rotates the token and revoke kills
// the link immediately. Mirrors the demo link's generate / copy / revoke flow.
function renderChartsSection() {
  const charts = state.charts;
  const active = !!charts?.active;
  const statusHtml = active
    ? '<span class="admin-pill admin-pill-active">Active</span> <span class="admin-muted">Cost & ROI charts page</span>'
    : '<span class="admin-muted">No charts link yet</span>';

  return `
    <section class="admin-section" id="sec-charts">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Charts</p>
        <h2 class="admin-section-title">Charts link</h2>
        <p class="admin-section-sub">One shareable link to the standalone Cost &amp; ROI charts page. No password — anyone with the link can view it.</p>
      </header>

      <div class="admin-invite-card is-active" style="flex-direction:column;align-items:stretch;gap:14px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;">
          ${statusHtml}
        </div>
        <div class="admin-invite-actions" style="justify-content:flex-start;">
          <button type="button" class="primary-button" id="admin-charts-generate-btn">${active ? 'Regenerate charts link' : 'Generate charts link'}</button>
          ${active ? '<button type="button" class="ghost-button" id="admin-charts-revoke-btn">Revoke</button>' : ''}
        </div>
        <div id="admin-charts-generated" class="admin-generated"></div>
      </div>
    </section>
  `;
}

function attachChartsHandlers() {
  const genBtn = document.getElementById('admin-charts-generate-btn');
  if (genBtn) genBtn.addEventListener('click', onGenerateCharts);
  const revokeBtn = document.getElementById('admin-charts-revoke-btn');
  if (revokeBtn) revokeBtn.addEventListener('click', onRevokeCharts);
  paintChartsGenerated();
}

async function onGenerateCharts() {
  const btn = document.getElementById('admin-charts-generate-btn');
  const out = document.getElementById('admin-charts-generated');
  if (out) out.innerHTML = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
  try {
    const res = await fetch('/api/admin/charts', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      const errMsg = parts.length ? parts.join(' — ') : (res.statusText || 'no message');
      if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Error ${res.status}: ${escapeHtml(errMsg)}</div>`;
      return;
    }
    state.lastChartsUrl = data.url;
    await loadData();
    refreshChartsSection();
    paintChartsGenerated();
  } catch (err) {
    if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

async function onRevokeCharts() {
  if (!confirm('Revoke the charts link? Anyone holding it will lose access immediately.')) return;
  const btn = document.getElementById('admin-charts-revoke-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Revoking...'; }
  try {
    const res = await fetch('/api/admin/charts', { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok) {
      state.lastChartsUrl = null;
      await loadData();
      refreshChartsSection();
    } else {
      alert('Revoke failed.');
      if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
    }
  } catch {
    alert('Network error.');
    if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
  }
}

function refreshChartsSection() {
  const sections = root.querySelectorAll('.admin-section');
  for (const sec of sections) {
    const eyebrow = sec.querySelector('.admin-eyebrow');
    if (eyebrow && eyebrow.textContent.trim() === 'Charts') {
      const tmp = document.createElement('div');
      tmp.innerHTML = renderChartsSection();
      sec.replaceWith(tmp.firstElementChild);
      break;
    }
  }
  attachChartsHandlers();
}

function paintChartsGenerated() {
  const out = document.getElementById('admin-charts-generated');
  if (!out) return;
  if (!state.lastChartsUrl) { out.innerHTML = ''; return; }
  out.innerHTML = `
    <div class="admin-alert admin-alert-success"><strong>Charts link ready.</strong> Share it with anyone — no password needed.</div>
    <div class="admin-generated-list">
      <div class="admin-generated-row">
        <div class="admin-generated-url-row">
          <input class="admin-input admin-generated-url" readonly value="${escapeAttr(state.lastChartsUrl)}">
          <button type="button" class="ghost-button admin-copy-btn" data-url="${escapeAttr(state.lastChartsUrl)}">Copy</button>
        </div>
      </div>
    </div>`;
  out.querySelectorAll('.admin-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch {
        alert('Copy failed. Select the URL and copy it manually.');
      }
    });
  });
}

// ---- Full library preview link --------------------------------------------

// One token-gated, no-password link to the WHOLE trainee library (every real
// scenario, the random call, the showcase) — for prospects to roam and try
// anything. Excludes the placeholder demo scenarios and the /charts page.
// Backed by the invites system (sentinel recipient_email); generate rotates the
// token + re-syncs the full scenario set, revoke kills it immediately.
function renderPreviewSection() {
  const preview = state.preview;
  const active = !!preview?.active;
  const count = preview?.scenario_count;
  const statusHtml = active
    ? `<span class="admin-pill admin-pill-active">Active</span> <span class="admin-muted">Full library${count ? ` · ${count} scenarios` : ''}</span>`
    : '<span class="admin-muted">No preview link yet</span>';

  return `
    <section class="admin-section" id="sec-preview">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Preview</p>
        <h2 class="admin-section-title">Full library link</h2>
        <p class="admin-section-sub">One shareable link to the whole library — every scenario, the random call, the showcase. No password. (The demo placeholders and the charts page are not included.)</p>
      </header>

      <div class="admin-invite-card is-active" style="flex-direction:column;align-items:stretch;gap:14px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;">
          ${statusHtml}
        </div>
        <div class="admin-invite-actions" style="justify-content:flex-start;">
          <button type="button" class="primary-button" id="admin-preview-generate-btn">${active ? 'Regenerate library link' : 'Generate library link'}</button>
          ${active ? '<button type="button" class="ghost-button" id="admin-preview-revoke-btn">Revoke</button>' : ''}
        </div>
        <div id="admin-preview-generated" class="admin-generated"></div>
      </div>
    </section>
  `;
}

function attachPreviewHandlers() {
  const genBtn = document.getElementById('admin-preview-generate-btn');
  if (genBtn) genBtn.addEventListener('click', onGeneratePreview);
  const revokeBtn = document.getElementById('admin-preview-revoke-btn');
  if (revokeBtn) revokeBtn.addEventListener('click', onRevokePreview);
  paintPreviewGenerated();
}

async function onGeneratePreview() {
  const btn = document.getElementById('admin-preview-generate-btn');
  const out = document.getElementById('admin-preview-generated');
  if (out) out.innerHTML = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
  try {
    const res = await fetch('/api/admin/preview', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      const errMsg = parts.length ? parts.join(' — ') : (res.statusText || 'no message');
      if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Error ${res.status}: ${escapeHtml(errMsg)}</div>`;
      return;
    }
    state.lastPreviewUrl = data.url;
    await loadData();
    refreshPreviewSection();
    paintPreviewGenerated();
  } catch (err) {
    if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

async function onRevokePreview() {
  if (!confirm('Revoke the full-library link? Anyone holding it will lose access immediately.')) return;
  const btn = document.getElementById('admin-preview-revoke-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Revoking...'; }
  try {
    const res = await fetch('/api/admin/preview', { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok) {
      state.lastPreviewUrl = null;
      await loadData();
      refreshPreviewSection();
    } else {
      alert('Revoke failed.');
      if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
    }
  } catch {
    alert('Network error.');
    if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
  }
}

function refreshPreviewSection() {
  const sections = root.querySelectorAll('.admin-section');
  for (const sec of sections) {
    const eyebrow = sec.querySelector('.admin-eyebrow');
    if (eyebrow && eyebrow.textContent.trim() === 'Preview') {
      const tmp = document.createElement('div');
      tmp.innerHTML = renderPreviewSection();
      sec.replaceWith(tmp.firstElementChild);
      break;
    }
  }
  attachPreviewHandlers();
}

function paintPreviewGenerated() {
  const out = document.getElementById('admin-preview-generated');
  if (!out) return;
  if (!state.lastPreviewUrl) { out.innerHTML = ''; return; }
  out.innerHTML = `
    <div class="admin-alert admin-alert-success"><strong>Library link ready.</strong> Share it with anyone — no password needed.</div>
    <div class="admin-generated-list">
      <div class="admin-generated-row">
        <div class="admin-generated-url-row">
          <input class="admin-input admin-generated-url" readonly value="${escapeAttr(state.lastPreviewUrl)}">
          <button type="button" class="ghost-button admin-copy-btn" data-url="${escapeAttr(state.lastPreviewUrl)}">Copy</button>
        </div>
      </div>
    </div>`;
  out.querySelectorAll('.admin-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch {
        alert('Copy failed. Select the URL and copy it manually.');
      }
    });
  });
}

// ---- Generate -------------------------------------------------------------

async function onGenerate(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = document.getElementById('admin-generate-btn');
  const out = document.getElementById('admin-generated');
  out.innerHTML = '';

  const scenarioIds = [...form.querySelectorAll('input[name="scenario_id"]:checked')].map((el) => el.value);
  if (!scenarioIds.length) {
    out.innerHTML = '<div class="admin-alert admin-alert-error">Pick at least one scenario.</div>';
    return;
  }

  const email = (document.getElementById('admin-email').value || '').trim();
  const name = (document.getElementById('admin-name').value || '').trim() || null;
  if (!email) {
    out.innerHTML = '<div class="admin-alert admin-alert-error">Add a recipient email.</div>';
    return;
  }

  const expiryVal = document.getElementById('admin-expiry').value;
  const expires_days = expiryVal === 'never' ? 'never' : parseInt(expiryVal, 10);

  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const res = await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ scenario_ids: scenarioIds, recipients: [{ email, name }], expires_days }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      const errMsg = parts.length ? parts.join(' — ') : (res.statusText || 'no message');
      out.innerHTML = `<div class="admin-alert admin-alert-error">Error ${res.status}: ${escapeHtml(errMsg)}</div>`;
      return;
    }
    state.lastGenerated = data.invites || [];
    paintGenerated();
    await loadData();
    const wrap = document.getElementById('admin-invite-list-wrap');
    if (wrap) {
      wrap.innerHTML = renderInviteList(state.invites);
      attachInviteListHandlers();
    }
    // Reset recipient fields only — scenarios stay sticky so the next person
    // gets the same simulation set without re-picking.
    document.getElementById('admin-email').value = '';
    document.getElementById('admin-name').value = '';
  } catch (err) {
    out.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send invite';
    updateSelectionCount();
  }
}

function paintGenerated() {
  const out = document.getElementById('admin-generated');
  if (!state.lastGenerated.length) {
    out.innerHTML = '';
    return;
  }

  // Determine overall email status from the batch (all sent, none sent, mixed).
  const allSent = state.lastGenerated.every((g) => g.email_sent === true);
  const noneSent = state.lastGenerated.every((g) => g.email_sent === false);

  let alertHtml;
  if (allSent) {
    const names = state.lastGenerated.map((g) => escapeHtml(g.email)).join(', ');
    alertHtml = `<div class="admin-alert admin-alert-success"><strong>Sent to ${names}.</strong> The link is also copied below as a backup.</div>`;
  } else if (noneSent) {
    const firstError = state.lastGenerated[0]?.email_error;
    const firstDetail = state.lastGenerated[0]?.email_error_detail;
    const errorNote = firstError
      ? ` <small class="admin-muted">(${escapeHtml(firstError)})</small>`
      : '';
    const detailNote = firstDetail
      ? `<div class="admin-muted" style="margin-top:8px;font-size:11.5px;word-break:break-word;">${escapeHtml(firstDetail)}</div>`
      : '';
    alertHtml = `<div class="admin-alert admin-alert-success"><strong>Invite ready.</strong> Email delivery failed — copy the link below and send it manually.${errorNote}${detailNote}</div>`;
  } else {
    // Partial — some sent, some didn't.
    alertHtml = `<div class="admin-alert admin-alert-success"><strong>Invites ready.</strong> Some emails sent — check each link below and send manually where needed.</div>`;
  }

  const rows = state.lastGenerated.map((g) => `
    <div class="admin-generated-row">
      <div class="admin-generated-email">${escapeHtml(g.email)}${g.name ? ' · ' + escapeHtml(g.name) : ''}${g.reused ? ' <span class="admin-muted">(refreshed)</span>' : ' <span class="admin-muted">(new)</span>'}</div>
      <div class="admin-generated-url-row">
        <input class="admin-input admin-generated-url" readonly value="${escapeAttr(g.url)}">
        <button type="button" class="ghost-button admin-copy-btn" data-url="${escapeAttr(g.url)}">Copy</button>
      </div>
    </div>
  `).join('');

  out.innerHTML = `${alertHtml}<div class="admin-generated-list">${rows}</div>`;

  out.querySelectorAll('.admin-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch {
        alert('Copy failed. Select the URL and copy it manually.');
      }
    });
  });
}

// ---- API Usage / Cache Stats ----------------------------------------------

const ANTHROPIC_PRICES = {
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-opus-4-7':   { input: 15.00, output: 75.00 },
};
// Default price for unknown models (use sonnet rates as a conservative floor).
const DEFAULT_INPUT_PRICE = 3.00;

async function loadUsage() {
  const wrap = document.getElementById('admin-usage-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="admin-muted" style="padding:12px 0;">Loading…</div>';
  try {
    const res = await fetch('/api/admin/usage', { credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (data?.error === 'no_usage_table') {
        wrap.innerHTML = renderUsageEmptyState('migration');
      } else {
        wrap.innerHTML = `<div class="admin-alert admin-alert-error">Failed to load usage: ${escapeHtml(data?.error || res.statusText)}</div>`;
      }
      return;
    }
    wrap.innerHTML = renderUsagePanel(data);
  } catch (err) {
    wrap.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

function renderUsageEmptyState(reason) {
  if (reason === 'migration') {
    return `
      <div class="admin-invite-card" style="padding:18px 20px;">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <div class="admin-invite-name">Usage tracking not yet active</div>
          <div class="admin-invite-email">Paste the SQL below in your D1 console, then refresh.</div>
          <pre style="margin:10px 0 0;padding:12px 14px;background:var(--color-surface-elevated);border-radius:8px;font-size:11.5px;color:var(--color-text-secondary);overflow-x:auto;white-space:pre-wrap;word-break:break-all;">Run migration 0002_usage_stats.sql in the D1 console.</pre>
        </div>
      </div>`;
  }
  return `<div class="admin-empty">No API calls logged yet — take a simulation to populate this.</div>`;
}

function renderUsagePanel(data) {
  const { last_24h, all_time, recent } = data;

  const hasAny = (all_time?.calls || 0) > 0;
  if (!hasAny) {
    return renderUsageEmptyState('empty');
  }

  // Compute per-model savings from recent rows (we have model info there).
  // For aggregate stats we don't have per-model breakdown, so we use blended
  // sonnet price as a conservative estimate (most calls are chat/sonnet).
  const stats24h = computeStats(last_24h?.chat, last_24h?.coach);
  const statsAll = computeStats(all_time, null);

  return `
    <div class="admin-usage-cards">
      ${renderStatCard('Last 24 hours', stats24h)}
      ${renderStatCard('All time', statsAll)}
    </div>
    ${renderRecentTable(recent || [])}
  `;
}

function computeStats(chatRow, coachRow) {
  // Accept either a single row (all_time) or chat+coach pair.
  // When coachRow is provided, merge them.
  const rows = [chatRow, coachRow].filter(Boolean);
  let calls = 0, input = 0, cacheCreate = 0, cacheRead = 0, output = 0;
  for (const r of rows) {
    calls += r.calls || 0;
    input += r.input_tokens || 0;
    cacheCreate += r.cache_creation_input_tokens || 0;
    cacheRead += r.cache_read_input_tokens || 0;
    output += r.output_tokens || 0;
  }

  const totalInput = input + cacheCreate + cacheRead;
  const hitRate = totalInput > 0 ? cacheRead / totalInput : null;

  // Savings math (using default input price since no per-model breakdown here).
  const pricePerM = DEFAULT_INPUT_PRICE;
  const withoutCost = totalInput * pricePerM / 1_000_000;
  const withCost = (
    input * pricePerM +
    cacheCreate * pricePerM * 1.25 +
    cacheRead * pricePerM * 0.10
  ) / 1_000_000;
  const savings = withoutCost - withCost;

  return { calls, input, cacheCreate, cacheRead, output, hitRate, savings };
}

function renderStatCard(title, s) {
  const hitRateStr = s.hitRate !== null ? (s.hitRate * 100).toFixed(1) + '%' : '—';
  const savingsStr = formatDollars(s.savings);
  return `
    <div class="admin-invite-card" style="flex:1;min-width:0;">
      <div style="display:flex;flex-direction:column;gap:10px;width:100%;">
        <div style="font-size:12px;font-weight:600;color:var(--color-accent);text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(title)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
          <div>
            <div style="font-size:22px;font-weight:700;color:var(--color-text-primary);line-height:1.1;">${s.calls.toLocaleString()}</div>
            <div class="admin-muted" style="margin-top:2px;">calls</div>
          </div>
          <div>
            <div style="font-size:22px;font-weight:700;color:var(--color-text-primary);line-height:1.1;">${hitRateStr}</div>
            <div class="admin-muted" style="margin-top:2px;">cache hit rate</div>
          </div>
          <div>
            <div style="font-size:22px;font-weight:700;color:var(--color-accent);line-height:1.1;">${savingsStr}</div>
            <div class="admin-muted" style="margin-top:2px;">est. saved</div>
          </div>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <span class="admin-muted">input ${fmtTokens(s.input)}</span>
          <span class="admin-muted">cache write ${fmtTokens(s.cacheCreate)}</span>
          <span class="admin-muted">cache read ${fmtTokens(s.cacheRead)}</span>
          <span class="admin-muted">output ${fmtTokens(s.output)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderRecentTable(rows) {
  if (!rows.length) return '';
  const tableRows = rows.slice(0, 10).map((r) => {
    const hitRate = (() => {
      const total = (r.input_tokens || 0) + (r.cache_creation_input_tokens || 0) + (r.cache_read_input_tokens || 0);
      if (!total) return '—';
      return ((r.cache_read_input_tokens || 0) / total * 100).toFixed(0) + '%';
    })();
    return `
      <tr>
        <td class="admin-muted" style="white-space:nowrap;">${fmtRelative(r.created_at, Math.floor(Date.now() / 1000))}</td>
        <td><span class="admin-chip">${escapeHtml(r.endpoint || '')}</span></td>
        <td class="admin-muted" style="font-size:11px;">${escapeHtml((r.model || '').replace('claude-', ''))}</td>
        <td class="admin-muted" style="text-align:right;">${fmtTokens(r.input_tokens)}</td>
        <td class="admin-muted" style="text-align:right;">${fmtTokens(r.cache_read_input_tokens)}</td>
        <td class="admin-muted" style="text-align:right;">${fmtTokens(r.cache_creation_input_tokens)}</td>
        <td class="admin-muted" style="text-align:right;">${fmtTokens(r.output_tokens)}</td>
        <td style="text-align:right;font-weight:600;color:var(--color-accent);font-size:12px;">${hitRate}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="margin-top:16px;overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
        <thead>
          <tr style="border-bottom:1px solid var(--color-border);">
            <th class="admin-muted" style="text-align:left;padding:4px 8px 8px 0;font-weight:600;">Time</th>
            <th class="admin-muted" style="text-align:left;padding:4px 8px 8px;font-weight:600;">Endpoint</th>
            <th class="admin-muted" style="text-align:left;padding:4px 8px 8px;font-weight:600;">Model</th>
            <th class="admin-muted" style="text-align:right;padding:4px 0 8px 8px;font-weight:600;">Input</th>
            <th class="admin-muted" style="text-align:right;padding:4px 0 8px 8px;font-weight:600;">Cache read</th>
            <th class="admin-muted" style="text-align:right;padding:4px 0 8px 8px;font-weight:600;">Cache write</th>
            <th class="admin-muted" style="text-align:right;padding:4px 0 8px 8px;font-weight:600;">Output</th>
            <th class="admin-muted" style="text-align:right;padding:4px 0 8px 8px;font-weight:600;">Hit %</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

function formatDollars(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return '$0.00';
  if (amount < 0.01) return '<$0.01';
  return '$' + amount.toFixed(2);
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

// ---- Identity bar + Team section ------------------------------------------

// Small "Signed in as ..." line shown above the first section. The (Owner) tag
// distinguishes the password-login owner from named admins.
function renderSignedInBar() {
  if (!state.admin) return '';
  const who = state.admin.name || state.admin.email || 'admin';
  const ownerTag = state.admin.is_owner ? ' (Owner)' : '';
  return `
    <div class="admin-signed-in" style="display:flex;align-items:center;gap:8px;margin-bottom:18px;font-size:13px;color:var(--color-text-secondary);">
      <span class="admin-muted">Signed in as</span>
      <strong style="color:var(--color-text-primary);font-weight:600;">${escapeHtml(who)}${escapeHtml(ownerTag)}</strong>
    </div>
  `;
}

// Owner-only Team section: add an admin (Name | Email | Add admin), surface the
// generated magic link + email status, and list existing admins with revoke.
// Renders nothing for non-owners (they never see team management).
function renderTeamSection() {
  if (!state.admin?.is_owner) return '';
  return `
    <section class="admin-section" id="sec-team">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Team</p>
        <h2 class="admin-section-title">Admins</h2>
        <p class="admin-section-sub">Give a teammate admin access by email. They get a magic link that signs them in — no shared password. Revoke access any time; it takes effect immediately.</p>
      </header>

      <form id="admin-add-form" autocomplete="off">
        <div class="admin-invite-form">
          <div class="admin-field">
            <label class="admin-field-label" for="admin-new-name">Name</label>
            <input type="text" id="admin-new-name" class="admin-input" placeholder="Full name" autocomplete="off">
          </div>
          <div class="admin-field">
            <label class="admin-field-label" for="admin-new-email">Email</label>
            <input type="email" id="admin-new-email" class="admin-input" placeholder="name@firm.com" autocomplete="off" required>
          </div>
          <div class="admin-send-cell">
            <button type="submit" class="primary-button" id="admin-add-btn">Add admin</button>
          </div>
        </div>
      </form>

      <div id="admin-added" class="admin-generated"></div>

      <div id="admin-team-list-wrap">${renderAdminList(state.admins)}</div>
    </section>
  `;
}

function renderAdminList(admins) {
  if (!admins.length) {
    return '<div class="admin-empty">No other admins yet. Add one above.</div>';
  }
  const now = Math.floor(Date.now() / 1000);
  const rows = admins.map((ad) => {
    const status = ad.revoked
      ? { tag: 'revoked', label: 'Revoked', cls: 'is-revoked' }
      : { tag: 'active', label: 'Active', cls: 'is-active' };
    const lastLogin = ad.last_login_at
      ? `last login ${fmtRelative(ad.last_login_at, now)}`
      : 'never signed in';
    return `
      <div class="admin-invite-card ${status.cls}" data-admin-id="${escapeAttr(ad.id)}">
        <div class="admin-invite-recipient">
          <div class="admin-invite-name">${escapeHtml(ad.name || ad.email)}</div>
          ${ad.name ? `<div class="admin-invite-email">${escapeHtml(ad.email)}</div>` : ''}
        </div>
        <div class="admin-invite-meta">
          <div class="admin-invite-meta-line">${escapeHtml(lastLogin)}</div>
          ${ad.created_by ? `<div class="admin-invite-meta-line">added by ${escapeHtml(ad.created_by)}</div>` : ''}
        </div>
        <span class="admin-pill admin-pill-${status.tag}">${status.label}</span>
        <div class="admin-invite-actions">
          ${status.tag === 'active' ? `<button type="button" class="ghost-button admin-revoke-admin-btn" data-revoke-admin="${escapeAttr(ad.id)}">Revoke</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  return `<div class="admin-invite-list">${rows}</div>`;
}

function attachTeamHandlers() {
  const form = document.getElementById('admin-add-form');
  if (form) form.addEventListener('submit', onAddAdmin);

  root.querySelectorAll('[data-revoke-admin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.revokeAdmin;
      if (!confirm("Revoke this admin's access? Their link and session will stop working immediately.")) return;
      btn.disabled = true;
      btn.textContent = 'Revoking...';
      try {
        const res = await fetch(`/api/admin/admins/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (res.ok) {
          await loadData();
          const wrap = document.getElementById('admin-team-list-wrap');
          if (wrap) {
            wrap.innerHTML = renderAdminList(state.admins);
            attachTeamHandlers();
          }
        } else {
          alert('Revoke failed.');
          btn.disabled = false;
          btn.textContent = 'Revoke';
        }
      } catch {
        alert('Network error.');
        btn.disabled = false;
        btn.textContent = 'Revoke';
      }
    });
  });
}

async function onAddAdmin(e) {
  e.preventDefault();
  const btn = document.getElementById('admin-add-btn');
  const out = document.getElementById('admin-added');
  out.innerHTML = '';

  const email = (document.getElementById('admin-new-email').value || '').trim();
  const name = (document.getElementById('admin-new-name').value || '').trim() || null;
  if (!email) {
    out.innerHTML = '<div class="admin-alert admin-alert-error">Add an email address.</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Adding...';
  try {
    const res = await fetch('/api/admin/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, name }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      const errMsg = parts.length ? parts.join(' — ') : (res.statusText || 'no message');
      out.innerHTML = `<div class="admin-alert admin-alert-error">Error ${res.status}: ${escapeHtml(errMsg)}</div>`;
      return;
    }
    state.lastAdminInvite = data;
    paintAdminGenerated();
    await loadData();
    const wrap = document.getElementById('admin-team-list-wrap');
    if (wrap) {
      wrap.innerHTML = renderAdminList(state.admins);
      attachTeamHandlers();
    }
    document.getElementById('admin-new-email').value = '';
    document.getElementById('admin-new-name').value = '';
  } catch (err) {
    out.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add admin';
  }
}

// Surface the generated admin magic link + email status. Mirrors paintGenerated's
// green/fallback logic so the owner gets a copyable link even if email fails.
function paintAdminGenerated() {
  const out = document.getElementById('admin-added');
  const g = state.lastAdminInvite;
  if (!out || !g) return;

  let alertHtml;
  if (g.email_sent) {
    alertHtml = `<div class="admin-alert admin-alert-success"><strong>Sent to ${escapeHtml(g.email)}.</strong> The sign-in link is also copied below as a backup.</div>`;
  } else {
    const errorNote = g.email_error ? ` <small class="admin-muted">(${escapeHtml(g.email_error)})</small>` : '';
    const detailNote = g.email_error_detail
      ? `<div class="admin-muted" style="margin-top:8px;font-size:11.5px;word-break:break-word;">${escapeHtml(g.email_error_detail)}</div>`
      : '';
    alertHtml = `<div class="admin-alert admin-alert-success"><strong>Admin ${g.reused ? 'link refreshed' : 'added'}.</strong> Email delivery failed — copy the sign-in link below and send it manually.${errorNote}${detailNote}</div>`;
  }

  out.innerHTML = `${alertHtml}
    <div class="admin-generated-list">
      <div class="admin-generated-row">
        <div class="admin-generated-email">${escapeHtml(g.email)}${g.name ? ' · ' + escapeHtml(g.name) : ''}${g.reused ? ' <span class="admin-muted">(refreshed)</span>' : ' <span class="admin-muted">(new)</span>'}</div>
        <div class="admin-generated-url-row">
          <input class="admin-input admin-generated-url" readonly value="${escapeAttr(g.url)}">
          <button type="button" class="ghost-button admin-copy-btn" data-url="${escapeAttr(g.url)}">Copy</button>
        </div>
      </div>
    </div>`;

  out.querySelectorAll('.admin-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch {
        alert('Copy failed. Select the URL and copy it manually.');
      }
    });
  });
}

// ---- Utilities ------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function escapeAttr(s) { return escapeHtml(s); }
function fmtDate(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}
function fmtRelative(ts, now) {
  const diff = now - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
