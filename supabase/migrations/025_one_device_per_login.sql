-- 025: One device per login. Signing in on a new device signs the login out on the device used before.
-- Each browser has its own device id; the latest one to sign in is the one that stays signed in.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.

create table if not exists public.login_devices (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  device_id text not null,
  claimed_at timestamptz not null default now()
);
alter table public.login_devices enable row level security;
drop policy if exists admin_read on public.login_devices;
create policy admin_read on public.login_devices for select using ((select public.is_admin()));

-- claim = true (just signed in on this device): this device becomes the login's device.
-- claim = false: is this still the login's device? (A login with no device yet takes this one.)
create or replace function public.check_device(device text, claim boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if auth.uid() is null or coalesce(device, '') = '' then return true; end if;
  select device_id into cur from public.login_devices where profile_id = auth.uid();
  if claim or cur is null then
    insert into public.login_devices (profile_id, device_id) values (auth.uid(), device)
      on conflict (profile_id) do update set device_id = excluded.device_id, claimed_at = now();
    return true;
  end if;
  return cur = device;
end $$;
revoke all on function public.check_device(text, boolean) from public, anon;
grant execute on function public.check_device(text, boolean) to authenticated;

select 'OK: one device per login is on' as result;
