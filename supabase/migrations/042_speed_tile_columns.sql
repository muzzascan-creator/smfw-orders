-- 042: Speed Screen columns. Tiles run top to bottom in 5 columns; each tile can be given its column (1-5), and
-- speed_tiles.sort is then its place within that column. Set in Administration › Speed Screen. Needs 041 first.
-- Safe to run more than once.
alter table public.speed_tiles add column if not exists col int check (col between 1 and 5);
notify pgrst, 'reload schema';
select 'OK: Speed Screen columns ready' as result;
