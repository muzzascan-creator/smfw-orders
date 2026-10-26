-- 036: Promo tick box on each pack type (Products › Edit product). Safe to run more than once.
alter table public.product_packs add column if not exists promo boolean not null default false;
notify pgrst, 'reload schema';
