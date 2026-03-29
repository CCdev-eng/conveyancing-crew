-- Run in Supabase SQL editor (in order) to dedupe rows and enforce one row per Graph email_id.
-- See app/api/cron/contract-inbox/route.js — cron now uses the latest row per email_id only.

-- Step 1: Remove duplicates, keeping the most recent row per email_id
DELETE FROM contract_review_inbox
WHERE id NOT IN (
  SELECT DISTINCT ON (email_id) id
  FROM contract_review_inbox
  ORDER BY email_id, created_at DESC
);

-- Step 2 (optional safety): remove any remaining duplicates by keeping newest created_at
DELETE FROM contract_review_inbox a
USING contract_review_inbox b
WHERE a.created_at < b.created_at
  AND a.email_id = b.email_id;

-- Step 3: Unique constraint so duplicates cannot be inserted again
ALTER TABLE contract_review_inbox
  DROP CONSTRAINT IF EXISTS contract_review_inbox_email_id_key;

ALTER TABLE contract_review_inbox
  ADD CONSTRAINT contract_review_inbox_email_id_key UNIQUE (email_id);
