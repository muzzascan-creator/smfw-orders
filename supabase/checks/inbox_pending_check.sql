-- Read-only: lists every order now waiting in the Inbox (status Sent), with signs that it was
-- transmitted before (emailed, received or given a CSV) and then put back, e.g. by "Reopen to edit".
-- Changes nothing. Paste into Supabase > SQL Editor and press Run.
select o.number as order_no,
       c.name as customer,
       o.required_date,
       o.source,
       o.submitted_at at time zone 'Australia/Sydney' as sent_sydney,
       o.updated_at   at time zone 'Australia/Sydney' as last_changed_sydney,
       o.emailed_at is not null  as was_emailed,
       o.received_at is not null as was_received,
       o.csv_at is not null      as had_csv,
       (o.emailed_at is not null or o.received_at is not null or o.csv_at is not null) as looks_transmitted_before
from public.orders o
left join public.customers c on c.id = o.customer_id
where o.status = 'submitted'
order by o.submitted_at;
