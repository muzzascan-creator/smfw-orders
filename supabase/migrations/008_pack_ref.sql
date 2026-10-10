-- Ref: a reference for each pack type, shown next to its SID. Optional, but no two packs can share one
-- (compared ignoring upper/lower case and spaces at either end).
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.product_packs add column if not exists ref text;
create unique index if not exists product_packs_ref_key on public.product_packs (upper(btrim(ref))) where ref is not null and btrim(ref) <> '';
