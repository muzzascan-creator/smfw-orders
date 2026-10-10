-- Manager logins: run the business like an Admin (Inbox, Orders, New order, Customers, Products)
-- but can't change Suppliers, order Emails or Logins. Needs 010 first.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','manager','customer','receiver'));

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager' and approved);
$$;

-- Full access to orders, customers and products.
drop policy if exists manager_all on public.orders;
create policy manager_all on public.orders for all using (public.is_manager()) with check (public.is_manager());
drop policy if exists manager_all on public.customers;
create policy manager_all on public.customers for all using (public.is_manager()) with check (public.is_manager());
drop policy if exists manager_all on public.products;
create policy manager_all on public.products for all using (public.is_manager()) with check (public.is_manager());
drop policy if exists manager_all on public.product_packs;
create policy manager_all on public.product_packs for all using (public.is_manager()) with check (public.is_manager());

-- Read only: suppliers and their order addresses, so managers can email orders out. No access to other logins.
drop policy if exists manager_read on public.suppliers;
create policy manager_read on public.suppliers for select using (public.is_manager());
drop policy if exists manager_read on public.supplier_emails;
create policy manager_read on public.supplier_emails for select using (public.is_manager());

-- orders_guard again (as in 010), treating a manager's order like an admin's.
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
               where p.product_group <> 'Organic') then
      raise exception 'Conventional products can only be ordered by SMFW';
    end if;
  end if;
  return new;
end $$;
