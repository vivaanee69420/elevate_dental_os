-- 20260101000094_ghl_contacts_fix.sql
-- FIX: contacts with NULL integration_account_id still belong to an account.
-- This happens when:
--   (a) A contact was originally a Dentally/manual row that was LINKED to GHL
--       by email/phone match (sets ghl_contact_id but may leave integration_account_id
--       NULL if the sync path didn't propagate it).
--   (b) syncOneOrg (legacy org-level path) passed integrationAccountId = null.
--
-- Strategy: backfill integration_account_id on contacts where it is NULL but the
-- contact has a lead with a known integration_account_id. This is safe because a
-- contact can only belong to one GHL location (one account).
--
-- Also backfill contacts that have a ghl_contact_id but NULL integration_account_id
-- by matching against the leads table which almost always has integration_account_id.

UPDATE public.contacts c
SET integration_account_id = l.integration_account_id
FROM (
  SELECT DISTINCT ON (contact_id) contact_id, integration_account_id
  FROM public.leads
  WHERE source = 'gohighlevel'
    AND integration_account_id IS NOT NULL
    AND contact_id IS NOT NULL
  ORDER BY contact_id, created_at DESC
) l
WHERE c.id = l.contact_id
  AND c.integration_account_id IS NULL
  AND l.integration_account_id IS NOT NULL;

-- Also backfill communications that have NULL integration_account_id but whose
-- contact now has one (conversations sync ran before the backfill above).
UPDATE public.communications cm
SET integration_account_id = co.integration_account_id
FROM public.contacts co
WHERE cm.contact_id = co.id
  AND cm.integration_account_id IS NULL
  AND co.integration_account_id IS NOT NULL
  AND cm.organisation_id = co.organisation_id;

NOTIFY pgrst, 'reload schema';
