-- Adds Friday Organic deliveries: order by Thursday 7:30am. Needs 018 first.
-- Organic deliveries and their order cut-offs (Sydney time) are now:
--   Tuesday <- Monday 7:30am, Wednesday <- Tuesday, Thursday <- Wednesday, Friday <- Thursday,
--   Monday <- Friday 7:30am, Sunday <- Friday 7:30am (Sunday-delivery customers only, e.g. Harris Farm).
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
create or replace function public.organic_cutoff(d date, sunday_ok boolean) returns timestamp
language sql immutable as $$
  select case extract(isodow from d)::int
    when 2 then d - 1 when 3 then d - 1 when 4 then d - 1 when 5 then d - 1
    when 1 then d - 3
    when 7 then case when sunday_ok then d - 2 end
  end + time '07:30';
$$;

-- orders_guard again (as in 018), with the delivery-day message updated for Friday deliveries.
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text; sun boolean; cut timestamp;
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
    if exists (select 1 from jsonb_array_elements(new.lines) l join public.products p on p.id::text = l->>'product_id'
               where p.product_group <> coalesce(g, 'Organic')) then
      raise exception 'This customer orders % products only', coalesce(g, 'Organic');
    end if;
    -- Sending an Organic order: the delivery day must be one we deliver on, and before its 7:30am cut-off.
    if coalesce(g, 'Organic') = 'Organic' and new.status = 'submitted' and (tg_op = 'INSERT' or old.status = 'draft') then
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
