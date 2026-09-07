-- ════════════════════════════════════════════════════════════════
--  Your's Store — Access Requests Upgrade
--  Run this ONCE in Supabase → SQL Editor, AFTER google-auth-setup.sql
--  has already been run.
--
--  What changes:
--   • allowed_emails gets a `status` column: 'pending' | 'approved' | 'banned'
--   • Anyone who signs in with Google now gets a row filed automatically
--     (status = 'pending') — you no longer have to add emails by hand
--     before someone can even try. You still can, via the admin panel's
--     "Pre-approve" box, which inserts a row as 'approved' directly.
--   • You approve or ban each request from the admin panel's Access tab.
--   • Existing rows (the ones you already added manually before this
--     migration) are grandfathered in as 'approved' — nobody currently
--     let in gets locked out by this change.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE allowed_emails
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

-- Anyone already in the table before this migration was already
-- manually approved by you — grandfather them in.
UPDATE allowed_emails SET status = 'approved' WHERE status = 'pending';

ALTER TABLE allowed_emails
  DROP CONSTRAINT IF EXISTS allowed_emails_status_check;
ALTER TABLE allowed_emails
  ADD CONSTRAINT allowed_emails_status_check CHECK (status IN ('pending','approved','banned'));


-- A signed-in user may file ONE row for themselves, and only ever as
-- 'pending' — they can never self-approve or lift their own ban this way
-- (a second INSERT for the same email fails on the UNIQUE constraint
-- anyway; banning/approving happens only via UPDATE, which this policy
-- doesn't grant).
DROP POLICY IF EXISTS "self request access" ON allowed_emails;
CREATE POLICY "self request access"
  ON allowed_emails FOR INSERT
  TO authenticated
  WITH CHECK (email = auth.jwt()->>'email' AND status = 'pending');


-- Store access now requires status = 'approved', not just presence in
-- the table — a pending or banned row must NOT grant access.
DROP POLICY IF EXISTS "approved read visible products" ON products;
CREATE POLICY "approved read visible products"
  ON products FOR SELECT
  TO authenticated
  USING (
    hidden = false
    AND EXISTS (
      SELECT 1 FROM allowed_emails ae
      WHERE ae.email = auth.jwt()->>'email' AND ae.status = 'approved'
    )
  );

DROP POLICY IF EXISTS "approved insert orders" ON orders;
CREATE POLICY "approved insert orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'pending'
    AND EXISTS (
      SELECT 1 FROM allowed_emails ae
      WHERE ae.email = auth.jwt()->>'email' AND ae.status = 'approved'
    )
  );


-- ── VERIFY ──
SELECT email, status, added_at FROM allowed_emails ORDER BY status, added_at DESC;
