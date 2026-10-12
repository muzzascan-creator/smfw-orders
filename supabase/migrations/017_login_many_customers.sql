-- One customer login can order for several customers (Logins > tick each customer it orders for).
-- The customer then picks which business an order is for. Needs 013 and 014 first.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
create table if not exists public.profile_customers (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  primary key (profile_id, customer_id)
);
alter table public.profile_customers enable row level security;
drop policy if exists admin_all on public.profile_customers;
create policy admin_all on public.profile_customers for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists read_own on public.profile_customers;
create policy read_own on public.profile_customers for select using (profile_id = auth.uid());

-- Every login's existing customer becomes its first linked customer.
insert into public.profile_customers (profile_id, customer_id)
select id, customer_id from public.profiles where customer_id is not null
on conflict do nothing;

-- True when the signed-in, approved login orders for customer c (its main customer or a linked one).
create or replace function public.is_my_customer(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c is not null and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.approved
      and (p.customer_id = c or exists (select 1 from public.profile_customers pc where pc.profile_id = p.id and pc.customer_id = c)));
$$;
-- The product groups (Organic / Conventional) of all the customers this login orders for.
create or replace function public.my_product_groups() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct c.product_group), '{}') from public.customers c where public.is_my_customer(c.id);
$$;

drop policy if exists customer_read on public.products;
create policy customer_read on public.products for select
  using (active and product_group = any (public.my_product_groups()));
drop policy if exists customer_read on public.product_packs;
create policy customer_read on public.product_packs for select using (
  exists (select 1 from public.products p where p.id = product_id and p.active and p.product_group = any (public.my_product_groups())));

drop policy if exists customer_read_own on public.customers;
create policy customer_read_own on public.customers for select using (public.is_my_customer(id));

drop policy if exists customer_select on public.orders;
create policy customer_select on public.orders for select using (public.is_my_customer(customer_id));
drop policy if exists customer_insert on public.orders;
create policy customer_insert on public.orders for insert
  with check (public.is_my_customer(customer_id) and status in ('draft','submitted'));
drop policy if exists customer_update on public.orders;
create policy customer_update on public.orders for update
  using (public.is_my_customer(customer_id) and status = 'draft')
  with check (public.is_my_customer(customer_id) and status in ('draft','submitted'));
drop policy if exists customer_delete on public.orders;
create policy customer_delete on public.orders for delete
  using (public.is_my_customer(customer_id) and status = 'draft');

-- orders_guard again (as in 014): a customer's order is for one of their customers, and only that customer's group of products.
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text;
begin
  new.updated_at := now();
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then new.submitted_at := now(); end if;
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status <> 'complete') then new.completed_at := now(); end if;
  -- auth.uid() is empty for trusted server-side updates (the email function, the SQL Editor); leave those alone.
  if auth.uid() is not null and not public.is_admin() and not public.is_manager() and not public.is_receiver() then
    new.source := 'customer';
    if tg_op = 'INSERT' then
      if not public.is_my_customer(new.customer_id) then new.customer_id := public.my_customer_id(); end if;
      new.created_by := auth.uid();
    else
      if not public.is_my_customer(new.customer_id) then new.customer_id := old.customer_id; end if;
      new.created_by := old.created_by; new.number := old.number;
    end if;
    select coalesce(product_group, 'Organic') into g from public.customers where id = new.customer_id;
    if exists (select 1 from jsonb_array_elements(new.lines) l join public.products p on p.id::text = l->>'product_id'
               where p.product_group <> coalesce(g, 'Organic')) then
      raise exception 'This customer orders % products only', coalesce(g, 'Organic');
    end if;
  end if;
  return new;
end $$;
