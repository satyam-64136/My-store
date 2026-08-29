-- ════════════════════════════════════════════════════════════════
--  Satyam's Store — Complete Supabase SQL Setup
--  Run this entire file in Supabase → SQL Editor
--  This is the FULL setup from scratch — tables + RLS policies
-- ════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────
--  SECTION 1: CREATE TABLES
--  (Safe to run even if tables already exist — uses IF NOT EXISTS)
-- ────────────────────────────────────────────────────────────────


-- ── PRODUCTS ─────────────────────────────────────────────────────
-- Stores all your products with price, stock, image, buying price
CREATE TABLE IF NOT EXISTS products (
  id             bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           text            NOT NULL,
  price          numeric(10, 2)  NOT NULL DEFAULT 0,
  stock          integer         NOT NULL DEFAULT 0,
  image          text            DEFAULT '',
  purchase_price numeric(10, 2)  NOT NULL DEFAULT 0,
  hidden         boolean         NOT NULL DEFAULT false,
  created_at     timestamptz     DEFAULT now()
);


-- ── ORDERS ───────────────────────────────────────────────────────
-- Stores customer orders — pending until admin approves/rejects
-- items column is JSONB: array of { id, name, qty, sub, purchase_price }
-- purchase_price is snapshotted at approve time for accurate profit history
CREATE TABLE IF NOT EXISTS orders (
  id             bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  items          jsonb           NOT NULL DEFAULT '[]',
  total          numeric(10, 2)  NOT NULL DEFAULT 0,
  status         text            NOT NULL DEFAULT 'pending',
  created_at     timestamptz     DEFAULT now()
);

-- Add order_ref column if it doesn't exist (for future use)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_ref text;


-- ── SETTINGS ─────────────────────────────────────────────────────
-- Key-value store for app config (store open/closed, auto-close time, etc.)
-- value column is JSONB so it can hold any config object
CREATE TABLE IF NOT EXISTS settings (
  id         bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text         NOT NULL UNIQUE,
  value      jsonb        NOT NULL DEFAULT '{}',
  updated_at timestamptz  DEFAULT now()
);

-- Insert default store config if it doesn't exist
INSERT INTO settings (key, value)
VALUES (
  'store_config',
  '{
    "storeStatus": "open",
    "autoCloseEnabled": false,
    "autoCloseTime": "03:00",
    "lastAutoCloseDate": "",
    "closedMessage": "We''ll be back soon. You can still browse products in the meantime."
  }'
)
ON CONFLICT (key) DO NOTHING;


-- ────────────────────────────────────────────────────────────────
--  SECTION 2: ADD MISSING COLUMNS
--  (Safe to run — uses IF NOT EXISTS)
-- ────────────────────────────────────────────────────────────────

-- purchase_price tracks your buying cost for profit calculation
ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_price numeric(10,2) NOT NULL DEFAULT 0;

-- hidden lets you hide products without deleting them
ALTER TABLE products ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

-- order_ref is a short human-readable reference (future use)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_ref text;


-- ────────────────────────────────────────────────────────────────
--  SECTION 3: INDEXES
--  (Speeds up common queries)
-- ────────────────────────────────────────────────────────────────

-- Fast lookup of pending/approved orders
CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at  ON orders (created_at DESC);

-- Fast lookup of products by name
CREATE INDEX IF NOT EXISTS idx_products_name      ON products (name);
CREATE INDEX IF NOT EXISTS idx_products_hidden    ON products (hidden);

-- Fast settings lookup by key
CREATE INDEX IF NOT EXISTS idx_settings_key       ON settings (key);


-- ────────────────────────────────────────────────────────────────
--  SECTION 4: ROW LEVEL SECURITY (RLS)
--  This is the REAL security layer.
--  Even if someone calls the API directly with the anon key,
--  Supabase will block anything not permitted here.
-- ────────────────────────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (clean slate — prevents duplicates)
DROP POLICY IF EXISTS "anon read visible products"  ON products;
DROP POLICY IF EXISTS "auth read all products"      ON products;
DROP POLICY IF EXISTS "auth insert products"        ON products;
DROP POLICY IF EXISTS "auth update products"        ON products;
DROP POLICY IF EXISTS "auth delete products"        ON products;

DROP POLICY IF EXISTS "anon insert orders"          ON orders;
DROP POLICY IF EXISTS "auth manage orders"          ON orders;

DROP POLICY IF EXISTS "anon read store config"      ON settings;
DROP POLICY IF EXISTS "auth manage settings"        ON settings;


-- ── PRODUCTS policies ─────────────────────────────────────────────

-- Customers (anon) can only see products that are NOT hidden
CREATE POLICY "anon read visible products"
  ON products FOR SELECT
  TO anon
  USING (hidden = false);

-- Admin (authenticated) can see ALL products including hidden ones
CREATE POLICY "auth read all products"
  ON products FOR SELECT
  TO authenticated
  USING (true);

-- Only admin can add new products
CREATE POLICY "auth insert products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only admin can edit products (price, stock, purchase_price, hidden etc.)
CREATE POLICY "auth update products"
  ON products FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Only admin can delete products
CREATE POLICY "auth delete products"
  ON products FOR DELETE
  TO authenticated
  USING (true);


-- ── ORDERS policies ───────────────────────────────────────────────

-- Customers can place orders (INSERT only, must be pending status)
-- They CANNOT read, update or delete any orders
CREATE POLICY "anon insert orders"
  ON orders FOR INSERT
  TO anon
  WITH CHECK (status = 'pending');

-- Admin has full control over all orders
CREATE POLICY "auth manage orders"
  ON orders FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ── SETTINGS policies ─────────────────────────────────────────────

-- Customers can only read the store_config row
-- (needed to show open/closed banner and closed message on the store page)
CREATE POLICY "anon read store config"
  ON settings FOR SELECT
  TO anon
  USING (key = 'store_config');

-- Admin has full control over all settings
CREATE POLICY "auth manage settings"
  ON settings FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ────────────────────────────────────────────────────────────────
--  SECTION 5: VERIFY EVERYTHING
--  Run these after the above to confirm it worked
-- ────────────────────────────────────────────────────────────────

-- Should show all 3 tables with rowsecurity = true
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename IN ('products', 'orders', 'settings')
ORDER BY tablename;

-- Should show all your policies
SELECT
  tablename,
  policyname,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename IN ('products', 'orders', 'settings')
ORDER BY tablename, cmd;
