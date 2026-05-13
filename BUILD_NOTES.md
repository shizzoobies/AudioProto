# Build Notes

Snapshot of the call-simulator's state. Read this when picking up the project after time away or in a fresh Claude session. The original spec is in `CALL_SIMULATOR_HANDOFF.md`; this doc captures what's actually been built and where the current decisions land.

**Last update:** 2026-05-13
**Repo:** https://github.com/shizzoobies/AudioProto
**Production target:** `call-sim.ka-testing.com` (Cloudflare Pages, git auto-deploy off `main`)
**Local password:** `csrocks26` (also set as a Cloudflare secret in production)
**Local demo password:** `vp-demo-2026` (only in `.dev.vars`; the production value lives in Cloudflare and you should pick your own before any real VP demo)
**Local run:** `npm run dev` → http://127.0.0.1:8788

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
    |     +-- app.js (UI)             |
    +-- assets/css/styles.css         |  shared/scenarios.js
                                      |  shared/coaching-rubric.js
                                      |  shared/auth.js (HMAC tokens for both cookies)
                                      |  functions/api/_middleware.js (auth gate)
```

- **Auth:** Password gate → middleware-verified HMAC cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS), 8h expiry.
- **Demo unlock:** Separate `cs_demo` cookie issued by `/api/demo-unlock` when the demo password is entered. 8h TTL, same HMAC, scoped to swap models for the showcase persona only.
- **No `wrangler.toml`:** Removed so the Cloudflare dashboard can manage secrets. Build output dir + compatibility date are dashboard settings now.
- **No persistence:** Sessions and coaching reports are ephemeral.
- **No frameworks:** Vanilla HTML/CSS/JS. ESM modules in the browser.

## Model + voice routing (the two-tier gating)

| Scenario | Demo cookie | Chat model | TTS model |
|---|---|---|---|
| Any non-showcase | n/a | `claude-sonnet-4-6` | `eleven_multilingual_v2` |
| `showcase_*` | absent / invalid | `claude-sonnet-4-6` | `eleven_multilingual_v2` |
| `showcase_*` | valid | `claude-opus-4-7` | `eleven_v3` |
| Coaching report (any) | n/a | `claude-opus-4-7` | n/a |

Both `tts.js` and `chat.js` parse `cs_demo`, verify it with `SESSION_SECRET`, and only swap to premium when the scenario id starts with `showcase_`. Responses include `X-TTS-Model` and `X-Chat-Model` headers for debugging.

## What's actually built

Beyond the six phases in the original handoff:

### Welcome screen
- Hero, three feature cards, and two big mode-choice cards (Chat / Phone call). Mode is locked for the call; no mid-call toggle.
- **"or" divider** and a centered **"Meet Elena"** showcase card below — clicking it locks to phone mode and starts the showcase persona directly.
- Click → password modal: enter the demo password to unlock premium voice + Opus chat, OR skip to use the standard models with the same persona.

### Picker
- 5 scenario type cards (Lost Reservation, Price Shopper, First-Time Mover, Damage Dispute, Upsell) plus a 6th **Surprise me** card (blind random persona). The showcase persona is intentionally NOT on the picker — it lives only on the welcome screen and is excluded from the random pool.

### Personas (25 + 1 showcase)
- 5 scenario types × 5 personas = 25 training personas, each with: identity, emotional state, life context, mannerisms, persona-specific triggers, 2-3 cold-open variants, voice_id + voice_settings tuned per persona.
- **Showcase persona: Elena Vasquez.** 42yo bilingual ER charge nurse, San Antonio. Roughly 60 life bullets covering family, work history, daily texture, hobbies, faith, regrets. Has additional persona fields the others don't:
  - `meta_context` — she knows she's the showcase persona, can talk about Claude / ElevenLabs powering her, declines to roleplay other personas, holds both layers without breaking character.
  - `small_talk` — explicit warmth, reciprocates "how's your day", specific not stock answers.
  - `training_value_talking_points` — structured pitch material (trainee benefits, manager benefits, what it isn't) for when someone asks "how does this help our call center team." Delivers in her own voice, not as a list.
  - `bilingual_behavior` — code-switches to mirror the agent's language balance. English-only → sprinkled Spanish. Full-Spanish from agent → full Spanish back including identifiers spelled in Spanish digits.
- Universal trigger rules in `COMMON_RULES` (name usage, empty empathy, concrete commitments, silence markers, monologue, ignored concerns).
- **No stage directions.** Explicit rule in `COMMON_RULES` forbidding asterisk/bracket/parenthetical stage cues. Client also scrubs `*laughs*`, `[chuckles]`, and short `(sighs)`-style parens before TTS as belt-and-suspenders.
- **Naturalistic speaking** rules force phone numbers digit-by-digit (3-3-4 with comma pauses), spell accounts/case IDs character-by-character, spell emails letter-by-letter with "at"/"dot", spell last names when asked.

### Conversation pipeline
- **Streaming chat** via SSE. Server reshapes Anthropic's events to `{type:'text_delta',text}` shape, terminates with `[DONE]`.
- **Sentence chunking** on the client (regex `[.?!]+\s+`) flushes complete sentences to TTS as they arrive.
- **Silence trigger:** 30s timer after customer's turn. If it fires, an inline `· silence on the line ·` marker is appended and a synthetic `[silence: 30s]` user message is sent. Personas react in character.
- **Transcript normalizer.** After streaming ends, the client rewrites spelled-out identifiers back to natural form: `five one two, three three four, seven eight two one` → `512-334-7821`; `M A R C U S, dot, chen, at gmail, dot com` → `marcus.chen@gmail.com`; `M R, dash, two seven nine four, dash, seven eight two one` → `MR-2794-7821`. Email/account regexes require uppercase leading letters so prose like `email's` doesn't trigger.

### Voice
- **Phone call mode** is natural, no PTT. `ContinuousRecorder` polls real-time RMS amplitude. VAD ends recording after 1.4s of silence following a 450ms+ speech segment. Hard cap of 25s per turn.
- **Phone status panel** with state-coded dot + label + hint: connecting / customer_talking / your_turn / listening / processing / thinking / error.
- **Visualizer** above the transcript in phone mode. Amber bars during customer audio, blue during trainee speech.
- **Chat mode** keeps the textarea + Send composer.

### Reservation builder (right sidebar, in every call)
Four-step wizard with a colored stepper, back/continue nav, and running cost estimate:
1. **Customer** — name, phone, email (prefilled from persona's `customer_record` when found).
2. **Trip** — pickup date/time/location, return date/time/location, "same return location" toggle, estimated miles.
3. **Equipment** — inventory (bedrooms select, furniture/appliance checkboxes, boxes), live truck recommendation (color-coded by size), override dropdown, damage waiver, equipment add-ons (pads, dolly).
4. **Payment** — training-mode banner, live cost breakdown (truck × days + miles + waiver + add-ons + 9% tax), fake credit-card form with brand detection (Visa/MC/Amex/Discover) and animated card preview that updates as the trainee types.

Confirm → wizard hides, polished receipt card shows: confirmation number (`MR-XXXXXX`), customer/trip/equipment summary, line-item totals, card-on-file chip with brand+last4+exp, ready-made read-back script. "Start another reservation" resets to step 1.

**Truck size formula:** `score = bedrooms×2 + furniture_count + appliances×2 + boxes/10`. Thresholds 4 / 9 / 16 → 10ft / 15ft / 20ft / 26ft. Trainee can override.

### CRM lookup (right sidebar, lookup tab)
- Phone / email / last-name fields. Partial match (4+ digits, 3+ chars on email, 2+ chars on name).
- Returns: record found (identity grid, active reservations in amber, open claims in red, past rentals, agent notes), "No match", or "New prospect" with notes.
- Both empty-state cards (no-match and new-prospect) have a **"Start a new reservation"** CTA button that jumps to the Reservation tab.

### Coaching report
- After End Call, transcript is sent to Opus 4.7 via tool-use to force structured JSON output.
- Report: overall score ring (1.0–5.0), six-dimension rubric (rapport, listening, problem_solving, sales, policy, resolution) with quoted evidence and one-sentence "try next time" per dimension, strengths/growth callouts, a pull-quote in second person.
- **Mood snapshot:** color-coded chip in the header reads "*<Name>* left the call *<mood>*". Moods: satisfied / neutral / frustrated / unresolved / hostile.

### Customer record data (per persona)
- **Lost Reservation** personas: found in system, past rentals, no active reservation (the scenario's point).
- **Damage Dispute** personas: found, recent returned rental, open Claims case.
- **Upsell** personas: found, active 10ft booking visible (so the trainee can see the size mismatch).
- **Price Shopper** personas: mostly prospects. Greta is the one returning customer.
- **First-Time Mover** personas: all prospects.
- **Showcase persona (Elena):** found, member since 2012, three past rentals including a 2022 one-way back from Houston (sets up the piano-pickup conversation if she goes into scenario mode).

### Polish
- CSP headers locked down.
- View fade-in animations.
- Loading skeleton on the picker.
- Tab title tracks state.
- `Cache-Control: no-store` so redeploys land instantly.

## Key files

```
public/
  index.html                  Login
  app.html                    App shell (loaded module: app.js)
  _headers                    CSP + security headers
  assets/css/styles.css       All styling
  assets/js/login.js          Login form
  assets/js/app.js            State, welcome, picker, call view, CRM, reservation wizard, demo modal, transcript normalizer
  assets/js/conversation.js   Conversation class (Anthropic SSE parsing, sentence chunking)
  assets/js/coach.js          Coaching report fetch + render
  assets/js/audio.js          AudioPlayer, ContinuousRecorder (VAD), TTS/STT helpers, attachVisualizer

functions/api/
  _middleware.js              Auth gate (exempts /api/auth)
  auth.js                     POST = login, DELETE = logout
  session.js                  GET = 200 if cookie valid
  scenarios.js                GET = scenario types with persona arrays
  chat.js                     POST = SSE stream. Sonnet default. Opus when scenario_id starts with showcase_ AND cs_demo cookie valid.
  coach.js                    POST = Opus tool-use coaching report
  tts.js                      POST = ElevenLabs TTS proxy. multilingual_v2 default. eleven_v3 when scenario_id starts with showcase_ AND cs_demo cookie valid.
  stt.js                      POST = ElevenLabs Scribe STT proxy
  demo-unlock.js              POST = validate DEMO_PASSWORD, issue cs_demo cookie. DELETE = clear cookie.
  demo-status.js              GET = whether cs_demo cookie is currently valid

shared/
  auth.js                     HMAC-SHA256 sign/verify helpers (used for session AND cs_demo)
  scenarios.js                25 + 1 personas, customer records, prompt builder. buildPersonaPrompt renders optional meta_context / small_talk / training_value_talking_points / bilingual_behavior blocks when present.
  coaching-rubric.js          Tool schema, system prompt for Opus
```

## How to run locally

```powershell
npm install        # one-time
npm run dev        # → http://127.0.0.1:8788
```

`.dev.vars` is gitignored. Local needs: `APP_PASSWORD`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `DEMO_PASSWORD`. If `.dev.vars` is missing from a worktree, copy it from the main checkout.

## How to deploy

Cloudflare Pages handles it. Push to `main` and the integration redeploys. Secrets in **Pages → call-simulator → Settings → Variables and Secrets**:

- `APP_PASSWORD`
- `SESSION_SECRET`
- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`
- `DEMO_PASSWORD` ← required for the showcase premium-unlock flow to work. Without it the unlock endpoint returns 500 and the showcase stays on standard models (the rest of the app is unaffected).

Build configuration (also in the dashboard):
- Build output directory: `public`
- Compatibility date: `2026-05-01` or later

## Recent decisions worth remembering

- **No `wrangler.toml`** in the repo. All Pages config lives in the dashboard.
- **Two locked call formats** (Chat, Phone call), no mid-call toggles.
- **Phone mode is natural** (continuous listening + VAD), not push-to-talk.
- **CSR panel is the visual differentiator.** Two-column call layout: transcript + composer on the left, lookup + reservation builder on the right.
- **Customer records and persona prompts share identifiers.** The persona knows its own phone/email/account so the spoken value matches what the CRM lookup expects.
- **Naturalistic digit speaking** is prompt-enforced. Transcript bubble shows the natural form (`512-334-7821`); TTS gets the spelled form (`five one two...`) so it pronounces correctly. Two pipelines, one source.
- **Stage directions forbidden** by COMMON_RULES, scrubbed client-side as a safety net before TTS.
- **Showcase persona is meta-aware.** Elena is herself (full life) AND knows she's a designed AI persona. She introduces herself to the team, holds small talk, has training-pitch material ready, and only drops into her rental-customer scenario when asked. The showcase entry lives on the welcome screen, NOT the regular picker, to keep training trainees from stumbling onto her.
- **Premium gating is two-tier.** Sonnet 4.6 + multilingual_v2 = standard preview (anyone with the app password). Opus 4.7 + eleven_v3 = premium showcase (requires the demo password ON TOP of the app password). Premium only fires for `showcase_*` scenario ids — every other persona stays standard regardless of demo cookie state.

## Open / future ideas (not built)

- Multi-step coaching: chain follow-up calls with a remembered "session arc" (would require persistence).
- Per-call PDF export of the coaching report.
- Manager dashboard with aggregate scores.
- Live transcription overlay during phone mode so the trainee can read along as the AI speaks (useful for accessibility / loud environments).
- More aggressive interrupt handling — letting the agent talk over the customer mid-sentence with a "barge-in" pattern.
- Per-persona conversation pace tuning — older personas pause longer, faster types interrupt more.
- A "supervisor" overlay that pauses the call and offers in-the-moment coaching.
- More premium voices in the workspace. Current voice_ids are mostly ElevenLabs premade voices; a curation pass with professional/Latina voices would lift quality further for Elena specifically.

## Watch-outs / gotchas

- **Playwright headless can't produce real mic audio** — natural phone mode can't be end-to-end tested in CI. The VAD state machine is verified by UI side-effects only.
- **Showcase prompt is ~30k chars (~7.5k tokens).** Fine with Opus and Anthropic prompt caching, but the first-turn cost is higher than the other personas. After the first turn, caching makes it cheap.
- **Some legacy CSS classes** (`.mode-toggle`, `.ptt-button`, `.crm-truck-*`) are still in the stylesheet but no longer used by the markup.
- **`MicRecorder`** is still exported from `audio.js` even though the app no longer uses it (`ContinuousRecorder` replaced it). Kept for any future PTT mode return.
- **ElevenLabs voice IDs** must be in Alex's workspace library. If voices break in the future, run a TTS smoke test against each persona to identify the missing ID.
- **`eleven_v3` is currently alpha** at ElevenLabs. It works in production but the API surface may shift. Same `voice_settings` shape as v2 has worked so far.
- **Latent bug fixed:** `buildPersonaPrompt` was reading `persona.name` which doesn't exist on any persona. Every prompt used to start "You are undefined, ..." — Sonnet recovered from later context but it was sloppy. Now reads `customer_name`.
- **The demo cookie is named `cs_demo`** (HttpOnly, signed with `SESSION_SECRET`). Client can't read it, so we have `/api/demo-status` to query it.

## Where to start the next session

1. Read this doc.
2. Skim recent commits with `git log --oneline -20`.
3. Run `npm run dev` (copy `.dev.vars` from the main checkout if you're in a worktree).
4. Click through: Welcome → Meet Elena → Skip the password → small-talk with Elena → ask her to roleplay the customer scenario → exit back to meta.
5. Then take whatever Alex asks for next.
