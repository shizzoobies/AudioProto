const RUBRIC_DISPLAY = [
  { key: 'rapport', label: 'Rapport & Empathy' },
  { key: 'listening', label: 'Active Listening' },
  { key: 'problem_solving', label: 'Problem Solving' },
  { key: 'sales', label: 'Sales Acumen' },
  { key: 'policy', label: 'Policy & Accuracy' },
  { key: 'resolution', label: 'Overall Resolution' },
];

export async function requestCoachingReport(scenarioId, transcript, openingLine) {
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario_id: scenarioId, transcript, opening_line: openingLine }),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.error || `http_${res.status}`;
    } catch {
      detail = `http_${res.status}`;
    }
    throw new Error(detail);
  }
  return res.json();
}

export function renderReportHtml(scenario, report, { onNewCall, onRetry } = {}) {
  const root = document.createElement('section');
  root.className = 'report';

  const mood = sanitizeMood(report.final_mood);
  const moodNote = (report.final_mood_note || '').trim();

  root.innerHTML = `
    <header class="report-header">
      <div class="report-scenario-tag">${escapeHtml(scenario.title)}</div>
      <h1 class="report-title">Coaching report</h1>
      ${mood ? `
        <div class="report-mood" data-mood="${mood}">
          <span class="report-mood-dot" aria-hidden="true"></span>
          <span class="report-mood-label">${escapeHtml(scenario.customer_name)} left the call <strong>${mood}</strong></span>
          ${moodNote ? `<span class="report-mood-note">${escapeHtml(moodNote)}</span>` : ''}
        </div>
      ` : ''}
    </header>

    <div class="report-overall">
      <div class="report-score-ring" data-score="${escapeAttr(report.overall_score)}">
        <span class="report-score-value">${formatScore(report.overall_score)}</span>
        <span class="report-score-divisor">/ 5</span>
      </div>
      <div class="report-overall-label">Overall</div>
    </div>

    <div class="report-disclaimer">
      <p>Every call has room to grow, even a strong one. This report is built to surface those opportunities, not to grade you. A score below five is not a failure, it simply marks where your next improvement lives. Take one thing from it into your next call.</p>
    </div>

    <div class="report-callouts">
      <div class="report-callout report-callout-strengths">
        <h2 class="callout-title">Strengths</h2>
        <ul class="callout-list">
          ${(report.strengths || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>
      <div class="report-callout report-callout-growth">
        <h2 class="callout-title">Growth areas</h2>
        <ul class="callout-list">
          ${(report.growth_areas || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
        </ul>
      </div>
    </div>

    <blockquote class="report-pullquote">
      <div class="report-pullquote-label">One thing to try next time</div>
      <p class="report-pullquote-text">${escapeHtml(report.one_thing_to_try_next_time || '')}</p>
    </blockquote>

    <h2 class="report-section-title">Rubric breakdown</h2>
    <div class="report-rubric">
      ${RUBRIC_DISPLAY.map((entry) => renderRubricCard(entry, report.scores?.[entry.key])).join('')}
    </div>

    <div class="report-actions">
      <button class="ghost-button" id="report-new-call" type="button">Back to scenarios</button>
      <button class="primary-button" id="report-retry" type="button">Run this scenario again</button>
    </div>
  `;

  setTimeout(() => paintScoreRing(root.querySelector('.report-score-ring'), report.overall_score), 50);

  root.querySelector('#report-new-call').addEventListener('click', () => onNewCall?.());
  root.querySelector('#report-retry').addEventListener('click', () => onRetry?.());

  return root;
}

function renderRubricCard(entry, data) {
  if (!data) {
    return `
      <article class="rubric-card rubric-card-missing">
        <header class="rubric-head">
          <h3 class="rubric-label">${escapeHtml(entry.label)}</h3>
          <div class="rubric-score-text">No score</div>
        </header>
        <p class="rubric-evidence">No evidence captured.</p>
      </article>
    `;
  }
  const score = clampScore(data.score);
  return `
    <article class="rubric-card" data-score="${score}">
      <header class="rubric-head">
        <h3 class="rubric-label">${escapeHtml(entry.label)}</h3>
        <div class="rubric-score-text"><strong>${score}</strong> <span>/ 5</span></div>
      </header>
      <div class="rubric-bar" aria-label="Score ${score} out of 5">
        ${[1, 2, 3, 4, 5].map((i) => `<span class="rubric-bar-pip${i <= score ? ' filled' : ''}"></span>`).join('')}
      </div>
      <p class="rubric-evidence">${escapeHtml(data.evidence || '')}</p>
      <p class="rubric-suggestion"><span class="rubric-suggestion-label">Try next time</span> ${escapeHtml(data.suggestion || '')}</p>
    </article>
  `;
}

function paintScoreRing(ring, score) {
  if (!ring) return;
  const clamped = Math.max(1, Math.min(5, Number(score) || 0));
  const pct = ((clamped - 1) / 4) * 100;
  ring.style.setProperty('--ring-percent', `${pct}%`);
  ring.classList.add('animated');
}

const MOOD_VALUES = new Set(['satisfied', 'neutral', 'frustrated', 'unresolved', 'hostile']);
function sanitizeMood(value) {
  if (typeof value !== 'string') return '';
  const v = value.toLowerCase().trim();
  return MOOD_VALUES.has(v) ? v : '';
}

function clampScore(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function formatScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  return v.toFixed(1);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function escapeAttr(s) {
  return escapeHtml(s);
}
