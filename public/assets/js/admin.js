// Admin dashboard SPA. On boot probes /api/admin/session to decide between
// login and dashboard. The dashboard shows a Scenarios panel up top (pick the
// curriculum once) and an inline single-row recipient form below
// (Name | Email | Expiry | Send invite). The picked scenarios stay sticky so
// the admin can fan one set out to multiple recipients without re-picking.
//
// Invites live below as card rows with revoke buttons. The URL of a newly
// generated invite is shown above the list with a Copy button — we don't
// store plaintext tokens, so it's only available at generation time.

const root = document.getElementById('admin-root');
const logoutBtn = document.getElementById('admin-logout');
const body = document.body;

const state = {
  scenarioTypes: [],   // [{id, title, difficulty, description, persona_count, personas:[...]}]
  invites: [],         // [{id, recipient_email, recipient_name, scenarios:[], created_at, expires_at, revoked, ...}]
  lastGenerated: [],   // [{id, email, name, url, scenario_ids, expires_at, reused}]
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
  state.scenarioTypes = [];
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
    <section class="admin-section">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Invite recipients</p>
        <h1 class="admin-section-title">Send a training invite</h1>
        <p class="admin-section-sub">Pick the scenarios you want this batch of recipients to train on, then send invites one at a time. The selection stays put between sends.</p>
      </header>

      <form id="admin-create-form" autocomplete="off">
        <div class="admin-scenarios-panel">
          <div class="admin-scenarios-head">
            <span class="admin-scenarios-label">Scenarios</span>
            <span class="admin-selected-badge" id="selected-count" hidden>0 selected</span>
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
      </form>

      <div id="admin-generated" class="admin-generated"></div>
    </section>

    <section class="admin-section">
      <header class="admin-section-head">
        <p class="admin-eyebrow">Members</p>
        <h2 class="admin-section-title">Active invites</h2>
        <p class="admin-section-sub">Every recipient with a live or past link. Revoke to disable a link immediately.</p>
      </header>
      <div id="admin-invite-list-wrap">${renderInviteList(state.invites)}</div>
    </section>
  `;

  const form = document.getElementById('admin-create-form');
  form.addEventListener('submit', onGenerate);
  form.addEventListener('change', updateSelectionCount);
  updateSelectionCount();
  attachInviteListHandlers();
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
  const total = form.querySelectorAll('input[name="scenario_id"]:checked').length;

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
    // gets the same training set without re-picking.
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
