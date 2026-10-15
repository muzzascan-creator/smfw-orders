-- 023: A customer can order from Both product locations (Organic and Conventional).
-- Each order is still for one location only: an order can't mix Organic and Conventional products.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.

alter table public.customers drop constraint if exists customers_product_group_check;
alter table public.customers add constraint customers_product_group_check check (product_group in ('Organic','Conventional','Both'));

-- Product groups a login can see: 'Both' means Organic and Conventional.
create or replace function public.my_product_groups() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct g), '{}')
  from public.customers c
  cross join lateral unnest(case when c.product_group = 'Both' then array['Organic','Conventional'] else array[c.product_group] end) g
  where c.id in (
    select p.customer_id from public.profiles p where p.id = auth.uid() and p.approved
    union
    select pc.customer_id from public.profile_customers pc
      join public.profiles p on p.id = pc.profile_id
      where p.id = auth.uid() and p.approved);
$$;

-- orders_guard as in 019, plus: a Both customer's order must be all Organic or all Conventional.
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text; sun boolean; cut timestamp; lg text[];
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
    -- Sending an Organic order: the delivery day must be one we deliver on, and before its 7:30am cut-off.
    if g = 'Organic' and new.status = 'submitted' and (tg_op = 'INSERT' or old.status = 'draft') then
      cut := public.organic_cutoff(new.required_date, coalesce(sun, false));
      if cut is null then raise exception 'Organic deliveries are Monday to Friday%. Please choose one of those days.', case when sun then ' and Sunday' else '' end; end if;
      if (now() at time zone 'Australia/Sydney') >= cut then
        raise exception 'Orders for % delivery closed at 7:30am on %. Please choose a later delivery day, or call us on 0417 375 591.',
          to_char(new.required_date, 'FMDay DD Mon'), to_char(cut, 'FMDay DD Mon');
      end if;
    end if;
  end if;
  return new;
end $$;

select 'OK: customers can now order from Both locations' as result;
