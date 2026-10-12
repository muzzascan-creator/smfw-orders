-- Lets an Admin delete a login (Logins tab > Edit > Delete login). The person can no longer sign in;
-- their orders stay. You can't delete your own login or the last Admin.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run again.
create or replace function public.delete_login(user_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can delete logins'; end if;
  if user_id = auth.uid() then raise exception 'You can''t delete your own login'; end if;
  if exists (select 1 from public.profiles where id = user_id and role = 'admin')
     and (select count(*) from public.profiles where role = 'admin' and approved) <= 1 then
    raise exception 'You can''t delete the last Admin login';
  end if;
  -- Orders keep their details; they just no longer point at the deleted login.
  update public.orders set created_by = null where created_by = user_id;
  delete from auth.users where id = user_id; -- the profile row goes with it
end $$;
revoke all on function public.delete_login(uuid) from public;
grant execute on function public.delete_login(uuid) to authenticated;
