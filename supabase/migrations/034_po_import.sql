-- 034: Import purchase order (Inbox). A buyer's PDF purchase order lists several stores side by side. The app splits it
-- into one order per store; these tables remember which customer each store column is and which product/pack each of
-- the buyer's product descriptions is, so they only need matching once.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
create table if not exists public.po_stores (
  label text primary key,                 -- the store column heading on the PO, lower case (e.g. "2784", "oatley cptf")
  customer_id uuid references public.customers(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create table if not exists public.po_items (
  description text primary key,           -- the buyer's product description, lower case
  pack_id uuid references public.product_packs(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.po_stores enable row level security;
alter table public.po_items enable row level security;
drop policy if exists staff_all on public.po_stores;
drop policy if exists staff_all on public.po_items;
create policy staff_all on public.po_stores for all using (public.is_admin() or public.is_manager()) with check (public.is_admin() or public.is_manager());
create policy staff_all on public.po_items for all using (public.is_admin() or public.is_manager()) with check (public.is_admin() or public.is_manager());
grant select, insert, update, delete on public.po_stores, public.po_items to authenticated;
select 'OK: purchase order import ready' as result;
