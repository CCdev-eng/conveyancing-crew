-- Run in Supabase SQL editor (or migration). Stores Graph bodyPreview (plain text) for bell UI.
alter table contract_review_inbox
  add column if not exists body_preview text;
