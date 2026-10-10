-- SMFW Order Manager: database, logins and access rules.
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.

create extension if not exists pgcrypto;

-- ---------- reference data ----------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emails text[] not null default '{}',
  cutoff text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  cid integer not null unique check (cid > 0),
  name text not null,
  contact text,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  code text,
  name text not null,
  section text,
  sort integer not null default 999,
  active boolean not null default true,
  product_group text not null default 'Organic' check (product_group in ('Organic','Conventional')),
  created_at timestamptz not null default now()
);

-- Each pack type of a product: its own unique SID, outer multiple and availability.
create table public.product_packs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  sid integer not null unique check (sid > 0),
  ref text, -- optional reference shown next to the SID; unique when filled in (index below)
  outer_multiple integer not null default 1 check (outer_multiple >= 1),
  available boolean not null default true,
  sort integer not null default 0,
  unique (product_id, name)
);
create unique index product_packs_ref_key on public.product_packs (upper(btrim(ref))) where ref is not null and btrim(ref) <> '';

-- ---------- logins ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  business text,
  role text not null default 'customer' check (role in ('admin','customer')),
  customer_id uuid references public.customers(id) on delete set null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- New sign-ups get a profile. The very first account becomes the admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first boolean;
begin
  select not exists (select 1 from public.profiles where role = 'admin') into first;
  insert into public.profiles (id, email, full_name, business, role, approved)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), new.raw_user_meta_data->>'business',
          case when first then 'admin' else 'customer' end, first);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and approved);
$$;

create or replace function public.my_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select customer_id from public.profiles where id = auth.uid() and approved;
$$;

-- ---------- orders ----------
create sequence public.order_number_seq;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique default nextval('public.order_number_seq'),
  customer_id uuid references public.customers(id) on delete restrict, -- empty on Conventional orders SMFW enters for itself
  order_date date not null default current_date,
  required_date date,
  special text,
  status text not null default 'draft' check (status in ('draft','submitted','complete')),
  source text not null default 'admin' check (source in ('admin','customer')),
  -- [{pack_id, product_id, sid, code, product_name, pack_name, outer, qty}]
  lines jsonb not null default '[]',
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  emailed_at timestamptz,
  csv_at timestamptz
);
alter sequence public.order_number_seq owned by public.orders.number;

-- Stamp times and stop customers changing fields they don't own.
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then new.submitted_at := now(); end if;
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status <> 'complete') then new.completed_at := now(); end if;
  if not public.is_admin() then
    new.source := 'customer';
    new.customer_id := public.my_customer_id();
    if tg_op = 'INSERT' then new.created_by := auth.uid(); else new.created_by := old.created_by; new.number := old.number; end if;
    -- Customers order Organic only; Conventional is ordered through the admin app.
    if exists (select 1 from jsonb_array_elements(new.lines) l join public.products p on p.id::text = l->>'product_id'
               where p.product_group <> 'Organic') then
      raise exception 'Conventional products can only be ordered by SMFW';
    end if;
  end if;
  return new;
end $$;

create trigger orders_guard before insert or update on public.orders
  for each row execute function public.orders_guard();

-- ---------- access rules ----------
alter table public.suppliers enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.product_packs enable row level security;
alter table public.profiles enable row level security;
alter table public.orders enable row level security;

-- Admins can do everything.
create policy admin_all on public.suppliers for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.customers for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.products for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.product_packs for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.orders for all using (public.is_admin()) with check (public.is_admin());

-- Approved customers see the active Organic product list, but not suppliers. Conventional is admin only.
create policy customer_read on public.products for select using (active and product_group = 'Organic' and public.my_customer_id() is not null);
create policy customer_read on public.product_packs for select using (
  public.my_customer_id() is not null
  and exists (select 1 from public.products p where p.id = product_id and p.active and p.product_group = 'Organic'));

-- Customers see their own business record and their own login.
create policy customer_read_own on public.customers for select using (id = public.my_customer_id());
create policy read_own on public.profiles for select using (id = auth.uid());

-- Customers see their own orders, create drafts or send them, and edit or delete only while still a draft.
create policy customer_select on public.orders for select using (customer_id = public.my_customer_id());
create policy customer_insert on public.orders for insert
  with check (public.my_customer_id() is not null and status in ('draft','submitted'));
create policy customer_update on public.orders for update
  using (customer_id = public.my_customer_id() and status = 'draft')
  with check (customer_id = public.my_customer_id() and status in ('draft','submitted'));
create policy customer_delete on public.orders for delete
  using (customer_id = public.my_customer_id() and status = 'draft');

-- ---------- order emails (also in migrations/002_supplier_emails.sql) ----------

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

-- Live updates for the admin inbox.
alter publication supabase_realtime add table public.orders;
