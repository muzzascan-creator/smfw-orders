-- Sends one test text to the sms_to number(s). Then check your phone.
select net.http_post(
  url := 'https://ywiblqtasikiwfndwrrb.supabase.co/functions/v1/quick-api',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3aWJscXRhc2lraXdmbmR3cnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MTE5MTQsImV4cCI6MjEwNzA4NzkxNH0.YSOqvsm0gOOGQEnS_p1b0tWDr5kjHO8ItEm0UEOUYHs',
    'x-cron-key', (select value from public.app_settings where key = 'cron_key')),
  body := '{"action":"test-sms"}'::jsonb) as request_id;

-- A few seconds later, run this on its own to see the answer (200 and "sent":true means it went):
-- select status_code, content from net._http_response order by id desc limit 1;
