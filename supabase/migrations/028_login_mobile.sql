-- 028: New customers give a mobile number when they create an account, and get a text when their login is approved.
-- Needs 027 first. Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
alter table public.profiles add column if not exists mobile text;

-- A new sign-up copies its name, business and mobile from the sign-up form.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first boolean;
begin
  select not exists (select 1 from public.profiles) into first;
  insert into public.profiles (id, email, full_name, business, mobile, role, approved)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), new.raw_user_meta_data->>'business',
          nullif(trim(new.raw_user_meta_data->>'mobile'), ''),
          case when first then 'admin' else 'customer' end, first);
  return new;
end $$;

select 'OK: logins now have a mobile number' as result;
