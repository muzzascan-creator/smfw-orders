-- Customers order Organic products only. Conventional products are ordered through the admin app.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again. Needs 004 first.

-- Customers can no longer see Conventional products or their packs.
drop policy if exists customer_read on public.products;
create policy customer_read on public.products for select
  using (active and product_group = 'Organic' and public.my_customer_id() is not null);
drop policy if exists customer_read on public.product_packs;
create policy customer_read on public.product_packs for select using (
  public.my_customer_id() is not null
  and exists (select 1 from public.products p where p.id = product_id and p.active and p.product_group = 'Organic'));

-- A customer's order is refused if it has any Conventional line.
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then new.submitted_at := now(); end if;
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status <> 'complete') then new.completed_at := now(); end if;
  if not public.is_admin() then
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
