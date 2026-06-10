-- ============================================================================
-- ad_accounts.practice_id — optional link from an ad account to the practice it
-- advertises for. Each GM practice runs its own Google/Meta ad account, so this
-- mapping lets the marketing read paths attribute spend + platform conversions
-- per practice (and, with Dentally revenue already per-practice, compute real
-- per-site ROAS). NULL = unmapped (group-level / no matching practice); those
-- accounts stay in the group totals but don't attribute to a site.
--
-- Mapping is tenant data (account names are too fuzzy to derive reliably), set
-- via backfill / a future Integrations mapping UI — not seeded here.
-- ON DELETE SET NULL: removing a practice just unmaps its accounts.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================
ALTER TABLE ad_accounts
  ADD COLUMN IF NOT EXISTS practice_id UUID REFERENCES practices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ad_accounts_practice
  ON ad_accounts(organisation_id, practice_id) WHERE practice_id IS NOT NULL;

-- Reload PostgREST cache after applying:
--   NOTIFY pgrst, 'reload schema';
