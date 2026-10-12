-- Setup check, step 2 of 2. Run this a few seconds after step 1. Changes nothing.
select case
  when status_code = 200 then 'OK: the email function has the reminders version'
  when status_code = 401 then 'OLD VERSION: paste the new code into the email function and Deploy'
  when status_code = 404 then 'NOT FOUND: the email function is missing'
  else 'Problem: ' || coalesce(status_code::text, '') || ' ' || coalesce(left(content, 200), error_msg, '') end as email_function
from net._http_response order by id desc limit 1;
