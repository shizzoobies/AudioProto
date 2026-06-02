// Activity log for the Call Review rubric editor. Records who opened the shared
// review link and every change made to the rubric (admin or scoped reviewer).
// Backed by a small D1 table (rubric_audit). The logger self-creates the table
// on first use, so it works even before any migration runs.

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS rubric_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  action TEXT NOT NULL,
  item_key TEXT,
  detail TEXT
)`;

// Record one event. Best-effort: never throws (logging must not break an edit).
export async function logRubricEvent(env, { actor, actor_kind, action, item_key, detail }) {
  if (!env?.DB) return;
  const ts = Math.floor(Date.now() / 1000);
  const insert = () => env.DB
    .prepare(`INSERT INTO rubric_audit (ts, actor, actor_kind, action, item_key, detail) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(ts, actor || 'unknown', actor_kind || 'unknown', action || '', item_key || null, detail || null)
    .run();
  try {
    await insert();
  } catch {
    // Table probably doesn't exist yet — create it lazily and retry once.
    try { await env.DB.prepare(CREATE_SQL).run(); await insert(); } catch {}
  }
}

// Most-recent events first.
export async function getRubricAudit(env, limit = 60) {
  if (!env?.DB) return [];
  const n = Math.min(200, Math.max(1, Number(limit) || 60));
  try {
    const res = await env.DB
      .prepare(`SELECT ts, actor, actor_kind, action, item_key, detail FROM rubric_audit ORDER BY id DESC LIMIT ?`)
      .bind(n)
      .all();
    return res?.results || [];
  } catch {
    return [];
  }
}
