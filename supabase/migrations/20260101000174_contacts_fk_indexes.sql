-- Index every foreign key that points at public.contacts.
--
-- Postgres does not index the referencing side of a foreign key for you. When a
-- contact is deleted, it must prove no child row still references it, and with
-- no index on the child's FK column that proof is a SEQUENTIAL SCAN of the whole
-- child table — per deleted row.
--
-- Found the hard way: clearing 9,446 contacts from one organisation timed out
-- repeatedly, and batches as small as 1,000 rows still timed out. The cause was
-- dentally_treatment_items.contact_id (256,275 rows) and leads.contact_id
-- (22,813 rows) having no index, so each contact deletion scanned ~279k rows.
-- With these indexes the same 9,446 deletions completed in a single statement.
--
-- This is not only a cleanup concern: contact merges and any future GDPR
-- erasure request walk the same path, and both would have been unusably slow at
-- this table size.
--
-- The remaining five are small today, but a missing FK index is a bug that only
-- shows up once the child table grows, which is exactly when it is most
-- expensive to discover. They are indexed now rather than left as a trap.
--
-- Not created CONCURRENTLY: these were applied to the live database by hand
-- while the tables were small enough for the brief lock to be unnoticeable, and
-- this file records that. On a much larger table, prefer CONCURRENTLY.

-- The two that actually caused the timeout.
create index if not exists idx_dentally_treatment_items_contact_id
    on public.dentally_treatment_items (contact_id);
create index if not exists idx_leads_contact_id
    on public.leads (contact_id);

-- Small today; unbounded tomorrow.
create index if not exists idx_ghl_appointments_contact_id
    on public.ghl_appointments (contact_id);
create index if not exists idx_treatment_accepted_contact_id
    on public.treatment_accepted (contact_id);
create index if not exists idx_sheet_export_queue_contact_id
    on public.sheet_export_queue (contact_id);
create index if not exists idx_sheet_export_queue_matched_contact_id
    on public.sheet_export_queue (matched_contact_id);
create index if not exists idx_workflow_runs_contact_id
    on public.workflow_runs (contact_id);
create index if not exists idx_tasks_related_contact_id
    on public.tasks (related_contact_id);

notify pgrst, 'reload schema';
