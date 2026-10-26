-- 037: Promo tick box on each customer (Customers › Edit customer). Safe to run more than once.
alter table public.customers add column if not exists promo boolean not null default false;
notify pgrst, 'reload schema';
