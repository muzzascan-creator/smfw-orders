-- 029: Favourite orders. A customer saves an order's products and quantities under a name (e.g. "Monday order")
-- and starts a new order from it later. Kept per business, so every login for that business sees them.
-- Needs 028 first. Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
create table if not exists public.favourites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  product_group text not null default 'Organic' check (product_group in ('Organic', 'Conventional')),
  lines jsonb not null default '[]'::jsonb,   -- [{ "pack_id": "...", "qty": 2 }, ...]
  updated_at timestamptz not null default now(),
  unique (customer_id, name)
);
alter table public.favourites enable row level security;

drop policy if exists staff_all on public.favourites;
create policy staff_all on public.favourites for all
  using (public.is_admin() or public.is_manager()) with check (public.is_admin() or public.is_manager());
drop policy if exists customer_own on public.favourites;
create policy customer_own on public.favourites for all
  using (public.is_my_customer(customer_id)) with check (public.is_my_customer(customer_id));

grant select, insert, update, delete on public.favourites to authenticated;

select 'OK: favourites ready' as result;
