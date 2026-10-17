-- 031: Settings shared by every staff login, e.g. the CSV folder an Admin chose in Administration > Settings.
-- Admin and Manager can read them; only Admin can change them. (Kept apart from app_settings, which holds
-- server-only keys nobody signed in may read.)
-- Needs 030 first. Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
create table if not exists public.staff_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.staff_settings enable row level security;
drop policy if exists staff_read on public.staff_settings;
create policy staff_read on public.staff_settings for select using (public.is_admin() or public.is_manager());
drop policy if exists admin_write on public.staff_settings;
create policy admin_write on public.staff_settings for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.staff_settings to authenticated;

select 'OK: settings ready' as result;
