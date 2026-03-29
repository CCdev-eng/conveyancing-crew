-- Optional client detail columns for matters (Overview edit + intake)
alter table matters add column if not exists client_first_name text;
alter table matters add column if not exists client_last_name text;
alter table matters add column if not exists client_email text;
alter table matters add column if not exists client_phone text;
alter table matters add column if not exists co_purchaser_name text;
alter table matters add column if not exists updated_at timestamptz default now();
