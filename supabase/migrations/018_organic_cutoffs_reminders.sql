-- Organic order times and 7:20am reminder emails. Needs 017 first.
-- Organic deliveries and their order cut-offs (Sydney time):
--   Tuesday   <- order by Monday 7:30am
--   Wednesday <- order by Tuesday 7:30am
--   Thursday  <- order by Wednesday 7:30am
--   Sunday    <- order by Friday 7:30am (only customers ticked "Sunday delivery", e.g. Harris Farm)
--   Monday    <- order by Friday 7:30am
-- At 7:20am on each order day, Organic customers with no order sent for that delivery get a reminder email.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.

alter table public.customers add column if not exists sunday_delivery boolean not null default false;
alter table public.customers add column if not exists reminders boolean not null default true;
-- Harris Farm is the one customer with Sunday deliveries (tick or untick it under Customers).
update public.customers set sunday_delivery = true where name ilike '%harris%farm%' and not sunday_delivery;

-- When an Organic order for delivery day d has to be sent by (Sydney local time); null when d isn't a delivery day.
create or replace function public.organic_cutoff(d date, sunday_ok boolean) returns timestamp
language sql immutable as $$
  select case extract(isodow from d)::int
    when 2 then d - 1 when 3 then d - 1 when 4 then d - 1
    when 1 then d - 3
    when 7 then case when sunday_ok then d - 2 end
  end + time '07:30';
$$;

-- One row per reminder sent, so nobody is reminded twice about the same delivery.
create table if not exists public.reminder_log (
  customer_id uuid not null references public.customers(id) on delete cascade,
  delivery_date date not null,
  sent_at timestamptz not null default now(),
  sent_to text,
  error text,
  primary key (customer_id, delivery_date)
);
alter table public.reminder_log enable row level security;
drop policy if exists admin_read on public.reminder_log;
create policy admin_read on public.reminder_log for select using (public.is_admin() or public.is_manager());

-- A private key the scheduled job uses to call the email function. No policies: only the server can read it.
create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values ('cron_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- orders_guard again (as in 017), now also holding customers to the Organic order times when they send an order.
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
      if cut is null then raise exception 'Organic deliveries are Monday, Tuesday, Wednesday and Thursday%. Please choose one of those days.', case when sun then ' and Sunday' else '' end; end if;
      if (now() at time zone 'Australia/Sydney') >= cut then
        raise exception 'Orders for % delivery closed at 7:30am on %. Please choose a later delivery day, or call us on 0417 375 591.',
          to_char(new.required_date, 'FMDay DD Mon'), to_char(cut, 'FMDay DD Mon');
      end if;
    end if;
  end if;
  return new;
end $$;

-- ---------- the 7:20am schedule (Supabase Cron) ----------
-- Runs at 20:20 and 21:20 UTC every day, which is 7:20am in Sydney in summer and in winter.
-- The email function itself checks the Sydney time and day, and does nothing at the run that isn't 7:20am.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'order-reminders';
select cron.schedule('order-reminders', '20 20,21 * * *', $job$
  select net.http_post(
    url := 'https://ywiblqtasikiwfndwrrb.supabase.co/functions/v1/quick-api',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3aWJscXRhc2lraXdmbmR3cnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MTE5MTQsImV4cCI6MjEwNzA4NzkxNH0.YSOqvsm0gOOGQEnS_p1b0tWDr5kjHO8ItEm0UEOUYHs',
      'x-cron-key', (select value from public.app_settings where key = 'cron_key')),
    body := '{"action":"reminders"}'::jsonb);
$job$);
