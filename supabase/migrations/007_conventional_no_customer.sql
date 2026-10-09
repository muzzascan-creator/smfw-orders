-- Conventional orders are entered by SMFW without a customer, so an order's customer becomes optional.
-- Customer logins still always get their own customer stamped on their orders (see orders_guard).
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.orders alter column customer_id drop not null;
