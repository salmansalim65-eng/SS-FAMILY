-- ============================================================================
-- SS-FAMILY :: grocery catalogue
--
-- The standing list of what the household buys, grouped by category. A family
-- member opens the Grocery tab, ticks what is needed and sets a quantity; that
-- writes an ordinary shopping_list row, so it merges into the driver's
-- consolidated list exactly like a typed-in item — two people ticking Chicken
-- still produces one line with the totals added together.
-- ============================================================================
create table if not exists public.grocery_catalogue (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text not null,
  default_unit text not null default 'pcs',
  default_qty  numeric(10,2) not null default 1,
  sort_order   integer not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create unique index if not exists grocery_catalogue_uniq
  on public.grocery_catalogue (lower(name), category);

-- Links a ticked catalogue entry to the shopping row it created, so unticking
-- can find and remove it again.
alter table public.shopping_list
  add column if not exists catalogue_id uuid
  references public.grocery_catalogue (id) on delete set null;

create index if not exists shopping_catalogue_idx
  on public.shopping_list (catalogue_id, added_by, status);

-- ---------------------------------------------------------------------------
-- Starter catalogue. Everything is editable in the app afterwards.
-- ---------------------------------------------------------------------------
insert into public.grocery_catalogue (name, category, default_unit, default_qty, sort_order)
values
  ('Onions', 'Vegetables', 'kg', 2, 10),
  ('Tomatoes', 'Vegetables', 'kg', 2, 20),
  ('Potatoes', 'Vegetables', 'kg', 2, 30),
  ('Garlic', 'Vegetables', 'kg', 0.5, 40),
  ('Ginger', 'Vegetables', 'kg', 0.5, 50),
  ('Green Chilli', 'Vegetables', 'kg', 0.25, 60),
  ('Fresh Coriander', 'Vegetables', 'bunch', 2, 70),
  ('Fresh Mint', 'Vegetables', 'bunch', 2, 80),
  ('Cucumber', 'Vegetables', 'kg', 1, 90),
  ('Carrot', 'Vegetables', 'kg', 1, 100),
  ('Capsicum', 'Vegetables', 'kg', 1, 110),
  ('Lemon', 'Vegetables', 'kg', 0.5, 120),
  ('Spinach', 'Vegetables', 'bunch', 2, 130),
  ('Okra (Bhindi)', 'Vegetables', 'kg', 1, 140),
  ('Cauliflower', 'Vegetables', 'pcs', 1, 150),
  ('Cabbage', 'Vegetables', 'pcs', 1, 160),
  ('Green Peas', 'Vegetables', 'kg', 1, 170),
  ('Brinjal (Baingan)', 'Vegetables', 'kg', 1, 180),

  ('Bananas', 'Fruits', 'dozen', 1, 10),
  ('Apples', 'Fruits', 'kg', 2, 20),
  ('Oranges', 'Fruits', 'kg', 2, 30),
  ('Grapes', 'Fruits', 'kg', 1, 40),
  ('Mangoes', 'Fruits', 'kg', 2, 50),
  ('Watermelon', 'Fruits', 'pcs', 1, 60),
  ('Dates', 'Fruits', 'kg', 1, 70),
  ('Pomegranate', 'Fruits', 'kg', 1, 80),

  ('Mutton', 'Meat', 'kg', 2, 10),
  ('Beef', 'Meat', 'kg', 2, 20),
  ('Beef Mince (Keema)', 'Meat', 'kg', 1, 30),
  ('Chicken (Whole)', 'Meat', 'kg', 2, 40),
  ('Chicken Boneless', 'Meat', 'kg', 1, 50),
  ('Chicken Mince', 'Meat', 'kg', 1, 60),

  ('Fish', 'Fish', 'kg', 1, 10),
  ('Prawns', 'Fish', 'kg', 1, 20),

  ('Milk', 'Dairy', 'litre', 4, 10),
  ('Yoghurt', 'Dairy', 'kg', 2, 20),
  ('Laban', 'Dairy', 'litre', 2, 30),
  ('Cheese Slices', 'Dairy', 'pack', 1, 40),
  ('Butter', 'Dairy', 'pack', 1, 50),
  ('Cream', 'Dairy', 'pack', 2, 60),
  ('Eggs', 'Dairy', 'dozen', 2, 70),

  ('Basmati Rice', 'Grains', 'kg', 5, 10),
  ('Flour (Atta)', 'Grains', 'kg', 5, 20),
  ('Maida', 'Grains', 'kg', 1, 30),
  ('Daal Masoor', 'Grains', 'kg', 1, 40),
  ('Daal Chana', 'Grains', 'kg', 1, 50),
  ('Daal Moong', 'Grains', 'kg', 1, 60),
  ('Chickpeas (Chana)', 'Grains', 'kg', 1, 70),
  ('Kidney Beans (Rajma)', 'Grains', 'kg', 1, 80),
  ('Vermicelli (Sewaiyan)', 'Grains', 'pack', 2, 90),
  ('Pasta', 'Grains', 'pack', 2, 100),

  ('Salt', 'Spices', 'pack', 1, 10),
  ('Red Chilli Powder', 'Spices', 'pack', 1, 20),
  ('Turmeric', 'Spices', 'pack', 1, 30),
  ('Coriander Powder', 'Spices', 'pack', 1, 40),
  ('Cumin (Zeera)', 'Spices', 'pack', 1, 50),
  ('Garam Masala', 'Spices', 'pack', 1, 60),
  ('Black Pepper', 'Spices', 'pack', 1, 70),
  ('Cardamom', 'Spices', 'pack', 1, 80),
  ('Cinnamon', 'Spices', 'pack', 1, 90),
  ('Bay Leaves', 'Spices', 'pack', 1, 100),
  ('Biryani Masala', 'Spices', 'pack', 2, 110),
  ('Ginger Garlic Paste', 'Spices', 'pack', 1, 120),

  ('Bread', 'Bakery', 'pcs', 2, 10),
  ('Roti / Chapati', 'Bakery', 'pack', 2, 20),
  ('Rusk', 'Bakery', 'pack', 1, 30),
  ('Buns', 'Bakery', 'pack', 1, 40),
  ('Cake', 'Bakery', 'pcs', 1, 50),

  ('Tea (Chai Patti)', 'Beverages', 'pack', 1, 10),
  ('Green Tea', 'Beverages', 'pack', 1, 20),
  ('Coffee', 'Beverages', 'pack', 1, 30),
  ('Soft Drinks', 'Beverages', 'carton', 1, 40),
  ('Juice', 'Beverages', 'carton', 2, 50),
  ('Bottled Water', 'Beverages', 'carton', 4, 60),

  ('Frozen Paratha', 'Frozen', 'pack', 2, 10),
  ('Frozen Samosa', 'Frozen', 'pack', 2, 20),
  ('Frozen Peas', 'Frozen', 'pack', 2, 30),
  ('Ice Cream', 'Frozen', 'pcs', 2, 40),
  ('Frozen Fries', 'Frozen', 'pack', 2, 50),

  ('Dishwashing Liquid', 'Household', 'pcs', 1, 10),
  ('Laundry Detergent', 'Household', 'pack', 1, 20),
  ('Tissues', 'Household', 'pack', 2, 30),
  ('Toilet Paper', 'Household', 'pack', 1, 40),
  ('Garbage Bags', 'Household', 'pack', 2, 50),
  ('Aluminium Foil', 'Household', 'pcs', 1, 60),
  ('Cling Film', 'Household', 'pcs', 1, 70),
  ('Hand Soap', 'Household', 'pcs', 2, 80),
  ('Floor Cleaner', 'Household', 'pcs', 1, 90),
  ('Air Freshener', 'Household', 'pcs', 1, 100),

  ('Cooking Oil', 'Other', 'litre', 3, 10),
  ('Ghee', 'Other', 'kg', 1, 20),
  ('Sugar', 'Other', 'kg', 2, 30),
  ('Honey', 'Other', 'pcs', 1, 40),
  ('Vinegar', 'Other', 'pcs', 1, 50),
  ('Ketchup', 'Other', 'pcs', 1, 60),
  ('Mayonnaise', 'Other', 'pcs', 1, 70),
  ('Pickle (Achar)', 'Other', 'pcs', 1, 80),
  ('Dry Fruits', 'Other', 'kg', 1, 90)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Everyone in the family reads and may add a missing item; only the head can
-- edit or retire one, so the shared list does not drift under people's feet.
-- ---------------------------------------------------------------------------
alter table public.grocery_catalogue enable row level security;

drop policy if exists catalogue_select on public.grocery_catalogue;
create policy catalogue_select on public.grocery_catalogue
  for select to authenticated using (public.is_family());

drop policy if exists catalogue_insert on public.grocery_catalogue;
create policy catalogue_insert on public.grocery_catalogue
  for insert to authenticated with check (public.is_family());

drop policy if exists catalogue_update on public.grocery_catalogue;
create policy catalogue_update on public.grocery_catalogue
  for update to authenticated
  using (public.is_head()) with check (public.is_head());

drop policy if exists catalogue_delete on public.grocery_catalogue;
create policy catalogue_delete on public.grocery_catalogue
  for delete to authenticated using (public.is_head());

grant select, insert, update, delete on public.grocery_catalogue to authenticated;
