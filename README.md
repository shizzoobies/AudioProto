# Call Simulator

AI-powered customer service training simulator. Cloudflare Pages frontend, Pages Functions backend, Anthropic for conversation and coaching, ElevenLabs for voice.

See [CALL_SIMULATOR_HANDOFF.md](./CALL_SIMULATOR_HANDOFF.md) for the full spec.

## Phase status

- [x] **Phase 1** Skeleton + password gate
- [ ] Phase 2 Text-mode conversation
- [ ] Phase 3 Coaching report
- [ ] Phase 4 Voice playback
- [ ] Phase 5 Voice input
- [ ] Phase 6 Polish

## Local development

### Prerequisites

- Node 20 or newer
- npm

### One-time setup

```powershell
npm install
```

`.dev.vars` already exists with local-only placeholder values. Default password is `changeme`. Update both `APP_PASSWORD` and `SESSION_SECRET` before deploying.

### Run

```powershell
npm run dev
```

Wrangler will print a local URL (typically http://localhost:8788). Open it, enter the password, and you should land on the empty app shell.

## Project structure

```
public/                 Static frontend served by Pages
  index.html              Login page
  app.html                Protected app shell
  _headers                Security headers for static responses
  assets/css/styles.css   Theme tokens, login, app shell
  assets/js/login.js      Login form handler
  assets/js/app.js        Session check + app shell bootstrap
functions/api/          Pages Functions (Worker routes under /api/*)
  _middleware.js          Auth check for every /api/* request except /api/auth
  auth.js                 POST = login, DELETE = logout
  session.js              GET = 200 if the session cookie is valid
shared/                 Helpers reused by Functions
  auth.js                 HMAC-SHA256 token signing and verification
```

## Auth

- POST `/api/auth` with `{ "password": "..." }`. On success, the Worker sets an `HttpOnly` `SameSite=Strict` cookie named `session` and returns `{ ok: true, expires_at: <unix-seconds> }`. On failure, returns `401 { "error": "invalid_password" }`.
- GET `/api/session` returns `200 { ok: true }` when the cookie is valid, `401` otherwise. The frontend hits this on `app.html` load to gate access.
- DELETE `/api/auth` clears the cookie.
- The token is a JWT-shaped string signed with HMAC-SHA256 using `SESSION_SECRET`. Eight-hour expiry.
- `Secure` is set on the cookie only when the request arrives over HTTPS, so local HTTP dev still works.

This is a small simplification of the API contract in the handoff: protected routes read the cookie via the middleware instead of expecting an `Authorization: Bearer <token>` header. Same-origin makes this cleaner and keeps the token out of JS.

## Deploying (do not run without Alex's go-ahead)

```powershell
# First-time deploy (creates the Pages project)
npm run deploy

# Set production secrets
npm run secret:password
npm run secret:session
npm run secret:anthropic
npm run secret:elevenlabs

# Generate a strong session secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

After deploy, attach the custom domain `call-sim.ka-testing.com` from the Cloudflare Pages dashboard.

## Rotating secrets

Run the relevant `npm run secret:*` script. Rotating `SESSION_SECRET` invalidates every existing session immediately.
