-- 043: an order can only be marked Emailed or given a CSV once it has been transmitted (status complete).
-- Stops a Sent order (still in the Inbox) or a draft being emailed to the supplier before anyone has checked it,
-- whichever screen or device tries it. Orders already marked are left alone. Safe to run more than once.
create or replace function public.orders_send_guard() returns trigger language plpgsql as $$
begin
  if new.status <> 'complete' and (
       (new.emailed_at is not null and (tg_op = 'INSERT' or old.emailed_at is null)) or
       (new.csv_at     is not null and (tg_op = 'INSERT' or old.csv_at     is null))) then
    raise exception 'Order SO-% hasn''t been transmitted yet. Transmit it first, then email it or create its CSV.', lpad(new.number::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists orders_send_guard on public.orders;
create trigger orders_send_guard before insert or update on public.orders
  for each row execute function public.orders_send_guard();
select 'OK: orders are emailed and given CSVs only once transmitted' as result;
