-- Records when an order's upload CSV was created, so the Orders tab can show a CSV tag.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.orders add column if not exists csv_at timestamptz;
