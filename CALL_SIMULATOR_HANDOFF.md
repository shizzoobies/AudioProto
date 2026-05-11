# Call Simulator — Build Handoff

**Project name:** `call-simulator` (working title)
**Owner:** Alex Anderson
**Target domain:** ka-testing.com (Cloudflare-managed)
**Stack:** Vanilla HTML/CSS/JS frontend on Cloudflare Pages + Cloudflare Worker backend
**Goal:** Polished stakeholder demo of an AI-powered customer service training simulator

---

## What this is

A web app that lets a trainee have a realistic, voice-driven conversation with an AI customer. The trainee picks a scenario, has the call, and gets immediate coaching feedback at the end. Built around a fictional company ("Meridian Moving & Storage") so it's portable and unbranded.

Two interaction modes:
- **Voice mode:** trainee speaks into mic, hears customer through speakers
- **Text mode:** trainee types, customer responds with voice (for quiet environments or accessibility)

After the call ends, Claude analyzes the transcript and returns a scored coaching report.

---

## Architecture

```
┌──────────────────┐         ┌─────────────────────┐         ┌──────────────┐
│  Browser (Pages) │────────▶│  Cloudflare Worker  │────────▶│  Anthropic   │
│                  │         │  (api.ka-testing... │         │     API      │
│  - UI            │◀────────│   or path-based)    │         └──────────────┘
│  - Audio capture │         │                     │
│  - Audio playback│         │  - Session state    │         ┌──────────────┐
│  - Visualizer    │         │  - API key vault    │────────▶│ ElevenLabs   │
└──────────────────┘         │  - Streaming proxy  │         │  TTS + STT   │
                             └─────────────────────┘         └──────────────┘
```

**Why a Worker:** Both API keys must live server-side. Workers also handle streaming responses well (critical for low-latency feel).

**Why no database:** Per Alex, sessions are ephemeral for the prototype. Coaching feedback is delivered immediately after the call and not persisted.

---

## Domain + routing

Use `ka-testing.com` (already in Alex's Cloudflare account).

- **Frontend:** `call-sim.ka-testing.com` (Cloudflare Pages custom domain)
- **Worker:** Same origin, mounted at `/api/*` via a Pages Function or a Workers route on the subdomain. Same-origin keeps CORS simple — no preflight headaches.

If we go path-based on the Pages project (recommended), structure is:
- `call-sim.ka-testing.com/` → static frontend
- `call-sim.ka-testing.com/api/chat` → Worker (streaming chat)
- `call-sim.ka-testing.com/api/tts` → Worker (text-to-speech proxy)
- `call-sim.ka-testing.com/api/stt` → Worker (speech-to-text proxy)
- `call-sim.ka-testing.com/api/coach` → Worker (post-call analysis)
- `call-sim.ka-testing.com/api/auth` → Worker (password gate)

---

## File structure

```
call-simulator/
├── public/                          # Cloudflare Pages static root
│   ├── index.html                   # Login / password gate
│   ├── app.html                     # Main app shell (post-auth)
│   ├── assets/
│   │   ├── css/
│   │   │   └── styles.css
│   │   ├── js/
│   │   │   ├── app.js               # App controller + routing
│   │   │   ├── audio.js             # Mic capture, playback, visualizer
│   │   │   ├── conversation.js      # Chat state, streaming handler
│   │   │   ├── scenarios.js         # Scenario definitions (frontend display)
│   │   │   └── coach.js             # Post-call report rendering
│   │   └── img/
│   │       └── (logo, avatars)
│   └── _headers                     # Cloudflare Pages headers (security)
├── functions/                       # Pages Functions (Worker routes)
│   └── api/
│       ├── auth.js                  # POST: password check, issues session token
│       ├── chat.js                  # POST: streams Claude responses
│       ├── tts.js                   # POST: text → ElevenLabs audio
│       ├── stt.js                   # POST: audio → ElevenLabs Scribe transcript
│       └── coach.js                 # POST: full transcript → coaching report
├── shared/
│   ├── scenarios.js                 # Persona system prompts (server-side source of truth)
│   ├── coaching-rubric.js           # The rubric Claude uses to score calls
│   └── auth.js                      # Token signing/verification helpers
├── .dev.vars                        # Local secrets (gitignored)
├── wrangler.toml                    # Worker config
├── package.json
└── README.md
```

---

## Environment variables (Cloudflare secrets)

Set via `wrangler secret put` or the Cloudflare dashboard:

```
ANTHROPIC_API_KEY         # Anthropic key
ELEVENLABS_API_KEY        # ElevenLabs key
APP_PASSWORD              # The shared password for the gate
SESSION_SECRET            # Random string for signing session tokens
```

For local dev, mirror these in `.dev.vars` (gitignored).

---

## Model selection

- **In-call conversation:** `claude-sonnet-4-6` — fast, cheap, plenty smart for staying in character. Streaming enabled.
- **Post-call coaching report:** `claude-opus-4-7` — depth matters here, and it only runs once per session.

Both are current production model strings as of May 2026.

---

## Latency strategy (the key UX decision)

Naive flow: trainee speaks → STT → full Claude response → full TTS → playback. That's 4–7 seconds of dead air. In a demo, that kills the magic.

**Streaming approach:**
1. Stream Claude's response from the Worker to the browser via SSE.
2. As tokens arrive, buffer them in the browser until a sentence boundary (`.`, `?`, `!`).
3. Send each completed sentence to `/api/tts` immediately.
4. Queue the returned audio chunks and play them sequentially.

Result: customer starts talking within ~800ms of the trainee finishing, while later sentences are still being generated.

ElevenLabs supports streaming TTS too — for v1 we can use their regular endpoint per-sentence to keep complexity down, then upgrade to their websocket streaming endpoint if latency still feels off.

---

## The five scenarios

Stored in `shared/scenarios.js` as objects with: `id`, `title`, `customer_name`, `difficulty`, `voice_id` (ElevenLabs), `opening_line`, `system_prompt`, `success_criteria`.

1. **The Lost Reservation** — Frustrated. Reserved a 15-foot truck at the downtown location, showed up, no truck. Has movers waiting at $80/hour. Voice: stressed, mid-30s.

2. **The Price Shopper** — Calm but skeptical. Got a quote from BudgetMove for $50 less. Wants to know why Meridian is worth it. Voice: measured, analytical, 40s.

3. **The First-Time Mover** — Overwhelmed, asking lots of questions. Recent college grad, first apartment. Doesn't know about insurance, pads, dollies, or appliance moving. Voice: nervous, young.

4. **The Damage Dispute** — Returning customer. Claims the dent on the cargo door was there at pickup but wasn't noted. Argumentative but not abusive. Voice: defensive, 50s.

5. **The Upsell Opportunity** — Booked the 10-foot truck. Mentions casually that they're moving "the whole house, three bedrooms." Doesn't realize they need a bigger truck. Voice: cheerful, oblivious.

Each system prompt instructs Claude to:
- Stay in character no matter what
- Never break the fourth wall or mention being an AI
- Respond in 1–3 sentences typically (keeps pacing realistic)
- Escalate, calm down, or shift mood based on how the trainee handles the call
- Have an internal "satisfaction" trajectory it tracks implicitly

---

## Coaching rubric (post-call)

Lives in `shared/coaching-rubric.js`. After the call, the full transcript goes to Opus 4.7 with this rubric:

1. **Rapport & Empathy** (1–5): Did the agent acknowledge feelings, use the customer's name, match tone appropriately?
2. **Active Listening** (1–5): Did the agent confirm understanding, ask clarifying questions, avoid talking over the customer?
3. **Problem Solving** (1–5): Did the agent move toward a resolution efficiently? Offer options?
4. **Sales Acumen** (1–5, when applicable): Did the agent identify upsell opportunities, position value, handle objections?
5. **Policy & Accuracy** (1–5): Did the agent stay accurate to Meridian's stated policies (in the scenario brief)?
6. **Overall Resolution** (1–5): Did the call end with the customer's issue resolved or a clear next step?

Output structure (Claude returns JSON):
```json
{
  "overall_score": 4.2,
  "scores": {
    "rapport": { "score": 5, "evidence": "...", "suggestion": "..." },
    "listening": { ... },
    ...
  },
  "strengths": ["..."],
  "growth_areas": ["..."],
  "one_thing_to_try_next_time": "..."
}
```

Frontend renders this as a polished report card with progress bars, expandable sections, and pull-quote evidence from the transcript.

---

## Auth (password gate)

Simple but real. Don't ship a frontend-only check — that's trivially bypassable.

1. `index.html` shows a password form.
2. POST to `/api/auth` with the password.
3. Worker compares against `APP_PASSWORD` env var.
4. On match, Worker returns a signed JWT-style token (HMAC with `SESSION_SECRET`, 8-hour expiry).
5. Token stored in `httpOnly` cookie OR localStorage (cookie is more secure; localStorage is easier for the demo — pick cookie).
6. Every `/api/*` route except `/api/auth` verifies the token first; returns 401 if missing/expired.
7. On 401, frontend redirects to `/`.

---

## Visual direction

Premium SaaS aesthetic, not corporate training portal. Reference points: Linear, Vercel, Rauno's portfolio.

- **Theme:** Dark mode default. Background `#0a0a0b`, surfaces `#141416`, borders `#27272a`.
- **Accent:** Confident amber `#f5a524` (not orange — avoids U-Haul read). Used sparingly for active states, CTAs, the audio visualizer.
- **Typography:** Inter for UI, JetBrains Mono for transcript timestamps and scores. Generous line-height.
- **Layout:** Full-bleed app, single column max-width 720px for the call view, two-column for the report.
- **Motion:** Audio visualizer is a horizontal bar of ~32 vertical bars that respond to the customer's voice frequency (Web Audio API `AnalyserNode`). Subtle scale animations on state changes. No bouncy springs — this should feel calm and professional.
- **Empty states:** Treated as first-class. The scenario picker has a quick description and "difficulty" tag for each.
- **No em dashes in any UI copy.** (Alex's locked writing rule.)

---

## Build order for Claude Code

Do these in sequence. Each phase should leave the app in a working, demo-able state.

### Phase 1: Skeleton + auth
- Project scaffold, `wrangler.toml`, `package.json`
- Password gate working end-to-end (frontend form → Worker → token → protected page)
- Empty app shell visible after auth

### Phase 2: Text-mode conversation
- Scenario picker UI with the 5 personas
- Text input → `/api/chat` → streaming response in chat bubbles
- Conversation history maintained client-side, sent with each request
- "End Call" button finishes the session

### Phase 3: Coaching report
- "End Call" triggers `/api/coach` with full transcript
- Loading state ("Analyzing your call...")
- Report renders with scores, evidence, suggestions
- "New Call" button returns to scenario picker

### Phase 4: Voice playback
- Each customer message also sent to `/api/tts`
- Audio plays as it arrives, queued if multiple sentences
- Audio visualizer animates during playback

### Phase 5: Voice input
- Push-to-talk button (hold to record, release to send)
- Audio uploaded to `/api/stt` (ElevenLabs Scribe)
- Transcript inserted as if typed, conversation continues normally
- Mode toggle in UI: Text / Voice / Both

### Phase 6: Polish
- Audio visualizer tuning
- Transition animations
- Error states (mic permission denied, API failures, etc.)
- Loading skeletons
- Mobile responsive check (demo will likely run on a laptop, but don't break on tablet)

---

## API endpoint contracts

### `POST /api/auth`
**Request:** `{ "password": "string" }`
**Response 200:** `{ "token": "string", "expires_at": 1234567890 }`
**Response 401:** `{ "error": "invalid_password" }`

### `POST /api/chat` (streaming, SSE)
**Headers:** `Authorization: Bearer <token>`
**Request:**
```json
{
  "scenario_id": "lost_reservation",
  "messages": [
    { "role": "user", "content": "Hello, this is Alex with Meridian..." },
    { "role": "assistant", "content": "Yeah, hi, I'm trying to figure out..." }
  ]
}
```
**Response:** SSE stream of `data: { "type": "text_delta", "text": "..." }` events, terminated by `data: [DONE]`

### `POST /api/tts`
**Headers:** `Authorization: Bearer <token>`
**Request:** `{ "text": "string", "voice_id": "string" }`
**Response:** `audio/mpeg` binary stream

### `POST /api/stt`
**Headers:** `Authorization: Bearer <token>`
**Request:** `multipart/form-data` with audio file
**Response:** `{ "transcript": "string" }`

### `POST /api/coach`
**Headers:** `Authorization: Bearer <token>`
**Request:**
```json
{
  "scenario_id": "lost_reservation",
  "transcript": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```
**Response:** `{ ...coaching report JSON shape from above... }`

---

## Things Claude Code should NOT do

- Don't ship API keys to the frontend under any circumstances.
- Don't use a frontend-only auth check.
- Don't pick fancy frameworks for v1. Vanilla JS is fine and faster to debug. If something genuinely needs React later, refactor then.
- Don't use em dashes in any UI copy, error messages, or report text. (Alex's locked rule.)
- Don't add scenario content based on U-Haul. Stay generic to Meridian Moving & Storage.
- Don't persist conversation data anywhere. Sessions are ephemeral by design.
- Don't auto-deploy. Build locally with `wrangler pages dev` until Alex approves.

---

## Open items to confirm before/during build

1. **ElevenLabs voice IDs:** Alex will need to pick or generate 5 distinct voices that match the persona descriptions. Can use ElevenLabs' default voice library to start.
2. **ElevenLabs plan tier:** Confirm the account has enough character/STT quota for demo runs (each full call is roughly 500–1500 characters of TTS plus 1–3 minutes of STT).
3. **Anthropic spend cap:** Set a monthly budget alarm in the Anthropic console before demo day.
4. **Demo password:** Alex picks the value for `APP_PASSWORD` before deploy.
5. **Final subdomain choice:** `call-sim.ka-testing.com` is the assumed default — confirm or pick alternate.

---

## Done definition for v1

- All 5 scenarios work in both text and voice modes
- Customer audio plays within ~1.5s of trainee finishing input
- Coaching report renders within ~10s of ending the call
- Password gate keeps strangers out
- No console errors during a happy-path demo run
- Deployed to `call-sim.ka-testing.com` with valid HTTPS
- README documents how to run locally and how to rotate API keys
