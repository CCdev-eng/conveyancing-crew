-- Run in Supabase SQL editor (or migration) to persist per-review AI cost for billing.
alter table contract_review_inbox
  add column if not exists review_cost_aud numeric;

alter table contract_review_inbox
  add column if not exists review_cost_usd numeric;

alter table contract_review_inbox
  add column if not exists tokens_used integer;
