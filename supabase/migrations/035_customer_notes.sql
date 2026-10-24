-- 035: Special Requirements a buyer types on their order form. Kept apart from "special" (which is printed on the
-- supplier order form), so suppliers never see them. SMFW sees them on the order in the admin app.
-- Up to 50 characters.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again (an earlier run allowed 500; running
-- this again sets the limit to 50).
alter table public.orders add column if not exists customer_notes text;
alter table public.orders drop constraint if exists customer_notes_len;
alter table public.orders add constraint customer_notes_len check (customer_notes is null or char_length(customer_notes) <= 50) not valid;
notify pgrst, 'reload schema';
select 'OK: buyer Special Requirements ready' as result;
