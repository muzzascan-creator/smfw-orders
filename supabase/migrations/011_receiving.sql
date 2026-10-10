-- Receiving: a Receiver opens an order, corrects quantities and flags lines that weren't delivered.
-- Each changed line keeps what was first ordered in ordered_qty; undelivered lines are marked "undelivered": true
-- and left out of the upload CSV. Needs 010 first.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
create or replace function public.save_receipt(order_id uuid, items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare cur jsonb; done timestamptz; l jsonb; it jsonb; result jsonb := '[]';
begin
  if not (public.is_receiver() or public.is_admin()) then raise exception 'Only receivers can record deliveries'; end if;
  select lines, received_at into cur, done from public.orders where id = order_id for update;
  if cur is null then raise exception 'Order not found'; end if;
  if done is not null then raise exception 'This order is already marked received'; end if;
  for l in select * from jsonb_array_elements(cur) loop
    select x into it from jsonb_array_elements(items) x where x->>'pack_id' = l->>'pack_id' limit 1;
    if it is not null then
      l := l || jsonb_build_object(
        'ordered_qty', coalesce(l->'ordered_qty', l->'qty'),
        'qty', greatest(0, coalesce((it->>'qty')::int, 0)),
        'undelivered', coalesce((it->>'undelivered')::boolean, false),
        'received', coalesce((it->>'received')::boolean, false) and not coalesce((it->>'undelivered')::boolean, false));
    end if;
    result := result || jsonb_build_array(l);
  end loop;
  update public.orders set lines = result where id = order_id;
end $$;
grant execute on function public.save_receipt(uuid, jsonb) to authenticated;
