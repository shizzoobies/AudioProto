// Admin dashboard SPA. On boot probes /api/admin/session to decide between
// the login form and the dashboard. The dashboard lets the admin pick
// scenarios, enter recipients, and click "Generate" - which POSTs to
// /api/admin/invites and returns one URL per recipient (newly minted, since
// reused invites get a refreshed token so the URL can always be re-shared).
// Invites are listed below with revoke buttons; the URL of an existing
// invite is NOT shown because we never store plaintext tokens.

const root = document.getElementById('admin-root');
const logoutBtn = document.getElementById('admin-logout');
const body = document.body;

const state = {
  scenarioTypes: [],      // grouped: [{id, title, difficulty, description, persona_count, personas:[...]}]
  invites: [],            // [{id, recipient_email, recipient_name, scenarios:[], created_at, expires_at, revoked, ...}]
  lastGenerated: [],      // [{id, email, name, url, scenario_ids, expires_at, reused}] from the last POST
};

init();

async function init() {
  body.dataset.appState = 'ready';
  const sessionRes = await fetch('/api/admin/session', { credentials: 'same-origin' });
  if (sessionRes.ok) {
    await renderDashboard();
  } else {
    renderLogin();
  }
}

// ---- Login ----------------------------------------------------------------

function renderLogin(errorMsg) {
  logoutBtn.hidden = true;
  root.innerHTML = `
    <section class="admin-login">
      <header class="admin-login-head">
        <h1 class="admin-login-title">Admin login</h1>
        <p class="admin-login-sub">Enter the admin password to manage training invites.</p>
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
    await fetch('/api/admin/login', { method: 'DELETE', credentials: 'same-origin' });
  } catch {}
  state.scenarios = [];
  state.invites = [];
  state.lastGenerated = [];
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
  // Scenario types stay grouped so the dashboard can render each as a
  // collapsible. Filter showcase since it's not useful as an invite target.
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
}

function paintDashboard() {
  const typesHtml = state.scenarioTypes.length
    ? state.scenarioTypes.map((t) => renderType(t)).join('')
    : '<div class="admin-empty">No scenarios available.</div>';

  root.innerHTML = `
    <section class="admin-section admin-create">
      <header class="admin-section-head">
        <h1 class="admin-section-title">New invites</h1>
        <p class="admin-section-sub">Pick scenarios, add recipients, generate URLs.</p>
      </header>

      <form id="admin-create-form" autocomplete="off">
        <fieldset class="admin-fieldset admin-fieldset-scenarios">
          <div class="admin-fieldset-head">
            <legend class="admin-legend">Scenarios</legend>
            <span class="admin-selected-badge" id="selected-count" hidden>0</span>
          </div>
          <div class="admin-types-list">${typesHtml}</div>
        </fieldset>

        <div class="admin-form-row">
          <fieldset class="admin-fieldset admin-fieldset-recipients">
            <legend class="admin-legend">Recipients</legend>
            <textarea id="admin-recipients" class="admin-textarea" rows="3" placeholder="jane@example.com, Jane Doe&#10;mike@example.com"></textarea>
            <p class="admin-hint">One per line. Format: <code>email</code> or <code>email, name</code>.</p>
          </fieldset>

          <fieldset class="admin-fieldset admin-fieldset-expiry">
            <legend class="admin-legend">Expiry</legend>
            <select id="admin-expiry" class="admin-select">
              <option value="7" selected>7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="never">Never</option>
            </select>
            <p class="admin-hint">Revoke anytime, regardless of expiry.</p>
          </fieldset>
        </div>

        <div class="admin-form-actions">
          <button type="submit" class="primary-button" id="admin-generate-btn" disabled>Generate</button>
        </div>
      </form>

      <div id="admin-generated"></div>
    </section>

    <section class="admin-section admin-invites">
      <header class="admin-section-head">
        <h2 class="admin-section-title">Invites</h2>
        <p class="admin-section-sub">All active and past invites. Click revoke to disable a link immediately.</p>
      </header>
      ${renderInviteTable(state.invites)}
    </section>
  `;

  const form = document.getElementById('admin-create-form');
  form.addEventListener('submit', onGenerate);
  form.addEventListener('change', updateSelectionCount);
  updateSelectionCount();
  attachInviteTableHandlers();
}

// One scenario type rendered as a <details> collapsible. Description is shown
// on expand, persona checkboxes underneath. Default collapsed - admins can
// open the tracks they're working with and ignore the rest.
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
  const total = form.querySelectorAll('input[name="scenario_id"]:checked').length;
  const badge = document.getElementById('selected-count');
  if (badge) {
    badge.hidden = total === 0;
    badge.textContent = `${total} selected`;
  }
  const btn = document.getElementById('admin-generate-btn');
  if (btn) btn.disabled = total === 0;

  document.querySelectorAll('[data-type-count]').forEach((el) => {
    const tid = el.dataset.typeCount;
    const count = form.querySelectorAll(`input[data-type="${CSS.escape(tid)}"]:checked`).length;
    el.hidden = count === 0;
    el.textContent = count;
  });
}

function renderInviteTable(invites) {
  if (!invites.length) {
    return '<div class="admin-empty">No invites yet. Generate one above.</div>';
  }
  const now = Math.floor(Date.now() / 1000);
  const rows = invites.map((inv) => {
    const status = inviteStatus(inv, now);
    const scenarios = (inv.scenarios || [])
      .map((s) => `<span class="admin-chip" title="${escapeAttr(s.tagline || '')}">${escapeHtml(s.customer_name || s.id)}</span>`)
      .join('');
    return `
      <tr data-id="${escapeAttr(inv.id)}" class="admin-invite-row ${status.cls}">
        <td class="admin-cell-recipient">
          <div class="admin-cell-email">${escapeHtml(inv.recipient_email)}</div>
          ${inv.recipient_name ? `<div class="admin-cell-name">${escapeHtml(inv.recipient_name)}</div>` : ''}
        </td>
        <td class="admin-cell-scenarios">${scenarios || '<span class="admin-muted">none</span>'}</td>
        <td class="admin-cell-meta">
          <div>${fmtDate(inv.created_at)}</div>
          <div class="admin-muted">expires ${inv.expires_at ? fmtDate(inv.expires_at) : 'never'}</div>
        </td>
        <td class="admin-cell-usage">
          <div>${inv.total_calls || 0} calls</div>
          <div class="admin-muted">${inv.last_click_at ? `clicked ${fmtRelative(inv.last_click_at, now)}` : 'no clicks yet'}</div>
        </td>
        <td class="admin-cell-status">
          <span class="admin-pill admin-pill-${status.tag}">${status.label}</span>
        </td>
        <td class="admin-cell-actions">
          ${status.tag === 'active' ? `<button type="button" class="ghost-button admin-revoke-btn" data-revoke="${escapeAttr(inv.id)}">Revoke</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
  return `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Recipient</th>
          <th>Scenarios</th>
          <th>Created</th>
          <th>Usage</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function inviteStatus(inv, now) {
  if (inv.revoked) return { tag: 'revoked', label: 'Revoked', cls: 'is-revoked' };
  if (inv.expires_at && inv.expires_at < now) return { tag: 'expired', label: 'Expired', cls: 'is-expired' };
  return { tag: 'active', label: 'Active', cls: 'is-active' };
}

function attachInviteTableHandlers() {
  root.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.revoke;
      if (!confirm('Revoke this invite? The recipient\'s link will stop working immediately.')) return;
      btn.disabled = true;
      btn.textContent = 'Revoking...';
      try {
        const res = await fetch(`/api/admin/invites/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (res.ok) {
          await loadData();
          paintDashboard();
        } else {
          alert('Revoke failed.');
          btn.disabled = false;
          btn.textContent = 'Revoke';
        }
      } catch (e) {
        alert('Network error.');
        btn.disabled = false;
        btn.textContent = 'Revoke';
      }
    });
  });
}

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

  const raw = document.getElementById('admin-recipients').value || '';
  const recipients = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(',');
    const email = (idx === -1 ? trimmed : trimmed.slice(0, idx)).trim();
    const name = idx === -1 ? null : trimmed.slice(idx + 1).trim() || null;
    if (email) recipients.push({ email, name });
  }
  if (!recipients.length) {
    out.innerHTML = '<div class="admin-alert admin-alert-error">Add at least one recipient.</div>';
    return;
  }

  const expiryVal = document.getElementById('admin-expiry').value;
  const expires_days = expiryVal === 'never' ? 'never' : parseInt(expiryVal, 10);

  btn.disabled = true;
  btn.textContent = 'Generating...';
  try {
    const res = await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ scenario_ids: scenarioIds, recipients, expires_days }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      out.innerHTML = `<div class="admin-alert admin-alert-error">Error: ${escapeHtml(data?.error || res.statusText)}</div>`;
      return;
    }
    state.lastGenerated = data.invites || [];
    paintGenerated();
    // Refresh the table below.
    await loadData();
    // Rerender just the invites section, keeping the create form state alive.
    const invitesSection = document.querySelector('.admin-invites');
    if (invitesSection) {
      invitesSection.innerHTML = `<h2 class="admin-section-title">Invites</h2>${renderInviteTable(state.invites)}`;
      attachInviteTableHandlers();
    }
    // Clear the recipients textarea so a follow-up Generate doesn't repeat.
    document.getElementById('admin-recipients').value = '';
    // Uncheck scenarios so the next batch starts fresh.
    form.querySelectorAll('input[name="scenario_id"]:checked').forEach((el) => { el.checked = false; });
  } catch (err) {
    out.innerHTML = `<div class="admin-alert admin-alert-error">Network error: ${escapeHtml(err?.message || String(err))}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}

function paintGenerated() {
  const out = document.getElementById('admin-generated');
  if (!state.lastGenerated.length) {
    out.innerHTML = '';
    return;
  }
  const rows = state.lastGenerated.map((g) => `
    <div class="admin-generated-row">
      <div class="admin-generated-meta">
        <div class="admin-generated-email">${escapeHtml(g.email)}${g.name ? ' · ' + escapeHtml(g.name) : ''}${g.reused ? ' <span class="admin-muted">(refreshed)</span>' : ' <span class="admin-muted">(new)</span>'}</div>
      </div>
      <div class="admin-generated-url-row">
        <input class="admin-input admin-generated-url" readonly value="${escapeAttr(g.url)}">
        <button type="button" class="ghost-button admin-copy-btn" data-url="${escapeAttr(g.url)}">Copy</button>
      </div>
    </div>
  `).join('');
  out.innerHTML = `
    <div class="admin-alert admin-alert-success">
      <strong>Done.</strong> Send each link to its recipient. (Email delivery comes in Phase 3 - for now, copy the URLs and send them manually.)
    </div>
    <div class="admin-generated-list">${rows}</div>
  `;
  out.querySelectorAll('[data-copy], .admin-copy-btn').forEach((btn) => {
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
function escapeAttr(s) {
  return escapeHtml(s);
}
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
