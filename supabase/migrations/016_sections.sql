-- Product sections (the headings on the order forms) as their own list, so Admins and Managers can
-- add new sections and rename them under Products > Sections. Starts with the sections already in use.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
create table if not exists public.product_sections (
  name text primary key check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);
alter table public.product_sections enable row level security;
drop policy if exists admin_all on public.product_sections;
create policy admin_all on public.product_sections for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists manager_all on public.product_sections;
create policy manager_all on public.product_sections for all using (public.is_manager()) with check (public.is_manager());

insert into public.product_sections (name)
select distinct trim(section) from public.products where coalesce(trim(section), '') <> ''
on conflict (name) do nothing;
