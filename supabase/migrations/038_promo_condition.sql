-- 038: Condition 3 (Promo). Customer logins may read the one setting that lists the Stock Refs Promo customers
-- don't see (Administration › Settings). Every other setting stays Admin and Manager only. Safe to run more than once.
drop policy if exists promo_read on public.staff_settings;
create policy promo_read on public.staff_settings for select to authenticated using (key = 'promo_hide_refs');
insert into public.staff_settings (key, value) values ('promo_hide_refs', '1010, 1011') on conflict (key) do nothing;
notify pgrst, 'reload schema';
