// Shared renderer for the coaching landing CONTENT (hero + free-form blocks).
// One source of truth used by BOTH the participant page (app.js) and the admin
// live preview (admin.js), so the preview can never drift from reality. Pure:
// takes a content object, returns an HTML string. Self-contained (own escaping,
// font map, paragraph splitting) so neither bundle has to share helpers.
//
// All color/font/image values are server-validated (hex / whitelisted key /
// id-shaped ref) before they are ever stored, so dropping them into inline
// styles here is safe (and the CSP allows 'unsafe-inline' styles).

export const COACHING_FONT_STACKS = {
  default: '',
  sans: "'Inter', system-ui, sans-serif",
  serif: "'Playfair Display', Georgia, serif",
  geometric: "'Poppins', system-ui, sans-serif",
  modern: "'Space Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

function fontStack(key) { return COACHING_FONT_STACKS[key] || ''; }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function imgUrl(id) { return `/coaching-image/${encodeURIComponent(id)}`; }
function paras(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function renderBlock(s) {
  if (!s || typeof s !== 'object') return '';
  const type = s.type || 'text';
  const heading = typeof s.heading === 'string' ? s.heading : '';
  const body = typeof s.body === 'string' ? s.body : '';
  const imgId = s.imageId || '';
  const fs = fontStack(s.font);
  const textColor = s.textColor || '';
  const bgColor = s.bgColor || '';
  const colorStyle = textColor ? ` style="color:${textColor}"` : '';

  const textInner = `
    ${heading ? `<h2 class="coaching-landing-section-h"${colorStyle}>${esc(heading)}</h2>` : ''}
    ${body ? `<div class="coaching-landing-section-body"${colorStyle}>${paras(body)}</div>` : ''}`;

  if (type === 'image_overlay' && imgId) {
    const overlay = (Math.max(0, Math.min(100, Number(s.overlay) || 0)) / 100);
    const tint = bgColor || '#000000';
    const wrap = [`background-image:url('${imgUrl(imgId)}')`];
    if (fs) wrap.push(`font-family:${fs}`);
    const inner = textColor ? ` style="color:${textColor}"` : ' style="color:#fff"';
    return `
      <section class="coaching-landing-block coaching-block-overlay" style="${wrap.join(';')}">
        <span class="coaching-block-tint" style="background:${tint};opacity:${overlay}"></span>
        <div class="coaching-block-overlay-inner"${inner}>
          ${heading ? `<h2 class="coaching-block-overlay-h">${esc(heading)}</h2>` : ''}
          ${body ? `<div class="coaching-block-overlay-body">${paras(body)}</div>` : ''}
        </div>
      </section>`;
  }

  if (type === 'image_split' && imgId) {
    const sideClass = s.imageSide === 'right' ? 'is-right' : 'is-left';
    const wrap = [];
    if (fs) wrap.push(`font-family:${fs}`);
    if (bgColor) wrap.push(`background:${bgColor}`);
    return `
      <section class="coaching-landing-block coaching-block-split ${sideClass}"${wrap.length ? ` style="${wrap.join(';')}"` : ''}>
        <div class="coaching-block-split-img" style="background-image:url('${imgUrl(imgId)}')"></div>
        <div class="coaching-block-split-text">${textInner}</div>
      </section>`;
  }

  if (!heading && !body) return '';
  const wrap = [];
  if (fs) wrap.push(`font-family:${fs}`);
  if (bgColor) wrap.push(`background:${bgColor}`);
  return `
    <section class="coaching-landing-section${bgColor ? ' has-bg' : ''}"${wrap.length ? ` style="${wrap.join(';')}"` : ''}>
      ${textInner}
    </section>`;
}

// Legacy content stored a flat `sections` array; new content uses `rows` (each a
// 1-3 column layout). Migrate sections to single-column rows on the fly so old
// content keeps rendering until it's re-saved.
function migrateRows(landing) {
  if (Array.isArray(landing.rows)) return landing.rows;
  if (Array.isArray(landing.sections)) {
    return landing.sections.map((s) => ({
      width: (s && (s.type === 'image_overlay' || s.type === 'image_split' || (s.type === 'text' && s.bgColor))) ? 'full' : 'contained',
      cols: 1,
      blocks: [s],
    }));
  }
  return [];
}

function renderRow(row) {
  if (!row || typeof row !== 'object') return '';
  const blocks = Array.isArray(row.blocks) ? row.blocks : [];
  if (!blocks.some(Boolean)) return '';
  let cols = parseInt(row.cols, 10);
  if (!(cols >= 1 && cols <= 3)) cols = Math.max(1, Math.min(3, blocks.length || 1));
  const width = row.width === 'full' ? 'full' : 'contained';
  const hasBg = !!row.bgColor;
  const style = hasBg ? ` style="background:${row.bgColor}"` : '';
  let colsHtml = '';
  for (let i = 0; i < cols; i++) {
    const b = blocks[i];
    colsHtml += `<div class="cl-col">${b ? renderBlock(b) : ''}</div>`;
  }
  return `<div class="cl-row width-${width}${hasBg ? ' has-bg' : ''}"${style}><div class="cl-row-cols cols-${cols}">${colsHtml}</div></div>`;
}

// Hero + rows HTML (NOT the scenario cards — those are data-driven and added by
// the participant page). Applies the same sensible defaults the live page uses
// when the admin hasn't authored a field yet.
export function renderLandingContentHtml(content) {
  const landing = content && typeof content === 'object' ? content : {};
  const hero = landing.hero && typeof landing.hero === 'object' ? landing.hero : {};
  const eyebrow = hero.eyebrow || 'Coaching Practice';
  const title = hero.title || 'Practice the conversations that matter.';
  const intro = hero.intro
    || 'Step into real coaching scenarios with team members who remember every conversation you have with them. Take them at your own pace. Your progress is saved.';
  const rowsHtml = migrateRows(landing).map(renderRow).join('');

  const heroFont = fontStack(hero.font);
  const heroHasImg = !!hero.imageId;
  const heroStyle = [];
  if (heroFont) heroStyle.push(`font-family:${heroFont}`);
  if (heroHasImg) heroStyle.push(`background-image:url('${imgUrl(hero.imageId)}')`);
  else if (hero.bgColor) heroStyle.push(`background:${hero.bgColor}`);
  const heroTextColor = hero.textColor || (heroHasImg ? '#ffffff' : '');
  const heroColor = heroTextColor ? ` style="color:${heroTextColor}"` : '';
  const heroOverlay = heroHasImg ? (Math.max(0, Math.min(100, Number(hero.overlay) || 0)) / 100) : 0;
  const heroTint = hero.bgColor || '#000000';
  const heroAlign = (hero.align === 'left' || hero.align === 'right') ? hero.align : 'center';

  // Fine-tune: text-size scale (CSS var the title/intro multiply by) + the inner
  // block's nudge (translate) and width. Neutral values (scale 100, offset 0,
  // width 0) leave everything at the CSS default.
  const scale = Number(hero.textScale) || 100;
  if (scale && scale !== 100) heroStyle.push(`--hero-text-scale:${scale / 100}`);
  const innerStyle = [];
  const ox = Number(hero.offsetX) || 0;
  const oy = Number(hero.offsetY) || 0;
  if (ox || oy) innerStyle.push(`transform:translate(${ox}px,${oy}px)`);
  const tw = Number(hero.textWidth) || 0;
  if (tw > 0) innerStyle.push(`max-width:${tw}px`);
  const innerAttr = innerStyle.length ? ` style="${innerStyle.join(';')}"` : '';

  return `
    <header class="coaching-landing-hero align-${heroAlign}${heroHasImg ? ' has-image' : ''}"${heroStyle.length ? ` style="${heroStyle.join(';')}"` : ''}>
      ${heroHasImg ? `<span class="coaching-block-tint" style="background:${heroTint};opacity:${heroOverlay}"></span>` : ''}
      <div class="coaching-landing-hero-inner"${innerAttr}>
        <p class="coaching-landing-eyebrow"${heroColor}>${esc(eyebrow)}</p>
        <h1 class="coaching-landing-title"${heroColor}>${esc(title)}</h1>
        ${intro ? `<p class="coaching-landing-intro"${heroColor}>${esc(intro)}</p>` : ''}
      </div>
    </header>
    ${rowsHtml}`;
}
