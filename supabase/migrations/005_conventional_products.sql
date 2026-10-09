-- Coolibah Herbs Farm: Conventional products from their wholesale order form.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Running it again adds nothing twice.
-- Needs 004_product_groups.sql to have been run first. New SIDs carry on from your highest SID.
do $$
declare sup uuid; pid uuid; next_sid int;
begin
  select id into sup from public.suppliers where name = 'Coolibah Herbs Farm';
  if sup is null then
    insert into public.suppliers (name, emails, cutoff, notes)
    values ('Coolibah Herbs Farm', '{}', 'Orders by 7am for current day processing. Orders after 7am are processed the following day.', 'All products subject to availability.')
    returning id into sup;
  end if;
  select coalesce(max(sid), 0) + 1 into next_sid from public.product_packs;

  if not exists (select 1 from public.products where supplier_id = sup and name = 'Salad mix') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '101', 'Salad mix', 'Salad Leaf Mixes', 10, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, true, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, true, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Gold mix (premium salad)') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '105', 'Gold mix (premium salad)', 'Salad Leaf Mixes', 20, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, false, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Cress mix') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '106', 'Cress mix', 'Salad Leaf Mixes', 30, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Aussie mix') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '108', 'Aussie mix', 'Salad Leaf Mixes', 40, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Italian mix') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '109', 'Italian mix', 'Salad Leaf Mixes', 50, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Asian mix') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '119', 'Asian mix', 'Salad Leaf Mixes', 60, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Queenslander mix') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '121', 'Queenslander mix', 'Salad Leaf Mixes', 70, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, false, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Coriander heads') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, null, 'Coriander heads', 'Salad Leaf Mixes', 80, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, true, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, true, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Spinach / wild roquette [50/50]') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '117', 'Spinach / wild roquette [50/50]', 'Salad Leaf Mixes', 90, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, false, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, false, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Sydney Salad') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, null, 'Sydney Salad', 'Salad Leaf Mixes', 100, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, false, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, false, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Sydney Spinach') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, null, 'Sydney Spinach', 'Salad Leaf Mixes', 110, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, false, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, false, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Baby spinach') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '201', 'Baby spinach', 'Salad Leaf Single Variety', 120, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, true, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, true, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Wild roquette') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '202', 'Wild roquette', 'Salad Leaf Single Variety', 130, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, true, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, true, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Cos') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '211', 'Cos', 'Salad Leaf Single Variety', 140, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, false, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Tatsoi') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '251', 'Tatsoi', 'Salad Leaf Single Variety', 150, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, false, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Snow pea shoots') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '253', 'Snow pea shoots', 'Salad Leaf Single Variety', 160, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, false, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Mizuna') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '255', 'Mizuna', 'Salad Leaf Single Variety', 170, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Finesse / endive') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '258', 'Finesse / endive', 'Salad Leaf Single Variety', 180, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, false, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Chard') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '261', 'Chard', 'Salad Leaf Single Variety', 190, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, false, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, false, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Spinach / wild roquette') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '152', 'Spinach / wild roquette', 'Salad Leaf Single Variety', 200, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, false, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Salad / spinach / wild / asian / italian') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '157', 'Salad / spinach / wild / asian / italian', 'Salad Leaf Single Variety', 210, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, false, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Salad / spinach / wild roquette') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '158', 'Salad / spinach / wild roquette', 'Salad Leaf Single Variety', 220, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '3kg CARTON', next_sid, 1, false, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, '1.5kg CARTON', next_sid, 1, false, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 15 CLAM SHELLS', next_sid, 1, true, 2); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 16 FLOW PACKS', next_sid, 1, true, 3); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 3 x 500g Pillow', next_sid, 1, false, 4); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BOX of 10 x 100g Pillow', next_sid, 1, false, 5); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Coriander') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '301', 'Coriander', 'Herbs', 230, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Basil') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '302', 'Basil', 'Herbs', 240, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Chives') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '303', 'Chives', 'Herbs', 250, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Mint') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '304', 'Mint', 'Herbs', 260, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Dill') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '305', 'Dill', 'Herbs', 270, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Sage') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '307', 'Sage', 'Herbs', 280, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Thyme') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '308', 'Thyme', 'Herbs', 290, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Lemon thyme') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '309', 'Lemon thyme', 'Herbs', 300, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Marjoram') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '310', 'Marjoram', 'Herbs', 310, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Oregano') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '311', 'Oregano', 'Herbs', 320, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Tarragon') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '312', 'Tarragon', 'Herbs', 330, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Rosemary') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '313', 'Rosemary', 'Herbs', 340, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
  if not exists (select 1 from public.products where supplier_id = sup and name = 'Continental parsley') then
    insert into public.products (supplier_id, code, name, section, sort, active, product_group)
    values (sup, '315', 'Continental parsley', 'Herbs', 350, true, 'Conventional') returning id into pid;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'BUNCH', next_sid, 1, true, 0); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'SLEEVE', next_sid, 1, true, 1); next_sid := next_sid + 1;
    insert into public.product_packs (product_id, name, sid, outer_multiple, available, sort) values (pid, 'PUNNET', next_sid, 1, true, 2); next_sid := next_sid + 1;
  end if;
end $$;
