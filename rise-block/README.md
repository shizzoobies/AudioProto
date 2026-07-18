# First Call - Rise / Reach 360 embed block

This folder is the Mighty HTML block that runs the Robert practice call inside
a Rise course delivered through Reach 360. The block frames the embed app at
ka-testing.com, passes the learner's identity down, and relays the completion
signal back to Reach as xAPI statements (attempted, completed with score,
evaluated).

Files:

- `index.html` - the block page: a full-width iframe (mic + autoplay allowed) and a status line.
- `block.js` - resolves the learner from the xAPI bridge, frames the embed, relays `firstcall:*` postMessages into xAPI statements.
- `xapi-bridge.js` - finds Articulate's ADL XAPIWrapper up the window chain; mock mode (console logging) outside Reach.
- `config.js` - the ONLY per-course file: embed origin, course token, scenario id, activity id, passing score.

A byte-identical copy of `index.html`, `block.js`, and `xapi-bridge.js` lives
at `public/block-test/` with a localhost config so the whole relay can be
tested same-origin before touching Rise:
`https://ka-testing.com/block-test/?ct=<token>` (or on 127.0.0.1:8788 in dev).
If you edit the block, update BOTH copies (diff them to confirm).

## Publishing a course (per course)

1. In the admin dashboard, open "Course embeds" and create a token for the
   course. Copy the URL; the `ct=` value is the course token (shown once).
2. Edit `config.js`: paste the token into `ct`. Leave `sid: 'demo_sales'` for
   Robert. Adjust `passing` if the course needs a different bar.
3. Zip the four files (flat, no folder) and add them to the Rise lesson as a
   Mighty HTML block (or any HTML block type that accepts a zip).
4. Publish the course to Reach 360 and open it as a learner.

## First-publish server setup (once per Reach account)

The embed page only allows framing by known ancestors. Out of the box it
allows `*.reach360.com`, `*.articulate.com`, and `*.articulateusercontent.com`.
If the published course loads the block from a different origin, the iframe
will be blank; collect the real chain and pin it:

1. In the published course, open devtools inside the embed iframe context and
   read `location.ancestorOrigins` (or check the console error naming the
   blocked ancestor).
2. In the Cloudflare Pages project, set `EMBED_FRAME_ANCESTORS` to the full
   space-separated list, keeping `'self'`, e.g.
   `'self' https://*.reach360.com https://your-org.reach360.com`.
3. Optionally set `EMBED_PARENT_ORIGINS` to the block page's origin(s) so the
   embed posts its completion messages to exact targets (the embed also posts
   to the referrer origin automatically).

## Verifying end to end

- Standalone: `/block-test/?ct=<token>` - bridge logs `[xapi mock]` statements
  to the console, the call runs, the status line follows ready / in progress /
  complete with score.
- In Reach: take the call as a learner, then check Reach reporting's activity
  stream for the attempted and completed (with score) statements, the admin
  dashboard's Course embeds table for the usage row, and the learner name
  landing in the row (from the xAPI actor).
