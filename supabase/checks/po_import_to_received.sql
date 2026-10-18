-- One-off: move orders made by Import purchase order before 18 Oct 2026 (they went to the Inbox) to the Received tab,
-- so they follow the Received tab rules like new imports: no Receiver, no email, Condition 2 CSV saved by an open Admin PC.
-- Only Conventional orders still in the Inbox with a "PO ..." note are moved. Run once in Supabase SQL Editor.
update public.orders o set status = 'complete', direct = true, completed_at = now()
where o.special like 'PO %' and o.status = 'submitted' and o.source = 'admin' and not exists (
  select 1 from jsonb_array_elements(o.lines) l left join public.products p on p.id = (l->>'product_id')::uuid
  where coalesce(p.product_group, 'Organic') <> 'Conventional')
returning 'SO-' || lpad(o.number::text, greatest(4, length(o.number::text)), '0') as moved, o.special, (select name from public.customers c where c.id = o.customer_id) as customer;
