// Admin CRUD for coachable-agent profiles — the Phase 1 authoring surface of
// the Coaching Agents framework. Each row is a coachable AI "employee" managers
// will practice on. This endpoint is AUTHORING ONLY: nothing here wires a
// profile into the live call flow yet (that's a later phase). Middleware
// (functions/api/_middleware.js) already enforces the cs_admin cookie on every
// /api/admin/* route, so no auth check is needed inside the handlers.
//
// GET    - { agents: [ ...all rows, newest first ] }
// POST   - create (no id) or update (matching id) one profile; returns { agent }
// DELETE - remove a profile by ?id= or JSON body { id }; returns { ok, deleted }
//
// The table self-bootstraps at runtime (ensureCoachingAgentsTable) so it exists
// on Cloudflare without a manual migration step.

import { randomId, getAdminScope } from '../../../shared/auth.js';

const FIELD_CAP = 4000;
const LEVELS = new Set(['low', 'medium', 'high']);
// Audience gate: which caller role the employee is receptive to. '' = anyone
// (the default, ungated). 'manager' / 'senior_agent' match the cohort role labels
// ('Manager' / 'Senior Agent') after normalization.
const RECEPTIVE_TO = new Set(['', 'manager', 'senior_agent']);
// How the employee reacts to the WRONG (or unknown) role when gated.
const GATE_STRICTNESS = new Set(['hard', 'soft']);

export async function onRequestGet({ env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureCoachingAgentsTable(env);
    const res = await env.DB
      .prepare(`SELECT * FROM coaching_agents ORDER BY created_at DESC`)
      .all();
    const agents = (res?.results || []).map(rowToAgent);
    return json({ agents });
  } catch (e) {
    return jsonError('list_failed', 500, String(e?.message || e));
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureCoachingAgentsTable(env);

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('invalid_request', 400);
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return jsonError('name_required', 400);

    const fields = {
      scenario_name: cleanStr(body?.scenario_name),
      name: cap(name),
      age: toIntOrNull(body?.age),
      role_title: cleanStr(body?.role_title),
      voice_id: cleanStr(body?.voice_id),
      attitude: cleanStr(body?.attitude),
      resistance: level(body?.resistance),
      receptiveness: level(body?.receptiveness),
      receptive_to: receptiveTo(body?.receptive_to),
      gate_strictness: gateStrictness(body?.gate_strictness),
      skill_gap: cleanStr(body?.skill_gap),
      skill_gap_detail: cleanStr(body?.skill_gap_detail),
      demeanor: cleanStr(body?.demeanor),
      incident: cleanStr(body?.incident),
      personality: cleanStr(body?.personality),
      derails: toBit(body?.derails),
      mode_assessment: toBit(body?.mode_assessment),
      mode_coaching: toBit(body?.mode_coaching),
      mode_followup: toBit(body?.mode_followup),
      opening_lines: normalizeOpeningLines(body?.opening_lines),
      active: body?.active === undefined ? 1 : toBit(body?.active),
      image_id: imageRef(body?.image_id),
      accent_color: hexColor(body?.accent_color),
      photo: imageStr(body?.photo),
      incident_image: imageStr(body?.incident_image),
    };

    const now = Math.floor(Date.now() / 1000);

    // UPDATE if body.id matches an existing row, else INSERT a new one.
    let id = typeof body?.id === 'string' ? body.id.trim() : '';
    let existing = null;
    if (id) {
      existing = await env.DB
        .prepare(`SELECT id FROM coaching_agents WHERE id = ?`)
        .bind(id)
        .first();
    }

    if (existing) {
      await env.DB
        .prepare(
          `UPDATE coaching_agents SET
             scenario_name = ?, name = ?, age = ?, role_title = ?, voice_id = ?, attitude = ?,
             resistance = ?, receptiveness = ?, receptive_to = ?, gate_strictness = ?,
             skill_gap = ?, skill_gap_detail = ?,
             demeanor = ?, incident = ?, personality = ?, derails = ?,
             mode_assessment = ?, mode_coaching = ?, mode_followup = ?,
             opening_lines = ?, active = ?, image_id = ?, accent_color = ?,
             photo = ?, incident_image = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          fields.scenario_name, fields.name, fields.age, fields.role_title, fields.voice_id, fields.attitude,
          fields.resistance, fields.receptiveness, fields.receptive_to, fields.gate_strictness,
          fields.skill_gap, fields.skill_gap_detail,
          fields.demeanor, fields.incident, fields.personality, fields.derails,
          fields.mode_assessment, fields.mode_coaching, fields.mode_followup,
          fields.opening_lines, fields.active, fields.image_id, fields.accent_color,
          fields.photo, fields.incident_image, now,
          id
        )
        .run();
    } else {
      id = 'ca_' + randomId();
      let createdBy = null;
      try {
        const scope = await getAdminScope(request, env);
        createdBy = scope ? (scope.email || scope.admin_id || null) : null;
      } catch {
        createdBy = null;
      }
      await env.DB
        .prepare(
          `INSERT INTO coaching_agents
             (id, scenario_name, name, age, role_title, voice_id, attitude, resistance, receptiveness,
              receptive_to, gate_strictness,
              skill_gap, skill_gap_detail, demeanor, incident, personality, derails,
              mode_assessment, mode_coaching, mode_followup, opening_lines, active,
              image_id, accent_color, photo, incident_image, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id, fields.scenario_name, fields.name, fields.age, fields.role_title, fields.voice_id, fields.attitude,
          fields.resistance, fields.receptiveness, fields.receptive_to, fields.gate_strictness,
          fields.skill_gap, fields.skill_gap_detail,
          fields.demeanor, fields.incident, fields.personality, fields.derails,
          fields.mode_assessment, fields.mode_coaching, fields.mode_followup,
          fields.opening_lines, fields.active, fields.image_id, fields.accent_color,
          fields.photo, fields.incident_image, now, now, createdBy
        )
        .run();
    }

    const row = await env.DB
      .prepare(`SELECT * FROM coaching_agents WHERE id = ?`)
      .bind(id)
      .first();
    return json({ agent: rowToAgent(row) }, existing ? 200 : 201);
  } catch (e) {
    return jsonError('save_failed', 500, String(e?.message || e));
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return jsonError('db_not_configured', 500);
  try {
    await ensureCoachingAgentsTable(env);

    let id = new URL(request.url).searchParams.get('id') || '';
    if (!id) {
      try {
        const body = await request.json();
        if (typeof body?.id === 'string') id = body.id;
      } catch {
        // no body / not JSON — fall through to the missing-id check
      }
    }
    id = (id || '').trim();
    if (!id) return jsonError('id_required', 400);

    const res = await env.DB
      .prepare(`DELETE FROM coaching_agents WHERE id = ?`)
      .bind(id)
      .run();
    const changes = res?.meta?.changes ?? 0;
    return json({ ok: true, deleted: changes > 0 });
  } catch (e) {
    return jsonError('delete_failed', 500, String(e?.message || e));
  }
}

// Runtime self-bootstrap: create the table if it does not exist yet. Cheap to
// call at the top of every handler; CREATE TABLE IF NOT EXISTS is a no-op once
// the table is present. Mirrors the ensure... pattern used elsewhere in admin/.
async function ensureCoachingAgentsTable(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS coaching_agents (
         id               TEXT PRIMARY KEY,
         scenario_name    TEXT,
         name             TEXT NOT NULL,
         age              INTEGER,
         role_title       TEXT,
         voice_id         TEXT,
         attitude         TEXT,
         resistance       TEXT,
         receptiveness    TEXT,
         skill_gap        TEXT,
         skill_gap_detail TEXT,
         demeanor         TEXT,
         incident         TEXT,
         personality      TEXT,
         derails          INTEGER NOT NULL DEFAULT 0,
         mode_assessment  INTEGER NOT NULL DEFAULT 0,
         mode_coaching    INTEGER NOT NULL DEFAULT 1,
         mode_followup    INTEGER NOT NULL DEFAULT 0,
         opening_lines    TEXT,
         active           INTEGER NOT NULL DEFAULT 1,
         created_at       INTEGER NOT NULL,
         updated_at       INTEGER,
         created_by       TEXT
       )`
    ).run();
  } catch {
    // table already present or a benign race — safe to ignore
  }
  // Self-bootstrap the scenario_name column on DBs that predate it. ADD COLUMN
  // throws "duplicate column" once present — swallow it.
  try {
    await env.DB.prepare(
      `ALTER TABLE coaching_agents ADD COLUMN scenario_name TEXT`
    ).run();
  } catch {
    // column already present — safe to ignore
  }
  // Presentation columns (per-scenario card/journey look + dashboard imagery).
  // Swallow dup-column.
  for (const col of ['image_id TEXT', 'accent_color TEXT', 'photo TEXT', 'incident_image TEXT']) {
    try {
      await env.DB.prepare(`ALTER TABLE coaching_agents ADD COLUMN ${col}`).run();
    } catch {
      // column already present
    }
  }
  // Role-conditional receptiveness: who the employee opens up to, and how hard
  // they resist the wrong role. Swallow dup-column on DBs that already have them.
  for (const col of ['receptive_to TEXT', 'gate_strictness TEXT']) {
    try {
      await env.DB.prepare(`ALTER TABLE coaching_agents ADD COLUMN ${col}`).run();
    } catch {
      // column already present
    }
  }
}

// Shape a DB row into the JSON an admin client expects: booleans coerced,
// opening_lines parsed back to an array.
function rowToAgent(row) {
  if (!row) return null;
  let openingLines = [];
  if (row.opening_lines) {
    try {
      const parsed = JSON.parse(row.opening_lines);
      if (Array.isArray(parsed)) openingLines = parsed;
    } catch {
      openingLines = [];
    }
  }
  return {
    id: row.id,
    scenario_name: row.scenario_name || '',
    name: row.name,
    age: row.age ?? null,
    role_title: row.role_title || '',
    voice_id: row.voice_id || '',
    attitude: row.attitude || '',
    resistance: row.resistance || 'medium',
    receptiveness: row.receptiveness || 'medium',
    receptive_to: RECEPTIVE_TO.has(row.receptive_to) ? row.receptive_to : '',
    gate_strictness: GATE_STRICTNESS.has(row.gate_strictness) ? row.gate_strictness : 'hard',
    skill_gap: row.skill_gap || '',
    skill_gap_detail: row.skill_gap_detail || '',
    demeanor: row.demeanor || '',
    incident: row.incident || '',
    personality: row.personality || '',
    derails: !!row.derails,
    mode_assessment: !!row.mode_assessment,
    mode_coaching: !!row.mode_coaching,
    mode_followup: !!row.mode_followup,
    opening_lines: openingLines,
    active: !!row.active,
    image_id: row.image_id || '',
    accent_color: row.accent_color || '',
    photo: row.photo || '',
    incident_image: row.incident_image || '',
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    created_by: row.created_by || null,
  };
}

// Validators for the presentation fields.
function imageRef(v) { return typeof v === 'string' && /^img_[a-f0-9]{6,}$/i.test(v) ? v : ''; }
// Dashboard imagery (portrait / incident illustration) may be a data URL or an
// asset reference; cap generously so a base64 image is not truncated. Empty ->
// null so an absent field clears the column.
const IMAGE_CAP = 2_000_000;
function imageStr(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, IMAGE_CAP) : null;
}
function hexColor(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : ''; }

function cap(s) {
  return String(s).slice(0, FIELD_CAP);
}
// Trimmed string capped at a sane length, or null when empty.
function cleanStr(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, FIELD_CAP) : null;
}
function toIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function level(v) {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return LEVELS.has(t) ? t : 'medium';
}
// Normalize an incoming receptive-to value (accepts 'manager'/'senior_agent' or
// the cohort labels 'Manager'/'Senior Agent'); anything else -> '' (anyone).
function receptiveTo(v) {
  const t = typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, '_') : '';
  return RECEPTIVE_TO.has(t) ? t : '';
}
function gateStrictness(v) {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return GATE_STRICTNESS.has(t) ? t : 'hard';
}
function toBit(v) {
  if (v === true || v === 1 || v === '1' || v === 'on' || v === 'true') return 1;
  return 0;
}
// Accept an array OR a newline/comma-separated string; normalize to a JSON array
// string of trimmed, non-empty lines (or null when there are none).
function normalizeOpeningLines(v) {
  let arr = [];
  if (Array.isArray(v)) {
    arr = v;
  } else if (typeof v === 'string') {
    arr = v.split(/[\r\n,]+/);
  }
  const lines = arr
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .map((s) => s.slice(0, FIELD_CAP));
  return lines.length ? JSON.stringify(lines) : null;
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
