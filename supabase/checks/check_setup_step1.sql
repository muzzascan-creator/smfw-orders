-- Setup check, step 1 of 2. Paste into Supabase SQL Editor and press Run. Sends nothing to customers.
-- Shows which database updates have been run, and asks the email function (quick-api) to answer a "ping".
-- Then run step 2 a few seconds later to see the function's answer.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_net') and to_regclass('public.app_settings') is not null then
    execute $q$ insert into public.app_settings (key, value) select 'setup_check_id', net.http_post(
      url := 'https://ywiblqtasikiwfndwrrb.supabase.co/functions/v1/quick-api',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3aWJscXRhc2lraXdmbmR3cnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MTE5MTQsImV4cCI6MjEwNzA4NzkxNH0.YSOqvsm0gOOGQEnS_p1b0tWDr5kjHO8ItEm0UEOUYHs',
        'x-cron-key', (select value from public.app_settings where key = 'cron_key')),
      body := '{"action":"ping"}'::jsonb)::text
      on conflict (key) do update set value = excluded.value $q$;
  end if;
end $$;
select item, case when ok then 'OK' else 'NOT DONE' end as status from (values
  ('015 delete logins', exists (select 1 from pg_proc where proname = 'delete_login')),
  ('016 sections', to_regclass('public.product_sections') is not null),
  ('017 logins with several customers', to_regclass('public.profile_customers') is not null),
  ('018 reminders log', to_regclass('public.reminder_log') is not null),
  ('020 speed-ups', to_regclass('public.orders_customer_idx') is not null),
  ('021 special orders', exists (select 1 from information_schema.columns where table_name = 'orders' and column_name = 'special_order')),
  ('022 new-login texts', exists (select 1 from pg_proc where proname = 'sms_new_login')),
  ('023 Both locations', exists (select 1 from pg_constraint where conname = 'customers_product_group_check' and pg_get_constraintdef(oid) like '%Both%')),
  ('024 SMS settings screen', exists (select 1 from pg_proc where proname = 'save_sms_settings')),
  ('025 one device per login', to_regclass('public.login_devices') is not null),
  ('026 cut-off rules', to_regclass('public.cutoff_rules') is not null),
  ('026 reminders every 10 minutes', case when to_regclass('cron.job') is not null then
      (xpath('//row/c/text()', query_to_xml('select count(*) as c from cron.job where jobname = ''order-reminders'' and schedule = ''*/10 * * * *''', false, false, '')))[1]::text::int > 0 else false end),
  ('027 review fixes', exists (select 1 from pg_proc where proname = 'keep_an_admin')),
  ('028 login mobile numbers', exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'mobile')),
  ('029 favourites', to_regclass('public.favourites') is not null),
  ('030 batch codes', to_regclass('public.batch_codes') is not null),
  ('031 CSV folder settings', to_regclass('public.staff_settings') is not null),
  ('032 Conventional orders straight to Received', exists (select 1 from information_schema.columns where table_name = 'orders' and column_name = 'direct')),
  ('033 more speed-ups', to_regclass('public.orders_updated_idx') is not null),
  ('034 purchase order import', to_regclass('public.po_items') is not null),
  ('035 buyer Special Requirements', exists (select 1 from information_schema.columns where table_name = 'orders' and column_name = 'customer_notes')),
  ('036 Promo tick box', exists (select 1 from information_schema.columns where table_name = 'product_packs' and column_name = 'promo')),
  ('037 customer Promo tick box', exists (select 1 from information_schema.columns where table_name = 'customers' and column_name = 'promo')),
  ('038 Condition 3 Promo', exists (select 1 from pg_policies where tablename = 'staff_settings' and policyname = 'promo_read')),
  ('039 Auto CSV Off at Conventional cut-off', case when to_regclass('cron.job') is not null then
      (xpath('//row/c/text()', query_to_xml('select count(*) as c from cron.job where jobname = ''auto-csv-cutoff''', false, false, '')))[1]::text::int > 0 else false end),
  ('040 Speed Screen logins', exists (select 1 from pg_proc where proname = 'is_speed')),
  ('041 Speed Screen tile settings', to_regclass('public.speed_tiles') is not null),
  ('042 Speed Screen columns', exists (select 1 from information_schema.columns where table_name = 'speed_tiles' and column_name = 'col'))
) as t(item, ok);
