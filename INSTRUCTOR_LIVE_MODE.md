# Instructor Live Mode (no-API two-screen practice)

A budget fallback for the Robert (`demo_sales`) sales demo that needs **zero AI
and zero paid API calls**. A human instructor plays the customer by voice while
the trainee drives the real reservation POS on a paired screen. No transcript,
no scored AI report.

Built on branch `instructor-live-mode` (off `dev-dashboard`). Isolated behind a
distinct route/mode; the normal demo path is untouched.

## How to run a session

1. Open the admin dashboard. Under **Live practice → Instructor Live Mode**,
   optionally type a label (e.g. "Maria, week 1") and click **Create live
   session**. You get two passwordless links.
2. Open the **Instructor** link on your own screen. Send the **Trainee** link to
   the new hire (Teams, text, email, whatever).
3. Get on a call together (phone / Teams / in person). You play Robert using the
   role-play crib on your screen; they work the reservation.
4. You watch their screen mirror live (current step, fields, recommended truck,
   notes) and talk them through it.
5. When done, fill the **end-of-session debrief** checklist + notes on your
   screen and click **Save debrief**, then **End session** (this disables both
   links immediately).

## How it works

- **Transport:** ~1s D1 polling. The trainee's browser POSTs a small POS state
  snapshot to `/api/live/state`; the instructor view GETs it ~1.2s and re-renders
  a read-only mirror. Same-origin fetch, so the existing CSP (`connect-src
  'self'`) needs no change.
- **Access:** the invites-style token-link pattern. Each session mints a paired
  trainee token + instructor token (24 bytes each, stored hashed). Opening
  `/live/<token>` sets a role-scoped `cs_live` cookie and redirects (trainee ->
  `/app?live=1`, instructor -> `/instructor-live`). `getLiveScope` re-reads D1 on
  every request, so **End session** / expiry cuts access instantly.
- **No AI:** the `?live=1` trainee boot skips the normal auth probes,
  `/api/scenarios`, the ElevenLabs voice agent, and the coaching report. The POS
  is fully interactive; we only observe and emit its state.
- **Card safety:** the card number is masked to last 4 (and the CVV dropped) both
  client-side before sending and again server-side before persisting.
- **Dossier:** the instructor-only role-play crib mirrors the Robert demo-script
  PDF (scenario snapshot, key facts, dynamic move timeline, the 8-phase ideal
  path, objection cheat sheet, presenter tips, success criteria).

## Files

| File | Purpose |
| --- | --- |
| `shared/live.js` | table bootstrap, token minting, `cs_live` cookie, `getLiveScope`, card masking |
| `functions/api/live/state.js` | GET status/snapshot (both roles); POST trainee snapshot or instructor checklist/end |
| `functions/api/live/dossier.js` | instructor-only role-play crib |
| `functions/api/admin/live-sessions.js` | admin create / list / end / delete |
| `functions/live/[token].js` | public landing; resolves token -> role -> cookie -> redirect |
| `functions/api/_middleware.js` | allow `/api/live/state` + `/api/live/dossier` to self-gate via `cs_live` |
| `public/assets/js/app.js` | `?live=1` boot, POS snapshot/emit, three guarded skips in `renderCall` |
| `public/instructor-live.html` + `public/assets/js/instructor-live.js` | the instructor screen |
| `public/assets/js/admin.js` | the "Live practice session" admin card |
| `public/assets/css/styles.css` | live-mode chrome + message cards |
| `migrations/0012_live_sessions.sql` | canonical schema reference (optional, see below) |

## D1 note

This project cannot run D1 migrations from CI, so the `live_sessions` table is
**self-bootstrapped at runtime** by `ensureLiveTable` (`CREATE TABLE IF NOT
EXISTS`), the same approach as the invites/dashboard tables. No manual step is
required. If you prefer, you can also run `migrations/0012_live_sessions.sql` by
hand in the D1 console for `call-simulator-preview-db`.

## To deploy

This is on its own branch and has **not** been merged. When you are happy:

```
git push origin origin/instructor-live-mode:dev-dashboard   # or open a PR
```

Then deploy `dev-dashboard` as usual. Do not fast-forward `main` until the June
demo path is re-verified.
