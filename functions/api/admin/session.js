// "Am I logged in as admin?" The middleware gates /api/admin/* with a strict
// cs_admin check, so if execution reaches this handler the answer is yes.
// The admin SPA hits this on boot to decide between login form and dashboard.

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
