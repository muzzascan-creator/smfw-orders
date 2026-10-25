-- Setup check, step 2 of 2. Run this a few seconds after step 1. Changes nothing.
select case
  when r.id is null then 'NO ANSWER YET: wait a few seconds and run this again'
  when r.status_code = 200 then 'OK: the email function is up to date'
  when r.status_code = 400 then 'OLD VERSION: paste the new code in the email function (quick-api) and Deploy'
  when r.status_code = 403 then 'KEY MISMATCH: the function and the database disagree on the private key (cron_key)'
  when r.status_code = 404 then 'NOT FOUND: the email function is missing'
  else 'Problem: ' || coalesce(r.status_code::text, '') || ' ' || coalesce(left(r.content, 200), r.error_msg, '') end as email_function
from (select value::bigint as id from public.app_settings where key = 'setup_check_id') s
left join net._http_response r on r.id = s.id;
