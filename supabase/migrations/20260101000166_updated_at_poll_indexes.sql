-- ===========================================================================
-- Indexes for the incremental `updated_at` polls.
--
-- A separate database role, gm_referral_reader, polls this database directly
-- for records changed since its last cursor:
--
--   select a.id, a.contact_id, a.pms_patient_id, a.status, a.starts_at,
--          a.ends_at, a.updated_at, p.pms_site_id
--     from appointments a left join practices p on p.id = a.practice_id
--    where a.updated_at > $1 order by a.updated_at asc limit $2
--
-- ...and the matching shape on contacts. Neither table had ANY index on
-- updated_at, so every poll was a full scan and sort of the whole table.
-- Measured on pg_stat_statements before this migration:
--
--   appointments  2,852 calls @ 6,172.9 ms mean  =  4.9 hours
--   contacts      2,962 calls @ 3,543.6 ms mean  =  2.9 hours
--
-- Together 9.4% of ALL database time on the project, for a query that only
-- ever wants the newest tail of each table.
--
-- Plain (non-concurrent) CREATE INDEX: both tables are small (114k and 96k
-- live rows), so the write lock is held for well under a second. If either
-- grows by an order of magnitude, build any replacement CONCURRENTLY instead
-- — that cannot run inside a transaction, so it does not belong in a
-- migration file.
--
-- These are deliberately NOT scoped by organisation_id. The poller reads
-- across tenants by design (it is a separate role with its own grants), and a
-- leading organisation_id column would make the index useless to it. Every
-- application read stays org-scoped through the existing composite indexes.
-- ===========================================================================

CREATE INDEX IF NOT EXISTS idx_appointments_updated_at
  ON public.appointments (updated_at);

CREATE INDEX IF NOT EXISTS idx_contacts_updated_at
  ON public.contacts (updated_at);

NOTIFY pgrst, 'reload schema';
