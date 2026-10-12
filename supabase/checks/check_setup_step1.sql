-- Setup check, step 1 of 2. Paste into Supabase SQL Editor and press Run. Changes nothing.
-- Shows which database updates have been run, and asks the email function (quick-api) which version it is.
-- Don't run it between 7:10 and 7:30am on Mon, Tue, Wed or Fri: that is when the function sends the real reminders.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_net') and to_regclass('public.app_settings') is not null then
    execute $q$ select net.http_post(
      url := 'https://ywiblqtasikiwfndwrrb.supabase.co/functions/v1/quick-api',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3aWJscXRhc2lraXdmbmR3cnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MTE5MTQsImV4cCI6MjEwNzA4NzkxNH0.YSOqvsm0gOOGQEnS_p1b0tWDr5kjHO8ItEm0UEOUYHs',
        'x-cron-key', (select value from public.app_settings where key = 'cron_key')),
      body := '{"action":"reminders"}'::jsonb) $q$;
  end if;
end $$;
select item, case when ok then 'OK' else 'NOT DONE' end as status from (values
  ('015 delete logins', exists (select 1 from pg_proc where proname = 'delete_login')),
  ('016 sections', to_regclass('public.product_sections') is not null),
  ('017 logins with several customers', to_regclass('public.profile_customers') is not null),
  ('018 Organic order times', to_regclass('public.reminder_log') is not null and exists (select 1 from pg_proc where proname = 'organic_cutoff')),
  ('018 7:20am schedule', case when to_regclass('cron.job') is not null then
      (xpath('//row/c/text()', query_to_xml('select count(*) as c from cron.job where jobname = ''order-reminders''', false, false, '')))[1]::text::int > 0 else false end),
  ('Harris Farm ticked for Sunday', case when to_regclass('public.reminder_log') is not null then
      (xpath('//row/c/text()', query_to_xml('select count(*) as c from public.customers where sunday_delivery', false, false, '')))[1]::text::int > 0 else false end)
) as t(item, ok);
