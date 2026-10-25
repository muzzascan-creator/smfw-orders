-- Read-only check: how many products and pack types there are, the highest SID,
-- any SIDs left on a temporary value, and the 10 highest SIDs with their products.
select 'products' as what, count(*)::text as value from public.products
union all select 'pack types', count(*)::text from public.product_packs
union all select 'highest SID', max(sid)::text from public.product_packs where sid < 1000000000
union all select 'SIDs stuck on a temporary value', count(*)::text from public.product_packs where sid >= 1000000000;

select pk.sid, p.name as product, pk.name as pack
from public.product_packs pk join public.products p on p.id = pk.product_id
order by pk.sid desc limit 10;
