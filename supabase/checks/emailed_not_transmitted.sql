-- Read-only: every order marked Emailed or given a CSV while it was never transmitted (not Complete). Changes nothing.
select o.number as order_no, c.name as customer, o.status, o.source, o.required_date,
       o.emailed_at at time zone 'Australia/Sydney' as emailed, o.csv_at at time zone 'Australia/Sydney' as csv_created
from public.orders o left join public.customers c on c.id = o.customer_id
where o.status <> 'complete' and (o.emailed_at is not null or o.csv_at is not null)
order by o.emailed_at, o.number;
