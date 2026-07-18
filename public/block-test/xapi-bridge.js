// xAPI bridge for Mighty HTML blocks inside Rise/Reach. Walks the window tree
// to find Articulate's ADL XAPIWrapper, extracts the learner (actor) and the
// parent activity, and exposes a tiny API:
//   xapi.ready(cb)   - cb fires once the bridge has initialized
//   xapi.send(opts)  - send a statement ({verb, object, result, context})
//   xapi.getActor()  - the LRS actor (learner identity) or null
//   xapi.isMock()    - true outside Reach/Rise (statements log to console)
//
// Outside Reach (standalone browser test, Rise preview) there is no wrapper:
// the bridge runs in mock mode, logging statements to the console so the block
// keeps working end to end.

(function (global) {
  'use strict';

  // Standard xAPI verb IRIs (ADL registry)
  const VERBS = {
    answered: { id: 'http://adlnet.gov/expapi/verbs/answered', display: { 'en-US': 'answered' } },
    asked: { id: 'http://adlnet.gov/expapi/verbs/asked', display: { 'en-US': 'asked' } },
    attempted: { id: 'http://adlnet.gov/expapi/verbs/attempted', display: { 'en-US': 'attempted' } },
    completed: { id: 'http://adlnet.gov/expapi/verbs/completed', display: { 'en-US': 'completed' } },
    experienced: { id: 'http://adlnet.gov/expapi/verbs/experienced', display: { 'en-US': 'experienced' } },
    interacted: { id: 'http://adlnet.gov/expapi/verbs/interacted', display: { 'en-US': 'interacted' } },
    progressed: { id: 'http://adlnet.gov/expapi/verbs/progressed', display: { 'en-US': 'progressed' } },
    evaluated: { id: 'https://w3id.org/xapi/dod-isd/verbs/evaluated', display: { 'en-US': 'evaluated' } },
  };

  let wrapper = null;
  let actor = null;
  let activity = null;
  let readyCallbacks = [];
  let isReady = false;
  let mockMode = false;

  function findWrapper() {
    let w = window;
    while (w) {
      try {
        if (w.ADL && w.ADL.XAPIWrapper) {
          return { wrapper: w.ADL.XAPIWrapper, source: w };
        }
        if (w.XAPIWrapper) {
          return { wrapper: w.XAPIWrapper, source: w };
        }
      } catch (e) {
        // Cross-origin access denied; skip up the chain.
      }
      if (w === w.parent) break;
      w = w.parent;
    }
    return null;
  }

  function getActorAndActivity(source) {
    let a = null;
    let act = null;
    try {
      if (source.ADL && source.ADL.XAPIWrapper && source.ADL.XAPIWrapper.lrs) {
        const lrs = source.ADL.XAPIWrapper.lrs;
        if (lrs.actor) {
          a = typeof lrs.actor === 'string' ? JSON.parse(lrs.actor) : lrs.actor;
        }
        if (lrs.activity_id) {
          act = { id: lrs.activity_id };
        }
      }
    } catch (e) {
      console.warn('xapi: could not extract actor/activity', e);
    }
    return { actor: a, activity: act };
  }

  function init() {
    const found = findWrapper();
    if (found) {
      wrapper = found.wrapper;
      const got = getActorAndActivity(found.source);
      actor = got.actor;
      activity = got.activity;
      mockMode = false;
      console.log('xapi: bridge initialized', { actor, activity });
    } else {
      mockMode = true;
      console.log('xapi: running in mock mode (no Reach/Rise detected)');
    }
    isReady = true;
    while (readyCallbacks.length) {
      try { readyCallbacks.shift()(); } catch (e) { console.error(e); }
    }
  }

  function send(opts) {
    if (!isReady) {
      readyCallbacks.push(() => send(opts));
      return;
    }

    const verb = typeof opts.verb === 'string' ? VERBS[opts.verb] : opts.verb;
    if (!verb || !verb.id) {
      console.error('xapi: unknown verb', opts.verb);
      return;
    }

    const objectId = opts.object && opts.object.id ? opts.object.id : 'unknown';
    const statement = {
      actor: opts.actor || actor || { account: { name: 'unknown-learner', homePage: 'https://ka-testing.com' } },
      verb,
      object: {
        objectType: 'Activity',
        id: /^https?:/.test(objectId) ? objectId : 'https://ka-testing.com/activities/' + objectId,
        definition: {
          name: { 'en-US': (opts.object && opts.object.name) || 'Activity' },
        },
      },
      timestamp: new Date().toISOString(),
    };
    if (opts.result) statement.result = opts.result;
    if (opts.context) statement.context = opts.context;

    // Link the statement to the parent Rise activity when we know it.
    if (activity && !opts.context) {
      statement.context = {
        contextActivities: {
          parent: [{ id: activity.id }],
        },
      };
    }

    if (mockMode) {
      console.log('[xapi mock] statement:', JSON.stringify(statement, null, 2));
      return Promise.resolve({ mocked: true });
    }

    try {
      return new Promise((resolve, reject) => {
        wrapper.sendStatement(statement, (response, statementId) => {
          if (response && (response.status === 200 || response.status === 204)) {
            resolve({ statementId });
          } else {
            console.error('xapi: send failed', response);
            reject(response);
          }
        });
      });
    } catch (e) {
      console.error('xapi: exception during send', e);
      return Promise.reject(e);
    }
  }

  function ready(cb) {
    if (isReady) cb();
    else readyCallbacks.push(cb);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.xapi = {
    send,
    ready,
    VERBS,
    getActor: () => actor,
    isMock: () => mockMode,
  };
})(window);
