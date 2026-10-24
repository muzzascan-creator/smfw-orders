-- 035: Special Requirements a buyer types on their order form. Kept apart from "special" (which is printed on the
-- supplier order form), so suppliers never see them. SMFW sees them on the order in the admin app.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.orders add column if not exists customer_notes text;
alter table public.orders drop constraint if exists customer_notes_len;
alter table public.orders add constraint customer_notes_len check (customer_notes is null or char_length(customer_notes) <= 500);
notify pgrst, 'reload schema';
select 'OK: buyer Special Requirements ready' as result;
