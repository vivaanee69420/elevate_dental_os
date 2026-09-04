-- ============================================================================
-- One account per practice, per provider — enforced in the database.
--
-- THE RULE (owner, 2026-09-04): "they should have strictly one account per
-- practice whether its dentally or ghl or google or facebook anything".
--
-- This was already enforced for GoHighLevel and NOWHERE ELSE. The index
-- idx_integration_accounts_practice pins (organisation_id, practice_id) for
-- provider = 'gohighlevel' alone, so the right thing was done once and never
-- generalised: today two CallRail companies, two Google Ads accounts, two Meta
-- ad accounts or two practices sharing a Dentally site are all accepted
-- silently.
--
-- WHY IT MATTERS MORE THAN IT LOOKS. Practice attribution is a JOIN through
-- the account, so a second account on the same practice does not raise an
-- error anywhere — it doubles that practice's spend, or splits its leads
-- across two rows that no screen adds back together. There is no wrong-looking
-- number to notice: the totals simply stop meaning what the label says. This
-- codebase has now lost six weeks of two practices' ad data to one silent
-- attribution gap; that is the failure this makes structurally impossible
-- rather than merely unlikely.
--
-- SAFE ON EXISTING DATA — verified against hosted before writing, across every
-- organisation and provider: zero (organisation_id, provider, practice_id)
-- duplicates in integration_accounts or ad_accounts, zero duplicate
-- pms_site_id within an organisation, zero duplicate practices in
-- emergent_practice_map. Nothing is rewritten and no existing row is touched;
-- these constraints bite only on the NEXT mapping a tenant makes.
--
-- NULL practice is deliberately still allowed, and the partial WHERE clause is
-- what allows it. An account that is not mapped to a practice is a legitimate
-- state, not a violation:
--   - QuickBooks is org-level ONLY and never practice-mapped by design (owner
--     reaffirmed 2026-09-03) — all four of its accounts carry a null practice.
--   - A Google account for a business that is not one of the practices
--     (Smile Arch, Snoreeze) has nothing to map to.
--   - A newly discovered account is unmapped until the owner maps it.
-- Postgres treats NULLs as distinct in a unique index anyway; the partial
-- clause states the intent rather than relying on that.
--
-- idx_integration_accounts_practice is left in place. It is now redundant with
-- the broader index below, but dropping a unique index that an ON CONFLICT
-- could be resolving against is a needless risk on a table this small, and a
-- redundant index on a few dozen rows costs nothing worth reclaiming.
-- ============================================================================

-- GoHighLevel, CallRail, and every provider added later.
CREATE UNIQUE INDEX IF NOT EXISTS integration_accounts_one_per_practice
    ON public.integration_accounts (organisation_id, provider, practice_id)
    WHERE practice_id IS NOT NULL;

-- Google Ads and Meta Ads.
CREATE UNIQUE INDEX IF NOT EXISTS ad_accounts_one_per_practice
    ON public.ad_accounts (organisation_id, provider, practice_id)
    WHERE practice_id IS NOT NULL;

-- Dentally: the practice row carries the PMS site id directly, so "one account
-- per practice" here is the mirror statement — two practices must not claim
-- the same Dentally site, which would make every appointment, invoice and
-- treatment plan from that site land on both.
CREATE UNIQUE INDEX IF NOT EXISTS practices_one_pms_site
    ON public.practices (organisation_id, pms_site_id)
    WHERE pms_site_id IS NOT NULL;

-- Emergent. Interim by design — the owner intends to replace this feed with
-- first-party treatment entry in the app — but the same rule applies while it
-- is live. Note this constrains the PRACTICE side: the (organisation_id,
-- business_id) unique already present stops one business mapping twice, and
-- this stops two businesses claiming one practice.
CREATE UNIQUE INDEX IF NOT EXISTS emergent_practice_map_one_per_practice
    ON public.emergent_practice_map (organisation_id, practice_id)
    WHERE practice_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
