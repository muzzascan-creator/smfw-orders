-- Read-only: the Conventional sections and pack types in use, with how many products each has. Changes nothing.
select p.section, pk.name as pack, count(*) as products
from public.products p join public.product_packs pk on pk.product_id = p.id
where p.product_group = 'Conventional' and p.active and pk.available
group by p.section, pk.name
order by p.section, pk.name;
