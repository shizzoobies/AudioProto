// First Call embed block logic. Runs inside the Mighty HTML block page:
// resolves the learner from the xAPI bridge, frames the embed with the course
// token, and relays the embed's postMessage completion signal to Reach as xAPI
// statements (attempted -> completed + evaluated).
//
// Kept as an external file (not inline) so the same code also runs on the
// same-origin /block-test/ page, where the site CSP forbids inline scripts.

(function () {
  'use strict';

  const config = window.FIRSTCALL || {};
  // The test surface passes ?ct= on the page URL; a real course bakes it into
  // config.js. The query param wins so one test page covers any token.
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('ct')) config.ct = qs.get('ct');
    if (qs.get('sid')) config.sid = qs.get('sid');
  } catch (e) { /* older browsers: config.js values stand */ }

  const frame = document.getElementById('firstcall');
  const statusEl = document.getElementById('firstcall-status');
  const embedOrigin = new URL(config.origin).origin;
  let attempted = false;
  let finished = false;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  // ISO 8601 duration for xAPI result.duration (e.g. 187s -> PT3M7S).
  function isoDuration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return 'PT' + (m ? m + 'M' : '') + rest + 'S';
  }

  function learnerName() {
    const actor = window.xapi && window.xapi.getActor ? window.xapi.getActor() : null;
    if (!actor) return 'anonymous';
    if (actor.name) return String(actor.name);
    if (actor.account && actor.account.name) return String(actor.account.name);
    if (actor.mbox) return String(actor.mbox).replace(/^mailto:/, '');
    return 'anonymous';
  }

  window.xapi.ready(function () {
    const learner = learnerName();
    const src = config.origin + '/embed/call'
      + '?ct=' + encodeURIComponent(config.ct || '')
      + '&sid=' + encodeURIComponent(config.sid || 'demo_sales')
      + '&learner=' + encodeURIComponent(learner);
    frame.src = src;
    setStatus('Loading the practice call for ' + learner + '...');
  });

  window.addEventListener('message', function (e) {
    // Only trust messages from OUR embed: exact origin AND the framed window.
    if (e.origin !== embedOrigin) return;
    if (!frame || e.source !== frame.contentWindow) return;
    const data = e.data || {};

    if (data.type === 'firstcall:ready') {
      setStatus('Practice call ready. Press Start when you are.');
      if (!attempted) {
        attempted = true;
        window.xapi.send({
          verb: 'attempted',
          object: { id: config.activityId, name: config.activityName },
        });
      }
      return;
    }

    if (data.type === 'firstcall:started') {
      setStatus('Call in progress...');
      return;
    }

    if (data.type === 'firstcall:complete') {
      if (finished) return;
      finished = true;
      const score = Number(data.score);
      const hasScore = Number.isFinite(score);
      const passing = Number(config.passing);
      const result = {
        completion: true,
        duration: isoDuration(data.durationS),
      };
      if (hasScore) {
        result.success = Number.isFinite(passing) ? score >= passing : true;
        result.score = {
          raw: score,
          min: 1,
          max: 5,
          scaled: Math.max(0, Math.min(1, (score - 1) / 4)),
        };
      }
      window.xapi.send({
        verb: 'completed',
        object: { id: config.activityId, name: config.activityName },
        result: result,
      });
      if (hasScore) {
        window.xapi.send({
          verb: 'evaluated',
          object: { id: config.activityId, name: config.activityName },
          result: { score: result.score },
        });
      }
      setStatus(hasScore
        ? 'Call complete. Your score: ' + score.toFixed(1) + ' / 5. You can continue the course.'
        : 'Call complete. You can continue the course.');
      return;
    }

    if (data.type === 'firstcall:error') {
      setStatus(data.code === 'limit_reached'
        ? 'The practice line has hit its daily limit. Please come back tomorrow.'
        : 'The practice call hit a problem. You can continue the course and try again later.');
    }
  });
})();
