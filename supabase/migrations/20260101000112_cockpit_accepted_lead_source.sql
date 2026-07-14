-- ============================================================================
-- Daily Command Cockpit — which GHL ad pipeline each Emergent-accepted
-- treatment originally came from, so a conversion can be tagged with the ad
-- that produced it ("this patient came from 1. Google Ads Leads").
--
-- Why SQL and not the JS matcher: the accepted rows in a window are few, but
-- the leads they have to be matched against are EVERY pipeline lead the org
-- has ever had (a patient accepted in July may have come in as a lead in
-- March). Pulling all of those into Node just to match a few hundred rows is
-- what the rollup RPCs elsewhere in this schema exist to avoid.
--
-- Match precedence mirrors lead-attribution.service.js exactly:
--   normalised phone (last 10 digits)  ->  lower/trimmed email
--   ->  practice-scoped normalised name (last resort; a common name must not
--       match across practices)
--
-- Ties break on the EARLIEST lead — first touch. A patient who came in on
-- "2. Facebook Ads Leads" in March and was later moved into "Open Day July"
-- was won by the Facebook ad; crediting the pipeline they ended up in would
-- report the follow-up as the source and no ad would ever get credit.
-- Idempotent.
-- ============================================================================

create or replace function public.cockpit_accepted_lead_source(
  p_org uuid,
  p_since date,
  p_until date,
  p_practice uuid default null
)
returns table (
  accepted_id uuid,
  ghl_pipeline_id text,
  lead_created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with acc as (
    select
      ta.id,
      ta.practice_id,
      nullif(right(regexp_replace(coalesce(ta.phone, ''), '\D', '', 'g'), 10), '') as ph,
      nullif(lower(trim(coalesce(ta.email, ''))), '')                              as em,
      nullif(lower(regexp_replace(trim(coalesce(ta.patient_name, '')), '\s+', ' ', 'g')), '') as nm
    from treatment_accepted ta
    where ta.organisation_id = p_org
      and ta.status = 'accepted'
      and ta.accepted_date >= p_since
      and ta.accepted_date <  p_until
      and (p_practice is null or ta.practice_id = p_practice)
  ),
  ld as (
    select
      l.ghl_pipeline_id,
      l.practice_id,
      l.created_at,
      nullif(right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10), '') as ph,
      nullif(lower(trim(coalesce(c.email, ''))), '')                              as em,
      nullif(lower(regexp_replace(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '\s+', ' ', 'g')), '') as nm
    from leads l
    join contacts c on c.id = l.contact_id
    where l.organisation_id = p_org
      and l.ghl_pipeline_id is not null
  )
  -- One equi-join per key, UNION ALL'd, rather than a single OR'd join: an OR
  -- across three keys forces a nested loop over every lead in the org and the
  -- statement times out through PostgREST. Equi-joins hash-join instead.
  -- (A NULL key never matches in a join, so the nullif()s above are the guard.)
  , m as (
    select acc.id, ld.ghl_pipeline_id, ld.created_at, 1 as prio
      from acc join ld on ld.ph = acc.ph
    union all
    select acc.id, ld.ghl_pipeline_id, ld.created_at, 2 as prio
      from acc join ld on ld.em = acc.em
    union all
    select acc.id, ld.ghl_pipeline_id, ld.created_at, 3 as prio
      from acc join ld
        on ld.nm = acc.nm
       -- name is the weakest key, so it only counts within the same practice;
       -- coalesced to a sentinel so this stays an equi-join (hash-joinable).
       and coalesce(ld.practice_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(acc.practice_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  select distinct on (m.id)
    m.id,
    m.ghl_pipeline_id,
    m.created_at
  from m
  order by m.id, m.prio, m.created_at asc;   -- phone > email > name; first touch wins
$$;

comment on function public.cockpit_accepted_lead_source(uuid, date, date, uuid) is
  'Cockpit: maps each accepted treatment in [p_since, p_until) to the GHL pipeline its lead came from (phone > email > practice-scoped name).';

grant execute on function public.cockpit_accepted_lead_source(uuid, date, date, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
