-- Customer emails about undelivered items: records when (and to whom) the customer was told,
-- or why the email couldn't be sent. Filled in by the notify-undelivered edge function.
-- Needs 013 first.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.orders add column if not exists customer_notified_at timestamptz;
alter table public.orders add column if not exists customer_notified_to text;
alter table public.orders add column if not exists notify_error text;

-- orders_guard again (as in 013), so the email function's own update doesn't count as a customer edit.
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then new.submitted_at := now(); end if;
  if new.status = 'complete' and (tg_op = 'INSERT' or old.status <> 'complete') then new.completed_at := now(); end if;
  -- auth.uid() is empty for trusted server-side updates (the email function, the SQL Editor); leave those alone.
  if auth.uid() is not null and not public.is_admin() and not public.is_manager() and not public.is_receiver() then
    new.source := 'customer';
    new.customer_id := public.my_customer_id();
    if tg_op = 'INSERT' then new.created_by := auth.uid(); else new.created_by := old.created_by; new.number := old.number; end if;
    if exists (select 1 from jsonb_array_elements(new.lines) l join public.products p on p.id::text = l->>'product_id'
               where p.product_group <> coalesce(public.my_product_group(), 'Organic')) then
      raise exception 'Your account orders % products only', coalesce(public.my_product_group(), 'Organic');
    end if;
  end if;
  return new;
end $$;
