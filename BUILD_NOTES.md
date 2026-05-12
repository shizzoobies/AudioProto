# Build Notes

Snapshot of the call-simulator's state. Read this when picking up the project after time away or in a fresh Claude session. The original spec is in `CALL_SIMULATOR_HANDOFF.md`; this doc captures what's actually been built and where the current decisions land.

**Last update:** 2026-05-11
**Repo:** https://github.com/shizzoobies/AudioProto
**Production target:** `call-sim.ka-testing.com` (Cloudflare Pages, git auto-deploy off `main`)
**Local password:** `csrocks26` (also set as a Cloudflare secret in production)
**Local run:** `npm run dev` → http://127.0.0.1:8788

---

## What this app is

An AI-powered customer service training simulator for a fictional moving company (Meridian Moving & Storage). A trainee logs in, picks a scenario type, takes the call with a roleplaying AI customer, and gets a scored coaching report at the end. Designed for stakeholder demos and short training rotations.

## Architecture

```
Browser (Cloudflare Pages)        Pages Functions (Workers)        External APIs
    |                                 |                              |
    |  index.html (login)             |  /api/auth (cookie issue)    |
    |  app.html  (call shell)         |  /api/session                |
    |     |                           |  /api/scenarios              |
    |     +-- conversation.js  ---->  |  /api/chat   (SSE) -------->  Anthropic (Sonnet 4.6)
    |     +-- coach.js         ---->  |  /api/coach        --------->  Anthropic (Opus 4.7, tool use)
    |     +-- audio.js         ---->  |  /api/tts          --------->  ElevenLabs Turbo v2.5
    |     |                    ---->  |  /api/stt          --------->  ElevenLabs Scribe v1
    |     +-- app.js (UI)             |
    +-- assets/css/styles.css         |  shared/scenarios.js
                                      |  shared/coaching-rubric.js
                                      |  shared/auth.js (HMAC token)
                                      |  functions/api/_middleware.js (auth gate)
```

- **Auth:** Password gate → middleware-verified HMAC cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS), 8h expiry.
- **No `wrangler.toml`:** Removed so the Cloudflare dashboard can manage secrets. Build output dir + compatibility date are dashboard settings now.
- **No persistence:** Sessions and coaching reports are ephemeral.
- **No frameworks:** Vanilla HTML/CSS/JS. ESM modules in the browser.

## What's actually built

Beyond the six phases in the original handoff, the following has been added and is shipping:

### Welcome / picker / scenario flow
- **Welcome screen** with hero, three feature cards, and two big mode-choice cards (Chat / Phone call). Mode is locked for the call; no mid-call toggle.
- **Picker** shows 5 scenario type cards (Lost Reservation, Price Shopper, First-Time Mover, Damage Dispute, Upsell) plus a 6th **Surprise me** card that picks a random persona from across the 25 and runs in blind mode (identity hidden until the coaching report).
- **"Change format"** button on the picker returns to welcome without signing out.

### Personas (the depth pass)
- 5 scenario types × 5 personas = **25 personas total**, each with:
  - identity, emotional state, specific situation
  - full life context (family, work, recent stress, why this move)
  - speech mannerisms (mono-rhythm tics — "actual money", "I'll be honest with you", "literally", etc.)
  - persona-specific trigger reactions
  - 2–3 cold-open variants (client picks one at random per call)
  - voice_id + voice_settings tuned per persona, all verified live against Alex's ElevenLabs workspace
- **Universal trigger rules** in COMMON_RULES: name usage, empty empathy, concrete commitments, silence markers, monologue/talking-over, ignored concerns.
- **Naturalistic speaking** rules force the AI to say phone numbers digit-by-digit (3-3-4 with comma pauses), spell account numbers and case IDs character-by-character, spell emails letter-by-letter with "at"/"dot", spell last names when asked. Dollar amounts and dates stay natural.

### Conversation pipeline
- **Streaming chat** from Sonnet 4.6 via SSE. Server reshapes Anthropic's events to a `{type:'text_delta',text}` shape and terminates with `[DONE]`.
- **Sentence chunking** on the client: regex `[.?!]+\s+` flushes complete sentences to TTS as they arrive, so customer audio starts within ~1.5–2s of the trainee finishing.
- **Silence trigger:** After the customer finishes speaking, a 30s timer arms. Trainee input clears it. If it fires, an inline `· silence on the line ·` marker is appended and a synthetic `[silence: 30s]` user message is sent. Personas react in character per their trigger rules; the system prompt forbids reading the bracketed text aloud.

### Voice
- **Phone call mode** is natural, no PTT. `ContinuousRecorder` polls real-time RMS amplitude through an AnalyserNode. Voice activity detection ends recording after 1.4s of silence following a 450ms+ speech segment. Hard cap of 25s per turn. Auto-transcribes and submits.
- **Phone status panel** replaces the composer in phone mode. State-coded dot + label + hint: connecting / customer_talking / your_turn / listening / processing / thinking / error.
- **Visualizer** above the transcript in phone mode. Amber bars during customer audio, blue while trainee speaks. Pulse glow on the wrapper border matches state.
- **Chat mode** keeps the textarea + Send composer; no PTT, no mic prompt.

### Coaching report
- After End Call, transcript is sent to Opus 4.7 via tool-use to force structured JSON output.
- Report shows: overall score ring (1.0–5.0), six-dimension rubric breakdown (rapport, listening, problem_solving, sales, policy, resolution) with quoted evidence and a one-sentence "try next time" per dimension, strengths/growth callouts, a pull-quote "one thing to try next time" in second person.
- **Mood snapshot:** A color-coded chip in the report header reads "*<Name>* left the call *<mood>*" with a one-line note. Moods: satisfied / neutral / frustrated / unresolved / hostile.
- Buttons: Back to scenarios, Run this scenario again (rebooks the same scenario in non-blind mode).

### CSR system (CRM panel)
Right-side sidebar in every call view (both chat and phone), with two tabs:

1. **Lookup tab.** Phone / email / last-name fields. Partial match (4+ digits, 3+ chars on email, 2+ chars on name). Returns:
   - Record found → identity grid, active reservations (amber), open claims (red), past rentals (compact list), agent notes (amber-bordered callout).
   - No match → "No match" card.
   - Prospect (record.found=false) → "New prospect" with notes.
2. **New Reservation tab.** Guided form with five sections, each with a mono-font training hint suggesting what to ask:
   - Customer (prefilled from persona record if returning)
   - Move details (date, time, location, miles)
   - Inventory (bedrooms select, furniture + appliance checkboxes, box count)
   - Truck recommendation (live calculation; border tint shifts green/amber/red with size)
   - Add-ons (damage waiver, equipment)
   - Save creates a fake `MR-NNNNNN` confirmation and shows a "read back to customer" summary.

**Truck size formula:** `score = bedrooms×2 + furniture_count + appliances×2 + boxes/10`. Thresholds at 4 / 9 / 16 → 10ft / 15ft / 20ft / 26ft. Trainee can override.

### Customer record data (CRM source of truth)
- **Lost Reservation** personas: found in system, past rentals shown, no active reservation (the scenario's whole point).
- **Damage Dispute** personas: found, recent returned rental, open Claims case with case_id/amount.
- **Upsell** personas: found, active 10ft booking visible (so the trainee can see the size mismatch).
- **Price Shopper** personas: mostly prospects (no record). Greta is the one returning customer (2015 rental with a damage claim resolved in her favor).
- **First-Time Mover** personas: all prospects.
- Prospects still have caller_phone/email/name fields so the AI speaks consistent identifiers; CRM lookup just returns "No record."

### Polish
- CSP headers (`default-src 'self'`, locked down).
- View fade-in animations.
- Loading skeleton on the picker.
- Tab title tracks state ("Call: Marcus" / "Live call" / "Analyzing call" / "Report: Karen").
- Welcome screen has gradient title + hero copy.
- `Cache-Control: no-cache, no-store, must-revalidate` so redeploys land instantly.

## Key files

```
public/
  index.html                  Login
  app.html                    App shell (loaded module: app.js)
  _headers                    CSP + security headers
  assets/css/styles.css       All styling
  assets/js/login.js          Login form
  assets/js/app.js            Big one — state, picker, call view, CRM panel, reservation
  assets/js/conversation.js   Conversation class (Anthropic SSE parsing, sentence chunking)
  assets/js/coach.js          Coaching report fetch + render
  assets/js/audio.js          AudioPlayer, MicRecorder (legacy PTT), ContinuousRecorder (VAD), TTS/STT helpers, attachVisualizer

functions/api/
  _middleware.js              Auth gate (exempts /api/auth)
  auth.js                     POST = login, DELETE = logout
  session.js                  GET = 200 if cookie valid
  scenarios.js                GET = scenario types with persona arrays
  chat.js                     POST = SSE stream from Anthropic
  coach.js                    POST = Opus tool-use coaching report
  tts.js                      POST = ElevenLabs TTS proxy
  stt.js                      POST = ElevenLabs Scribe STT proxy

shared/
  auth.js                     HMAC-SHA256 cookie token
  scenarios.js                25 personas, customer records, prompt builder
  coaching-rubric.js          Tool schema, system prompt for Opus
```

## How to run locally

```powershell
npm install        # one-time
npm run dev        # → http://127.0.0.1:8788
```

`.dev.vars` is gitignored. The current local password is `csrocks26`. API keys live there too.

## How to deploy

Cloudflare Pages handles it. Push to `main` and the integration redeploys. Secrets are managed in **Pages → call-simulator → Settings → Variables and Secrets**:

- `APP_PASSWORD`
- `SESSION_SECRET`
- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`

Build configuration (also in the dashboard):
- Build output directory: `public`
- Compatibility date: `2026-05-01` or later

## Recent decisions worth remembering

- **No `wrangler.toml`** in the repo, because Cloudflare locks the dashboard out of secret management when one is present. All Pages config lives in the dashboard now.
- **Two locked call formats** (Chat, Phone call), no mid-call toggles — a real shift doesn't switch formats mid-call.
- **Phone mode is natural** (continuous listening + VAD), not push-to-talk. PTT logic was removed.
- **CSR panel is the visual differentiator.** Two-column call layout: transcript + composer on the left, lookup + reservation builder on the right.
- **Customer records and persona prompts share identifiers.** The persona knows its own phone/email/account so the spoken value matches what the CRM lookup expects.
- **Naturalistic digit speaking** is rule-enforced in the system prompt. Customers say "two one six, five five seven, oh oh eight three" not "two hundred and sixteen, five thousand five hundred and seventy..."

## Open / future ideas (not built)

- Multi-step coaching: chain follow-up calls with a remembered "session arc" (would require persistence).
- Per-call PDF export of the coaching report.
- A manager dashboard with aggregate scores.
- Live transcription overlay during phone mode so the trainee can read along as the AI speaks (useful for accessibility / loud environments).
- More aggressive interrupt handling — letting the agent talk over the customer mid-sentence with a "barge-in" pattern.
- Per-persona conversation pace tuning — older personas pause longer, faster types interrupt more.
- A "supervisor" overlay that pauses the call and offers in-the-moment coaching.

## Watch-outs / gotchas

- **Playwright headless can't produce real mic audio** — natural phone mode can't be end-to-end tested in CI. The VAD state machine is verified by UI side-effects only. Real browser test is required.
- **The 25th persona prompt is long.** Total system prompt size per call is ~1500–2000 tokens. Still cheap on Sonnet but worth noting if anyone tunes max_tokens.
- **Some legacy CSS classes** (`.mode-toggle`, `.ptt-button`) are still in the stylesheet but no longer used by the markup. Safe to drop on the next pass.
- **`MicRecorder`** is still exported from `audio.js` even though the app no longer uses it (`ContinuousRecorder` replaced it). Kept for any future PTT mode return.
- **ElevenLabs voice IDs** must be in Alex's workspace library. The previous default Bella ID (`EXAVITQu4vr4xnSDxMaC`) returned 404 and had to be swapped. If voices break in the future, run a TTS smoke test against each persona to identify the missing ID, then re-pick from `GET /v1/voices`.

## Where to start the next session

1. Read this doc.
2. Read `CALL_SIMULATOR_HANDOFF.md` for the original spec (mostly historical at this point).
3. Skim the most recent commits with `git log --oneline -20`.
4. Run `npm run dev` and click through Welcome → Chat → first_time_mover → look up Jordan → New Reservation tab → fill out + submit.
5. Then take whatever Alex asks for next.
