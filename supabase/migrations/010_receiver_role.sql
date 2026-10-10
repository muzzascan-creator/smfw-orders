-- Receiver logins: staff who can see every order (read only) but change nothing.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','customer','receiver'));

create or replace function public.is_receiver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'receiver' and approved);
$$;

drop policy if exists receiver_read on public.suppliers;
create policy receiver_read on public.suppliers for select using (public.is_receiver());
drop policy if exists receiver_read on public.customers;
create policy receiver_read on public.customers for select using (public.is_receiver());
drop policy if exists receiver_read on public.products;
create policy receiver_read on public.products for select using (public.is_receiver());
drop policy if exists receiver_read on public.product_packs;
create policy receiver_read on public.product_packs for select using (public.is_receiver());
drop policy if exists receiver_read on public.orders;
create policy receiver_read on public.orders for select using (public.is_receiver());

-- orders_guard again (as in 006), now leaving a receiver's tick-off alone instead of treating it as a customer edit.
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then new.submitted_at := now(); end if;
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status <> 'complete') then new.completed_at := now(); end if;
  if not public.is_admin() and not public.is_receiver() then
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

-- Receivers tick orders off as received. They can't edit orders, so this function sets only these two fields.
alter table public.orders add column if not exists received_at timestamptz;
alter table public.orders add column if not exists received_by text;
create or replace function public.set_received(order_id uuid, received boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_receiver() or public.is_admin()) then raise exception 'Only receivers can mark orders received'; end if;
  update public.orders set received_at = case when received then now() end,
    received_by = case when received then (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()) end
  where id = order_id;
end $$;
grant execute on function public.set_received(uuid, boolean) to authenticated;
