-- ============================================================================
-- CRM leads split by the ad channel that bought them.
--
-- WHY. The Business Hub's "Leads" card summed `ad_metrics.conversions` —
-- PLATFORM-REPORTED conversions, which are any optimised action, not enquiries.
-- For Plan4growth 1-6 Sep 2026 it read 1,047 Meta leads while the CRM took 303
-- enquiries in total from every source, and our own Facebook report attributed
-- 187 of those to Meta. One product, two answers, 5.6x apart.
--
-- (Meta's own figure is additionally inflated by `conversionsFromActions`
-- matching both the `*_total` roll-ups and their components, so the same
-- conversion is counted more than once. That is a separate fix in
-- meta-ads-sync.js; this function simply stops the Business Hub depending on it.)
--
-- The channel is identified STRUCTURALLY — the lead's campaign id must resolve
-- to a campaign this org actually has ad_metrics rows for, under that provider —
-- and never by a CRM label such as `attribution_source`. Another tenant's CRM
-- may name the channel differently, or not be GoHighLevel at all, and keying off
-- a label would render an empty report that looks perfectly healthy. This is the
-- same test `ad_meta_funnel` uses, and it reproduces that function's count
-- exactly (187 for the window above).
--
-- Returns ONLY the attributed channels. The caller holds the CRM total and
-- derives the remainder, so the card's parts always sum to the total it shows
-- rather than to whatever this function happened to match.
-- ============================================================================

create or replace function public.lead_counts_by_channel(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid default null
)
returns table(channel text, leads bigint)
language sql stable security definer
set search_path = public
as $function$
  with l as (
    select c.ad_campaign_id
    from public.ad_lead_conversions(p_org, p_since, p_until, p_practice) c
    where c.ad_campaign_id is not null
  ),
  prov as (
    select distinct m.provider, m.campaign_id
    from public.ad_metrics m
    where m.organisation_id = p_org and m.campaign_id is not null
  )
  select pr.provider::text, count(*)::bigint
  from l join prov pr on pr.campaign_id = l.ad_campaign_id
  group by pr.provider;
$function$;

comment on function public.lead_counts_by_channel(uuid, timestamptz, timestamptz, uuid) is
  'CRM leads in the window whose campaign resolves to one of this org''s own ad_metrics campaigns, counted per provider. Channel is structural, never a CRM attribution label. Attributed channels only — the caller owns the total and the remainder.';

revoke all on function public.lead_counts_by_channel(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.lead_counts_by_channel(uuid, timestamptz, timestamptz, uuid) to service_role;

notify pgrst, 'reload schema';
