-- Business Hub conversion fix: redefine the leads "converted" count.
--
-- The old definition counted only leads whose status reached
-- 'treatment_started' / 'treatment_completed'. GHL leads almost never carry
-- those statuses (their lifecycle is new -> consultation_booked ->
-- contact_attempted/contact_made -> not_proceeding), so conversionRate was
-- structurally pinned at ~0% on every real org. The honest "this lead
-- converted" signal in the GHL vocabulary is a BOOKED CONSULTATION, so
-- consultation_booked now counts as converted too (treatment_started /
-- treatment_completed are retained for any Dentally-sourced leads).
--
-- Only caller: analyticsRepository.leadsRollupByPractice -> businessHub
-- conversionRate. CREATE OR REPLACE keeps the arg list, so no drop needed.
-- Idempotent; re-applies cleanly.

create or replace function public.leads_rollup_by_practice(
  p_org uuid, p_since timestamptz default null, p_until timestamptz default null
)
returns table(practice_id uuid, total bigint, converted bigint)
language sql stable security definer set search_path = public as $$
  select practice_id,
         count(*)::bigint,
         count(*) filter (
           where status in ('consultation_booked', 'treatment_started', 'treatment_completed')
         )::bigint
  from public.leads
  where organisation_id = p_org
    and (p_since is null or created_at >= p_since)
    and (p_until is null or created_at <= p_until)
  group by practice_id;
$$;
grant execute on function public.leads_rollup_by_practice(uuid, timestamptz, timestamptz) to service_role, authenticated;
