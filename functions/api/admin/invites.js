// Admin CRUD for invites. Backed by D1 (env.DB binding). Middleware enforces
// cs_admin on every method here, so no extra auth check inside.
//
// GET  - list all invites with usage stats + their assigned scenarios.
// POST - { scenario_ids: [], recipients: [{email, name?}], expires_days? }
//        For each recipient: find their existing non-revoked invite or create
//        a new one, mint a fresh URL token (so reassignment can be re-emailed
//        with a working link), and INSERT OR IGNORE the scenario assignments.
//        Usage history carries over - same invite, refreshed URL.

import { getScenario, listScenarioTypesForDisplay, COACHING_SCENARIO_ID } from '../../../shared/scenarios.js';
import { sha256Hex, randomId, randomToken, getAdminScope, DEMO_RECIPIENT_EMAIL, CHARTS_RECIPIENT_EMAIL, PREVIEW_RECIPIENT_EMAIL } from '../../../shared/auth.js';
import { sendInviteEmail } from '../../../shared/email.js';

const MIN_EXPIRY_DAYS = 1;
const MAX_EXPIRY_DAYS = 365;
const DEFAULT_EXPIRY_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Self-bootstrap the nullable `mode` column on invites. NULL/'standard' = the
// normal recipient library page; 'coaching' = the dedicated coaching-test page.
// This project can't run D1 migrations, so we add the column on demand and
// swallow the "duplicate column" error if it already exists (mirrors
// rubric.js ensureSeeded). Cheap to call before any invites read/write.
async function ensureInviteModeColumn(env) {
  try {
    await env.DB.prepare(`ALTER TABLE invites ADD COLUMN mode TEXT`).run();
  } catch {
    // column already present
  }
}

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    return await listInvites(env);
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

async function listInvites(env) {
  await ensureInviteModeColumn(env);
  const invitesRes = await env.DB.prepare(
    `SELECT id, recipient_email, recipient_name, created_at, expires_at,
            revoked, revoked_at, last_click_at, last_call_at, total_calls,
            created_by, mode
     FROM invites
     ORDER BY revoked ASC, created_at DESC`
  ).all();
  // Filter out the open demo link (identified by its sentinel recipient_email)
  // so it never appears in the regular Active Invites list. It has its own
  // Demo section / endpoint.
  const invites = (invitesRes?.results || []).filter(
    (i) =>
      i.recipient_email !== DEMO_RECIPIENT_EMAIL &&
      i.recipient_email !== CHARTS_RECIPIENT_EMAIL &&
      i.recipient_email !== PREVIEW_RECIPIENT_EMAIL
  );
  if (!invites.length) return json({ invites: [] });

  // Pull all scenario assignments for those invites in one round trip.
  const placeholders = invites.map(() => '?').join(',');
  const sceneRes = await env.DB
    .prepare(`SELECT invite_id, scenario_id FROM invite_scenarios WHERE invite_id IN (${placeholders})`)
    .bind(...invites.map((i) => i.id))
    .all();
  const sceneRows = sceneRes?.results || [];

  // Hydrate scenario IDs with their persona display data so the dashboard can
  // render names and taglines without a second API call.
  const personaMap = new Map();
  for (const t of listScenarioTypesForDisplay()) {
    for (const p of t.personas) personaMap.set(p.id, { ...p, type_title: t.title });
  }

  const byInvite = new Map(invites.map((i) => [i.id, []]));
  for (const row of sceneRows) {
    const persona = personaMap.get(row.scenario_id);
    byInvite.get(row.invite_id)?.push({
      id: row.scenario_id,
      customer_name: persona?.customer_name || row.scenario_id,
      customer_short: persona?.customer_short || '',
      tagline: persona?.tagline || '',
      premium: !!persona?.premium,
    });
  }

  return json({
    invites: invites.map((inv) => ({
      id: inv.id,
      recipient_email: inv.recipient_email,
      recipient_name: inv.recipient_name,
      created_at: inv.created_at,
      expires_at: inv.expires_at,
      revoked: !!inv.revoked,
      revoked_at: inv.revoked_at,
      last_click_at: inv.last_click_at,
      last_call_at: inv.last_call_at,
      total_calls: inv.total_calls,
      created_by: inv.created_by,
      mode: inv.mode || null,
      scenarios: byInvite.get(inv.id) || [],
    })),
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    return await createInvites(request, env);
  } catch (e) {
    return jsonError('create_failed', 500, String(e?.message || e));
  }
}

async function createInvites(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid_request', 400); }

  await ensureInviteModeColumn(env);

  // Page mode for the recipient: 'coaching' renders the dedicated coaching-test
  // sub-page (auto-loads one scenario, ends in the report). Anything else is a
  // normal recipient library invite — stored as NULL to keep existing rows /
  // behavior unchanged.
  const mode = body?.mode === 'coaching' ? 'coaching' : null;

  // Scenario assignment. Coaching-test invites ALWAYS target the single
  // dedicated coaching_practice scenario (the coaching page auto-loads it), so
  // the admin never needs to pick a library scenario - we force it here
  // regardless of what the client sent. Standard invites use the picked library
  // scenarios as before.
  let scenarios;
  if (mode === 'coaching') {
    scenarios = [COACHING_SCENARIO_ID];
  } else {
    const rawScenarios = Array.isArray(body?.scenario_ids) ? body.scenario_ids.filter((s) => typeof s === 'string') : [];
    if (!rawScenarios.length) return jsonError('scenario_ids_required', 400);
    scenarios = [...new Set(rawScenarios)];
    for (const sid of scenarios) {
      if (!getScenario(sid)) return jsonError(`unknown_scenario:${sid}`, 400);
    }
  }

  // Validate recipients
  const rawRecipients = Array.isArray(body?.recipients) ? body.recipients : [];
  if (!rawRecipients.length) return jsonError('recipients_required', 400);
  const recipients = [];
  for (const r of rawRecipients) {
    if (!r || typeof r !== 'object') continue;
    const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) return jsonError(`invalid_email:${email || '(blank)'}`, 400);
    const name = typeof r.name === 'string' && r.name.trim()
      ? r.name.trim().slice(0, 120)
      : null;
    recipients.push({ email, name });
  }
  if (!recipients.length) return jsonError('recipients_required', 400);

  // Expiry: 0 / null / "never" -> NULL in DB. Otherwise an integer day count
  // in the supported range, default 7.
  let expiresAt = null;
  const rawDays = body?.expires_days;
  if (rawDays === null || rawDays === 0 || rawDays === '0' || rawDays === 'never') {
    expiresAt = null;
  } else {
    const d = Number.isInteger(rawDays) ? rawDays : DEFAULT_EXPIRY_DAYS;
    if (d < MIN_EXPIRY_DAYS || d > MAX_EXPIRY_DAYS) return jsonError('invalid_expires_days', 400);
    expiresAt = Math.floor(Date.now() / 1000) + d * 86400;
  }

  const now = Math.floor(Date.now() / 1000);
  const origin = env.INVITE_PUBLIC_URL || new URL(request.url).origin;
  // Attribute this invite to whoever is signed in (owner email or named admin
  // email). Middleware already verified an admin cookie; this resolves which.
  const actor = await getAdminScope(request, env);
  const createdBy = actor?.email || null;
  const results = [];

  for (const rec of recipients) {
    const existing = await env.DB
      .prepare(`SELECT id FROM invites WHERE recipient_email = ? AND revoked = 0 LIMIT 1`)
      .bind(rec.email)
      .first();

    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    let inviteId;
    let reused = false;
    let createdAt = now;

    if (existing) {
      inviteId = existing.id;
      reused = true;
      // Refresh URL + expiry. Keep usage history. Update name if a new one was
      // provided (otherwise keep the existing one).
      await env.DB
        .prepare(`UPDATE invites
                  SET token_hash = ?, expires_at = ?,
                      recipient_name = COALESCE(?, recipient_name),
                      created_by = COALESCE(?, created_by),
                      mode = ?
                  WHERE id = ?`)
        .bind(tokenHash, expiresAt, rec.name, createdBy, mode, inviteId)
        .run();
      const row = await env.DB
        .prepare(`SELECT created_at FROM invites WHERE id = ?`)
        .bind(inviteId)
        .first();
      createdAt = row?.created_at ?? now;
    } else {
      inviteId = randomId();
      await env.DB
        .prepare(`INSERT INTO invites
                  (id, token_hash, recipient_email, recipient_name, created_at, expires_at, created_by, mode)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(inviteId, tokenHash, rec.email, rec.name, now, expiresAt, createdBy, mode)
        .run();
    }

    // PRIMARY KEY (invite_id, scenario_id) - INSERT OR IGNORE keeps existing
    // assignments. Scenarios can be added across multiple POSTs.
    for (const sid of scenarios) {
      await env.DB
        .prepare(`INSERT OR IGNORE INTO invite_scenarios (invite_id, scenario_id) VALUES (?, ?)`)
        .bind(inviteId, sid)
        .run();
    }

    const inviteUrl = `${origin}/me/${token}`;
    const emailResult = await sendInviteEmail(env, {
      to: rec.email,
      name: rec.name,
      url: inviteUrl,
      expiresAt,
    });

    const resultEntry = {
      id: inviteId,
      email: rec.email,
      name: rec.name,
      url: inviteUrl,
      scenario_ids: scenarios,
      expires_at: expiresAt,
      created_at: createdAt,
      created_by: createdBy,
      mode,
      reused,
      email_sent: emailResult.ok,
    };
    if (!emailResult.ok) {
      resultEntry.email_error = emailResult.error;
      if (emailResult.detail) resultEntry.email_error_detail = emailResult.detail;
    }
    results.push(resultEntry);
  }

  return json({ invites: results }, 201);
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
