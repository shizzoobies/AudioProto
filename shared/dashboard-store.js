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
import { DEFAULT_DASHBOARD_FIELDS } from './coaching-dashboard.js';

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

  // Seed the default Development-Plan fields the first time the table is empty.
  try {
    const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM dashboard_fields`).first();
    if (!countRow || Number(countRow.n) === 0) {
      const now = Math.floor(Date.now() / 1000);
      for (const f of DEFAULT_DASHBOARD_FIELDS) {
        await env.DB
          .prepare(
            `INSERT INTO dashboard_fields (id, section_key, label, type, position, active, created_at)
             VALUES (?, ?, ?, ?, ?, 1, ?)`
          )
          .bind('df_' + randomId(), f.section_key, f.label, f.type || 'textarea', f.position || 0, now)
          .run();
      }
    }
  } catch {
    // seed failed (table contention / partial state) — non-fatal, callers degrade
  }
}
