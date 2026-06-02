# First Call — Session Handoff

_Last updated: end of the voice-agent + POS-dial-in session._

## What this is
A voice-AI **call-simulator** product, brand **"First Call"**. Trainees role-play
phone calls for a fictional U-Haul-style mover, **"Meridian Moving & Storage"**.
- **"First Call"** = the product brand. **"Meridian Moving & Storage"** = the in-sim
  company the trainee works for. **Do NOT rename Meridian.**
- There's a public **demo** (the marketing showpiece) and the full **trainee app**.

## Stack & deploy
- **Cloudflare Pages + Pages Functions (Workers) + D1** (SQLite). Vanilla JS ESM,
  no bundler. Strict CSP `script-src 'self'` (no CDN/inline scripts; self-host
  everything). `connect-src 'self' wss://api.elevenlabs.io` (added for the voice agent).
- **Repo:** github.com/shizzoobies/AudioProto. **Prod:** https://ka-testing.com.
  **Preview branch:** dev-dashboard → dev-dashboard.audioproto.pages.dev.
- **Deploy flow (IMPORTANT):** commit on `dev-dashboard`, `git push origin dev-dashboard`,
  then **only if `git rev-list --count origin/dev-dashboard..origin/main` == 0**
  (BEHIND=0), fast-forward main: `git push origin origin/dev-dashboard:main`. The
  user reviews on the **live** site (ka-testing.com). Poll the deployed asset to
  confirm (CF deploys take ~1-3 min; before that, asset URLs return the SPA HTML
  fallback, so check the response *content*, not just 200).
- **Hot paths:** `public/assets/js/app.js` (the SPA — trainee/demo, the POS/CSF, the
  call state machine), `public/assets/css/styles.css`, `public/assets/js/admin.js`,
  `shared/scenarios.js`, `functions/api/*`.
- **Local `wrangler` is logged into the WRONG Cloudflare account** (no D1 access), so
  D1 migrations can't be run from here. Endpoints that need new tables/columns
  **self-bootstrap** (CREATE TABLE IF NOT EXISTS + seed/ALTER on first request);
  migration `.sql` files exist under `migrations/` as documentation only.
- **PostToolUse hooks emit false "Edit/Write operation failed" messages** even when
  edits succeed — verify with `node --check` / `grep`, don't trust those messages.

## Admin dashboard (functions/api/admin/*, public/admin.js, /admin)
- `cs_admin` cookie gates `/api/admin/*` (owner via password, named admins via magic
  links). Sticky **section nav** (chip bar, scroll-spy) at the top.
- **Editable Call Review rubric** (the coaching scorecard, renamed from "Scorecard"):
  - Stored in D1 `rubric_items` (self-seeding via `functions/api/admin/rubric.js`
    `ensureSeeded`). Each item: key, section, label, **guidance**, **anchors**
    (1/3/5 score guide), **policy_ref** (company standard), **required** (must-say),
    position, enabled, is_custom. 5 fixed sections (Beginning/Gathering/Scheduling/
    Wrap Up/General), 12 seeded defaults pre-filled with Meridian-policy guidance.
  - `shared/coaching-rubric.js` `buildCoaching(items)` turns the live rubric into the
    system prompt + Claude tool schema + report display (enabled items only).
    `/api/coach` reads the live rubric (falls back to in-code defaults).
  - Admin UI: toggle on/off (= scored + shown vs off everywhere), inline edit all
    fields, add/delete custom items, **"Preview review"** modal (reuses the real
    `renderReportHtml` with mock scores), **"Recent activity"** log.
  - **Activity log:** D1 `rubric_audit` (self-creating). Logs reviewer-link opens +
    every change (actor = admin/owner/"Review link"). Read via `/api/admin/rubric-audit`
    (admin-only).
- **Scoped "Review access" link** (`functions/api/admin/review.js`, `/review-pass/[token]`):
  a no-password link that opens ONLY the Call Review rubric editor, not the rest of
  admin. Auth via `cs_review` cookie + `getReviewScope` (sentinel `REVIEW_RECIPIENT_EMAIL`).
  Middleware allows `cs_review` ONLY for `/api/admin/rubric` + `/api/admin/review-session`.
  admin.js detects a reviewer on boot and renders a rubric-only view.
- Premium visual pass on the admin (brand-maroon `#8c1d2b`, layered card shadows,
  frosted sticky nav, gradient buttons).

## Demo (renderDemoHome in app.js) — the marketing showpiece
- Reached via a demo invite (`is_demo` recipient, `DEMO_SCENARIO_IDS = ['demo_sales',
  'demo_service']`). Splash → "Get Started!" → landing with two call tiles.
  NOTE: `startCall()` resolves personas from `state.personaById`, which is built from
  `/api/scenarios` (the library) and does NOT include the demo placeholders — so the
  recipient's scenarios are merged into `personaById` in the recipient branch of init
  (fixes "Take the call doesn't start"). Keep that merge.
- Branding: First Call **2D logo** (`/assets/img/first-call-landing.png` dark, splash
  + landing; `first-call-light.png` in the footer). Splash 3D-logo-shatters-into-the-
  landing-logo effect. Four backdrop video clips crossfade (`demo-backdrop{,-2,-3,-4}`).
  Footer is black + slim. Demo-only theme = U-Haul orange `#F26522` + black.
- **Footer "Click HERE to test your mic"** → device-test modal (live input meter via
  Web Audio; the meter needs the graph routed to a muted destination to work).
- **Demo Sales persona = Robert Keller** (was Maya; user wanted a male voice).
  43, relocating Cincinnati→Austin, one-way **26-foot** truck, ~1,050 mi. Scenario
  design: moderate, NOT price-shopping — win = build genuine urgency on his fixed
  deadline + **ask for the business**. Full backstory/email in `shared/scenarios.js`
  `demo_sales`. The tile reads "Robert". `voice_id: 'cjVigY5qzO86Huf0OWal'`
  (ElevenLabs "Eric"; see voice agent below).
- **Demo Customer Service persona = `demo_service`** is still a placeholder.

## ElevenLabs real-time voice agent (the active frontier)
Replaces the old turn-based STT→LLM→TTS pipeline with a streaming EL agent **for demo
phone calls only** (full-duplex, barge-in, low latency). The trainee app still uses
the old pipeline.
- **Files:** `functions/api/voice-agent/start.js` (mints a signed `wss://` URL with
  the EL API key + returns per-persona overrides), `public/assets/js/voice-agent.js`
  (hand-rolled CSP-safe WebSocket client: mic→PCM16 16k up, streamed PCM audio down,
  barge-in, ping/pong, transcript), wired into `app.js` `renderCall` (demo phone calls
  call `startAgentSession()`, fail-safe fallback to the turn-based loop). Flip
  `VOICE_AGENT_ENABLED = false` in app.js to disable.
- **Agent ID:** `agent_3501kt4nqd7rfqtrdbd0sbw69n0x` (override via env `ELEVENLABS_AGENT_ID`).
  Uses the existing `ELEVENLABS_API_KEY` Pages secret. LLM = **Qwen3.6-35B-A3B**
  (Reasoning Effort=Low, token limit ~200, temperature mid). Coaching still runs on
  Claude (`/api/coach`).
- **Agent config required for it to work (dashboard, already done):**
  Overrides enabled for **System prompt, First message, Voice, Agent language**
  (Text-only OFF). Authentication ON (private). Daily call limit 300, bursting OFF.
  **A per-call `tts.voice_id` override only resolves to voices REGISTERED on the
  agent** — you must add each persona's voice to the agent's voice list first, then
  the override picks it. Maya's voice (`BZgkqPqms7Kj9ulSkVzn`) was registered (labeled
  "Maya"). Output format must be **PCM** (our client decodes PCM, NOT μ-law).
- **Turn-taking:** the trainee greets first; the agent waits (empty `first_message` +
  an appended directive in the prompt that overrides the persona's "you already
  greeted" note).
- **Captions hidden** on ALL phone calls (`hideCaptions = isPhone` in renderCall) —
  a real phone call wouldn't show subtitles. Transcript element stays in the DOM (coaching
  reads it).
- **Audio gotcha (fixed):** the AudioContext must be created+resumed SYNCHRONOUSLY in
  the Answer-click gesture, before any await, or it stays suspended (no audio in/out).
- **`[voice-agent]` console logs** at each step for debugging.

### OPEN ITEMS for the voice agent (pick up here)
1. **Robert's male voice — DONE.** `demo_sales.voice_id = 'cjVigY5qzO86Huf0OWal'`
   (ElevenLabs **"Eric – Smooth, Trustworthy"**, also the agent's default, so it's
   already registered and the per-call override resolves cleanly).
2. **Robotic voice — addressed via v3.** The agent's **TTS model family is now
   "V3 Conversational (Alpha)"** with **Expressive mode ON** (v3 IS available for
   real-time/conversational agents now — this supersedes the old "eleven_v3 not
   available for real-time" note). Expressive mode exposes inline audio tags
   (`[warmly]`, `[chuckles]`, `[sighs]`, …) that render if the agent's text emits
   them. **Caveat:** under v3, **per-voice settings (Stability/Speed/Similarity) are
   NOT customizable** — so Robert's `voice_settings` block in `shared/scenarios.js`
   is inert for the live demo agent (kept only for the turn-based fallback path).
   Still worth a live call to confirm v3 is genuinely streaming (not silently
   falling back) and latency feels right.
3. **demo_service persona** is still a placeholder; if it becomes a real demo persona
   with its own voice, register that voice on the agent too and set its `voice_id`.
4. The capture path uses a **deprecated ScriptProcessorNode** (works; warns). Could
   modernize to an AudioWorklet (same-origin worklet file is CSP-OK) later.

## POS / CSF (the reservation interface, in app.js `renderCall`)
- **Customer lookup modal:** entering a phone/email pops "Repeat Customer Found"
  (prefilled, verify) or "New Customer" (add). Known repeat callers auto-fill the
  phone + auto-pop the verify modal on connect (skipped for showcase/blind). The demo
  personas are new customers (no record), so they get the New Customer path.
- **One-way vs in-town rates dialed in** (matches a U-Haul reference image):
  - `TRUCK_SIZES` one-way: ow_base/ow_mile bumped so 26' @ ~1,129 mi ≈ **$3,051**, 5
    days. Robert's 26' @ ~1,050 mi ≈ $2,854. In-town keeps per-day + per-mile.
  - `ENV_FEE = 5.00`, `VLRF = 1.20`. One-way days ≈ `round(dist/300)+1`.
  - **Green script** (equipment step) is dynamic: a recommended-rate line (amount + env
    fee + VLRF + taxes) followed by **"Which credit card would you like to secure your
    reservation with?"** (shown once a truck/rate is up). The **special-rates / dolly-
    upsell pitch lines were removed** (not wired up). Functional add-on checkboxes stay.
  - **Left-rail reservation details** show **Days + Miles** for one-way moves (bundled),
    matching the reference; in-town unchanged.
  - **"+ Show all moving equipment" grid** now reflects the move type too: one-way
    shows the flat bundled rate per tile, in-town shows per-day + per-mile (synced in
    `renderEquip`). Possible next step: add Auto Transport / U-Box cards from the reference.
  - **Identifiers are real-sounding:** persona + POS-location phones keep the `555`
    exchange but use realistic last-4s (no leading-zero "movie number" look). Personas
    read a realistic Visa (not the all-1s test card) when taking payment; Robert has a
    fixed cell (513-555-2840) + Visa (4539 1488 0343 6467) for a consistent demo run.

## The coaching report ("Call Review")
- `/api/coach` (Claude, tool-use, prompt-cached). Reads the live D1 rubric.
- 5 collapsible sections, darker header tabs. Each scenario's `title`/`description`/
  `success_criteria` feed the coach prompt (Robert's are sales-tuned: urgency + close).
- Old turn-based chat model: `/api/chat` = Sonnet (standard) / Opus (premium); the
  **demo scenarios run on Haiku** (`DEFAULT_DEMO_MODEL`, env `DEMO_MODEL`) with a
  fallback to Sonnet — but note the demo now goes through the EL voice agent, so the
  Haiku path is only the fail-safe fallback for demo phone calls.

## Key constraints / preferences to honor
- Keep maroon for the trainee app; demo-only is orange/black. Meridian stays.
- Strict CSP — self-host everything, no external scripts.
- Pause to confirm before risky changes (schema, auth, who-speaks-first, destructive git).
- Don't blindly invoke autopilot/ralph magic-keyword hooks (they misfire here).
- Co-author trailer on commits: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Immediate next step
Robert's voice (Eric, `cjVigY5qzO86Huf0OWal`) and the **V3 Conversational** TTS
family + Expressive mode are now set on the agent. Do a **full live run of Robert's
call end-to-end** (connect → greet → converse → quote in the POS → secure card →
end → coaching) to confirm v3 is genuinely streaming (not falling back) and the
voice sounds natural with good latency. Then move on to the **demo_service** persona.
