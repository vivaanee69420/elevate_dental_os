-- 000068: index the contact_id foreign keys on large child tables.
--
-- These FKs had no covering index. Deleting/merging a contact (a real
-- operation — see the dedup work; leads.contact_id is ON DELETE CASCADE) forced
-- a full sequential scan of each child table to resolve the FK — most painfully
-- appointments (~538k rows). These indexes also speed contact-detail lookups
-- ("this contact's appointments/payments/etc.").
--
-- Applied on hosted with CREATE INDEX CONCURRENTLY (non-locking, live data).
-- CONCURRENTLY cannot run inside a transaction; `supabase db reset` runs each
-- migration in a txn, so this file omits CONCURRENTLY — on an empty/seeded
-- local reset the brief lock is irrelevant. Idempotent via IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_appts_contact         ON public.appointments    (contact_id);
CREATE INDEX IF NOT EXISTS idx_payments_contact      ON public.payments        (contact_id);
CREATE INDEX IF NOT EXISTS idx_tplans_contact        ON public.treatment_plans (contact_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_contact ON public.invoice_items   (contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contact      ON public.invoices        (contact_id);
