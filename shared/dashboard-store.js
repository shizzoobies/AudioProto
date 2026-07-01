// Runtime self-bootstrap for the coaching-dashboard tables (Phase 1 backend).
// Mirrors the ensure...Table pattern in functions/api/admin/coaching-agents.js
// and functions/api/coaching/progress.js: CREATE TABLE IF NOT EXISTS (cheap to
// call at the top of every handler), plus a one-time seed of dashboard_fields
// from DEFAULT_DASHBOARD_FIELDS so a fresh DB has the default Development-Plan
// questions without a manual migration step.
//
// This module touches env.DB at call time (pass env in); the structural
// constants live in the pure shared/coaching-dashboard.js.

import { randomId } from './auth.js';
import { DEFAULT_DASHBOARD_FIELDS, DEFAULT_DASHBOARD_BLOCKS, MAX_STAGE, SEED_VERSION } from './coaching-dashboard.js';

// Resolve the effective unlocked stage for a manager (by their invite_id). A
// cohort member is gated to their cohort's unlocked_stage; an ad-hoc (non-cohort)
// manager is ungated (MAX_STAGE). Used by BOTH the dashboard endpoint (display)
// and /api/voice-agent/start (to ENFORCE the gate server-side). Never throws.
export async function resolveManagerStage(env, inviteId) {
  if (!env?.DB || !inviteId) return MAX_STAGE;
  try {
    const member = await env.DB
      .prepare(`SELECT cohort_id FROM cohort_members WHERE invite_id = ? LIMIT 1`)
      .bind(inviteId)
      .first();
    if (!member) return MAX_STAGE; // not in a cohort -> ungated
    const cohort = await env.DB
      .prepare(`SELECT unlocked_stage FROM cohorts WHERE id = ?`)
      .bind(member.cohort_id)
      .first();
    const n = Number(cohort?.unlocked_stage);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(MAX_STAGE, n));
  } catch {
    return MAX_STAGE;
  }
}

// Create the dashboard tables if they do not exist yet, and seed dashboard_fields
// from the defaults when the table is empty. Safe to call repeatedly; never
// throws (each step swallows its own error like the sibling ensure helpers).
export async function ensureDashboardTables(env) {
  if (!env?.DB) return;

  // cohorts: an admin-managed group of managers sharing an unlocked_stage gate.
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS cohorts (
         id              TEXT PRIMARY KEY,
         name            TEXT,
         unlocked_stage  INTEGER NOT NULL DEFAULT 1,
         created_at      INTEGER NOT NULL,
         created_by      TEXT
       )`
    ).run();
  } catch {
    // table already present or a benign race — safe to ignore
  }

  // cohort_members: which invite belongs to which cohort + which agent (scenario)
  // that manager is assigned. PRIMARY KEY (cohort_id, invite_id).
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS cohort_members (
         cohort_id     TEXT NOT NULL,
         invite_id     TEXT NOT NULL,
         scenario_id   TEXT,
         member_name   TEXT,
         member_email  TEXT,
         created_at    INTEGER NOT NULL,
         PRIMARY KEY (cohort_id, invite_id)
       )`
    ).run();
  } catch {
    // table already present or a benign race — safe to ignore
  }
  try {
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_cohort_members_invite ON cohort_members(invite_id)`
    ).run();
  } catch {
    // index already present — safe to ignore
  }

  // dashboard_answers: one autosaved value per (invite, field_key).
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS dashboard_answers (
         invite_id   TEXT NOT NULL,
         field_key   TEXT NOT NULL,
         value       TEXT,
         updated_at  INTEGER,
         PRIMARY KEY (invite_id, field_key)
       )`
    ).run();
  } catch {
    // table already present or a benign race — safe to ignore
  }

  // dashboard_calls: one-try record per (invite, mode); stores the ElevenLabs
  // conversation_id so the recording proxy can fetch the audio.
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS dashboard_calls (
         invite_id       TEXT NOT NULL,
         mode            TEXT NOT NULL,
         conversation_id TEXT,
         taken_by        TEXT,
         completed_at    INTEGER,
         PRIMARY KEY (invite_id, mode)
       )`
    ).run();
  } catch {
    // table already present or a benign race — safe to ignore
  }

  // dashboard_fields: the editable Development-Plan questions (seeded below).
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS dashboard_fields (
         id          TEXT PRIMARY KEY,
         section_key TEXT NOT NULL,
         label       TEXT NOT NULL,
         type        TEXT NOT NULL DEFAULT 'textarea',
         position    INTEGER NOT NULL DEFAULT 0,
         active      INTEGER NOT NULL DEFAULT 1,
         created_at  INTEGER NOT NULL
       )`
    ).run();
  } catch {
    // table already present or a benign race — safe to ignore
  }

  // New dashboard_fields columns for the Development by Design reframe: a
  // "Consider:" hint list, a Week-4 part number (1 prep / 2 reflect), and a group
  // tag ('leadership'). ADD COLUMN throws once present — swallow it. ('group' is a
  // reserved word, so the column is 'grp'.)
  for (const col of ['hint TEXT', 'part INTEGER', 'grp TEXT']) {
    try {
      await env.DB.prepare(`ALTER TABLE dashboard_fields ADD COLUMN ${col}`).run();
    } catch {
      // column already present — safe to ignore
    }
  }

  // dashboard_blocks: the editable narrative per (section_key, slot) — Story,
  // Assignment, Leadership intro, Final Prompt, Info, Completion, Practicum.
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS dashboard_blocks (
         section_key TEXT NOT NULL,
         slot        TEXT NOT NULL,
         value       TEXT,
         updated_at  INTEGER,
         PRIMARY KEY (section_key, slot)
       )`
    ).run();
  } catch {
    // table already present or a benign race — safe to ignore
  }

  // dashboard_meta: tiny key/value store for migration bookkeeping (the applied
  // seed version), so a course redesign can re-seed exactly once on deploy.
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS dashboard_meta (
         key   TEXT PRIMARY KEY,
         value TEXT
       )`
    ).run();
  } catch {
    // table already present — safe to ignore
  }

  // Seed (or RE-seed on a SEED_VERSION bump) the default form fields. On a bump
  // we wipe the old fields + now-orphaned answers and reset cohort gates to the
  // new scale, then seed the new fields — a clean rollout of a course redesign
  // with no manual migration. Runs exactly once per version. Scoped to the
  // coaching dashboard only (scenarios / voices / invites are untouched).
  try {
    const verRow = await env.DB
      .prepare(`SELECT value FROM dashboard_meta WHERE key = 'seed_version'`)
      .first();
    const applied = Number(verRow?.value) || 0;
    if (applied !== SEED_VERSION) {
      const now = Math.floor(Date.now() / 1000);
      if (applied > 0) {
        // Upgrading from an earlier course: clean reset of dashboard state.
        try { await env.DB.prepare(`DELETE FROM dashboard_fields`).run(); } catch {}
        try { await env.DB.prepare(`DELETE FROM dashboard_blocks`).run(); } catch {}
        try { await env.DB.prepare(`DELETE FROM dashboard_answers`).run(); } catch {}
        try { await env.DB.prepare(`UPDATE cohorts SET unlocked_stage = 1`).run(); } catch {}
      }
      // Seed only when empty (covers both a fresh DB and a post-wipe reseed).
      const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM dashboard_fields`).first();
      if (!countRow || Number(countRow.n) === 0) {
        for (const f of DEFAULT_DASHBOARD_FIELDS) {
          await env.DB
            .prepare(
              `INSERT INTO dashboard_fields (id, section_key, label, type, position, hint, part, grp, active, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
            )
            .bind('df_' + randomId(), f.section_key, f.label, f.type || 'textarea', f.position || 0,
              f.hint || null, f.part == null ? null : f.part, f.group || null, now)
            .run();
        }
      }
      const blockCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM dashboard_blocks`).first();
      if (!blockCount || Number(blockCount.n) === 0) {
        for (const b of DEFAULT_DASHBOARD_BLOCKS) {
          await env.DB
            .prepare(
              `INSERT INTO dashboard_blocks (section_key, slot, value, updated_at)
               VALUES (?, ?, ?, ?)`
            )
            .bind(b.section_key, b.slot, b.value == null ? '' : b.value, now)
            .run();
        }
      }
      await env.DB
        .prepare(`INSERT INTO dashboard_meta (key, value) VALUES ('seed_version', ?)
                  ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
        .bind(String(SEED_VERSION))
        .run();
    }
  } catch {
    // seed failed (table contention / partial state) — non-fatal, callers degrade
  }

  // Idempotent top-up: add any newly-introduced default narrative blocks WITHOUT
  // a full reseed. INSERT OR IGNORE keys off the (section_key, slot) PK so it
  // never overwrites an admin's edits. Only runs the loop when the block count is
  // short of the defaults, so it's a single COUNT on the common path.
  try {
    const bc = await env.DB.prepare(`SELECT COUNT(*) AS n FROM dashboard_blocks`).first();
    if (!bc || Number(bc.n) < DEFAULT_DASHBOARD_BLOCKS.length) {
      const t = Math.floor(Date.now() / 1000);
      for (const b of DEFAULT_DASHBOARD_BLOCKS) {
        await env.DB
          .prepare(`INSERT OR IGNORE INTO dashboard_blocks (section_key, slot, value, updated_at) VALUES (?, ?, ?, ?)`)
          .bind(b.section_key, b.slot, b.value == null ? '' : b.value, t)
          .run();
      }
    }
  } catch {
    // best-effort top-up — non-fatal
  }
}
