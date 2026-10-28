-- Read-only: how big the main lists are. Changes nothing.
select 'customers' as list, count(*) from public.customers
union all select 'products', count(*) from public.products
union all select 'pack types', count(*) from public.product_packs
union all select 'logins', count(*) from public.profiles
union all select 'orders', count(*) from public.orders
union all select 'orders in the last 7 days', count(*) from public.orders where created_at > now() - interval '7 days'
union all select 'database size (MB)', (pg_database_size(current_database()) / 1024 / 1024)::bigint;
