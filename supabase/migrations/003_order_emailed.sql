-- Records when an order was emailed to its supplier(s), shown on the Orders tab.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.orders add column if not exists emailed_at timestamptz;
