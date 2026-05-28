// GET /api/admin/usage
//
// Returns aggregate token usage + recent calls so the admin dashboard can
// show prompt-caching efficiency. Admin gate enforced by _middleware.js.
//
// Response shape:
//   { last_24h: { chat: {...}, coach: {...} }, all_time: {...}, recent: [...] }

export async function onRequestGet(ctx) {
  if (!ctx.env.DB) {
    return jsonError('db_not_configured', 500);
  }
  try {
    return await getUsage(ctx.env);
  } catch (e) {
    // D1_ERROR is thrown when the table doesn't exist yet (migration not run).
    const msg = String(e?.message || e);
    if (msg.includes('no such table') || msg.includes('D1_ERROR')) {
      return jsonError('no_usage_table', 500, 'Run migration 0002 in the D1 console.');
    }
    return jsonError('query_failed', 500, msg.slice(0, 200));
  }
}

async function getUsage(env) {
  const cutoff24h = Math.floor(Date.now() / 1000) - 86400;

  const [rows24h, allTime, recent] = await Promise.all([
    env.DB.prepare(
      `SELECT
         COUNT(*) AS calls,
         SUM(input_tokens) AS input_tokens,
         SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
         SUM(cache_read_input_tokens) AS cache_read_input_tokens,
         SUM(output_tokens) AS output_tokens,
         endpoint
       FROM call_usage
       WHERE created_at >= ?
       GROUP BY endpoint`
    ).bind(cutoff24h).all(),

    env.DB.prepare(
      `SELECT
         COUNT(*) AS calls,
         SUM(input_tokens) AS input_tokens,
         SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
         SUM(cache_read_input_tokens) AS cache_read_input_tokens,
         SUM(output_tokens) AS output_tokens
       FROM call_usage`
    ).first(),

    env.DB.prepare(
      `SELECT created_at, endpoint, scenario_id, model,
              input_tokens, cache_creation_input_tokens,
              cache_read_input_tokens, output_tokens
       FROM call_usage
       ORDER BY created_at DESC
       LIMIT 20`
    ).all(),
  ]);

  // Index 24h rows by endpoint.
  const last24h = { chat: null, coach: null };
  for (const row of (rows24h.results || [])) {
    if (row.endpoint === 'chat' || row.endpoint === 'coach') {
      last24h[row.endpoint] = normalizeRow(row);
    }
  }

  return json({
    last_24h: last24h,
    all_time: normalizeRow(allTime),
    recent: (recent.results || []),
  });
}

function normalizeRow(row) {
  if (!row) return { calls: 0, input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  return {
    calls: row.calls || 0,
    input_tokens: row.input_tokens || 0,
    cache_creation_input_tokens: row.cache_creation_input_tokens || 0,
    cache_read_input_tokens: row.cache_read_input_tokens || 0,
    output_tokens: row.output_tokens || 0,
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(code, status, detail) {
  const payload = detail ? { error: code, detail } : { error: code };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
