-- 022: Text SMFW when a new login is waiting to be activated (via SMS Broadcast).
-- BEFORE RUNNING, change the three values in quotes just below:
--   your mobile (several can be separated by commas), and your SMS Broadcast username and password.
-- These are kept in a private settings table that only the server can read.
-- Safe to run more than once (it just updates the values).
insert into public.app_settings (key, value) values
  ('sms_to',       '04XX XXX XXX'),
  ('sms_username', 'YOUR SMS BROADCAST USERNAME'),
  ('sms_password', 'YOUR SMS BROADCAST PASSWORD'),
  ('sms_from',     'Coolibah')
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
