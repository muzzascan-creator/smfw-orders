-- 020: Speed up loading.
-- The permission checks ran once for every row, and "which product groups can this login see?"
-- looked through every customer each time. With 250+ customers that made the product list slow
-- for everyone. Now each check runs once per request, and the product-group lookup goes straight
-- to the login's own customers. Nobody can see anything they couldn't before.
-- Safe to run more than once.

create or replace function public.my_product_groups() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct c.product_group), '{}')
  from public.customers c
  where c.id in (
    select p.customer_id from public.profiles p where p.id = auth.uid() and p.approved
    union
    select pc.customer_id from public.profile_customers pc
      join public.profiles p on p.id = pc.profile_id
      where p.id = auth.uid() and p.approved);
$$;

-- Wrap each role check as (select fn()) so Postgres works it out once per request, not per row.
do $$
declare
  r record;
  fn text;
  q text;
  c text;
begin
  for r in select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := r.qual; c := r.with_check;
    foreach fn in array array['is_admin', 'is_manager', 'is_receiver', 'my_product_groups'] loop
      if q is not null and position(fn || '()' in q) > 0 and position('AS ' || fn in q) = 0 then
        q := replace(q, fn || '()', '(select public.' || fn || '())' || case when fn = 'my_product_groups' then '::text[]' else '' end);
      end if;
      if c is not null and position(fn || '()' in c) > 0 and position('AS ' || fn in c) = 0 then
        c := replace(c, fn || '()', '(select public.' || fn || '())' || case when fn = 'my_product_groups' then '::text[]' else '' end);
      end if;
    end loop;
    if q is distinct from r.qual then
      execute format('alter policy %I on public.%I using (%s)', r.policyname, r.tablename, q);
    end if;
    if c is distinct from r.with_check then
      execute format('alter policy %I on public.%I with check (%s)', r.policyname, r.tablename, c);
    end if;
  end loop;
end $$;

-- Lookups the checks and the app lean on.
create index if not exists profile_customers_customer_idx on public.profile_customers (customer_id);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists product_packs_product_idx on public.product_packs (product_id);
create index if not exists products_supplier_idx on public.products (supplier_id);

select 'OK: permission checks sped up' as result;
