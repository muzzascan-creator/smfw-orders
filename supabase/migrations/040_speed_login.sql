-- 040: Speed Screen logins. A login with the role "speed" can only use the Speed Screen (csorders.org/speed):
-- it sees customers and products, enters Conventional orders like the office does, and reads back only the
-- orders it entered. It can't open the Admin app. Set a login's role in Administration › Logins.
-- Safe to run more than once.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','manager','customer','receiver','speed'));

create or replace function public.is_speed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'speed' and approved);
$$;

drop policy if exists speed_read on public.customers;
create policy speed_read on public.customers for select using ((select public.is_speed()));
drop policy if exists speed_read on public.products;
create policy speed_read on public.products for select using ((select public.is_speed()));
drop policy if exists speed_read on public.product_packs;
create policy speed_read on public.product_packs for select using ((select public.is_speed()));
-- Orders: add new ones (as the office), and read back the ones this login entered.
drop policy if exists speed_insert on public.orders;
create policy speed_insert on public.orders for insert with check ((select public.is_speed()) and source = 'admin' and status in ('draft', 'complete') and created_by = auth.uid());
drop policy if exists speed_select on public.orders;
create policy speed_select on public.orders for select using ((select public.is_speed()) and created_by = auth.uid());

-- orders_guard (as in 027) and orders_route (as in 032), treating a Speed Screen order like the office's.
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text; sun boolean; cut timestamp; lg text[]; r public.cutoff_rules%rowtype; syd date := (now() at time zone 'Australia/Sydney')::date;
begin
  new.updated_at := now();
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then new.submitted_at := now(); end if;
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status <> 'complete') then new.completed_at := now(); end if;
  -- auth.uid() is empty for trusted server-side updates (the email function, the SQL Editor); leave those alone.
  if auth.uid() is not null and not public.is_admin() and not public.is_manager() and not public.is_receiver() and not public.is_speed() then
    new.source := 'customer';
    if tg_op = 'INSERT' then
      if not public.is_my_customer(new.customer_id) then new.customer_id := public.my_customer_id(); end if;
      new.created_by := auth.uid();
      -- The office's own stamps start empty on a customer's order.
      new.emailed_at := null; new.csv_at := null; new.received_at := null; new.received_by := null; new.completed_at := null;
      new.customer_notified_at := null; new.customer_notified_to := null; new.notify_error := null; new.special_order := false;
    else
      if not public.is_my_customer(new.customer_id) then new.customer_id := old.customer_id; end if;
      new.created_by := old.created_by; new.number := old.number;
      new.emailed_at := old.emailed_at; new.csv_at := old.csv_at; new.received_at := old.received_at; new.received_by := old.received_by;
      new.completed_at := old.completed_at; new.customer_notified_at := old.customer_notified_at;
      new.customer_notified_to := old.customer_notified_to; new.notify_error := old.notify_error; new.special_order := old.special_order;
    end if;
    select coalesce(product_group, 'Organic'), sunday_delivery into g, sun from public.customers where id = new.customer_id;
    g := coalesce(g, 'Organic');
    select coalesce(array_agg(distinct p.product_group), '{}') into lg
      from jsonb_array_elements(new.lines) l join public.products p on p.id::text = l->>'product_id';
    if g = 'Both' then
      if cardinality(lg) > 1 then
        raise exception 'One order is for one product location only. Please put Organic and Conventional products on separate orders.';
      end if;
      g := coalesce(lg[1], 'Organic');
    elsif exists (select 1 from unnest(lg) x where x <> g) then
      raise exception 'This customer orders % products only', g;
    end if;
    -- Sending an order: a delivery date from today to a year ahead, on a day we deliver, before its cut-off.
    if new.status = 'submitted' and (tg_op = 'INSERT' or old.status = 'draft') then
      if new.required_date is null then raise exception 'Add the day/date required first.'; end if;
      if new.required_date < syd or new.required_date > syd + 366 then
        raise exception 'The date required must be between today and a year ahead.';
      end if;
      select * into r from public.cutoff_rules where product_group = g and dow = extract(isodow from new.required_date)::int;
      if found then
        if r.delivers = 'none' or (r.delivers = 'sunday' and not coalesce(sun, false)) then
          raise exception 'We don''t deliver % orders on %s. Please choose another day, or call us on 0417 375 591.', g, to_char(new.required_date, 'FMDay');
        end if;
        if r.days_before is not null then
          cut := (new.required_date - r.days_before) + coalesce(r.cutoff_time, time '00:00');
          if (now() at time zone 'Australia/Sydney') >= cut then
            raise exception 'Orders for % delivery closed at % on %. Please choose a later delivery day, or call us on 0417 375 591.',
              to_char(new.required_date, 'FMDay DD Mon'), lower(to_char(cut, 'FMHH12:MIAM')), to_char(cut, 'FMDay DD Mon');
          end if;
        elsif new.required_date = syd then
          raise exception 'Orders for today can only be taken where a same-day cut-off is set. Please choose tomorrow or later.';
        end if;
      elsif new.required_date = syd then
        raise exception 'Please choose tomorrow or later for the date required.';
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.orders_route() returns trigger
language plpgsql security definer set search_path = public as $$
declare lg text[];
begin
  if auth.uid() is null or public.is_admin() or public.is_manager() or public.is_receiver() or public.is_speed() then return new; end if;
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

notify pgrst, 'reload schema';
select 'OK: Speed Screen logins ready' as result;
