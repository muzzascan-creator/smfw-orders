-- One-off repair: customer orders that lost their customer when SMFW transmitted a Conventional order
-- (bug fixed in the app on 13 Oct 2026). Puts back the customer of the login that placed the order, but only where
-- that login orders for one customer; orders from logins with several customers are listed for a manual fix.
-- Paste into Supabase SQL Editor and press Run. Safe to run again. Shows the orders it fixed.
with fixed as (
  update public.orders o set customer_id = p.customer_id
  from public.profiles p
  where o.customer_id is null and o.source = 'customer' and o.created_by = p.id and p.customer_id is not null
    and not exists (select 1 from public.profile_customers pc where pc.profile_id = p.id and pc.customer_id <> p.customer_id)
  returning o.number, o.customer_id, o.csv_at
)
select 'SO-' || lpad(f.number::text, 4, '0') as order_no, c.name as customer,
       case when f.csv_at is not null then 'CSV already made with 1183: make it again' else 'Fixed' end as note
from fixed f join public.customers c on c.id = f.customer_id
union all
select 'SO-' || lpad(o.number::text, 4, '0'), p.email, 'Login orders for several customers: set the customer on this order by hand'
from public.orders o join public.profiles p on p.id = o.created_by
where o.customer_id is null and o.source = 'customer'
  and exists (select 1 from public.profile_customers pc where pc.profile_id = p.id and pc.customer_id <> p.customer_id)
order by 1;
