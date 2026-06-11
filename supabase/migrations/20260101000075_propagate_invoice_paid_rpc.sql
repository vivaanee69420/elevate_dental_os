-- 20260101000075_propagate_invoice_paid_rpc.sql
-- Propagate invoice payment status onto invoice_items. invoice_items.invoice_paid
-- is a denormalised snapshot captured at item-sync time (from the parent invoice's
-- `paid` flag via the transient invoiceMap). When a patient PAYS later, Dentally
-- bumps the INVOICE's updated_at but NOT the line-item's — so an incremental sync
-- re-pulls the invoice (invoices.paid goes true) but never re-pulls the item, and
-- invoice_items.invoice_paid stays stale. This made the "Treatments Paid" card
-- under-report (paid treatment still showing as unpaid). This RPC reconciles the
-- item flag to the invoices table's current paid status. Idempotent; returns the
-- number of rows changed. Called at the end of each Dentally sync (after invoices
-- pull) like the other relink_* RPCs.

CREATE OR REPLACE FUNCTION propagate_invoice_paid(p_org UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE invoice_items ii
  SET invoice_paid = i.paid,
      updated_at = now()
  FROM invoices i
  WHERE ii.organisation_id = p_org
    AND i.organisation_id = p_org
    AND ii.pms_invoice_id = i.external_id
    AND ii.invoice_paid IS DISTINCT FROM i.paid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION propagate_invoice_paid(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
