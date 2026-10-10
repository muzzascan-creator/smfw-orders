-- Each customer orders either Organic or Conventional products (set on the customer in Customers).
-- Customer logins see and order only their own group's products. Needs 004, 010 and 012 first.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.customers add column if not exists product_group text not null default 'Organic';
alter table public.customers drop constraint if exists customers_product_group_check;
alter table public.customers add constraint customers_product_group_check check (product_group in ('Organic','Conventional'));

create or replace function public.my_product_group() returns text
language sql stable security definer set search_path = public as $$
  select c.product_group from public.profiles p join public.customers c on c.id = p.customer_id where p.id = auth.uid() and p.approved;
$$;

-- Customers see the active products (and packs) of their own group only.
drop policy if exists customer_read on public.products;
create policy customer_read on public.products for select
  using (active and product_group = public.my_product_group());
drop policy if exists customer_read on public.product_packs;
create policy customer_read on public.product_packs for select using (
  exists (select 1 from public.products p where p.id = product_id and p.active and p.product_group = public.my_product_group()));

-- orders_guard again (as in 012): a customer's order may only hold products from the customer's group.
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then new.submitted_at := now(); end if;
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status <> 'complete') then new.completed_at := now(); end if;
  if not public.is_admin() and not public.is_manager() and not public.is_receiver() then
    new.source := 'customer';
    new.customer_id := public.my_customer_id();
    if tg_op = 'INSERT' then new.created_by := auth.uid(); else new.created_by := old.created_by; new.number := old.number; end if;
    if exists (select 1 from jsonb_array_elements(new.lines) l join public.products p on p.id::text = l->>'product_id'
               where p.product_group <> coalesce(public.my_product_group(), 'Organic')) then
      raise exception 'Your account orders % products only', coalesce(public.my_product_group(), 'Organic');
    end if;
  end if;
  return new;
end $$;
