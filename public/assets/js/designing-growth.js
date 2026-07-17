// Designing Growth — The Cultivar Lab Game.
//
// A native rebuild of the Articulate Storyline course of the same name. The whole
// game is data: /assets/data/designing-growth.json holds every slide's copy, the
// stat deltas, the branching graph and the ending rules (all extracted faithfully
// from the Storyline package). This module is just the engine + renderer.
//
// Model shape:
//   { title, start, stats:{Growth,Yield,Resilience,Efficiency,TotalScore},
//     endings:[{id,name,when:[[stat,op,value],...]}],   // first match wins
//     slides:{ <id>: { title, body:[..], deltas:[{stat,op,n}], choices:[{letter,title,desc,target}],
//                      next:<id>, final:true, ending:'<name>' } } }
//
// Rules of play (from the source): every stat starts at 5 (TotalScore 20). Each
// outcome slide applies its deltas ON ENTRY. A `final` slide ends the run: the
// ending is chosen by evaluating `endings` in order.

// Lives inside the token-gated /designing-growth/ folder (see
// functions/designing-growth/_middleware.js), so the game content is only served
// to a valid cs_game cookie.
const DATA_URL = 'data.json?v=20260701-2';
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

// A prose line that is ONLY a stat readout (after substitution it's just a
// number) is redundant with the stat bar above, so drop it.
const isStatEcho = (t) => /^\s*[\d\s]+\s*$/.test(subst(t));

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
  if (root) root.scrollTop = 0;
  window.scrollTo(0, 0);
}

function restart() {
  stats = Object.assign({}, model.stats);
  go(model.start);
}

// ---- rendering ------------------------------------------------------------

function statsHtml() {
  const chips = STAT_KEYS.map((k) => {
    const v = Number(stats[k]) || 0;
    // Below 5 is the danger zone: Breakthrough Cultivar needs every stat above 4.
    const low = v <= 4 ? ' is-low' : '';
    return `<div class="dg-stat${low}">
      <span class="dg-stat-k">${esc(k)}</span>
      <span class="dg-stat-v">${v}</span>
    </div>`;
  }).join('');
  return `<div class="dg-stats" aria-label="Your cultivar">
    ${chips}
    <div class="dg-stat dg-stat-total"><span class="dg-stat-k">Total</span><span class="dg-stat-v">${Number(stats.TotalScore) || 0}</span></div>
  </div>`;
}

// head / eyebrow / prose are resolved at extraction time (the heading is the
// largest text on the Storyline slide; decorative glyphs and the stat echo lines
// are filtered out there). A slide with no real heading renders prose only.
function proseHtml(list) {
  return (list || [])
    .filter((p) => p && !isStatEcho(p))
    .map((p) => `<p class="dg-body">${esc(subst(p))}</p>`)
    .join('');
}

function bodyHtml(slide) {
  return `
    ${slide.eyebrow ? `<p class="dg-eyebrow">${esc(subst(slide.eyebrow))}</p>` : ''}
    ${slide.head ? `<h1 class="dg-title">${esc(subst(slide.head))}</h1>` : ''}
    ${proseHtml(slide.prose)}`;
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

function render() {
  const slide = model.slides[currentId];
  if (!slide || !root) return;
  const isEnding = !!slide.ending;
  const isIntro = currentId === model.start;

  let actions = '';
  if (slide.choices && slide.choices.length) actions = choicesHtml(slide);
  else if (slide.final) actions = `<div class="dg-actions"><button type="button" class="dg-next" data-ending="1">See your outcome</button></div>`;
  else if (slide.next) actions = `<div class="dg-actions"><button type="button" class="dg-next" data-go="${esc(slide.next)}">Continue</button></div>`;
  else if (isEnding) actions = `<div class="dg-actions"><button type="button" class="dg-next" data-restart="1">Play again</button></div>`;
  else actions = `<div class="dg-actions"><button type="button" class="dg-next" data-restart="1">Start over</button></div>`;

  root.innerHTML = `
    <div class="dg-shell${isEnding ? ' is-ending' : ''}${isIntro ? ' is-intro' : ''}">
      ${isIntro ? '' : statsHtml()}
      <article class="dg-card">
        ${isEnding ? `<p class="dg-eyebrow">Outcome</p><h1 class="dg-title">${esc(slide.ending)}</h1>
             ${proseHtml((slide.prose || []).filter((t) => t !== slide.ending))}`
          : bodyHtml(slide)}
        ${actions}
      </article>
    </div>`;

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
    root.innerHTML = `<div class="dg-shell"><article class="dg-card">
      <h1 class="dg-title">Could not load the game</h1>
      <p class="dg-body">Please refresh to try again.</p></article></div>`;
    console.warn('[designing-growth] load failed', err);
    return;
  }
  restart();
}

boot();
