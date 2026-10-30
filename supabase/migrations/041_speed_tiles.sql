-- 041: Speed Screen tile settings. For each product pack shown on the Speed Screen: an alias (the name shown on
-- the tile instead of the product name), its place in the order, and a tile colour. Set in Administration ›
-- Speed Screen. Orders still record the real product name. Safe to run more than once.
create table if not exists public.speed_tiles (
  pack_id uuid primary key references public.product_packs(id) on delete cascade,
  alias text check (alias is null or char_length(alias) <= 40),
  sort int,
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz not null default now()
);
alter table public.speed_tiles enable row level security;
drop policy if exists speed_tiles_read on public.speed_tiles;
create policy speed_tiles_read on public.speed_tiles for select using ((select public.is_admin()) or (select public.is_manager()) or (select public.is_speed()));
drop policy if exists speed_tiles_write on public.speed_tiles;
create policy speed_tiles_write on public.speed_tiles for all using ((select public.is_admin()) or (select public.is_manager())) with check ((select public.is_admin()) or (select public.is_manager()));
grant select, insert, update, delete on public.speed_tiles to authenticated;
notify pgrst, 'reload schema';
select 'OK: Speed Screen tile settings ready' as result;
