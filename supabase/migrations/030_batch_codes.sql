-- 030: Batch codes. A pack type can be marked "Batch Code" in Products. When a Receiver ticks such a line Received
-- on a Conventional order with No customer, they must enter its batch code. Codes are kept in batch_codes for the
-- admin Batch Code tab, and on the order line itself.
-- Needs 029 first. Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.product_packs add column if not exists batch_code boolean not null default false;

create table if not exists public.batch_codes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  pack_id uuid not null,
  product_name text,
  pack_name text,
  qty int,
  code text not null,
  entered_at timestamptz not null default now(),
  entered_by text,
  unique (order_id, pack_id)
);
alter table public.batch_codes enable row level security;
drop policy if exists staff_read on public.batch_codes;
create policy staff_read on public.batch_codes for select using (public.is_admin() or public.is_manager() or public.is_receiver());
grant select on public.batch_codes to authenticated;

-- Does this order need batch codes? Only Conventional orders (every product Conventional) with no customer.
create or replace function public.needs_batch(o public.orders) returns boolean
language sql stable security definer set search_path = public as $$
  select o.customer_id is null and jsonb_array_length(coalesce(o.lines, '[]')) > 0 and not exists (
    select 1 from jsonb_array_elements(o.lines) l left join public.products p on p.id = (l->>'product_id')::uuid
    where coalesce(p.product_group, 'Organic') <> 'Conventional')
$$;

create or replace function public.save_receipt(order_id uuid, items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; l jsonb; it jsonb; result jsonb := '[]'; need boolean; flagged boolean; got boolean; code text; who text;
begin
  if not (public.is_receiver() or public.is_admin()) then raise exception 'Only receivers can record deliveries'; end if;
  select * into o from public.orders where id = order_id for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.received_at is not null then raise exception 'This order is already marked received'; end if;
  need := public.needs_batch(o);
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = auth.uid();
  for l in select * from jsonb_array_elements(o.lines) loop
    select x into it from jsonb_array_elements(items) x where x->>'pack_id' = l->>'pack_id' limit 1;
    if it is not null then
      got := coalesce((it->>'received')::boolean, false) and not coalesce((it->>'undelivered')::boolean, false);
      code := nullif(trim(coalesce(it->>'batch', '')), '');
      select coalesce(k.batch_code, false) into flagged from public.product_packs k where k.id = (l->>'pack_id')::uuid;
      if need and coalesce(flagged, false) and got then
        if code is null then raise exception 'Enter the batch code for %', coalesce(l->>'product_name', 'every ticked line'); end if;
        insert into public.batch_codes (order_id, pack_id, product_name, pack_name, qty, code, entered_by)
        values (order_id, (l->>'pack_id')::uuid, l->>'product_name', l->>'pack_name', greatest(0, coalesce((it->>'qty')::int, 0)), code, who)
        on conflict on constraint batch_codes_order_id_pack_id_key do update set
          code = excluded.code, qty = excluded.qty, entered_by = excluded.entered_by,
          entered_at = case when batch_codes.code is distinct from excluded.code then now() else batch_codes.entered_at end;
      else
        code := null;
        delete from public.batch_codes b where b.order_id = save_receipt.order_id and b.pack_id = (l->>'pack_id')::uuid;
      end if;
      l := (l - 'batch_code') || jsonb_build_object(
        'ordered_qty', coalesce(l->'ordered_qty', l->'qty'),
        'qty', greatest(0, coalesce((it->>'qty')::int, 0)),
        'undelivered', coalesce((it->>'undelivered')::boolean, false),
        'received', got) || case when code is null then '{}'::jsonb else jsonb_build_object('batch_code', code) end;
    end if;
    result := result || jsonb_build_array(l);
  end loop;
  update public.orders set lines = result where id = order_id;
end $$;
grant execute on function public.save_receipt(uuid, jsonb) to authenticated;

-- Marking received also checks no batch code is missing (e.g. a pack was marked Batch Code after the lines were saved).
create or replace function public.set_received(order_id uuid, received boolean) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; missing text;
begin
  if not (public.is_receiver() or public.is_admin()) then raise exception 'Only receivers can mark orders received'; end if;
  select * into o from public.orders where id = order_id;
  if received and o.id is not null and public.needs_batch(o) then
    select l->>'product_name' into missing from jsonb_array_elements(o.lines) l join public.product_packs k on k.id = (l->>'pack_id')::uuid
    where k.batch_code and coalesce((l->>'received')::boolean, false) and nullif(trim(coalesce(l->>'batch_code', '')), '') is null limit 1;
    if missing is not null then raise exception 'Open the order and enter the batch code for %, then Save', missing; end if;
  end if;
  update public.orders set received_at = case when received then now() end,
    received_by = case when received then (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()) end
  where id = order_id;
end $$;
grant execute on function public.set_received(uuid, boolean) to authenticated;

select 'OK: batch codes ready' as result;
