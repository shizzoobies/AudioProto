# Handoff — Coaching app (Development by Design)

_Updated 2026-06. This file has TWO handoffs: the CURRENT coaching/Dev-by-Design work
(below), and an EARLIER "First Call demo / voice agent" handoff further down (still
valid for that area). Read the current one first._

## 1. What this project is
A manager/agent soft-skills coaching tool on **Cloudflare Pages + Pages Functions + D1**
(`env.DB`). Vanilla JS ESM, **no bundler**. Strict CSP (`script-src 'self'`,
`img-src 'self' data:`, inline styles allowed). Admins author "Scenarios" (coachable AI
employees), group participants into "Cohorts", and participants take real-time voice
coaching calls (ElevenLabs) with persistent memory.

## 2. Where the code lives + how to deploy
- **Repo / worktree:** `...\.claude\worktrees\ecstatic-noether-2e7a0d` (this is the git repo;
  the shell's default dir `...\Bobbie's Coaching thing` is the project root, NOT the repo).
- **Branch:** `dev-dashboard`. Deploy = commit → `git push origin dev-dashboard` →
  if `git rev-list --count origin/dev-dashboard..origin/main` is `0`, then
  `git push origin dev-dashboard:main`. Cloudflare auto-builds `main`.
- **Cache-bust:** bump `?v=` on `styles.css` + `app.js` in `public/app.html` (currently
  `20260610-34`); `app.js` also has a `BUILD_ID` const. **Edit `app.html` with the Edit tool
  or `sed`, NOT PowerShell `Set-Content` (it injects a UTF-8 BOM).**
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- A **parallel work stream** sometimes lands commits here. `git fetch` + check before committing.

## 3. CURRENT ACTIVE THREAD — Scenario card redesign ("Bobbie's Dashboard")
Per-scenario participant/preview screen rebuilt to a warm botanical design.
- **Function:** `renderCoachingProfile()` authored branch in `public/assets/js/app.js`
  (search `class="scn-page"`). CSS in `public/assets/css/styles.css` under `.scn-*` (~line 3964).
- **Routing:** the scenario **Test preview** renders this card (`renderCoachingTest` checks
  `state.recipient.coaching_preview`). The cohort 5-week course (`renderCoachingDashboard`) is unchanged.
- **Background:** one composed image `public/assets/img/coaching/background.png` on `.scn-bg`
  (`position: fixed; inset:0; background: url(...) center -13vh / cover`). `-13vh` lifts the tree
  top to the frame top.
- **Palette** (vars on `.scn-page`): green `#6a7f46`, orange `#e97132`, amber `#f5e1af`,
  card `#fcf9f3`, page `#f4eddf`, ink `#241d1c`, muted `#7e7764`, tan `#e2cca8`.
- **Card:** centered, `max-width:400px`. **Quote:** `.scn-quote` fixed `left:15vw; bottom:9vh`,
  black text, orange underline, inline-SVG bubble icon coloured from `--scn-orange`.
- **Buttons** (per enabled mode): Assessment green+`leaf-1.png`, Coaching orange+`leaf-2.png`,
  Follow-up amber+`icon-calendar.png` (calendar+arrow forced black via `filter:brightness(0)`).
- **Info rows** (demeanor, incident): collapse to 1 line + ellipsis + orange chevron (rotates on
  hover) + faint hover highlight; expand on hover. Mobile (<860px) shows full text, hides decor/quote.

### Card — open/next (cosmetic, non-blocking)
- Quote-vs-photo overlap can drift on extreme aspect changes (quote `vw/vh` vs photo `cover`).
  Bulletproof = bake quote into the image, or trim the cream off the top of `background.png` and
  use plain `center top` (also fixes the `-13vh` height-dependence).
- Unused decoration PNGs (switched to the single bg image): `photo.png`, `roots.png`,
  `shape-1/2/3.png`, `leaf-corner.png`, `icon-quote.png` — safe to delete later.

## 4. Broader Dev-by-Design work — DONE & deployed earlier this session
- **5-week + Final course** (`shared/coaching-dashboard.js`, `MAX_STAGE=6`, 2 calls). Reseed gated
  by `SEED_VERSION` (=2) in `shared/dashboard-store.js`.
- **Syllabus** (Pre-Week 1 panel + admin editor); **Welcome email** (`sendCoachingWelcomeEmail` +
  cohort `send_welcome` op; needs `RESEND_API_KEY`).
- **Scenario authoring:** role-gated receptiveness (`receptive_to`/`gate_strictness`), disruptive
  trait (`disruptiveness`), full coaching-editor share link (scope `level` full|scenarios).
- **Preview/Test:** `coaching-agent-preview`, `preview-reset`, `as_role` honored only for `__cvprev__`.
- **Bug fixed:** `dashboard-fields.js` derives `SECTION_KEYS` from `DASHBOARD_SECTIONS` (was stale).

## 5. Conventions / gotchas
- **No em dashes** in user-facing or AI-prompt copy (locked rule).
- "Edit operation failed" hooks are **false alarms** — trust success + `node --check`.
- **OMC autopilot stop-loop bug:** MCP `state_*` tools resolve `.omc` to the PARENT dir, but the
  stop hook reads the session cwd `...\Bobbie's Coaching thing\.omc`. If a stuck "[AUTOPILOT...]"
  loop recurs, set `"active": false` in `...\Bobbie's Coaching thing\.omc\state\sessions\<id>\autopilot-state.json`.
- No test suite; verify code-level + `node --check`; gated flows need the user to click through.

---

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
   "V3 Conversational (Alpha)"** with **Expressive mode ON**. Expressive mode exposes
   inline audio tags (`[warmly]`, `[chuckles]`, `[sighs]`, …). **Caveat:** under v3,
   **per-voice settings (Stability/Speed/Similarity) are NOT customizable** — so
   Robert's `voice_settings` block in `shared/scenarios.js` is inert for the live demo
   agent (kept only for the turn-based fallback path).
3. **demo_service persona** is still a placeholder; if it becomes a real persona with
   its own voice, register that voice on the agent too and set its `voice_id`.
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
  - **Green script** (equipment step) is dynamic: a recommended-rate line followed by
    **"Which credit card would you like to secure your reservation with?"** The special-
    rates / dolly-upsell pitch lines were removed (not wired up). Add-on checkboxes stay.
  - **Left-rail reservation details** show **Days + Miles** for one-way moves.
  - **"+ Show all moving equipment" grid** reflects the move type (one-way flat bundled
    rate per tile; in-town per-day + per-mile).
  - **Identifiers are real-sounding** (`555` exchange, realistic last-4s). Robert has a
    fixed cell (513-555-2840) + Visa (4539 1488 0343 6467) for a consistent demo run.

## The coaching report ("Call Review")
- `/api/coach` (Claude, tool-use, prompt-cached). Reads the live D1 rubric.
- 5 collapsible sections, darker header tabs. Each scenario's `title`/`description`/
  `success_criteria` feed the coach prompt.
- Old turn-based chat model: `/api/chat` = Sonnet/Opus; **demo scenarios run on Haiku**
  (`DEFAULT_DEMO_MODEL`, env `DEMO_MODEL`) with Sonnet fallback — but the demo now goes
  through the EL voice agent, so Haiku is only the fail-safe fallback for demo phone calls.

## Key constraints / preferences to honor
- Keep maroon for the trainee app; demo-only is orange/black. Meridian stays.
- Strict CSP — self-host everything, no external scripts.
- Pause to confirm before risky changes (schema, auth, who-speaks-first, destructive git).
- Co-author trailer on commits.
