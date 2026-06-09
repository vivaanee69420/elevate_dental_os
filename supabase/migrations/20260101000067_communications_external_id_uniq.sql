-- Race-proof dedup for synced communications (GoHighLevel conversations).
-- The GHL conversation sync previously deduped with a select-then-insert, which
-- has a TOCTOU window: two overlapping syncs (nightly cron + manual Refresh, or
-- webhook-driven) could both pass the "not seen" filter and insert the same
-- message twice. This partial unique index backs an upsert(onConflict) so the DB
-- drops the second write. Partial (external_id NOT NULL) because internally
-- generated rows (outbox email/SMS via lib/messaging.js) carry no external_id
-- and must remain free to share NULL.
create unique index if not exists uq_comms_org_extid
  on public.communications (organisation_id, external_id)
  where external_id is not null;

notify pgrst, 'reload schema';
