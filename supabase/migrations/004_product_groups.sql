-- Product groups: every product is Organic or Conventional. Existing products become Organic.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.products add column if not exists product_group text not null default 'Organic';
alter table public.products drop constraint if exists products_product_group_check;
alter table public.products add constraint products_product_group_check check (product_group in ('Organic','Conventional'));
