-- 027: Tightening found in the code review. Needs 026 first.
-- * Customers can't send an order without a delivery date, for a past date or more than a year ahead,
--   and can't set the office's own stamps (emailed, CSV, received, special order...) on their orders.
-- * A new sign-up only becomes Admin on a brand-new system, and the last Admin can't be turned into something else.
-- * Reminder emails are logged per product location, so a Both customer can get an Organic and a Conventional reminder.
-- * Removes two old functions nothing uses any more.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.

-- ---------- orders_guard (as in 026, plus the checks above) ----------
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text; sun boolean; cut timestamp; lg text[]; r public.cutoff_rules%rowtype; syd date := (now() at time zone 'Australia/Sydney')::date;
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

-- ---------- Admin logins ----------
-- Only the very first sign-up on a brand-new system becomes Admin (before: whenever no Admin was left).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first boolean;
begin
  select not exists (select 1 from public.profiles) into first;
  insert into public.profiles (id, email, full_name, business, role, approved)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), new.raw_user_meta_data->>'business',
          case when first then 'admin' else 'customer' end, first);
  return new;
end $$;

-- The last approved Admin can't be changed to another role or blocked.
create or replace function public.keep_an_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.approved and (new.role <> 'admin' or not new.approved)
     and (select count(*) from public.profiles where role = 'admin' and approved and id <> old.id) = 0 then
    raise exception 'This is the last Admin login, so it must stay an active Admin.';
  end if;
  return new;
end $$;
drop trigger if exists keep_an_admin on public.profiles;
create trigger keep_an_admin before update on public.profiles for each row execute function public.keep_an_admin();

revoke all on function public.delete_login(uuid) from public, anon;
grant execute on function public.delete_login(uuid) to authenticated;

-- ---------- reminder emails per product location ----------
alter table public.reminder_log add column if not exists product_group text not null default 'Organic';
alter table public.reminder_log drop constraint if exists reminder_log_pkey;
alter table public.reminder_log add constraint reminder_log_pkey primary key (customer_id, delivery_date, product_group);

-- ---------- tidy up ----------
-- Replaced by cutoff_rules (026) and my_product_groups (017); skipped if anything still uses them.
do $$ begin drop function if exists public.organic_cutoff(date, boolean); exception when others then null; end $$;
do $$ begin drop function if exists public.my_product_group(); exception when others then null; end $$;

select 'OK: review fixes applied' as result;
