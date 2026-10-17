-- 032: Conventional orders sent from a customer login skip the Inbox. They are accepted straight away (the
-- customer sees "Accepted"), listed on the Admin Received tab, kept off the Receiver tablet, and their CSV is
-- saved automatically using Condition 2 in Administration > Settings.
-- Applies to orders where every product is Conventional and it isn't a Special Order. Mixed orders go
-- through the Inbox as before.
-- Needs 031 first. Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.orders add column if not exists direct boolean not null default false;

-- Runs after orders_guard (triggers run in name order), so the guard's checks and stamps come first.
create or replace function public.orders_route() returns trigger
language plpgsql security definer set search_path = public as $$
declare lg text[];
begin
  if auth.uid() is null or public.is_admin() or public.is_manager() or public.is_receiver() then return new; end if;
  new.direct := case when tg_op = 'INSERT' then false else old.direct end; -- customers can't set it themselves
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status = 'draft') and new.customer_id is not null
     and not coalesce(new.special_order, false) then
    select coalesce(array_agg(distinct coalesce(p.product_group, 'Organic')), '{}') into lg
      from jsonb_array_elements(new.lines) l join public.products p on p.id::text = l->>'product_id';
    if lg = array['Conventional'] then
      new.status := 'complete'; new.completed_at := now(); new.direct := true;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_route on public.orders;
create trigger orders_route before insert or update on public.orders for each row execute function public.orders_route();

-- Customers may send (insert/update to) an order that the trigger above has just accepted as direct.
drop policy if exists customer_insert on public.orders;
create policy customer_insert on public.orders for insert
  with check (public.is_my_customer(customer_id) and (status in ('draft','submitted') or (status = 'complete' and direct)));
drop policy if exists customer_update on public.orders;
create policy customer_update on public.orders for update
  using (public.is_my_customer(customer_id) and status = 'draft')
  with check (public.is_my_customer(customer_id) and (status in ('draft','submitted') or (status = 'complete' and direct)));

select 'OK: Conventional customer orders go straight to Received' as result;
