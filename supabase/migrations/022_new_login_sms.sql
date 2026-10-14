-- 022: Text SMFW when a new login is waiting to be activated.
-- When someone signs up, the database asks quick-api to send an SMS (via ClickSend) to the number(s) below.
-- BEFORE RUNNING: replace 04XX XXX XXX with your mobile. Several numbers can be separated by commas.
-- Safe to run more than once (it just updates the number).
insert into public.app_settings (key, value) values ('sms_to', '04XX XXX XXX')
  on conflict (key) do update set value = excluded.value;

create or replace function public.sms_new_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.approved then
    -- A failed text must never stop someone signing up.
    begin
      perform net.http_post(
        url := 'https://ywiblqtasikiwfndwrrb.supabase.co/functions/v1/quick-api',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3aWJscXRhc2lraXdmbmR3cnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MTE5MTQsImV4cCI6MjEwNzA4NzkxNH0.YSOqvsm0gOOGQEnS_p1b0tWDr5kjHO8ItEm0UEOUYHs',
          'x-cron-key', (select value from public.app_settings where key = 'cron_key')),
        body := jsonb_build_object('action', 'new-login', 'id', new.id));
    exception when others then null;
    end;
  end if;
  return new;
end $$;

drop trigger if exists sms_new_login on public.profiles;
create trigger sms_new_login after insert on public.profiles
  for each row execute function public.sms_new_login();

select 'OK: new-login texts go to ' || value as result from public.app_settings where key = 'sms_to';
