-- Migration 0005: policy-grounding fields on rubric items.
-- Adds anchors (1/3/5 score guide), policy_ref (company standard), and required
-- (must-say checklist) to each rubric item. These are injected into the AI
-- coaching prompt per item so scoring aligns with company criteria.
--
-- The admin API (functions/api/admin/rubric.js) also performs these ALTERs and
-- backfills the default guidance on demand, so running this by hand is optional.
-- ADD COLUMN errors if the column already exists; ignore that case.

ALTER TABLE rubric_items ADD COLUMN anchors    TEXT NOT NULL DEFAULT '';
ALTER TABLE rubric_items ADD COLUMN policy_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE rubric_items ADD COLUMN required   TEXT NOT NULL DEFAULT '';
