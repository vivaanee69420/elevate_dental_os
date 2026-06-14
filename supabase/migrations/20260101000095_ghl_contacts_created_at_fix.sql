-- 20260101000095_ghl_contacts_created_at_fix.sql
-- FIX: Historically, the GHL sync did not save the actual `dateAdded` for contacts,
-- meaning they all defaulted to the date the sync was run (e.g., June 2026).
-- This causes them to disappear from the dashboard when filtering for past months
-- (like March 2026) because the database thinks they didn't exist yet!
--
-- This script backfills the `created_at` date for contacts by looking at their associated leads.
-- Since leads DO have the correct historical creation date from GHL, we can set the contact's
-- creation date to match the oldest lead for that contact.

UPDATE public.contacts c
SET created_at = l.min_created_at
FROM (
  SELECT contact_id, min(created_at) as min_created_at
  FROM public.leads
  WHERE source = 'gohighlevel' AND contact_id IS NOT NULL
  GROUP BY contact_id
) l
WHERE c.id = l.contact_id
  AND c.created_at > l.min_created_at;

NOTIFY pgrst, 'reload schema';
