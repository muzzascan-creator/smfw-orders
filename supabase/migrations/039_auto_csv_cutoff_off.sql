-- 039: Auto CSV (Orders tab) switches itself Off when each day's Conventional cut-off arrives (Administration › Cut-offs).
-- Checked every minute by Supabase Cron. It switches Off once per cut-off, so an Admin can switch it back On afterwards.
-- Safe to run more than once.
create or replace function public.auto_csv_cutoff() returns void
language plpgsql security definer set search_path = public as $$
declare syd timestamp := now() at time zone 'Australia/Sydney'; d date := syd::date; cut timestamp; done timestamp;
begin
  -- Today's Conventional cut-offs: the rule for the delivery day that is days_before days from today.
  select max(d + r.cutoff_time) into cut from public.cutoff_rules r
   where r.product_group = 'Conventional' and r.delivers <> 'none' and r.cutoff_time is not null and r.days_before is not null
     and r.dow = ((extract(isodow from d)::int - 1 + r.days_before) % 7) + 1
     and d + r.cutoff_time <= syd;
  if cut is null then return; end if;
  select value::timestamp into done from public.staff_settings where key = 'auto_csv_2_cutoff_done';
  if done is not null and done >= cut then return; end if;
  update public.staff_settings set value = 'off', updated_at = now() where key = 'auto_csv_2' and value = 'on';
  insert into public.staff_settings (key, value) values ('auto_csv_2_cutoff_done', cut::text)
    on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
revoke all on function public.auto_csv_cutoff() from public, anon, authenticated;

-- Start from now, so a cut-off that has already passed today doesn't switch it Off straight away.
insert into public.staff_settings (key, value) values ('auto_csv_2_cutoff_done', (now() at time zone 'Australia/Sydney')::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'auto-csv-cutoff';
select cron.schedule('auto-csv-cutoff', '* * * * *', 'select public.auto_csv_cutoff()');

select 'OK: Auto CSV switches Off at each Conventional cut-off' as result;
