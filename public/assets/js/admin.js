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
  coaching: null,      // { active, created_at } — the open coaching-test share link
  lastCoachingUrl: null, // last generated coaching URL (shown once with a Copy button)
  coachingAgents: [],  // [{id, name, role_title, attitude, resistance, receptiveness, ...}] — authored coachable agents
  editingCoachingAgentId: null, // id of the coaching agent currently loaded into the form, or null
  coachingVoices: [],  // [{id, name, voice_id, created_at}] — named EL voice catalogue
  charts: null,        // { active, created_at, last_click_at }
  lastChartsUrl: null, // last generated charts URL (shown once with a Copy button)
  preview: null,       // { active, created_at, last_click_at, scenario_count }
  lastPreviewUrl: null,// last generated full-library preview URL (shown once)
  rubric: null,        // { sections:[{key,label}], items:[{key,section,label,guidance,enabled,is_custom,position}] }
  review: null,        // { active, created_at, last_click_at } — the scoped review-editor share link
  lastReviewUrl: null, // last generated review-editor URL (shown once with a Copy button)
  reviewer: false,     // true when signed in via a scoped review link (rubric-only view)
  coachingEditor: false, // true when signed in via a scoped coaching-admin link (Scenarios-only view)
  coachingAccess: null,  // { active, created_at, last_click_at } — the scoped Scenarios-editor share link
  lastCoachingAccessUrl: null, // last generated coaching-access URL (shown once with a Copy button)
};

init();

// This SPA serves two pages off the same bundle: the main admin dashboard and a
// dedicated Coaching-agents page (public/admin-coaching.html sets
// data-admin-page="coaching"). After auth we route to the right one.
const ADMIN_PAGE = body.dataset.adminPage || 'dashboard';

async function renderAfterAuth() {
  if (ADMIN_PAGE === 'coaching') return renderCoachingPage();
  return renderDashboard();
}

async function init() {
  body.dataset.appState = 'ready';
  const sessionRes = await fetch('/api/admin/session', { credentials: 'same-origin' });
  if (sessionRes.ok) {
    const data = await sessionRes.json().catch(() => null);
    state.admin = data?.admin || null;
    await renderAfterAuth();
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
  // Or a scoped coaching-admin link (cs_coaching_admin) — opens ONLY the
  // Scenarios admin page (create/manage scenarios + voices).
  try {
    const ca = await fetch('/api/admin/coaching-access-session', { credentials: 'same-origin' });
    if (ca.ok) {
      const d = await ca.json().catch(() => null);
      if (d?.coaching_editor) {
        state.coachingEditor = true;
        await renderCoachingPage();
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
        await renderAfterAuth();
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
    } else if (state.coachingEditor) {
      await fetch('/api/admin/coaching-access-session', { method: 'DELETE', credentials: 'same-origin' });
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
  state.coaching = null;
  state.lastCoachingUrl = null;
  state.coachingAgents = [];
  state.editingCoachingAgentId = null;
  state.coachingVoices = [];
  state.charts = null;
  state.lastChartsUrl = null;
  state.preview = null;
  state.lastPreviewUrl = null;
  state.coachingEditor = false;
  state.coachingAccess = null;
  state.lastCoachingAccessUrl = null;
  renderLogin();
}

logoutBtn.addEventListener('click', logout);

// ---- Dashboard ------------------------------------------------------------

async function renderDashboard() {
  logoutBtn.hidden = false;
  await loadData();
  paintDashboard();
}

// ---- Dedicated Coaching-agents page (admin-coaching.html) ------------------
// Its own page so the busy main dashboard stays clean. Reuses the shared
// session/helpers and the same renderCoachingAgentsSection()/handlers; loads
// only what this page needs instead of the full dashboard payload.
async function renderCoachingPage() {
  logoutBtn.hidden = false;
  // Full admins resolve their identity here; the scoped Scenarios editor
  // (state.coachingEditor) has no admin session and must not probe for one.
  if (!state.admin && !state.coachingEditor) {
    try {
      const s = await fetch('/api/admin/session', { credentials: 'same-origin' });
      if (s.ok) { const d = await s.json(); state.admin = d.admin || null; }
    } catch (e) { console.warn('session load failed', e); }
  }
  try {
    const r = await fetch('/api/admin/coaching-agents', { credentials: 'same-origin' });
    if (r.ok) { const d = await r.json(); state.coachingAgents = d.agents || []; }
  } catch (e) { console.warn('coaching agents load failed', e); }
  try {
    const r = await fetch('/api/admin/coaching-voices', { credentials: 'same-origin' });
    if (r.ok) { const d = await r.json(); state.coachingVoices = d.voices || []; }
  } catch (e) { console.warn('coaching voices load failed', e); }
  // Share-link status is full-admin only — the scoped editor would 401 on it.
  if (!state.coachingEditor && state.admin) {
    try {
      const r = await fetch('/api/admin/coaching-access', { credentials: 'same-origin' });
      if (r.ok) { state.coachingAccess = await r.json(); }
    } catch (e) { console.warn('coaching access load failed', e); }
  }
  // Participant roster is full-admin only (it exposes each manager's live link).
  if (!state.coachingEditor && state.admin) {
    try {
      const r = await fetch('/api/admin/coaching-participants', { credentials: 'same-origin' });
      if (r.ok) { const d = await r.json(); state.coachingParticipants = d.participants || []; }
    } catch (e) { console.warn('coaching participants load failed', e); }
  }
  paintCoachingPage();
}

function paintCoachingPage() {
  // The scoped Scenarios editor has no admin dashboard to return to, so hide the
  // back link for them; full admins keep it. The share-link section is full-admin
  // only (the scoped editor must never see — or be able to mint — access links).
  const showBack = !state.coachingEditor;
  const showAccess = !state.coachingEditor && !!state.admin;
  // The roster exposes each participant's live link, so full admins only.
  const showRoster = !state.coachingEditor && !!state.admin;
  root.innerHTML = `
    ${renderSignedInBar()}
    ${showBack ? '<p class="admin-back"><a class="admin-back-link" href="/admin">&larr; Back to admin dashboard</a></p>' : ''}
    ${showRoster ? renderCoachingParticipantsSection() : ''}
    ${showRoster ? renderCoachingInviteSection() : ''}
    ${renderCoachingVoicesSection()}
    ${renderCoachingAgentsSection()}
    ${showAccess ? renderCoachingAccessSection() : ''}
  `;
  if (showRoster) attachCoachingParticipantsHandlers();
  if (showRoster) attachCoachingInviteHandlers();
  attachCoachingVoicesHandlers();
  attachCoachingAgentsHandlers();
  if (showAccess) attachCoachingAccessHandlers();
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
    const r = await fetch('/api/admin/coaching', { credentials: 'same-origin' });
    if (r.ok) {
      state.coaching = await r.json();
    }
  } catch (e) {
    console.warn('coaching load failed', e);
  }

  try {
    const r = await fetch('/api/admin/coaching-agents', { credentials: 'same-origin' });
    if (r.ok) {
      const data = await r.json();
      state.coachingAgents = data.agents || [];
    }
  } catch (e) {
    console.warn('coaching agents load failed', e);
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
          <label class="admin-all-scenarios">
            <input type="checkbox" id="admin-mode-coaching">
            <span class="admin-all-scenarios-text"><strong>Coaching practice page</strong> — this invite opens the coaching home with the scenarios you grant below.</span>
          </label>
          <div class="admin-coaching-picker" id="admin-coaching-picker" hidden>
            ${renderCoachingAgentPicker(state.coachingAgents)}
          </div>
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
        <p class="admin-send-hint" id="admin-send-hint">Pick at least one scenario above to send. Open a track with the arrow on the right, then check a scenario. (For a coaching test page, pick exactly one.)</p>
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

    ${renderCoachingSection()}

    ${renderCoachingAgentsLinkCard()}

    ${renderChartsSection()}

    ${renderPreviewSection()}

    ${renderRubricSection({ audit: true })}

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
  // Coaching-test invites use the dedicated coaching scenario, so turning the
  // checkbox on clears any library picks (and enables Send via updateSelectionCount).
  const coachingBox = document.getElementById('admin-mode-coaching');
  const coachingPicker = document.getElementById('admin-coaching-picker');
  if (coachingBox) {
    coachingBox.addEventListener('change', () => {
      if (coachingBox.checked) {
        form.querySelectorAll('input[name="scenario_id"]').forEach((cb) => { cb.checked = false; });
        const ab = document.getElementById('admin-all-scenarios');
        if (ab) { ab.checked = false; ab.indeterminate = false; }
      }
      // Reveal the coaching-agent picker only while in coaching mode.
      if (coachingPicker) coachingPicker.hidden = !coachingBox.checked;
      updateSelectionCount();
    });
  }
  // "All coaching agents" overrides the individual agent checkboxes: when it's
  // on, disable + ignore the per-agent picks.
  const coachingAll = document.getElementById('admin-coaching-all');
  if (coachingAll) {
    const syncAll = () => {
      form.querySelectorAll('input[name="coaching_agent_id"]').forEach((cb) => {
        if (cb === coachingAll) return;
        cb.disabled = coachingAll.checked;
      });
      updateSelectionCount();
    };
    coachingAll.addEventListener('change', syncAll);
    syncAll();
  }
  form.querySelectorAll('input[name="coaching_agent_id"]').forEach((cb) => {
    if (cb.id === 'admin-coaching-all') return;
    cb.addEventListener('change', updateSelectionCount);
  });
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
  attachCoachingHandlers();
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
  { id: 'sec-coaching', label: 'Coaching link' },
  { id: 'sec-coaching-agents-link', label: 'Scenarios' },
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

function renderRubricSection(opts = {}) {
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
      ${opts.audit ? `
      <details class="admin-rubric-audit" id="admin-rubric-audit">
        <summary class="admin-rubric-auditbtn">Recent activity</summary>
        <div class="admin-rubric-audit-body" id="admin-rubric-audit-body"><div class="admin-empty">Open to load activity…</div></div>
      </details>` : ''}
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
          ${list.map((it) => renderRubricItem(it, sections)).join('') || '<div class="admin-empty">No items in this section.</div>'}
        </div>
        <details class="admin-rubric-add">
          <summary class="admin-rubric-addbtn">+ Add item</summary>
          <div class="admin-rubric-editform" data-add-section="${escapeAttr(sec.key)}">
            ${rubricFieldsHtml({ section: sec.key }, sections)}
            <button type="button" class="primary-button" data-add>Add item</button>
          </div>
        </details>
      </div>
    `;
  }).join('');
}

function renderRubricItem(it, sections = []) {
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
            ${rubricFieldsHtml(it, sections)}
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
function rubricFieldsHtml(it = {}, sections = []) {
  const sectionSelect = (Array.isArray(sections) && sections.length) ? `
    <label class="admin-rubric-fl">Section</label>
    <select class="admin-input" data-field="section">
      ${sections.map((s) => `<option value="${escapeAttr(s.key)}"${s.key === it.section ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
    </select>` : '';
  return `
    ${sectionSelect}
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

  // Activity log (admin view only): load it the first time it's expanded.
  const auditEl = document.getElementById('admin-rubric-audit');
  if (auditEl && auditEl.dataset.wired !== '1') {
    auditEl.dataset.wired = '1';
    auditEl.addEventListener('toggle', () => { if (auditEl.open) loadRubricAudit(); });
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
      const section = fv('section') || item?.section;
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
      const fv = (f) => (form.querySelector(`[data-field="${f}"]`)?.value || '').trim();
      const section = fv('section') || form?.dataset.addSection;
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
  // Keep the activity log fresh if it's open.
  const auditEl = document.getElementById('admin-rubric-audit');
  if (auditEl && auditEl.open) loadRubricAudit();
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

async function loadRubricAudit() {
  const body = document.getElementById('admin-rubric-audit-body');
  if (!body) return;
  body.innerHTML = '<div class="admin-empty">Loading activity…</div>';
  try {
    const r = await fetch('/api/admin/rubric-audit', { credentials: 'same-origin' });
    const d = await r.json().catch(() => null);
    body.innerHTML = renderAuditList((d && d.events) || []);
  } catch {
    body.innerHTML = '<div class="admin-empty">Could not load activity.</div>';
  }
}

function renderAuditList(events) {
  if (!events.length) return '<div class="admin-empty">No activity yet.</div>';
  return `<ul class="admin-audit-list">${events.map((e) => {
    const who = e.actor_kind === 'reviewer' ? 'Review link' : escapeHtml(e.actor || 'admin');
    const action = describeAuditAction(e);
    const itemLabel = e.item_key ? auditItemLabel(e.item_key) : '';
    return `<li class="admin-audit-row">
      <span class="admin-audit-dot" data-kind="${escapeAttr(e.actor_kind || '')}" aria-hidden="true"></span>
      <span class="admin-audit-text"><strong>${who}</strong> ${escapeHtml(action)}${itemLabel ? ` <span class="admin-audit-item">${escapeHtml(itemLabel)}</span>` : ''}</span>
      <span class="admin-audit-when">${escapeHtml(formatAuditTime(e.ts))}</span>
    </li>`;
  }).join('')}</ul>`;
}

function describeAuditAction(e) {
  switch (e.action) {
    case 'opened': return 'opened the editor';
    case 'enable': return 'turned on';
    case 'disable': return 'turned off';
    case 'add': return 'added';
    case 'edit': return 'edited';
    case 'delete': return 'deleted';
    default: return e.action || 'changed';
  }
}

function auditItemLabel(key) {
  const it = (state.rubric?.items || []).find((i) => i.key === key);
  return it ? it.label : key;
}

function formatAuditTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return '';
  try {
    return new Date(n * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
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

// ---- Scenarios editor access (scoped share link) --------------------------
// A no-password link that opens ONLY this coaching Scenarios admin page (create/
// manage scenarios + voices), not the rest of admin. Backed by the invites
// sentinel pattern (like the review link): generate rotates the token, revoke
// kills it instantly. Full-admin only — the scoped editor never sees this.

function renderCoachingAccessSection() {
  const r = state.coachingAccess;
  const active = !!r?.active;
  const statusHtml = active
    ? '<span class="admin-pill admin-pill-active">Active</span> <span class="admin-muted">Opens this Scenarios editor only</span>'
    : '<span class="admin-muted">No Scenarios-editor link yet</span>';
  return `
    <section class="admin-section" id="sec-coachingaccess">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Scenarios editor access</p>
        <h2 class="admin-section-title">Share the Scenarios editor</h2>
        <p class="admin-section-sub">A no-password link that opens ONLY this page (create/manage scenarios + voices), not the rest of admin. Share it with someone who should author scenarios without full admin access. Revoke any time.</p>
      </header>
      <div class="admin-invite-card is-active" style="flex-direction:column;align-items:stretch;gap:14px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;">${statusHtml}</div>
        <div class="admin-invite-actions" style="justify-content:flex-start;">
          <button type="button" class="primary-button" id="admin-coaching-access-generate-btn">${active ? 'Regenerate link' : 'Generate link'}</button>
          ${active ? '<button type="button" class="ghost-button" id="admin-coaching-access-revoke-btn">Revoke</button>' : ''}
        </div>
        <div id="admin-coaching-access-generated" class="admin-generated"></div>
      </div>
    </section>
  `;
}

function attachCoachingAccessHandlers() {
  const genBtn = document.getElementById('admin-coaching-access-generate-btn');
  if (genBtn) genBtn.addEventListener('click', onGenerateCoachingAccess);
  const revokeBtn = document.getElementById('admin-coaching-access-revoke-btn');
  if (revokeBtn) revokeBtn.addEventListener('click', onRevokeCoachingAccess);
  paintCoachingAccessGenerated();
}

async function onGenerateCoachingAccess() {
  const btn = document.getElementById('admin-coaching-access-generate-btn');
  const out = document.getElementById('admin-coaching-access-generated');
  if (out) out.innerHTML = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
  try {
    const res = await fetch('/api/admin/coaching-access', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      const errMsg = parts.length ? parts.join(' — ') : (res.statusText || 'no message');
      if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Error ${res.status}: ${escapeHtml(errMsg)}</div>`;
      return;
    }
    state.lastCoachingAccessUrl = data.url;
    try {
      const r = await fetch('/api/admin/coaching-access', { credentials: 'same-origin' });
      if (r.ok) { state.coachingAccess = await r.json(); }
    } catch {}
    refreshCoachingAccessSection();
    paintCoachingAccessGenerated();
  } catch (err) {
    if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

async function onRevokeCoachingAccess() {
  if (!confirm('Revoke the Scenarios-editor link? Anyone holding it will lose access immediately.')) return;
  const btn = document.getElementById('admin-coaching-access-revoke-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Revoking...'; }
  try {
    const res = await fetch('/api/admin/coaching-access', { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok) {
      state.lastCoachingAccessUrl = null;
      try {
        const r = await fetch('/api/admin/coaching-access', { credentials: 'same-origin' });
        if (r.ok) { state.coachingAccess = await r.json(); }
      } catch {}
      refreshCoachingAccessSection();
    } else {
      alert('Revoke failed.');
      if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
    }
  } catch {
    alert('Network error.');
    if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
  }
}

function refreshCoachingAccessSection() {
  const sections = root.querySelectorAll('.admin-section');
  for (const sec of sections) {
    const eyebrow = sec.querySelector('.admin-eyebrow');
    if (eyebrow && eyebrow.textContent.trim() === 'Scenarios editor access') {
      const tmp = document.createElement('div');
      tmp.innerHTML = renderCoachingAccessSection();
      sec.replaceWith(tmp.firstElementChild);
      break;
    }
  }
  attachCoachingAccessHandlers();
}

function paintCoachingAccessGenerated() {
  const out = document.getElementById('admin-coaching-access-generated');
  if (!out) return;
  if (!state.lastCoachingAccessUrl) { out.innerHTML = ''; return; }
  out.innerHTML = `
    <div class="admin-alert admin-alert-success"><strong>Scenarios-editor link ready.</strong> It opens only this page — no password, no other admin access.</div>
    <div class="admin-generated-list">
      <div class="admin-generated-row">
        <div class="admin-generated-url-row">
          <input class="admin-input admin-generated-url" readonly value="${escapeAttr(state.lastCoachingAccessUrl)}">
          <button type="button" class="ghost-button admin-copy-btn" data-url="${escapeAttr(state.lastCoachingAccessUrl)}">Copy</button>
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

// Coaching-agent picker shown when the invite is in coaching mode. Lists the
// authored agents (checkboxes, value = ca_ id) PLUS an "All coaching agents"
// checkbox (value = '__all_coaching__'). When there are zero authored agents we
// fall back to the legacy coaching_practice so the feature still works, plus a
// hint linking to /admin-coaching to author agents.
function renderCoachingAgentPicker(agents) {
  const list = Array.isArray(agents) ? agents.filter((a) => a && a.id) : [];
  if (!list.length) {
    return `
      <div class="admin-coaching-picker-empty">
        <p class="admin-muted">No scenarios authored yet — this invite will use the built-in coaching practice (Taylor).</p>
        <p class="admin-muted"><a href="/admin-coaching" target="_blank" rel="noopener">Create scenarios →</a></p>
      </div>`;
  }
  const rows = list.map((a) => {
    const label = (a.scenario_name && a.scenario_name.trim()) || a.name || a.id;
    return `
    <label class="admin-coaching-agent-opt">
      <input type="checkbox" name="coaching_agent_id" value="${escapeAttr(a.id)}">
      <span class="admin-coaching-agent-text">${escapeHtml(label)}${a.role_title ? ` <span class="admin-muted">· ${escapeHtml(a.role_title)}</span>` : ''}</span>
    </label>`;
  }).join('');
  return `
    <label class="admin-coaching-agent-opt admin-coaching-agent-all">
      <input type="checkbox" id="admin-coaching-all" name="coaching_agent_id" value="__all_coaching__">
      <span class="admin-coaching-agent-text"><strong>All scenarios</strong> — grant every active scenario, including ones added later.</span>
    </label>
    <div class="admin-coaching-agent-rows">${rows}</div>`;
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

  const coaching = !!document.getElementById('admin-mode-coaching')?.checked;
  // Whether the coaching picker has a usable selection. When there are NO
  // authored agents the picker shows only the legacy fallback, so coaching mode
  // is valid on its own. When agents exist, the admin must pick at least one
  // (or "All coaching agents").
  const hasAuthoredAgents = Array.isArray(state.coachingAgents) && state.coachingAgents.length > 0;
  const coachingAllChecked = !!document.getElementById('admin-coaching-all')?.checked;
  const coachingPicked = form.querySelectorAll('input[name="coaching_agent_id"]:checked').length;
  const coachingReady = coaching && (!hasAuthoredAgents || coachingAllChecked || coachingPicked > 0);

  const btn = document.getElementById('admin-generate-btn');
  if (btn) btn.disabled = coaching ? !coachingReady : total === 0;

  // Tell the admin why Send is disabled (no scenario / no agent picked yet).
  const sendHint = document.getElementById('admin-send-hint');
  if (sendHint) sendHint.hidden = (coaching && coachingReady) || (!coaching && total !== 0);

  document.querySelectorAll('[data-type-count]').forEach((el) => {
    const tid = el.dataset.typeCount;
    const c = form.querySelectorAll(`input[data-type="${CSS.escape(tid)}"]:checked`).length;
    el.hidden = c === 0;
    el.textContent = c;
  });
}

// ---- Invite list ----------------------------------------------------------

// Human label for an assigned scenario chip. Maps ca_ ids to the authored
// agent's name (via state.coachingAgents) and renders the '__all_coaching__'
// sentinel as "All coaching agents". Normal scenarios keep their display name.
function coachingScenarioLabel(s) {
  const id = s && s.id;
  if (id === '__all_coaching__') return 'All scenarios';
  if (typeof id === 'string' && id.startsWith('ca_')) {
    const agent = (state.coachingAgents || []).find((a) => a && a.id === id);
    return (agent && ((agent.scenario_name && agent.scenario_name.trim()) || agent.name)) || id;
  }
  return s?.customer_name || id || '';
}

function renderInviteList(invites) {
  if (!invites.length) {
    return '<div class="admin-empty">No invites yet. Send your first one above.</div>';
  }
  const now = Math.floor(Date.now() / 1000);
  const rows = invites.map((inv) => {
    const status = inviteStatus(inv, now);
    const scenarios = (inv.scenarios || []);
    const chips = scenarios.length
      ? scenarios.slice(0, 4).map((s) => `<span class="admin-chip" title="${escapeAttr(s.tagline || '')}">${escapeHtml(coachingScenarioLabel(s))}</span>`).join('')
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
          <div class="admin-invite-name">${escapeHtml(inv.recipient_name || inv.recipient_email)}${inv.mode === 'coaching' ? ' <span class="admin-mode-badge">Coaching</span>' : ''}</div>
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

// ---- Coaching link --------------------------------------------------------

// One shareable, no-password link to the cinematic Coaching Test page (the
// coaching_practice scenario) — the open-link sibling of the per-email coaching
// invites. Backed by the invites system (sentinel recipient_email + mode), so
// generate rotates the token and revoke kills the link immediately. Mirrors the
// demo link's generate / copy / revoke flow.
// ---- Coaching participants roster ------------------------------------------
// The cohort dashboard: every per-email coaching invite (mode='coaching') with
// its live, copyable link, assigned scenario(s), calls taken, and last activity.
// Backed by GET /api/admin/coaching-participants (full-admin only). Invites are
// CREATED from the main admin dashboard's invite form; this is the read/manage
// surface for the people already invited.

function renderCoachingParticipantsSection() {
  const list = Array.isArray(state.coachingParticipants) ? state.coachingParticipants : [];
  const body = list.length
    ? `<div class="coaching-roster">${list.map(renderParticipantCard).join('')}</div>`
    : `<p class="admin-muted" style="margin:0;">No coaching participants yet. Use the <strong>Invite a participant</strong> form below to add managers. They'll appear here with their links.</p>`;

  return `
    <section class="admin-section" id="sec-coaching-participants">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Coaching</p>
        <h2 class="admin-section-title">Participants${list.length ? ` <span class="admin-muted" style="font-weight:400;">(${list.length})</span>` : ''}</h2>
        <p class="admin-section-sub">Everyone invited to coaching, each with their own dashboard and accumulating progress. Copy a link to re-send it manually. <button type="button" class="ghost-button" id="admin-participants-refresh" style="margin-left:6px;">Refresh</button></p>
      </header>
      ${body}
    </section>
  `;
}

function renderParticipantCard(p) {
  const who = p.recipient_name
    ? `<strong>${escapeHtml(p.recipient_name)}</strong> <span class="email">${escapeHtml(p.recipient_email)}</span>`
    : `<strong>${escapeHtml(p.recipient_email)}</strong>`;

  const chips = (p.scenarios || []).length
    ? (p.scenarios || []).map((s) =>
        `<span class="admin-pill"${s.all ? ' style="background:#eef2ff;color:#3730a3;"' : ''}>${escapeHtml(s.label)}</span>`
      ).join('')
    : '<span class="admin-muted" style="font-size:13px;">No scenario assigned</span>';

  const calls = Number(p.call_count) || 0;
  const callsLabel = `${calls} call${calls === 1 ? '' : 's'} taken`;
  const lastLabel = p.last_activity ? `Last active ${fmtParticipantDate(p.last_activity)}` : 'No calls yet';
  const revokedPill = p.revoked ? ' <span class="admin-pill" style="background:#fee2e2;color:#991b1b;">Revoked</span>' : '';

  const linkRow = p.has_link && p.url
    ? `<div class="admin-generated-url-row">
         <input class="admin-input admin-generated-url" readonly value="${escapeAttr(p.url)}">
         <button type="button" class="ghost-button admin-participant-copy" data-url="${escapeAttr(p.url)}">Copy</button>
       </div>`
    : `<p class="coaching-roster-nolink">Link not stored for this invite yet — re-send it (form below) to generate a copyable link.</p>`;

  return `
    <div class="coaching-roster-card${p.revoked ? ' is-revoked' : ''}">
      <div class="coaching-roster-head">
        <span class="coaching-roster-who">${who}${revokedPill}</span>
        <span class="coaching-roster-meta">${escapeHtml(callsLabel)} · ${escapeHtml(lastLabel)}</span>
      </div>
      <div class="coaching-roster-chips">${chips}</div>
      ${linkRow}
    </div>
  `;
}

// Short, local date formatter for the roster (epoch seconds -> "Jun 4, 2026").
function fmtParticipantDate(ts) {
  try {
    return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(ts);
  }
}

function attachCoachingParticipantsHandlers() {
  const refresh = document.getElementById('admin-participants-refresh');
  if (refresh) refresh.addEventListener('click', reloadCoachingParticipants);

  root.querySelectorAll('.admin-participant-copy').forEach((btn) => {
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

// Re-fetch the roster and swap just this section in place.
async function reloadCoachingParticipants() {
  const btn = document.getElementById('admin-participants-refresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing...'; }
  try {
    const r = await fetch('/api/admin/coaching-participants', { credentials: 'same-origin' });
    if (r.ok) { const d = await r.json(); state.coachingParticipants = d.participants || []; }
  } catch (e) {
    console.warn('coaching participants reload failed', e);
  }
  const sec = document.getElementById('sec-coaching-participants');
  if (sec) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderCoachingParticipantsSection();
    sec.replaceWith(tmp.firstElementChild);
    attachCoachingParticipantsHandlers();
  }
}

// ---- Invite a participant (from the coaching dashboard) --------------------
// A self-contained coaching-invite form so the whole cohort can be created and
// managed in one place, next to the scenarios. POSTs to /api/admin/invites with
// mode:'coaching' (same endpoint the main dashboard uses); on success it shows
// the new link and refreshes the roster above. Full-admin only.

function renderCoachingInviteSection() {
  return `
    <section class="admin-section" id="sec-coaching-invite">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Coaching</p>
        <h2 class="admin-section-title">Invite a participant</h2>
        <p class="admin-section-sub">Send a manager their own coaching link. They get a private dashboard with progress that accumulates across calls. We email it automatically — and it shows up in Participants above to copy &amp; send manually too.</p>
      </header>
      <form id="coaching-invite-form" class="admin-invite-card" style="flex-direction:column;align-items:stretch;gap:14px;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <label style="flex:1 1 200px;display:flex;flex-direction:column;gap:4px;font-size:13px;">
            <span class="admin-muted">Email</span>
            <input class="admin-input" type="email" id="coaching-invite-email" placeholder="manager@store.com" autocomplete="off">
          </label>
          <label style="flex:1 1 160px;display:flex;flex-direction:column;gap:4px;font-size:13px;">
            <span class="admin-muted">Name <span style="opacity:0.6;">(optional)</span></span>
            <input class="admin-input" type="text" id="coaching-invite-name" placeholder="Jordan" autocomplete="off">
          </label>
          <label style="flex:0 0 auto;display:flex;flex-direction:column;gap:4px;font-size:13px;">
            <span class="admin-muted">Link expires</span>
            <select class="admin-input" id="coaching-invite-expiry">
              <option value="never" selected>Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="7">7 days</option>
            </select>
          </label>
        </div>
        <div>
          <p class="admin-muted" style="margin:0 0 8px;font-size:13px;">Assign scenario(s)</p>
          ${renderCoachingAgentPicker(state.coachingAgents)}
        </div>
        <div class="admin-invite-actions" style="justify-content:flex-start;align-items:center;gap:10px;">
          <button type="submit" class="primary-button" id="coaching-invite-send">Send invite</button>
        </div>
        <div id="coaching-invite-out" class="admin-generated"></div>
      </form>
    </section>
  `;
}

function attachCoachingInviteHandlers() {
  const form = document.getElementById('coaching-invite-form');
  if (form) form.addEventListener('submit', onSendCoachingInvite);
}

async function onSendCoachingInvite(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const out = document.getElementById('coaching-invite-out');
  const btn = document.getElementById('coaching-invite-send');
  if (out) out.innerHTML = '';

  const email = (document.getElementById('coaching-invite-email').value || '').trim();
  const name = (document.getElementById('coaching-invite-name').value || '').trim() || null;
  if (!email) {
    if (out) out.innerHTML = '<div class="admin-alert admin-alert-error">Add a recipient email.</div>';
    return;
  }

  // Mirror the main dashboard's coaching scenario resolution: "All scenarios"
  // sentinel, the picked ca_ ids, or the legacy fallback when none are authored.
  let scenarioIds;
  const allChecked = !!document.getElementById('admin-coaching-all')?.checked;
  if (allChecked) {
    scenarioIds = ['__all_coaching__'];
  } else {
    const picked = [...form.querySelectorAll('input[name="coaching_agent_id"]:checked')]
      .map((el) => el.value)
      .filter((v) => v && v !== '__all_coaching__');
    const hasAuthoredAgents = Array.isArray(state.coachingAgents) && state.coachingAgents.length > 0;
    if (!picked.length) {
      if (hasAuthoredAgents) {
        if (out) out.innerHTML = '<div class="admin-alert admin-alert-error">Pick at least one scenario (or "All scenarios").</div>';
        return;
      }
      scenarioIds = ['coaching_practice'];
    } else {
      scenarioIds = picked;
    }
  }

  const expiryVal = document.getElementById('coaching-invite-expiry').value;
  const expires_days = expiryVal === 'never' ? 'never' : parseInt(expiryVal, 10);

  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  try {
    const res = await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ scenario_ids: scenarioIds, recipients: [{ email, name }], expires_days, mode: 'coaching' }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      const errMsg = parts.length ? parts.join(' — ') : (res.statusText || 'no message');
      if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Error ${res.status}: ${escapeHtml(errMsg)}</div>`;
      return;
    }
    const inv = (data.invites || [])[0] || null;
    const emailOk = inv && inv.email_sent;
    const url = inv && inv.url ? inv.url : '';
    if (out) {
      out.innerHTML = `
        <div class="admin-alert admin-alert-success"><strong>Invite ${inv && inv.reused ? 'updated' : 'created'}.</strong> ${emailOk ? 'Email sent.' : 'Email not sent — copy the link below and share it manually.'}</div>
        ${url ? `<div class="admin-generated-list"><div class="admin-generated-row"><div class="admin-generated-url-row">
          <input class="admin-input admin-generated-url" readonly value="${escapeAttr(url)}">
          <button type="button" class="ghost-button admin-participant-copy" data-url="${escapeAttr(url)}">Copy</button>
        </div></div></div>` : ''}`;
      out.querySelectorAll('.admin-participant-copy').forEach((b) => {
        b.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(b.dataset.url);
            const o = b.textContent; b.textContent = 'Copied!';
            setTimeout(() => { b.textContent = o; }, 1500);
          } catch { alert('Copy failed. Select the URL and copy it manually.'); }
        });
      });
    }
    // Clear the recipient fields (keep scenario selection sticky for the next
    // person) and refresh the roster so the new participant shows immediately.
    document.getElementById('coaching-invite-email').value = '';
    document.getElementById('coaching-invite-name').value = '';
    reloadCoachingParticipants();
  } catch (err) {
    if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send invite'; }
  }
}

function renderCoachingSection() {
  const coaching = state.coaching;
  const active = !!coaching?.active;

  const statusHtml = active
    ? '<span class="admin-pill admin-pill-active">Active</span>'
    : '<span class="admin-muted">No coaching link yet</span>';

  return `
    <section class="admin-section" id="sec-coaching">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Coaching</p>
        <h2 class="admin-section-title">Coaching link</h2>
        <p class="admin-section-sub">One shareable link to the live coaching test. No password — anyone with the link can practice.</p>
      </header>

      <div class="admin-invite-card is-active" style="flex-direction:column;align-items:stretch;gap:14px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;">
          ${statusHtml}
        </div>
        <div class="admin-invite-actions" style="justify-content:flex-start;">
          <button type="button" class="primary-button" id="admin-coaching-generate-btn">${active ? 'Regenerate coaching link' : 'Generate coaching link'}</button>
          ${active ? '<button type="button" class="ghost-button" id="admin-coaching-revoke-btn">Revoke</button>' : ''}
        </div>
        <div id="admin-coaching-generated" class="admin-generated"></div>
      </div>
    </section>
  `;
}

function attachCoachingHandlers() {
  const genBtn = document.getElementById('admin-coaching-generate-btn');
  if (genBtn) genBtn.addEventListener('click', onGenerateCoaching);
  const revokeBtn = document.getElementById('admin-coaching-revoke-btn');
  if (revokeBtn) revokeBtn.addEventListener('click', onRevokeCoaching);
  // Re-render the last generated URL (if any) so a paintDashboard re-run keeps it.
  paintCoachingGenerated();
}

async function onGenerateCoaching() {
  const btn = document.getElementById('admin-coaching-generate-btn');
  const out = document.getElementById('admin-coaching-generated');
  if (out) out.innerHTML = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
  try {
    const res = await fetch('/api/admin/coaching', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      const errMsg = parts.length ? parts.join(' — ') : (res.statusText || 'no message');
      if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Error ${res.status}: ${escapeHtml(errMsg)}</div>`;
      return;
    }
    state.lastCoachingUrl = data.url;
    await loadData();
    refreshCoachingSection();
    paintCoachingGenerated();
  } catch (err) {
    if (out) out.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

async function onRevokeCoaching() {
  if (!confirm('Revoke the coaching link? Anyone holding it will lose access immediately.')) return;
  const btn = document.getElementById('admin-coaching-revoke-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Revoking...'; }
  try {
    const res = await fetch('/api/admin/coaching', { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok) {
      state.lastCoachingUrl = null;
      await loadData();
      refreshCoachingSection();
    } else {
      alert('Revoke failed.');
      if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
    }
  } catch {
    alert('Network error.');
    if (btn) { btn.disabled = false; btn.textContent = 'Revoke'; }
  }
}

// Swap just the Coaching section's DOM in place and re-wire its handlers, so the
// rest of the dashboard (and the generated URL state) is left untouched.
function refreshCoachingSection() {
  const sections = root.querySelectorAll('.admin-section');
  for (const sec of sections) {
    const eyebrow = sec.querySelector('.admin-eyebrow');
    if (eyebrow && eyebrow.textContent.trim() === 'Coaching') {
      const tmp = document.createElement('div');
      tmp.innerHTML = renderCoachingSection();
      sec.replaceWith(tmp.firstElementChild);
      break;
    }
  }
  attachCoachingHandlers();
}

function paintCoachingGenerated() {
  const out = document.getElementById('admin-coaching-generated');
  if (!out) return;
  if (!state.lastCoachingUrl) { out.innerHTML = ''; return; }
  out.innerHTML = `
    <div class="admin-alert admin-alert-success"><strong>Coaching link ready.</strong> Share it with anyone — no password needed.</div>
    <div class="admin-generated-list">
      <div class="admin-generated-row">
        <div class="admin-generated-url-row">
          <input class="admin-input admin-generated-url" readonly value="${escapeAttr(state.lastCoachingUrl)}">
          <button type="button" class="ghost-button admin-copy-btn" data-url="${escapeAttr(state.lastCoachingUrl)}">Copy</button>
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

// ---- Coaching voices (named EL voice catalogue) ----------------------------
// Admins add voices once (friendly name + raw EL voice id). Agent authors then
// pick by name from a dropdown rather than pasting raw ids. The raw voice_id is
// still stored on each coaching_agent row — this is purely a catalogue.

function renderCoachingVoicesSection() {
  return `
    <section class="admin-section" id="sec-coaching-voices">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Coaching</p>
        <h2 class="admin-section-title">Voices</h2>
        <p class="admin-section-sub">The voices your scenarios can use. The easiest way: add voices (with labels) to the shared ElevenLabs agent, then click <strong>Import from ElevenLabs</strong> below to pull them in by name — no voice IDs to copy. You can also add one manually.</p>
      </header>

      <div class="admin-cv-toolbar">
        <button type="button" class="primary-button" id="admin-cv-import">Import from ElevenLabs</button>
        <span class="admin-field-hint">Pulls the labeled voices already on your shared coaching agent.</span>
      </div>

      <form id="admin-cv-form" class="admin-cv-form" autocomplete="off">
        <div class="admin-field">
          <label class="admin-field-label" for="cv-name">Name</label>
          <input type="text" id="cv-name" class="admin-input" placeholder="e.g. Taylor (US Female)" required>
        </div>
        <div class="admin-field">
          <label class="admin-field-label" for="cv-voice-id">Voice ID</label>
          <input type="text" id="cv-voice-id" class="admin-input" placeholder="ElevenLabs voice id" required>
        </div>
        <div class="admin-field admin-cv-submit-field">
          <label class="admin-field-label" style="visibility:hidden">Add</label>
          <button type="submit" class="primary-button">Add voice</button>
        </div>
      </form>
      <div id="admin-cv-alert"></div>
      <div id="admin-cv-list">${renderCoachingVoicesList(state.coachingVoices)}</div>
    </section>
  `;
}

function renderCoachingVoicesList(voices) {
  if (!Array.isArray(voices) || voices.length === 0) {
    return '<div class="admin-empty">No voices yet.</div>';
  }
  return voices.map((v) => `
    <div class="admin-ca-row" data-cv-id="${escapeAttr(v.id)}">
      <div class="admin-ca-row-main">
        <div class="admin-ca-row-name">${escapeHtml(v.name)}</div>
        <div class="admin-ca-row-meta">
          <span class="admin-cv-voice-id">${escapeHtml(v.voice_id)}</span>
        </div>
      </div>
      <div class="admin-ca-row-actions">
        <button type="button" class="ghost-button" data-cv-preview="${escapeAttr(v.voice_id)}">&#9654; Preview</button>
        <button type="button" class="ghost-button" data-cv-delete="${escapeAttr(v.id)}">Delete</button>
      </div>
    </div>
  `).join('');
}

// Render <option> elements for the #ca-voice select. If selectedVoiceId is
// set but not present in state.coachingVoices, prepend a "Custom (id)" option
// so the legacy/custom value is never silently dropped.
function renderVoiceOptions(selectedVoiceId) {
  const id = selectedVoiceId || '';
  const voices = state.coachingVoices || [];
  const found = id === '' || voices.some((v) => v.voice_id === id);
  let opts = `<option value="">No voice (use agent default)</option>`;
  if (id && !found) {
    opts += `<option value="${escapeAttr(id)}" selected>Custom (${escapeHtml(id)})</option>`;
  }
  opts += voices.map((v) => {
    const sel = v.voice_id === id ? ' selected' : '';
    return `<option value="${escapeAttr(v.voice_id)}"${sel}>${escapeHtml(v.name)}</option>`;
  }).join('');
  return opts;
}

// Rebuild #ca-voice innerHTML, preserving the current selection.
function refreshVoiceSelect() {
  const sel = document.getElementById('ca-voice');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = renderVoiceOptions(current);
  sel.value = current;
}

function attachCoachingVoicesHandlers() {
  const form = document.getElementById('admin-cv-form');
  if (form) form.addEventListener('submit', onAddCoachingVoice);

  const importBtn = document.getElementById('admin-cv-import');
  if (importBtn) importBtn.addEventListener('click', onImportElevenLabsVoices);

  document.querySelectorAll('[data-cv-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deleteCoachingVoice(btn.dataset.cvDelete));
  });
  document.querySelectorAll('[data-cv-preview]').forEach((btn) => {
    btn.addEventListener('click', () => playVoicePreview(btn.dataset.cvPreview, btn));
  });
}

// ---- Voice preview (shared single player) ---------------------------------
// Streams a voice sample from /api/admin/voice-preview (same-origin, CSP-safe).
// One Audio at a time; clicking the playing button stops it.
let voicePreviewAudio = null;
let voicePreviewBtn = null;
function stopVoicePreview() {
  if (voicePreviewAudio) { try { voicePreviewAudio.pause(); } catch {} voicePreviewAudio = null; }
  if (voicePreviewBtn) { voicePreviewBtn.innerHTML = voicePreviewBtn.dataset.label || '&#9654; Preview'; voicePreviewBtn = null; }
}
function playVoicePreview(voiceId, btn) {
  if (!voiceId) {
    if (btn) { const orig = btn.innerHTML; btn.textContent = 'Pick a voice first'; setTimeout(() => { btn.innerHTML = orig; }, 1400); }
    return;
  }
  const wasThis = voicePreviewBtn === btn;
  stopVoicePreview();
  if (wasThis) return; // second click on the same button = stop
  const audio = new Audio('/api/admin/voice-preview?voice_id=' + encodeURIComponent(voiceId));
  voicePreviewAudio = audio;
  voicePreviewBtn = btn;
  if (btn) { btn.dataset.label = btn.innerHTML; btn.textContent = 'Loading…'; }
  audio.addEventListener('playing', () => { if (voicePreviewBtn === btn && btn) btn.innerHTML = '&#9632; Stop'; });
  audio.addEventListener('ended', () => { if (voicePreviewBtn === btn) stopVoicePreview(); });
  audio.addEventListener('error', () => {
    if (btn) { btn.textContent = 'No preview'; }
    if (voicePreviewBtn === btn) { voicePreviewAudio = null; }
    setTimeout(() => { if (btn && btn.textContent === 'No preview') { btn.innerHTML = btn.dataset.label || '&#9654; Preview'; if (voicePreviewBtn === btn) voicePreviewBtn = null; } }, 1600);
  });
  audio.play().catch(() => { if (btn) btn.textContent = 'No preview'; });
}

// Pull the labeled voices already configured on the shared ElevenLabs agent and
// add any that aren't in the catalogue yet (deduped by voice_id). The admin
// never has to copy a raw voice id — they just label voices in ElevenLabs.
async function onImportElevenLabsVoices() {
  const alertEl = document.getElementById('admin-cv-alert');
  const btn = document.getElementById('admin-cv-import');
  if (alertEl) alertEl.innerHTML = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
  try {
    const r = await fetch('/api/admin/elevenlabs-voices', { credentials: 'same-origin' });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      const parts = [d?.error, d?.detail].filter(Boolean);
      if (alertEl) alertEl.innerHTML = `<div class="admin-alert admin-alert-error">Couldn't reach ElevenLabs: ${escapeHtml(parts.length ? parts.join(' — ') : (r.statusText || 'failed'))}</div>`;
      return;
    }
    const incoming = Array.isArray(d?.voices) ? d.voices : [];
    if (!incoming.length) {
      const diag = d?._diag ? ` <code style="font-size:11px;">debug: ${escapeHtml(JSON.stringify(d._diag))}</code>` : '';
      if (alertEl) alertEl.innerHTML = `<div class="admin-alert">No voices found on the ElevenLabs agent. Make sure the voices are on agent_7001… and try again.${diag}</div>`;
      return;
    }
    const existing = new Set((state.coachingVoices || []).map((v) => v.voice_id));
    const toAdd = incoming.filter((v) => v && v.voice_id && !existing.has(v.voice_id));
    if (!toAdd.length) {
      if (alertEl) alertEl.innerHTML = `<div class="admin-alert admin-alert-success">All ${incoming.length} voice(s) are already imported.</div>`;
      return;
    }
    let added = 0;
    for (const v of toAdd) {
      try {
        const res = await fetch('/api/admin/coaching-voices', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: v.label || 'Unnamed voice', voice_id: v.voice_id }),
        });
        if (res.ok) added++;
      } catch {}
    }
    await reloadCoachingVoices();
    if (alertEl) alertEl.innerHTML = `<div class="admin-alert admin-alert-success">Imported ${added} voice(s) from ElevenLabs.</div>`;
  } catch (err) {
    if (alertEl) alertEl.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Import from ElevenLabs'; }
  }
}

async function onAddCoachingVoice(e) {
  e.preventDefault();
  const alertEl = document.getElementById('admin-cv-alert');
  if (alertEl) alertEl.innerHTML = '';

  const name = (document.getElementById('cv-name')?.value || '').trim();
  const voice_id = (document.getElementById('cv-voice-id')?.value || '').trim();
  if (!name || !voice_id) {
    if (alertEl) alertEl.innerHTML = `<div class="admin-alert admin-alert-error">Name and Voice ID are both required.</div>`;
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }
  try {
    const res = await fetch('/api/admin/coaching-voices', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, voice_id }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      if (alertEl) alertEl.innerHTML = `<div class="admin-alert admin-alert-error">${escapeHtml(parts.length ? parts.join(' — ') : (res.statusText || 'Add failed'))}</div>`;
      if (btn) { btn.disabled = false; btn.textContent = 'Add voice'; }
      return;
    }
    // Clear inputs
    const nameEl = document.getElementById('cv-name');
    const vidEl = document.getElementById('cv-voice-id');
    if (nameEl) nameEl.value = '';
    if (vidEl) vidEl.value = '';
    if (btn) { btn.disabled = false; btn.textContent = 'Add voice'; }
    await reloadCoachingVoices();
  } catch (err) {
    if (alertEl) alertEl.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
    if (btn) { btn.disabled = false; btn.textContent = 'Add voice'; }
  }
}

async function deleteCoachingVoice(id) {
  if (!confirm('Delete this voice? Agents already using its voice_id will keep working, but it will no longer appear in the dropdown.')) return;
  try {
    const res = await fetch('/api/admin/coaching-voices?id=' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const parts = [data?.error, data?.detail].filter(Boolean);
      alert('Delete failed: ' + (parts.length ? parts.join(' — ') : res.statusText));
      return;
    }
    await reloadCoachingVoices();
  } catch (err) {
    alert('Network error: ' + (err?.message || String(err)));
  }
}

// Re-fetch voices, update state, re-render the list and refresh the agent
// form select in place (preserving the current selection).
async function reloadCoachingVoices() {
  try {
    const r = await fetch('/api/admin/coaching-voices', { credentials: 'same-origin' });
    if (r.ok) { const d = await r.json(); state.coachingVoices = d.voices || []; }
  } catch (e) { console.warn('coaching voices reload failed', e); }
  stopVoicePreview();
  const listEl = document.getElementById('admin-cv-list');
  if (listEl) listEl.innerHTML = renderCoachingVoicesList(state.coachingVoices);
  // Re-wire delete + preview buttons on the freshly rendered list
  document.querySelectorAll('[data-cv-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deleteCoachingVoice(btn.dataset.cvDelete));
  });
  document.querySelectorAll('[data-cv-preview]').forEach((btn) => {
    btn.addEventListener('click', () => playVoicePreview(btn.dataset.cvPreview, btn));
  });
  refreshVoiceSelect();
}

// ---- Coaching agents (authoring) ------------------------------------------
// Admin authoring of the coachable AI "employees" managers practice on. Phase 1:
// create / edit / list / delete profiles. These are NOT yet wired into the live
// call flow — this section only stores the profiles via /api/admin/coaching-agents.

// The feedback-reception styles offered in the attitude <select>. Value === label.
const COACHING_ATTITUDES = [
  'Defensive',
  'Defensive with an attitude',
  'Dismissive (checked-out)',
  'Anxious & insecure',
  'Overconfident (knows best)',
  'Agreeable but no follow-through',
  'Combative',
];

function levelOptions(selected) {
  return ['low', 'medium', 'high']
    .map((lv) => `<option value="${lv}"${lv === selected ? ' selected' : ''}>${lv[0].toUpperCase() + lv.slice(1)}</option>`)
    .join('');
}

// Dashboard pointer card — the full Coaching-agents editor lives on its own page
// (admin-coaching.html) to keep the dashboard uncluttered.
function renderCoachingAgentsLinkCard() {
  const n = Array.isArray(state.coachingAgents) ? state.coachingAgents.length : 0;
  const countLabel = n === 0 ? 'No scenarios yet' : `${n} scenario${n === 1 ? '' : 's'}`;
  return `
    <section class="admin-section" id="sec-coaching-agents-link">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Coaching</p>
        <h2 class="admin-section-title">Scenarios</h2>
        <p class="admin-section-sub">The library of coachable AI employees managers practice on. Authored and managed on their own page.</p>
      </header>
      <div class="admin-invite-card is-active" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <span class="admin-muted">${escapeHtml(countLabel)}</span>
        <a class="primary-button" href="/admin-coaching">Open scenarios &rarr;</a>
      </div>
    </section>
  `;
}

function renderCoachingAgentsSection() {
  return `
    <section class="admin-section" id="sec-coaching-agents">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Coaching</p>
        <h2 class="admin-section-title">Scenarios</h2>
        <p class="admin-section-sub">The coachable AI employees managers practice on. Give each scenario a name, then author the employee's demeanor, how they take feedback, what they're resistant or receptive to, and the skill gap underneath.</p>
      </header>

      <div id="admin-ca-alert"></div>

      <form id="admin-ca-form" class="admin-ca-grid" autocomplete="off">
        <input type="hidden" id="ca-id" value="">

        <div class="admin-field admin-ca-wide">
          <label class="admin-field-label" for="ca-scenario-name">Scenario name</label>
          <input type="text" id="ca-scenario-name" class="admin-input" placeholder="e.g. The disengaged closer">
        </div>
        <div class="admin-field">
          <label class="admin-field-label" for="ca-name">Name <span class="admin-req">*</span></label>
          <input type="text" id="ca-name" class="admin-input" placeholder="e.g. Taylor" required>
        </div>
        <div class="admin-field">
          <label class="admin-field-label" for="ca-age">Age</label>
          <input type="number" id="ca-age" class="admin-input" placeholder="e.g. 24" min="0" max="120">
        </div>
        <div class="admin-field">
          <label class="admin-field-label" for="ca-role">Role / title</label>
          <input type="text" id="ca-role" class="admin-input" placeholder="e.g. Reservations agent">
        </div>
        <div class="admin-field">
          <label class="admin-field-label" for="ca-voice">Voice</label>
          <div class="admin-voice-row">
            <select id="ca-voice" class="admin-select">${renderVoiceOptions('')}</select>
            <button type="button" class="ghost-button" id="ca-voice-preview">&#9654; Preview</button>
          </div>
          <span class="admin-field-hint">Pick a named voice. Add voices in the Voices panel above. Enable each on the shared ElevenLabs agent.</span>
        </div>

        <div class="admin-field">
          <label class="admin-field-label" for="ca-attitude">Attitude to feedback</label>
          <select id="ca-attitude" class="admin-select">
            ${COACHING_ATTITUDES.map((a) => `<option value="${escapeAttr(a)}">${escapeHtml(a)}</option>`).join('')}
          </select>
        </div>
        <div class="admin-field">
          <label class="admin-field-label" for="ca-resistance">Resistance (starting wall)</label>
          <select id="ca-resistance" class="admin-select">${levelOptions('medium')}</select>
        </div>
        <div class="admin-field">
          <label class="admin-field-label" for="ca-receptiveness">Receptiveness (how far they soften)</label>
          <select id="ca-receptiveness" class="admin-select">${levelOptions('medium')}</select>
        </div>
        <div class="admin-field">
          <label class="admin-field-label" for="ca-skill-gap">Skill gap</label>
          <input type="text" id="ca-skill-gap" class="admin-input" placeholder="e.g. Misses upsell opportunities">
        </div>

        <div class="admin-field admin-ca-wide">
          <label class="admin-field-label" for="ca-skill-gap-detail">Skill gap detail</label>
          <textarea id="ca-skill-gap-detail" class="admin-input" rows="2" placeholder="What's really going on underneath the gap (the agent won't name this; it surfaces through behavior)."></textarea>
        </div>
        <div class="admin-field admin-ca-wide">
          <label class="admin-field-label" for="ca-demeanor">Typical performance & demeanor</label>
          <textarea id="ca-demeanor" class="admin-input" rows="2" placeholder="How they normally show up at work."></textarea>
        </div>
        <div class="admin-field admin-ca-wide">
          <label class="admin-field-label" for="ca-incident">Recent incident</label>
          <textarea id="ca-incident" class="admin-input" rows="2" placeholder="A recent situation the manager may bring up."></textarea>
        </div>
        <div class="admin-field admin-ca-wide">
          <label class="admin-field-label" for="ca-personality">Personality</label>
          <textarea id="ca-personality" class="admin-input" rows="2" placeholder="Quirks, background, how they talk."></textarea>
        </div>
        <div class="admin-field admin-ca-wide">
          <label class="admin-field-label" for="ca-opening-lines">Opening lines <span class="admin-field-hint">(one per line)</span></label>
          <textarea id="ca-opening-lines" class="admin-input" rows="3" placeholder="Hey... you wanted to see me?"></textarea>
        </div>

        <div class="admin-field admin-ca-wide">
          <div class="admin-ca-checks">
            <label class="admin-ca-check"><input type="checkbox" id="ca-derails"> Tends to stall / derail</label>
            <label class="admin-ca-check"><input type="checkbox" id="ca-mode-assessment"> Assessment mode</label>
            <label class="admin-ca-check"><input type="checkbox" id="ca-mode-coaching" checked> Coaching mode</label>
            <label class="admin-ca-check"><input type="checkbox" id="ca-mode-followup"> Follow-up mode</label>
            <label class="admin-ca-check"><input type="checkbox" id="ca-active" checked> Active</label>
          </div>
        </div>

        <div class="admin-field admin-ca-wide admin-ca-actions">
          <button type="submit" class="primary-button" id="ca-save-btn">Save scenario</button>
          <button type="button" class="ghost-button" id="ca-clear-btn">Clear / new</button>
        </div>
      </form>

      <div id="admin-ca-list">${renderCoachingAgentsList(state.coachingAgents)}</div>
    </section>
  `;
}

function renderCoachingAgentsList(agents) {
  if (!Array.isArray(agents) || !agents.length) {
    return '<div class="admin-empty">No scenarios yet. Create one above.</div>';
  }
  return agents.map((a) => {
    const modes = [
      a.mode_assessment ? 'Assessment' : '',
      a.mode_coaching ? 'Coaching' : '',
      a.mode_followup ? 'Follow-up' : '',
    ].filter(Boolean).join(', ') || '—';
    const statusPill = a.active
      ? '<span class="admin-pill admin-pill-active">Active</span>'
      : '<span class="admin-pill">Inactive</span>';
    // Primary line is the scenario name (admin's label); fall back to the
    // employee name. The employee name/role drop to the secondary meta line.
    const primary = (a.scenario_name && a.scenario_name.trim()) || a.name;
    const secondaryName = a.scenario_name && a.scenario_name.trim() ? a.name : '';
    return `
      <div class="admin-ca-row" data-id="${escapeAttr(a.id)}">
        <div class="admin-ca-row-main">
          <div class="admin-ca-row-name">${escapeHtml(primary)} ${statusPill}</div>
          <div class="admin-ca-row-meta">
            ${secondaryName ? `<span>${escapeHtml(secondaryName)}</span>` : ''}
            ${a.role_title ? `<span>${escapeHtml(a.role_title)}</span>` : ''}
            ${a.attitude ? `<span>${escapeHtml(a.attitude)}</span>` : ''}
            <span>Modes: ${escapeHtml(modes)}</span>
          </div>
        </div>
        <div class="admin-ca-row-actions">
          <button type="button" class="ghost-button" data-ca-edit="${escapeAttr(a.id)}">Edit</button>
          <button type="button" class="ghost-button" data-ca-delete="${escapeAttr(a.id)}">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function attachCoachingAgentsHandlers() {
  const form = document.getElementById('admin-ca-form');
  if (form) form.addEventListener('submit', onSaveCoachingAgent);
  const clearBtn = document.getElementById('ca-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearCoachingAgentForm);
  const voicePreviewBtnEl = document.getElementById('ca-voice-preview');
  if (voicePreviewBtnEl) {
    voicePreviewBtnEl.addEventListener('click', () => {
      const sel = document.getElementById('ca-voice');
      playVoicePreview(sel ? sel.value : '', voicePreviewBtnEl);
    });
  }

  document.querySelectorAll('[data-ca-edit]').forEach((btn) => {
    btn.addEventListener('click', () => editCoachingAgent(btn.dataset.caEdit));
  });
  document.querySelectorAll('[data-ca-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deleteCoachingAgent(btn.dataset.caDelete));
  });

  // Re-load the form if we were mid-edit when the section re-rendered.
  if (state.editingCoachingAgentId) {
    const agent = state.coachingAgents.find((a) => a.id === state.editingCoachingAgentId);
    if (agent) populateCoachingAgentForm(agent);
    else state.editingCoachingAgentId = null;
  }
}

function showCoachingAgentError(msg) {
  const el = document.getElementById('admin-ca-alert');
  if (!el) return;
  el.innerHTML = msg
    ? `<div class="admin-alert admin-alert-error">${escapeHtml(msg)}</div>`
    : '';
}

async function onSaveCoachingAgent(e) {
  e.preventDefault();
  showCoachingAgentError('');
  const btn = document.getElementById('ca-save-btn');

  const val = (id) => (document.getElementById(id)?.value ?? '').trim();
  const checked = (id) => (document.getElementById(id)?.checked ? 1 : 0);

  const name = val('ca-name');
  if (!name) { showCoachingAgentError('Name is required.'); return; }

  const payload = {
    id: val('ca-id') || undefined,
    scenario_name: val('ca-scenario-name'),
    name,
    age: val('ca-age') || null,
    role_title: val('ca-role'),
    voice_id: val('ca-voice'),
    attitude: val('ca-attitude'),
    resistance: val('ca-resistance'),
    receptiveness: val('ca-receptiveness'),
    skill_gap: val('ca-skill-gap'),
    skill_gap_detail: val('ca-skill-gap-detail'),
    demeanor: val('ca-demeanor'),
    incident: val('ca-incident'),
    personality: val('ca-personality'),
    derails: checked('ca-derails'),
    mode_assessment: checked('ca-mode-assessment'),
    mode_coaching: checked('ca-mode-coaching'),
    mode_followup: checked('ca-mode-followup'),
    active: checked('ca-active'),
    opening_lines: (document.getElementById('ca-opening-lines')?.value || '')
      .split('\n').map((s) => s.trim()).filter(Boolean),
  };

  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    const res = await fetch('/api/admin/coaching-agents', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const parts = [data?.error, data?.detail].filter(Boolean);
      showCoachingAgentError(parts.length ? parts.join(' — ') : (res.statusText || 'Save failed'));
      if (btn) { btn.disabled = false; btn.textContent = 'Save scenario'; }
      return;
    }
    state.editingCoachingAgentId = null;
    await loadData();
    refreshCoachingAgentsSection();
  } catch (err) {
    showCoachingAgentError('Network error: ' + (err?.message || String(err)));
    if (btn) { btn.disabled = false; btn.textContent = 'Save scenario'; }
  }
}

function editCoachingAgent(id) {
  const agent = state.coachingAgents.find((a) => a.id === id);
  if (!agent) return;
  state.editingCoachingAgentId = id;
  populateCoachingAgentForm(agent);
  const form = document.getElementById('admin-ca-form');
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function populateCoachingAgentForm(agent) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  const check = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  set('ca-id', agent.id);
  set('ca-scenario-name', agent.scenario_name);
  set('ca-name', agent.name);
  set('ca-age', agent.age ?? '');
  set('ca-role', agent.role_title);
  const voiceSel = document.getElementById('ca-voice');
  if (voiceSel) {
    voiceSel.innerHTML = renderVoiceOptions(agent.voice_id || '');
    voiceSel.value = agent.voice_id || '';
  }
  set('ca-attitude', agent.attitude || COACHING_ATTITUDES[0]);
  set('ca-resistance', agent.resistance || 'medium');
  set('ca-receptiveness', agent.receptiveness || 'medium');
  set('ca-skill-gap', agent.skill_gap);
  set('ca-skill-gap-detail', agent.skill_gap_detail);
  set('ca-demeanor', agent.demeanor);
  set('ca-incident', agent.incident);
  set('ca-personality', agent.personality);
  set('ca-opening-lines', Array.isArray(agent.opening_lines) ? agent.opening_lines.join('\n') : '');
  check('ca-derails', agent.derails);
  check('ca-mode-assessment', agent.mode_assessment);
  check('ca-mode-coaching', agent.mode_coaching);
  check('ca-mode-followup', agent.mode_followup);
  check('ca-active', agent.active);
  const btn = document.getElementById('ca-save-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
}

function clearCoachingAgentForm() {
  state.editingCoachingAgentId = null;
  const form = document.getElementById('admin-ca-form');
  if (form) form.reset();
  const idEl = document.getElementById('ca-id');
  if (idEl) idEl.value = '';
  const scenarioNameEl = document.getElementById('ca-scenario-name');
  if (scenarioNameEl) scenarioNameEl.value = '';
  // Rebuild the voice select so form.reset() doesn't land on a stale value.
  const voiceSel = document.getElementById('ca-voice');
  if (voiceSel) { voiceSel.innerHTML = renderVoiceOptions(''); voiceSel.value = ''; }
  // form.reset() restores checkbox defaults from the HTML, but be explicit:
  const check = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
  check('ca-mode-coaching', true);
  check('ca-active', true);
  showCoachingAgentError('');
  const btn = document.getElementById('ca-save-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Save scenario'; }
}

async function deleteCoachingAgent(id) {
  if (!confirm('Delete this scenario? This cannot be undone.')) return;
  showCoachingAgentError('');
  try {
    const res = await fetch('/api/admin/coaching-agents?id=' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const parts = [data?.error, data?.detail].filter(Boolean);
      showCoachingAgentError(parts.length ? parts.join(' — ') : 'Delete failed');
      return;
    }
    if (state.editingCoachingAgentId === id) state.editingCoachingAgentId = null;
    await loadData();
    refreshCoachingAgentsSection();
  } catch (err) {
    showCoachingAgentError('Network error: ' + (err?.message || String(err)));
  }
}

// Swap just the Coaching agents section's DOM in place and re-wire its handlers.
function refreshCoachingAgentsSection() {
  const sec = document.getElementById('sec-coaching-agents');
  if (sec) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderCoachingAgentsSection();
    sec.replaceWith(tmp.firstElementChild);
  }
  attachCoachingAgentsHandlers();
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

  const modeEl = document.getElementById('admin-mode-coaching');
  const mode = modeEl && modeEl.checked ? 'coaching' : 'standard';

  // Coaching invites carry the authored agent ids the admin picked, or the
  // '__all_coaching__' sentinel when "All coaching agents" is checked. When no
  // agents are authored yet (picker shows only the fallback), send the legacy
  // coaching_practice so the feature still works. Standard invites use the
  // picked library scenarios.
  let scenarioIds;
  if (mode === 'coaching') {
    const allChecked = !!document.getElementById('admin-coaching-all')?.checked;
    if (allChecked) {
      scenarioIds = ['__all_coaching__'];
    } else {
      const picked = [...form.querySelectorAll('input[name="coaching_agent_id"]:checked')]
        .map((el) => el.value)
        .filter((v) => v && v !== '__all_coaching__');
      const hasAuthoredAgents = Array.isArray(state.coachingAgents) && state.coachingAgents.length > 0;
      if (!picked.length) {
        if (hasAuthoredAgents) {
          out.innerHTML = '<div class="admin-alert admin-alert-error">Pick at least one scenario (or "All scenarios").</div>';
          return;
        }
        scenarioIds = ['coaching_practice'];
      } else {
        scenarioIds = picked;
      }
    }
  } else {
    scenarioIds = [...form.querySelectorAll('input[name="scenario_id"]:checked')].map((el) => el.value);
    if (!scenarioIds.length) {
      out.innerHTML = '<div class="admin-alert admin-alert-error">Pick at least one scenario.</div>';
      return;
    }
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
      body: JSON.stringify({ scenario_ids: scenarioIds, recipients: [{ email, name }], expires_days, mode }),
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
