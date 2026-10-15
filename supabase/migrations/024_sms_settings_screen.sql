-- 024: SMS settings screen (Administration > SMS). Admins can view and change the SMS Broadcast
-- username, password, sender and the mobile number(s) texts go to.
-- The password is never sent back to the browser; the screen only shows whether one is saved.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.

create or replace function public.get_sms_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object(
    'username', (select value from public.app_settings where key = 'sms_username'),
    'sender',   (select value from public.app_settings where key = 'sms_from'),
    'mobile',   (select value from public.app_settings where key = 'sms_to'),
    'password_saved', exists (select 1 from public.app_settings where key = 'sms_password' and value <> '' and value not like 'YOUR %'));
end $$;

-- A blank password keeps the saved one.
create or replace function public.save_sms_settings(username text, password text, sender text, mobile text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  insert into public.app_settings (key, value) values
    ('sms_username', trim(coalesce(username, ''))), ('sms_from', trim(coalesce(sender, ''))), ('sms_to', trim(coalesce(mobile, '')))
    on conflict (key) do update set value = excluded.value;
  if coalesce(password, '') <> '' then
    insert into public.app_settings (key, value) values ('sms_password', password)
      on conflict (key) do update set value = excluded.value;
  end if;
end $$;

revoke all on function public.get_sms_settings(), public.save_sms_settings(text, text, text, text) from public, anon;
grant execute on function public.get_sms_settings(), public.save_sms_settings(text, text, text, text) to authenticated;

select 'OK: SMS settings screen ready' as result;
