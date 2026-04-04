-- Run in Supabase SQL editor (or migration). Used by bell Contract Reviews tab.
alter table contract_review_inbox
  add column if not exists is_actioned boolean not null default false;
