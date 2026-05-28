// Shared helper for recording per-call Anthropic token usage to D1.
// Fire-and-forget via ctx.waitUntil — must never throw or block a response.

export function recordUsage(ctx, env, row) {
  if (!env?.DB) return;
  try {
    const created_at = Math.floor(Date.now() / 1000);
    const stmt = env.DB.prepare(
      `INSERT INTO call_usage
         (created_at, endpoint, scenario_id, model,
          input_tokens, cache_creation_input_tokens,
          cache_read_input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      created_at,
      String(row?.endpoint || ''),
      row?.scenario_id || null,
      String(row?.model || ''),
      row?.input_tokens || 0,
      row?.cache_creation_input_tokens || 0,
      row?.cache_read_input_tokens || 0,
      row?.output_tokens || 0
    );
    ctx.waitUntil(stmt.run().catch(() => {}));
  } catch {
    // Swallow all errors — usage logging must never break a chat response.
  }
}
