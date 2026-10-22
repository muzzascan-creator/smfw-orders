-- Shows the Section and group saved on the products seen on SMFW's New order form (Limes, juices), and every
-- section name in use, so the Vegetables & Drinks rule can be matched to the real name.
-- Read only. Run in Supabase: SQL Editor > New query > paste > Run.
select 'product' as what, p.code, p.name, coalesce(p.section, '(no section)') as section, p.product_group, s.name as supplier
  from public.products p left join public.suppliers s on s.id = p.supplier_id
 where p.code in ('9126', '9127', '9177', '9129', '9121', '7005', '7001', '7000')
union all
select 'section in use', null, count(*)::text || ' products', coalesce(p.section, '(no section)'), p.product_group, null
  from public.products p group by p.section, p.product_group
order by 1, 4, 2;
