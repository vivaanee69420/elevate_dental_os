-- ============================================================================
-- The Marketing block's funnel, scoped to the SELECTED AD ACCOUNTS.
--
-- WHY. The Business Hub scoped its marketing cards by PRACTICE, so filtering to
-- Meta/Ashford + Google/Rochester counted every enquiry those two practices
-- received — walk-ins, referrals, other channels — 200 leads, where the Facebook
-- and Google report pages counted the 66 those two accounts actually bought.
-- Three screens in one product answering the same question three ways.
--
-- This reads THROUGH the very functions those pages use (ad_meta_lead_ledger,
-- ad_google_lead_ledger) rather than re-deriving booked/accepted/paid, so the
-- Business Hub cannot drift from them: same leads, same funnel, same money rule
-- (accepted = settled payments over the floor, from the lead's own day onward).
--
-- The account is resolved STRUCTURALLY — the lead's campaign must appear in this
-- org's own ad_metrics rows under that customer_id — never a CRM label, which
-- another tenant may spell differently or not use at all.
--
-- EXPECT NEAR-ZERO MONEY ON A SHORT WINDOW, and do not "fix" it: a lead takes
-- weeks to become a paying patient, so six days of attributed revenue really is
-- about nil. The figure this replaced looked healthier only because it divided
-- the whole group's plan fees by one account's leads.
-- ============================================================================

create or replace function public.ad_account_marketing(
  p_org uuid, p_since timestamptz, p_until timestamptz,
  p_accounts text[] default null, p_min_paid_pence integer default 4000
)
returns table(leads bigint, booked bigint, patients bigint,
              new_patients bigint, paid_pence bigint)
language sql stable security definer
set search_path = public
as $function$
  with led as (
    select m.campaign_id, m.booked, m.accepted, m.is_new_patient, m.paid_pence
    from public.ad_meta_lead_ledger(p_org, p_since, p_until, p_min_paid_pence) m
    union all
    select g.campaign_id, g.booked, g.accepted, g.is_new_patient, g.paid_pence
    from public.ad_google_lead_ledger(p_org, p_since, p_until, p_min_paid_pence) g
  ),
  acct as (
    select distinct campaign_id, customer_id
    from public.ad_metrics
    where organisation_id = p_org and campaign_id is not null
  )
  select count(*)::bigint,
         count(*) filter (where led.booked)::bigint,
         count(*) filter (where led.accepted)::bigint,
         count(*) filter (where led.is_new_patient)::bigint,
         coalesce(sum(led.paid_pence), 0)::bigint
  from led join acct on acct.campaign_id = led.campaign_id
  where p_accounts is null or acct.customer_id = any(p_accounts);
$function$;

comment on function public.ad_account_marketing(uuid, timestamptz, timestamptz, text[], integer) is
  'Marketing funnel (leads/booked/patients/new patients/paid) for the given ad accounts, read through the same per-lead ledgers the Facebook and Google report pages use so the three screens cannot disagree. Account resolved structurally via ad_metrics, never a CRM label.';

revoke all on function public.ad_account_marketing(uuid, timestamptz, timestamptz, text[], integer) from public, anon, authenticated;
grant execute on function public.ad_account_marketing(uuid, timestamptz, timestamptz, text[], integer) to service_role;

notify pgrst, 'reload schema';
