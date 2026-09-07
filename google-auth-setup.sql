-- ════════════════════════════════════════════════════════════════
--  Your's Store — Google Login Gate Setup
--  Run this entire file in Supabase → SQL Editor, ONCE,
--  AFTER complete_setup.sql has already been run.
--
--  What this does:
--   1. Creates an `allowed_emails` table — the admin adds emails to
--      it from the admin panel; only those Google accounts can sign
--      in and see the store.
--   2. Locks the customer-facing tables down so browsing/ordering
--      requires an approved, signed-in Google account instead of
--      the old public "anon" access.
--   3. Re-scopes every "authenticated" policy to the admin email only
--      — this is required, because once customers sign in they also
--      become "authenticated", and the old policies said ANY
--      authenticated user (USING (true)) could manage products,
--      orders and settings. Without this fix, an approved customer
--      would be able to edit your store, not just view it.
--
--  Before running: set your Google OAuth provider up in
--  Supabase Dashboard → Authentication → Providers → Google
--  (you'll need a Google Cloud OAuth Client ID + Secret from
--  https://console.cloud.google.com/apis/credentials — set the
--  authorized redirect URI to the one Supabase shows you there).
-- ════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────
--  SECTION 1: ALLOWED_EMAILS TABLE
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS allowed_emails (
  id         bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text         NOT NULL UNIQUE,
  added_at   timestamptz  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_allowed_emails_email ON allowed_emails (email);

ALTER TABLE allowed_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self read own email"         ON allowed_emails;
DROP POLICY IF EXISTS "admin manage allowed emails" ON allowed_emails;

-- A signed-in user can only see whether THEIR OWN email is on the
-- list — this is what the login gate checks after Google sign-in.
CREATE POLICY "self read own email"
  ON allowed_emails FOR SELECT
  TO authenticated
  USING (
    email = auth.jwt()->>'email'
    OR auth.jwt()->>'email' = 'satyam64136@gmail.com'
  );

-- Only the admin account can add or remove approved emails.
CREATE POLICY "admin manage allowed emails"
  ON allowed_emails FOR ALL
  TO authenticated
  USING     (auth.jwt()->>'email' = 'satyam64136@gmail.com')
  WITH CHECK(auth.jwt()->>'email' = 'satyam64136@gmail.com');


-- ────────────────────────────────────────────────────────────────
--  SECTION 2: PRODUCTS — replace public (anon) access
-- ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "anon read visible products" ON products;
DROP POLICY IF EXISTS "auth read all products"      ON products;
DROP POLICY IF EXISTS "auth insert products"        ON products;
DROP POLICY IF EXISTS "auth update products"        ON products;
DROP POLICY IF EXISTS "auth delete products"        ON products;

-- Admin (its own Google/password sign-in) can see every product,
-- hidden or not.
CREATE POLICY "admin read all products"
  ON products FOR SELECT
  TO authenticated
  USING (auth.jwt()->>'email' = 'satyam64136@gmail.com');

-- Approved, signed-in customers can see only the visible ones.
CREATE POLICY "approved read visible products"
  ON products FOR SELECT
  TO authenticated
  USING (
    hidden = false
    AND EXISTS (SELECT 1 FROM allowed_emails ae WHERE ae.email = auth.jwt()->>'email')
  );

-- Only admin can add/edit/delete products.
CREATE POLICY "admin insert products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (auth.jwt()->>'email' = 'satyam64136@gmail.com');

CREATE POLICY "admin update products"
  ON products FOR UPDATE
  TO authenticated
  USING     (auth.jwt()->>'email' = 'satyam64136@gmail.com')
  WITH CHECK(auth.jwt()->>'email' = 'satyam64136@gmail.com');

CREATE POLICY "admin delete products"
  ON products FOR DELETE
  TO authenticated
  USING (auth.jwt()->>'email' = 'satyam64136@gmail.com');


-- ────────────────────────────────────────────────────────────────
--  SECTION 3: ORDERS — only approved customers can place them;
--  only admin can manage them
-- ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "anon insert orders" ON orders;
DROP POLICY IF EXISTS "auth manage orders" ON orders;

CREATE POLICY "approved insert orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'pending'
    AND EXISTS (SELECT 1 FROM allowed_emails ae WHERE ae.email = auth.jwt()->>'email')
  );

CREATE POLICY "admin manage orders"
  ON orders FOR ALL
  TO authenticated
  USING     (auth.jwt()->>'email' = 'satyam64136@gmail.com')
  WITH CHECK(auth.jwt()->>'email' = 'satyam64136@gmail.com');


-- ────────────────────────────────────────────────────────────────
--  SECTION 4: SETTINGS — only admin can manage; store_config stays
--  publicly readable (harmless open/closed banner text)
-- ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "auth manage settings" ON settings;

CREATE POLICY "admin manage settings"
  ON settings FOR ALL
  TO authenticated
  USING     (auth.jwt()->>'email' = 'satyam64136@gmail.com')
  WITH CHECK(auth.jwt()->>'email' = 'satyam64136@gmail.com');

-- NOTE: "anon read store config" from complete_setup.sql is left as-is.


-- ────────────────────────────────────────────────────────────────
--  SECTION 5: VERIFY
-- ────────────────────────────────────────────────────────────────

SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('products', 'orders', 'settings', 'allowed_emails')
ORDER BY tablename, cmd;
