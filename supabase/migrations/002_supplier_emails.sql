-- Order emails: each supplier can have many outgoing addresses, each sent as To, CC or BCC and switched on or off.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.

create table if not exists public.supplier_emails (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  email text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  name text,
  send_as text not null default 'to' check (send_as in ('to','cc','bcc')),
  active boolean not null default true,
  sort integer not null default 0,
  unique (supplier_id, email)
);

alter table public.supplier_emails enable row level security;
drop policy if exists admin_all on public.supplier_emails;
create policy admin_all on public.supplier_emails for all using (public.is_admin()) with check (public.is_admin());

-- Bring across the addresses already saved on each supplier.
insert into public.supplier_emails (supplier_id, email, sort)
select s.id, lower(trim(e)), t.ord::int
from public.suppliers s, unnest(s.emails) with ordinality as t(e, ord)
where trim(e) <> ''
on conflict (supplier_id, email) do nothing;
