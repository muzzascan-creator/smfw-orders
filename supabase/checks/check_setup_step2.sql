-- Setup check, step 2 of 2. Run this a few seconds after step 1. Changes nothing.
select case
  when status_code = 200 and content like '%skipped%' then 'OK: quick-api has the reminders version'
  when status_code = 200 then 'OK: quick-api has the reminders version (it ran a reminder check)'
  when status_code = 401 then 'OLD VERSION: paste the new code into quick-api and Deploy'
  when status_code = 404 then 'NOT FOUND: quick-api function is missing'
  else 'Problem: ' || coalesce(status_code::text, '') || ' ' || coalesce(left(content, 200), error_msg, '') end as quick_api,
  created
from net._http_response order by created desc limit 1;
