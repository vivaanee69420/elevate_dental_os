-- ============================================================================
-- restamp_ghl_practices — push a GoHighLevel subaccount's practice onto the
-- contacts and leads it already pulled.
--
-- WHY IT DID NOT EXIST, AND WHY THAT MATTERED. A GHL contact or lead gets its
-- practice from the subaccount that fetched it — gohighlevel-sync.js passes
-- `account.practice_id` straight through to every row it writes. But the
-- screen that CHANGES that mapping (setSubaccountPractice) only updated
-- integration_accounts and stopped there, so the mapping applied to rows
-- fetched afterwards and to nothing already stored. Every ad-account mapping
-- on this page restamps (restamp_ad_metrics_practices, ad_grain_restamp_
-- practices); the subaccount one silently did not.
--
-- Measured on a live sub-account: 2,957 leads, ALL of them practice_id NULL,
-- with the org's single GHL subaccount mapped to no practice. Filtering the
-- Marketing pages to that org's only practice returned 0 leads beside real
-- spend — a confident zero produced entirely by a mapping step.
--
-- The rule here is copied from the sync rather than invented, so the poll and
-- the restamp cannot disagree: a row's practice is its integration account's
-- practice, full stop, including when that becomes NULL again. Rows with no
-- integration_account_id are not GHL's to stamp and are never touched — that
-- is what keeps a Dentally-derived practice on a Dentally contact.
--
-- Idempotent; running it twice changes nothing the second time.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================
create or replace function public.restamp_ghl_practices(p_org uuid)
returns table (contacts_updated bigint, leads_updated bigint)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  c_count bigint;
  l_count bigint;
begin
  with upd as (
    update contacts c
       set practice_id = ia.practice_id
      from integration_accounts ia
     where ia.id = c.integration_account_id
       and ia.organisation_id = p_org
       and c.organisation_id  = p_org
       -- IS DISTINCT FROM, so a NULL on either side compares properly and the
       -- statement is a no-op once the rows already agree.
       and c.practice_id IS DISTINCT FROM ia.practice_id
    returning 1
  ) select count(*) into c_count from upd;

  with upd as (
    update leads l
       set practice_id = ia.practice_id
      from integration_accounts ia
     where ia.id = l.integration_account_id
       and ia.organisation_id = p_org
       and l.organisation_id  = p_org
       and l.practice_id IS DISTINCT FROM ia.practice_id
    returning 1
  ) select count(*) into l_count from upd;

  return query select c_count, l_count;
end;
$fn$;

REVOKE ALL ON FUNCTION public.restamp_ghl_practices(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restamp_ghl_practices(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
