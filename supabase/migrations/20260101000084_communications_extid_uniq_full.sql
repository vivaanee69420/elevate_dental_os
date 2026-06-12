-- Fix: GoHighLevel conversation sync stored 0 messages -> Inbox silently empty.
--
-- The dedup upsert in gohighlevel-conversations.js uses
--   .upsert(batch, { onConflict: 'organisation_id,external_id', ignoreDuplicates: true })
-- which PostgREST runs as INSERT ... ON CONFLICT (organisation_id, external_id).
-- The conflict target (000067) was a PARTIAL unique index (WHERE external_id IS
-- NOT NULL). Postgres can only infer a partial unique index for ON CONFLICT when
-- the statement also carries the partial predicate -- PostgREST cannot supply
-- "WHERE external_id IS NOT NULL", so every sync raised:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- The error was swallowed by a console.warn, so contacts/leads synced fine but
-- no conversation messages were ever written. (The "developer" org's rows predate
-- 000067 and so were never affected.)
--
-- Replace the partial index with a FULL unique index on the same columns.
-- Postgres default NULLS DISTINCT still lets internally-generated rows (native
-- email/SMS via lib/messaging.js, which carry no external_id) share NULL freely
-- -- the original reason for the partial -- while making the index inferable for
-- ON CONFLICT. Same race-proof dedup guarantee for synced rows; upsert now works.
drop index if exists uq_comms_org_extid;
create unique index if not exists uq_comms_org_extid
  on public.communications (organisation_id, external_id);

notify pgrst, 'reload schema';
