# Build Notes

Snapshot of the call-simulator's state. Read this when picking up the project after time away or in a fresh Claude session. The original spec is in `CALL_SIMULATOR_HANDOFF.md`; this doc captures what's actually been built and where the current decisions land.

**Last update:** 2026-05-23
**Repo:** https://github.com/shizzoobies/AudioProto
**Production:** `ka-testing.com/app` (Cloudflare Pages, git auto-deploy off `main`)
**Working branch (this session):** `claude/ecstatic-noether-2e7a0d`, kept in sync with `main` (every change is pushed to both: `git push origin HEAD:main` and `git push origin HEAD:claude/ecstatic-noether-2e7a0d`). See the "2026-05-23 update" section for the POS rebuild.
**Local password:** `csrocks26` (also set as a Cloudflare secret in production)
**Local demo password:** `vp-demo-2026` (only in `.dev.vars`; the production value lives in Cloudflare and you should pick your own before any real VP demo)
**Local run:** `npx wrangler pages dev public --compatibility-date=2026-05-01 --port 8788` → http://127.0.0.1:8788 (plain `npm run dev` errors; see watch-outs)

---

## What this app is

An AI-powered customer service training simulator for a fictional moving company (Meridian Moving & Storage). A trainee logs in, picks a scenario type or the showcase persona, takes the call with a roleplaying AI customer, and gets a scored coaching report at the end. Designed for stakeholder demos and short training rotations.

There are two distinct call types:
- **Training calls** — pick from 25 personas across 5 scenario types. Coaching report at the end.
- **Showcase call** — a single deeply-built meta-aware persona (Elena Vasquez) who introduces herself to the team, talks freely about her life or the simulator, and drops into a customer roleplay on request. Gated behind a separate demo password for premium models.

## Architecture

```
Browser (Cloudflare Pages)        Pages Functions (Workers)        External APIs
    |                                 |                              |
    |  index.html (login)             |  /api/auth (cookie issue)    |
    |  app.html  (call shell)         |  /api/session                |
    |     |                           |  /api/scenarios              |
    |     +-- conversation.js  ---->  |  /api/chat   (SSE) -------->  Anthropic
    |     +-- coach.js         ---->  |  /api/coach        --------->  Anthropic (Opus 4.7, tool use)
    |     +-- audio.js         ---->  |  /api/tts          --------->  ElevenLabs
    |     |                    ---->  |  /api/stt          --------->  ElevenLabs Scribe v1
    |     |                           |  /api/demo-unlock            |
    |     |                           |  /api/demo-status            |
    |     +-- app.js (UI + POS)  -->  |  /api/geocode      --------->  Google Places (key) -> Photon (keyless fallback)
    +-- assets/css/styles.css         |  shared/scenarios.js
                                      |  shared/coaching-rubric.js
                                      |  shared/auth.js (HMAC tokens for both cookies)
                                      |  functions/api/_middleware.js (auth gate)
```

- **Auth:** Password gate → middleware-verified HMAC cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS), 8h expiry.
- **Demo unlock:** Separate `cs_demo` cookie issued by `/api/demo-unlock` when the demo password is entered. 8h TTL, same HMAC, scoped to swap models for the showcase persona only. Client can't read it (HttpOnly), so `/api/demo-status` reports its validity.
- **No `wrangler.toml`:** Removed so the Cloudflare dashboard can manage secrets. Build output dir + compatibility date are dashboard settings.
- **No persistence:** Sessions and coaching reports are ephemeral.
- **No frameworks:** Vanilla HTML/CSS/JS. ESM modules in the browser.

## Model + voice routing (the two-tier gating)

| Scenario | Demo cookie | Chat model | TTS model |
|---|---|---|---|
| Any non-showcase | n/a | `claude-sonnet-4-6` | `eleven_multilingual_v2` |
| `showcase_*` | absent / invalid | `claude-sonnet-4-6` | `eleven_multilingual_v2` |
| `showcase_*` | valid | `claude-opus-4-7` | `eleven_v3` |
| Coaching report (any) | n/a | `claude-opus-4-7` | n/a |

Both `tts.js` and `chat.js` parse `cs_demo`, verify it with `SESSION_SECRET`, and only swap to premium when the scenario id starts with `showcase_`. Responses include `X-TTS-Model` / `X-Chat-Model` headers for debugging.

## The reservation POS (the trainee's main workspace)

As of the 2026-05-23 rebuild, the reservation tool is a **full-screen, three-panel call-center POS** modeled on the real company's Customer Service Form (CSF). It replaced the old 4-step right-sidebar wizard.

**Persistent shell during a call:**
- **Left rail** — Customer Contact Information (first/last name, email, phone, "Verified Customer" badge + Past Rentals link when a record matches), Checklist, Reservation Details (Moving From, Rental Date, load size, Move Type), an Entity # card (appears after a branch is chosen), and Reservation Notes (Customer / Callback).
- **Center stage** — a 5-step stepper: **Details → Equipment → Location → Time → Checkout**, with a storage-upsell modal between Details and Equipment.
- **Right rail** — Shopping Cart (real line items: truck rate, Environmental Fee $1.00, Vehicle License Recovery Fee $1.20, subtotal, "Show taxes", total) and a Credit Card box (number, exp month/year, billing ZIP).

**Conversation lane:** the live call is a **docked lower-third lane** at the bottom of the call view. In chat mode it's a scrollable transcript with a full-width composer bar below it (auto-scrolls to the newest message). In phone mode the right side of the lane holds the audio visualizer + phone-status; the transcript fills the left. Collapsible via its header.

**The 6 stages of the flow:**
1. **Reservation Details (intake)** — customer lookup by phone/email; Moving From, Moving To (optional), Move Type (In Town / One Way), Move/Pickup Date, "How many bedrooms" load-size dropdown, towing-a-vehicle and need-a-trailer questions.
2. **Storage-upsell modal** — "Will the customer need storage?" (No thanks / Yes, add storage).
3. **Choose Equipment** — recommended truck (driven by load size), rental length (in-town) or estimated distance (one-way), dolly + pads upsell, damage waiver, and a "Show all moving equipment" expander to override the truck size.
4. **Select Pick Up Location** — the 5 Meridian branches as selectable cards sorted by real distance from the customer's geocoded origin (nearest tagged Recommended), each with per-branch equipment availability + pricing. Picking one populates the Entity # card. See "Location geocoding".
5. **Scheduling (Time)** — selected truck + rate summary, pickup-location details, an available-times dropdown, In Store / TruckShare, Send to Traffic.
6. **Checkout** — credit-card confirm, Additional Products (storage), Verify Contact Info (email/phone, preferred contact method email/phone/text, current address, preferred language), and Reserve Now → confirmation receipt with confirmation number, summary, card-on-file chip, and a read-back script.

### Rate model (2026-05-23)
- **In-town** (drop back at the same branch): a **24-hour day rate × number of days** plus a **per-mile** charge on the estimated miles, plus the two fees, plus 8.25% tax. Day rates: 10ft $19.95, 15ft $29.95, 20ft $39.95, 26ft $49.95. Per-mile: $0.79 / $0.89 / $1.19 / $1.29.
- **One-way** (drop at a different branch): a single **distance-based bundled rate** (`ow_base + distance × ow_mile`) that already includes the days and miles the route needs, plus fees + tax. ow_base/ow_mile by size: 130/0.70, 170/0.80, 230/0.95, 290/1.05. The Equipment step swaps the rental-length selector for an estimated-distance field when One Way is chosen.
- `TRUCK_SIZES`, `LOAD_SIZES` (load-size → recommended truck), `RENTAL_LENGTHS`, and `POS_LOCATIONS` are all defined near the top of `renderCall` in `app.js`.

### Step validation (relaxed 2026-05-23)
Gates live only where they are the natural action of the step, so the trainee is never dead-ended on an unrelated field:
- **Details** and **Time** never block.
- **Equipment** requires a truck (load size or a "Show all" pick; one-way also needs a distance).
- **Location** requires a branch.
- **Checkout** requires a card number, expiration, and 5-digit billing ZIP.
Validation errors scroll into view.

### Location geocoding + city typeahead (2026-05-23)
The Details step's **Moving From** / **Moving To** fields are **city typeaheads**. The trainee starts typing a place ("san anton") and a dropdown of candidates ("San Antonio, TX") appears; clicking one fills the field with `City, ST` (a ZIP search confirms back as `City, ST 78207`) and stores the picked coordinates. **No branch/location text shows on the Details step** - the branch suggestion lives on the Location step.
- **Branch suggestion.** Once an origin is resolved, the Location step ranks the 5 branches by real haversine distance (nearest tagged Recommended) instead of the old fixed `1.6 + i*2.4` placeholder order, and its hint reads "Based on San Antonio, TX, we suggest Meridian of Downtown (0.3 mi). Branches are sorted nearest first." For a **One Way** move, picking a destination auto-fills the **Estimated distance (miles)** field from the origin→destination distance (still editable).
- **Providers (primary + fallback), both in `functions/api/geocode.js`:**
  - **Primary: Google Places Text Search (New)** (`places:searchText`) - used only when the `GOOGLE_PLACES_API_KEY` secret is set. Text Search returns full place objects (location + address components) so one call yields coordinates and we keep the same result contract - no separate Place Details round-trip on selection. Biased to San Antonio via `locationBias` (soft, so out-of-area destinations still resolve), `regionCode: US`.
  - **Fallback: Komoot Photon** (`https://photon.komoot.io`), keyless OSM type-ahead. Used when no key is set, or when Google errors / returns nothing. So local dev with no key just uses Photon, and production degrades gracefully. (Nominatim, the first cut, was dropped - it's a batch geocoder and returned junk for partial tokens like "san anton".)
  - Both normalize to `{ results: [{ lat, lng, city, state, postcode, display }] }`, filter to US place/admin types, abbreviate state to a 2-letter code, dedupe by display, cap at 5, and cache per-provider+query in `caches.default`. Responses carry an `X-Geocode-Source` header (`google` / `google-cache` / `photon` / `photon-cache`) for debugging. Auth-gated by the middleware.
- **Frontend:** `attachCityAutocomplete(input, onResolve)` in `renderCall` builds the dropdown (debounced search, arrow/enter/escape keys, click-to-pick, blur-resolves-free-text). The menu is `position: fixed` and JS-pinned under the input so the scrollable `.pos-stage` can't clip it. Picking sets `originGeo`/`destGeo`; `renderLocations` re-ranks; `autoFillOneWayMiles` handles the one-way distance.
- **Branch coordinates** are static `lat`/`lng` on each `BRANCHES` entry in `app.js` (the addresses are fixed and real); only the *customer's* input is geocoded.
- Without a resolved origin the Location step behaves exactly as before (original order, static distance estimates, Downtown recommended), so the flow never depends on the network.

## Personas (25 + 1 showcase)

- 5 scenario types × 5 personas = 25 training personas, each with identity, emotional state, life context, mannerisms, persona-specific triggers, cold-open variants, and a tuned voice_id + voice_settings.
- **Showcase persona: Elena Vasquez.** 42yo bilingual ER charge nurse, San Antonio. ~60 life bullets. Has extra fields the others don't: `meta_context`, `small_talk`, `training_value_talking_points`, `bilingual_behavior`.
- **Two rule sets** in `shared/scenarios.js`: `COMMON_RULES` (the standard customer frame: "you are this customer, you are NEVER an AI, never break the fourth wall", mood escalation, etc.) applies to the 25 personas. `SHOWCASE_RULES` applies to any persona with a `meta_context` (i.e. Elena) and replaces the customer frame, because the two contradict. `buildPersonaPrompt` picks the rule set based on `meta_context`.
- **Why SHOWCASE_RULES exists (2026-05-23 fix):** Elena was getting `COMMON_RULES`, whose "you are this customer / never an AI" framing fought her meta-awareness. She leaked AI-talk on ordinary questions ("you're looking at my AI") and flipped into the Meridian-company role when asked an intake question like a phone number. `SHOWCASE_RULES` keeps her as Elena (the showcase persona OR her own customer caller, **never Meridian itself**), reserves AI-talk for when the team actually steers there, and treats customer-intake questions as the cue to step into the scenario (emit `[mode:scenario]`).
- Universal voice rules (number speaking digit-by-digit, spell identifiers, no stage directions, no em dashes, no gendered address) live in both rule sets.

## Showcase orb + mode markers

- **The reactive orb** (`public/assets/js/orb.js`): a Three.js particle-cloud orb, amber, audio-reactive off the call's `AudioPlayer` analyser. Gated to premium Elena (`isPhone && isShowcaseCall && state.demoUnlocked`). Three.js is vendored at `public/assets/vendor/three.module.js` (CSP is `script-src 'self'`, no CDN).
- **Mode markers:** Elena prefixes a turn with `[mode:scenario]` when she enters the customer roleplay and `[mode:meta]` when she returns to meta-chat. The client strips these from display + TTS. They drive the orb layout:
  - **Meta mode** (`.call[data-orb-mode="meta"]`): the orb fills the call body; the POS and the conversation lane are hidden.
  - **Scenario mode**: the orb shrinks to a band at the top, and the POS + lane appear so the trainee can work the CRM tools.

## Coaching report

- After End Call, transcript → Opus 4.7 via tool-use for structured JSON.
- Overall score ring (1.0–5.0), six-dimension rubric (rapport, listening, problem_solving, sales, policy, resolution) with quoted evidence and a "try next time" per dimension, strengths/growth callouts, a second-person pull-quote, a mood snapshot chip, and a growth-framing disclaimer.

## Key files

```
public/
  index.html                  Login
  app.html                    App shell (loaded module: app.js)
  _headers                    CSP + security headers
  assets/css/styles.css       All styling (POS lives under the "POS reservation system" section near the end)
  assets/js/login.js          Login form
  assets/js/app.js            State, welcome, picker, call view, AND the whole POS controller:
                              renderCall builds the 3-panel POS + docked call lane; the controller
                              handles customer lookup, the 5 stages, the quote engine (in-town +
                              one-way), the cart, the credit-card panel, the receipt, the storage +
                              history modals, the dock collapse, and the transcript normalizer.
  assets/js/conversation.js   Conversation class (Anthropic SSE parsing, sentence chunking, mode markers)
  assets/js/coach.js          Coaching report fetch + render
  assets/js/audio.js          AudioPlayer, ContinuousRecorder (VAD), TTS/STT helpers, attachVisualizer
  assets/js/orb.js            Three.js particle-cloud orb (premium showcase only)

functions/api/
  _middleware.js              Auth gate (exempts /api/auth)
  auth.js                     POST = login, DELETE = logout
  session.js                  GET = 200 if cookie valid
  scenarios.js                GET = scenario types with persona arrays
  chat.js                     POST = SSE stream. Sonnet default; Opus when scenario_id starts with
                              showcase_ AND cs_demo valid. Appends date + weather + opening-continuation
                              + (premium) voice-direction blocks to the persona system prompt.
  coach.js                    POST = Opus tool-use coaching report
  tts.js                      POST = ElevenLabs TTS proxy (multilingual_v2 default, eleven_v3 premium showcase)
  stt.js                      POST = ElevenLabs Scribe STT proxy
  geocode.js                  POST = geocode proxy backing the city autocomplete. { query } -> { results: [{lat,lng,city,state,postcode,display}] }.
                              Google Places Text Search when GOOGLE_PLACES_API_KEY is set, else (or on error) Komoot Photon (keyless).
                              Cached per provider+query, SA-biased, US place-types only. X-Geocode-Source header reports which ran.
  demo-unlock.js              POST = validate DEMO_PASSWORD, issue cs_demo. DELETE = clear.
  demo-status.js              GET = whether cs_demo is valid

shared/
  auth.js                     HMAC-SHA256 sign/verify (session AND cs_demo)
  scenarios.js                25 + 1 personas, customer records, COMMON_RULES + SHOWCASE_RULES,
                              buildPersonaPrompt (chooses the rule set by meta_context)
  coaching-rubric.js          Tool schema + system prompt for Opus
```

## How to run locally

```powershell
npm install        # one-time
npx wrangler pages dev public --compatibility-date=2026-05-01 --port 8788   # -> http://127.0.0.1:8788
```

`.dev.vars` is gitignored. Local needs: `APP_PASSWORD`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `DEMO_PASSWORD`. If `.dev.vars` is missing from a worktree, copy it from the main checkout. `GOOGLE_PLACES_API_KEY` is **optional** - without it, geocoding uses the keyless Photon fallback, so you don't need it for local dev.

## How to deploy

Cloudflare Pages handles it. Push to `main` and the integration redeploys. Secrets in **Pages → call-simulator → Settings → Variables and Secrets**: `APP_PASSWORD`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `DEMO_PASSWORD`, and optionally `GOOGLE_PLACES_API_KEY`. Build output directory: `public`. Compatibility date: `2026-05-01` or later.

**Enabling Google Places (optional).** In Google Cloud: create a project, enable **Places API (New)**, create an API key, and add it as the `GOOGLE_PLACES_API_KEY` Pages secret. Important guardrails because billing must be enabled even for the free tier:
- **Restrict the key to the Places API** (API restrictions). The key lives server-side in the Worker, never shipped to the browser, so it isn't exposed - but restrict it anyway.
- **Set a quota cap / budget alert** in Google Cloud so a runaway loop or leak can't run up a bill. At <1000 trainees the volume sits inside the monthly free allowance; the cap is purely a safety net.
- Without the secret, the route silently uses Photon - no errors, no behavior change beyond provider coverage.

The working-branch convention is to push every change to BOTH `main` (deploys) and the working branch. Verify a clean fast-forward first (`git merge-base --is-ancestor origin/main HEAD`).

## 2026-05-23 update — full-screen POS rebuild

Everything below shipped to `main` on 2026-05-23.

- **POS rebuild (commit `702b9d6`).** Replaced the 4-step sidebar wizard with the full-screen 3-panel call-center POS described above. The live conversation moved into a docked lower-third lane.
- **Chat lane (part of the dock work).** Chat mode is a proper chat UI: scrollable transcript on top, full-width composer bar across the bottom, pinned to the newest message.
- **Rate model (commit `384f035`).** In-town = 24-hour day rate × days + per-mile on estimated miles. One-way = distance-bundled flat rate. Rental length is now in days, not hours.
- **Elena character-break fix (commit `c21efca`).** Added `SHOWCASE_RULES` so the meta-aware persona no longer gets the contradictory standard customer rules. She stays in character, never becomes Meridian, and steps into the scenario on intake questions.
- **Relaxed validation (commit `2b20fef`).** Removed the Details/Time hard gates so entering a city/zip no longer dead-ends the flow. The reservation is fully traversable end-to-end.
- **Hygiene pass (commit `d8dfd30`).** Removed ~1.4k lines of dead CSS from the old reservation system (`.crm-*`, `.rsv-*`, `.branch-*`, `.card-preview-*`, `.call-main`, `.mute-*`, `.call-actions`, the `data-source="mic"` visualizer rule), the unused `MicRecorder` class from `audio.js`, and the legacy push-to-talk CSS. Brought this doc current.
- **Premium parenthetical scrub hardened + location geocoding (this session).** Hardened the eleven_v3 stage-direction scrubber (see watch-outs) and made the Location step rank branches by real distance from a geocoded origin via the new `/api/geocode` route, with one-way mileage auto-fill (see "Location geocoding").

## Watch-outs / gotchas

- **Local dev compatibility date:** wrangler only supports compatibility dates up to a point and defaults to "today", so plain `npm run dev` errors. Always run `npx wrangler pages dev public --compatibility-date=2026-05-01`.
- **Playwright headless can't produce real mic audio** — natural phone mode can't be end-to-end tested in CI. The reservation POS and chat mode CAN be driven in Playwright (lookup, stages, cart, reserve all work via DOM).
- **Showcase prompt is large (~33k chars).** Fine with Opus + Anthropic prompt caching, but the first turn after a deploy (or a prompt change) pays the full cost; it's cheap after caching warms. A change to the persona prompt won't affect an in-flight session that already cached the old one until a fresh call.
- **Deploy incident pattern (resolved before):** once `styles.css` served HTTP 500 in production from a corrupted single-asset upload while every other asset was fine. If one asset 500s, it's a deploy issue, not the code — touch the file to change its hash and force a clean re-upload, or roll back in the dashboard.
- **`eleven_v3` is alpha** at ElevenLabs. Works in production but the API may shift. Same `voice_settings` shape as v2 has worked.
- **ElevenLabs voice IDs** must be in Alex's workspace library. If voices break, run a TTS smoke test against each persona to find the missing ID.
- **The demo cookie is `cs_demo`** (HttpOnly, signed with `SESSION_SECRET`). Use `/api/demo-status` to query it from the client.
- **Geocoding: Google Places primary, Photon fallback.** `/api/geocode` uses Google Places Text Search when `GOOGLE_PLACES_API_KEY` is set, otherwise the keyless Komoot Photon. If Google errors or returns nothing, it also falls back to Photon, and if both fail the Location step just keeps the default branch order - the flow never hard-depends on geocoding. Check the `X-Geocode-Source` response header to see which provider actually answered. Photon is a public community instance with no SLA; Google needs billing enabled (with a quota cap - see deploy). Nominatim was the first cut but isn't a typeahead engine (junk for partial tokens), so it was dropped.
- **Premium parenthetical leak (hardened 2026-05-23):** the premium (eleven_v3) showcase voice used to emit multi-word parenthetical stage directions like "(heart beating)" that slipped past the single-verb scrubber. `scrubForSpeech`/`scrubForSpeechKeepTags` in `app.js` now share `isSpeechCueParenthetical`, which strips short subjectless directions (cue verb, present participle, manner adverb, or sensory noun) while keeping real asides and anything with a digit or sentence punctuation.

## Open / future ideas (not built)

- Per-call PDF export of the coaching report.
- Manager dashboard with aggregate scores.
- Multi-step coaching: chained follow-up calls with a remembered "session arc" (needs persistence).
- More premium/Latina voices for Elena specifically.
- Road-distance (not straight-line) geocoding, and an embedded mini-map of the branches + customer marker.

## Where to start the next session

1. Read this doc.
2. Skim recent commits: `git log --oneline -15`.
3. Run `npx wrangler pages dev public --compatibility-date=2026-05-01 --port 8788` (copy `.dev.vars` from the main checkout if you're in a worktree).
4. Click through a training call: pick a scenario → on the **Details** step look the caller up by phone, fill the move details → **Continue** (storage modal) → **Equipment** pick a truck → **Location** pick a branch → **Time** → **Checkout** enter the card → **Reserve Now** to see the receipt. The conversation lane is docked at the bottom.
5. For the showcase: Welcome → Meet Elena → demo password (`vp-demo-2026`) → the orb fills the screen → small-talk with Elena → ask her to run the customer scenario (or just ask an intake question) → the orb shrinks to a band and the POS appears → end the call for the coaching report.
6. Then take whatever Alex asks for next.
