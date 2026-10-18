-- 033: Indexes so the app stays fast at a few hundred orders a day. Screens load only orders still in play (unfinished,
-- or touched or required in the last 2 weeks) and then only what changed, which these make quick to find.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
create index if not exists orders_updated_idx on public.orders (updated_at);
create index if not exists orders_required_idx on public.orders (required_date);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_number_idx on public.orders (number);
create index if not exists batch_codes_entered_idx on public.batch_codes (entered_at);
select 'OK: indexes ready' as result;
