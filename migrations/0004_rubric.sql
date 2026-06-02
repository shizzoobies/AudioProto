-- Migration 0004: admin-editable Call Review rubric.
-- Run once in the D1 Console (call-simulator-preview-db) after deploying the
-- editable-rubric feature. Creates the rubric_items table and seeds it with the
-- 12 default items (the same rubric in use today), so behavior is unchanged
-- until an admin edits it. INSERT OR IGNORE makes re-running safe.

CREATE TABLE IF NOT EXISTS rubric_items (
  key         TEXT PRIMARY KEY,        -- score key, e.g. 'beginning_greeting'
  section     TEXT NOT NULL,           -- section key: beginning|gathering|scheduling|wrap|general
  label       TEXT NOT NULL,           -- short card label in the report
  guidance    TEXT NOT NULL,           -- scoring instruction the model reads
  position    INTEGER NOT NULL DEFAULT 0,  -- order within its section
  enabled     INTEGER NOT NULL DEFAULT 1,  -- 1 = scored + shown; 0 = off everywhere
  is_custom   INTEGER NOT NULL DEFAULT 0,  -- 1 = admin-added (deletable); 0 = seeded default
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rubric_section ON rubric_items(section, position);

INSERT OR IGNORE INTO rubric_items (key, section, label, guidance, position, enabled, is_custom, created_at, updated_at) VALUES
('beginning_greeting','beginning','Branded greeting & self-intro','Did they open with a proper branded greeting and give their name? For example, "Thank you for calling Meridian Moving and Storage, this is ___."',0,1,0,strftime('%s','now'),strftime('%s','now')),
('beginning_offer','beginning','Offer to help & set the tone','Did they ask how they can help and set a warm, professional tone from the first moment?',1,1,0,strftime('%s','now'),strftime('%s','now')),
('gathering_details','gathering','Move details','Did they collect the move details the reservation needs - where from and to, the date, the load size - by asking good questions and confirming understanding?',0,1,0,strftime('%s','now'),strftime('%s','now')),
('gathering_equipment','gathering','Equipment match','Did they recommend the right truck size for the move and present the rate and options clearly?',1,1,0,strftime('%s','now'),strftime('%s','now')),
('scheduling_location','scheduling','Pickup location','Did they select or confirm the right pickup branch for the customer?',0,1,0,strftime('%s','now'),strftime('%s','now')),
('scheduling_time','scheduling','Pickup time','Did they lock in a firm pickup date and time?',1,1,0,strftime('%s','now'),strftime('%s','now')),
('wrap_readback','wrap','Read-back & confirmation','Did they read back and confirm the reservation details, including the confirmation number?',0,1,0,strftime('%s','now'),strftime('%s','now')),
('wrap_close','wrap','Professional close','Did they cover next steps, ask if there is anything else, and close the call courteously?',1,1,0,strftime('%s','now'),strftime('%s','now')),
('general_objections','general','Overcoming objections','Did they handle objections (price, competitor, hesitation) and keep the call moving toward a booking?',0,1,0,strftime('%s','now'),strftime('%s','now')),
('general_advisories','general','Reading advisories','Did they read or cover the required advisories, notices, and disclosures when they applied?',1,1,0,strftime('%s','now'),strftime('%s','now')),
('general_upsell','general','Upsell opportunities','Did they catch upsell opportunities (storage, furniture pads, a dolly, coverage) when the moment came up?',2,1,0,strftime('%s','now'),strftime('%s','now')),
('general_policy','general','Policy & accuracy','Did they stay accurate to Meridian''s stated policies and avoid promising things outside them?',3,1,0,strftime('%s','now'),strftime('%s','now'));
