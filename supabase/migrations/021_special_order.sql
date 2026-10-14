-- 021: Special Order tick box on Conventional orders.
-- When ticked, the order's upload CSV gets S as a fourth field on its H line: H,<CID>,<YYYYMMDD>,S
-- Safe to run more than once.
alter table public.orders add column if not exists special_order boolean not null default false;
notify pgrst, 'reload schema';
select 'OK: Special Order added' as result;
