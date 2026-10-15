-- 026: Order cut-off rules you can change in the app (Administration › Cut-offs), per product location.
-- For each delivery day: who it's delivered to (everyone, Sunday-delivery customers only, or nobody), and when
-- orders close (how many days before, and the time, Sydney). Starts with the rules used until now:
--   Organic: Tue-Fri deliveries close 7:30am the day before; Mon closes 7:30am Friday; Sun (Sunday-delivery
--   customers only) closes 7:30am Friday; no Saturday deliveries. Reminder emails 10 minutes before the cut-off.
--   Conventional: every day, no cut-off, no reminders.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again (it keeps changes made in the app).

create table if not exists public.cutoff_rules (
  product_group text not null check (product_group in ('Organic', 'Conventional')),
  dow int not null check (dow between 1 and 7),                -- delivery day: 1 = Monday ... 7 = Sunday
  delivers text not null default 'all' check (delivers in ('all', 'sunday', 'none')),  -- 'sunday' = Sunday-delivery customers only
  days_before int check (days_before between 0 and 6),          -- empty = no cut-off
  cutoff_time time,
  primary key (product_group, dow)
);
create table if not exists public.cutoff_settings (
  product_group text primary key check (product_group in ('Organic', 'Conventional')),
  reminder_minutes int check (reminder_minutes between 10 and 720)   -- empty = no reminder emails
);
alter table public.cutoff_rules enable row level security;
alter table public.cutoff_settings enable row level security;
drop policy if exists read_all on public.cutoff_rules;
create policy read_all on public.cutoff_rules for select to authenticated using (true);
drop policy if exists admin_all on public.cutoff_rules;
create policy admin_all on public.cutoff_rules for all using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists read_all on public.cutoff_settings;
create policy read_all on public.cutoff_settings for select to authenticated using (true);
drop policy if exists admin_all on public.cutoff_settings;
create policy admin_all on public.cutoff_settings for all using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.cutoff_rules (product_group, dow, delivers, days_before, cutoff_time) values
  ('Organic', 1, 'all', 3, '07:30'), ('Organic', 2, 'all', 1, '07:30'), ('Organic', 3, 'all', 1, '07:30'),
  ('Organic', 4, 'all', 1, '07:30'), ('Organic', 5, 'all', 1, '07:30'), ('Organic', 6, 'none', null, null),
  ('Organic', 7, 'sunday', 2, '07:30'),
  ('Conventional', 1, 'all', null, null), ('Conventional', 2, 'all', null, null), ('Conventional', 3, 'all', null, null),
  ('Conventional', 4, 'all', null, null), ('Conventional', 5, 'all', null, null), ('Conventional', 6, 'all', null, null),
  ('Conventional', 7, 'all', null, null)
  on conflict do nothing;
insert into public.cutoff_settings (product_group, reminder_minutes) values ('Organic', 10), ('Conventional', null)
  on conflict do nothing;

-- orders_guard as in 023, with the delivery day and cut-off now read from cutoff_rules for the order's location.
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text; sun boolean; cut timestamp; lg text[]; r public.cutoff_rules%rowtype;
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
    -- Sending an order: the delivery day must be one we deliver on for this location, and before its cut-off.
    if new.status = 'submitted' and (tg_op = 'INSERT' or old.status = 'draft') and new.required_date is not null then
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
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

-- Reminder emails now go a set number of minutes before each cut-off, so the reminder job checks every 10 minutes.
do $$ begin
  perform cron.alter_job(jobid, schedule := '*/10 * * * *') from cron.job where jobname = 'order-reminders';
exception when others then null; end $$;

select 'OK: cut-off rules can now be changed under Administration › Cut-offs' as result;
