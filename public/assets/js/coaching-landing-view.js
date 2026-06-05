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

// Hero + blocks HTML (NOT the scenario cards — those are data-driven and added
// by the participant page). Applies the same sensible defaults the live page
// uses when the admin hasn't authored a field yet.
export function renderLandingContentHtml(content) {
  const landing = content && typeof content === 'object' ? content : {};
  const hero = landing.hero && typeof landing.hero === 'object' ? landing.hero : {};
  const eyebrow = hero.eyebrow || 'Coaching Practice';
  const title = hero.title || 'Practice the conversations that matter.';
  const intro = hero.intro
    || 'Step into real coaching scenarios with team members who remember every conversation you have with them. Take them at your own pace — your progress is saved.';
  const sections = Array.isArray(landing.sections) ? landing.sections : [];
  const blocksHtml = sections.map(renderBlock).join('');

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

  return `
    <header class="coaching-landing-hero align-${heroAlign}${heroHasImg ? ' has-image' : ''}"${heroStyle.length ? ` style="${heroStyle.join(';')}"` : ''}>
      ${heroHasImg ? `<span class="coaching-block-tint" style="background:${heroTint};opacity:${heroOverlay}"></span>` : ''}
      <div class="coaching-landing-hero-inner">
        <p class="coaching-landing-eyebrow"${heroColor}>${esc(eyebrow)}</p>
        <h1 class="coaching-landing-title"${heroColor}>${esc(title)}</h1>
        ${intro ? `<p class="coaching-landing-intro"${heroColor}>${esc(intro)}</p>` : ''}
      </div>
    </header>
    ${blocksHtml}`;
}
