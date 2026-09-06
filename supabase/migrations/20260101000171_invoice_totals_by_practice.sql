-- ============================================================================
-- Invoice totals per practice — the three figures Dentally's Invoice Timeline
-- shows, computed the same way so the two can be checked against each other.
--
-- WHY. The Business Hub's "Treatments Closed" and "Treatment Plan Fees
-- Collected" cards were built from `invoice_items` filtered to lines carrying a
-- `treatment_plan_id`. That filter exists nowhere in Dentally, so neither figure
-- appeared in any Dentally report and the owner could not check either one. For
-- Rochester 1-6 Sep 2026 the card read £11,781.22 against a Dentally total of
-- £11,877.62 — £136.40 of non-plan lines, unexplained on screen.
--
-- Dentally's Invoice Timeline (Invoices -> Invoice Timeline, filtered by
-- Location) states three numbers per month:
--
--     Total  = every invoice raised
--     Unpaid = the outstanding balance still owed
--     Paid   = Total - Unpaid
--
-- This returns exactly those, from `invoices` rather than `invoice_items`, so a
-- card can be reconciled against that screen line for line. Verified against the
-- live project for Rochester, 1-6 Sep 2026: Total £11,877.62, Unpaid £449.00,
-- Paid £11,428.62 — matching Dentally to the penny once the one invoice Dentally
-- has since deleted is excluded (we hold it because the Dentally sync prunes
-- deleted appointments and payments but never deleted INVOICES; that gap is
-- tracked separately and inflates these totals until it is closed).
--
-- IMPORTANT — "Paid" is not proof of cash. Dentally settles an invoice either by
-- a payment or by an adjustment (write-off, plan allocation, insurance credit),
-- and `amount_outstanding` reaching zero does not say which. Payment-dated
-- collection needs the `explanations[]` array we currently discard on ingest —
-- see docs/superpowers/specs/2026-09-06-payment-invoice-linkage-scope.md. Until
-- then this column means "settled", and the UI must say so.
--
-- Dated on `dated_on` (a DATE), resolved through the London window convention of
-- migration 000163 — never `::date` on a window bound.
-- ============================================================================

create or replace function public.invoice_totals_by_practice(
  p_org uuid, p_since timestamptz, p_until timestamptz default null
)
returns table(practice_id uuid,
              invoiced_pence bigint,
              outstanding_pence bigint,
              settled_pence bigint,
              invoice_count bigint)
language sql stable security definer
set search_path = public
as $function$
  select i.practice_id,
         coalesce(sum(i.amount_pence), 0)::bigint,
         coalesce(sum(i.amount_outstanding_pence), 0)::bigint,
         -- Clamped at zero: an over-payment leaves a NEGATIVE outstanding on the
         -- invoice, and letting that inflate "settled" past what was invoiced
         -- would make the card claim more was collected than was ever charged.
         greatest(0, coalesce(sum(i.amount_pence - coalesce(i.amount_outstanding_pence, 0)), 0))::bigint,
         count(*)::bigint
  from public.invoices i
  where i.organisation_id = p_org
    and i.dated_on >= public.window_first_day(p_since)
    and (p_until is null or i.dated_on <= public.window_last_day(p_until))
  group by i.practice_id;
$function$;

comment on function public.invoice_totals_by_practice(uuid, timestamptz, timestamptz) is
  'Invoiced / outstanding / settled per practice over a London day window, matching the three columns of Dentally''s Invoice Timeline. "settled" means the invoice balance reached zero by ANY means (payment or adjustment) — it is not evidence of cash received.';

revoke all on function public.invoice_totals_by_practice(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.invoice_totals_by_practice(uuid, timestamptz, timestamptz) to service_role;

-- The window read is org + date, carrying the summed columns so the grouping
-- never has to visit the heap.
create index if not exists invoices_org_dated_totals_idx
  on public.invoices (organisation_id, dated_on)
  include (practice_id, amount_pence, amount_outstanding_pence);

notify pgrst, 'reload schema';
