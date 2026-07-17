// Designing Growth — The Cultivar Lab Game.
//
// A native rebuild of the Articulate Storyline course. The whole game is data:
// data.json (gated, alongside index.html) holds every slide's copy, the stat
// deltas, the branching graph and the ending rules. This module is the engine +
// renderer. The visual styling deliberately mirrors the original Rise/Storyline
// design (cream canvas, organic corner shapes, leaf motifs, the cultivar photo,
// a green footer HUD) — see designing-growth.css.
//
// Rules of play (from the source): every stat starts at 5 (TotalScore 20). Each
// outcome slide applies its deltas ON ENTRY. A `final` slide ends the run: the
// ending is chosen by evaluating `endings` in order.

// Lives inside the token-gated /designing-growth/ folder (see
// functions/designing-growth/_middleware.js), so game content only reaches a
// valid cs_game cookie.
const DATA_URL = 'data.json?v=20260701-4';
const STAT_KEYS = ['Growth', 'Yield', 'Resilience', 'Efficiency'];

let model = null;
let stats = null;
let currentId = null;
let root = null;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Storyline embeds live variable references in copy as %_player.Growth%. Swap in
// the running value so any inline usage reads correctly.
const subst = (t) => String(t == null ? '' : t)
  .replace(/%_player\.(\w+)%/g, (m, k) => (k in stats ? String(stats[k]) : m));

// A prose line that is ONLY a stat readout (after substitution just a number) is
// redundant with the HUD, so drop it.
const isStatEcho = (t) => /^\s*[\d\s]+\s*$/.test(subst(t));

// Decorative leaf motifs (inline SVG so no extra assets, CSP-safe). One is a
// white outline (olive corner), one gold (charcoal corner) — matching the Rise art.
const LEAF = (cls, color) => `<svg class="${cls}" viewBox="0 0 64 64" fill="none" aria-hidden="true">
  <path d="M8 56 C8 30 30 8 56 8 C56 34 34 56 8 56 Z" stroke="${color}" stroke-width="2.4" fill="none"/>
  <path d="M8 56 C22 42 40 24 54 10" stroke="${color}" stroke-width="2.4"/>
</svg>`;

// ---- engine ---------------------------------------------------------------

function applyDeltas(slide) {
  for (const d of slide.deltas || []) {
    const n = Number(d.n) || 0;
    if (!(d.stat in stats)) continue;
    if (d.op === 'add') stats[d.stat] += n;
    else if (d.op === 'sub') stats[d.stat] -= n;
    else if (d.op === 'set') stats[d.stat] = n;
  }
}

function test(op, a, b) {
  if (op === 'gte') return a >= b;
  if (op === 'gt') return a > b;
  if (op === 'lte') return a <= b;
  if (op === 'lt') return a < b;
  if (op === 'eq') return a === b;
  return false;
}

// First ending whose conditions all pass. The last ending has no conditions, so
// it is the fallback.
function resolveEnding() {
  for (const e of model.endings) {
    if ((e.when || []).every(([stat, op, val]) => test(op, Number(stats[stat]), Number(val)))) return e.id;
  }
  return model.endings[model.endings.length - 1].id;
}

function go(id) {
  const slide = model.slides[id];
  if (!slide) return;
  currentId = id;
  applyDeltas(slide);
  render();
  window.scrollTo(0, 0);
}

function restart() {
  stats = Object.assign({}, model.stats);
  go(model.start);
}

// ---- rendering ------------------------------------------------------------

// Green footer HUD: the four stats + total, mirroring the Rise footer bar. A stat
// at 4 or below is flagged (Breakthrough Cultivar needs every stat above 4).
function footerHtml() {
  const chips = STAT_KEYS.map((k) => {
    const v = Number(stats[k]) || 0;
    return `<div class="dg-stat${v <= 4 ? ' is-low' : ''}">
      <span class="dg-stat-k">${esc(k)}</span><span class="dg-stat-v">${v}</span>
    </div>`;
  }).join('');
  return `<footer class="dg-footer">
    <div class="dg-hud">${chips}
      <div class="dg-stat dg-stat-total"><span class="dg-stat-k">Total</span><span class="dg-stat-v">${Number(stats.TotalScore) || 0}</span></div>
    </div>
  </footer>`;
}

function proseHtml(list) {
  return (list || [])
    .filter((p) => p && !isStatEcho(p))
    .map((p) => `<p class="dg-body">${esc(subst(p))}</p>`)
    .join('');
}

function choicesHtml(slide) {
  return `<div class="dg-choices">${(slide.choices || []).map((c) => `
    <button type="button" class="dg-choice" data-go="${esc(c.target)}">
      ${c.letter ? `<span class="dg-choice-letter">${esc(c.letter)}</span>` : ''}
      <span class="dg-choice-body">
        <span class="dg-choice-title">${esc(c.title)}</span>
        ${c.desc ? `<span class="dg-choice-desc">${esc(c.desc)}</span>` : ''}
      </span>
    </button>`).join('')}</div>`;
}

// The organic corner decorations + the cultivar photo edge that frame every
// in-game slide (the Rise look).
function decorHtml() {
  return `
    <div class="dg-corner dg-corner-tl">${LEAF('dg-leaf', '#f4efe0')}</div>
    <div class="dg-corner dg-corner-bl">${LEAF('dg-leaf', '#e79a3a')}</div>
    <div class="dg-photo" aria-hidden="true"></div>`;
}

function render() {
  const slide = model.slides[currentId];
  if (!slide || !root) return;
  const isEnding = !!slide.ending;
  const isIntro = currentId === model.start;

  // Intro: the original Rise title card as a hero, with a Begin button.
  if (isIntro) {
    root.innerHTML = `
      <div class="dg-stage is-intro">
        <div class="dg-hero">
          <img class="dg-hero-img" src="/assets/img/game/intro.png" alt="Designing Growth — The Cultivar Lab Game">
        </div>
        ${proseHtml((slide.prose || []).filter((t) => !/designing growth|cultivar lab game/i.test(t)))}
        <div class="dg-actions"><button type="button" class="dg-next" data-go="${esc(slide.next || '')}">Begin</button></div>
      </div>`;
    wire();
    return;
  }

  let actions = '';
  if (slide.choices && slide.choices.length) actions = choicesHtml(slide);
  else if (slide.final) actions = `<div class="dg-actions"><button type="button" class="dg-next" data-ending="1">See your outcome</button></div>`;
  else if (slide.next) actions = `<div class="dg-actions"><button type="button" class="dg-next" data-go="${esc(slide.next)}">Continue</button></div>`;
  else actions = `<div class="dg-actions"><button type="button" class="dg-next" data-restart="1">${isEnding ? 'Play again' : 'Start over'}</button></div>`;

  const content = isEnding
    ? `<p class="dg-eyebrow">Outcome</p><h1 class="dg-title">${esc(slide.ending)}</h1>
       ${proseHtml((slide.prose || []).filter((t) => t !== slide.ending))}`
    : `${slide.eyebrow ? `<p class="dg-eyebrow">${esc(subst(slide.eyebrow))}</p>` : ''}
       ${slide.head ? `<h1 class="dg-title">${esc(subst(slide.head))}</h1>` : ''}
       ${proseHtml(slide.prose)}`;

  root.innerHTML = `
    <div class="dg-stage${isEnding ? ' is-ending' : ''}">
      <div class="dg-slide">
        ${decorHtml()}
        <div class="dg-content">
          ${content}
          ${actions}
        </div>
        ${footerHtml()}
      </div>
    </div>`;
  wire();
}

function wire() {
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  root.querySelectorAll('[data-ending]').forEach((b) => b.addEventListener('click', () => go(resolveEnding())));
  root.querySelectorAll('[data-restart]').forEach((b) => b.addEventListener('click', restart));
}

// ---- boot -----------------------------------------------------------------

async function boot() {
  root = document.getElementById('dg-root');
  if (!root) return;
  try {
    const res = await fetch(DATA_URL, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    model = await res.json();
  } catch (err) {
    root.innerHTML = `<div class="dg-stage"><div class="dg-slide"><div class="dg-content">
      <h1 class="dg-title">Could not load the game</h1>
      <p class="dg-body">Please refresh to try again.</p></div></div></div>`;
    console.warn('[designing-growth] load failed', err);
    return;
  }
  restart();
}

boot();
