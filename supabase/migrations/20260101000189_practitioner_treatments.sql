-- ============================================================================
-- Completed treatments, per practitioner.
--
-- The Practitioner Performance page needs treatment volume beside time and
-- revenue, and nothing so far answers "how many did THIS clinician complete".
-- treatments_completed_by_practice groups by site; treatments_completed_lines
-- goes the other way and returns one row per item carrying a PATIENT NAME — a
-- page that only wants a count per clinician should never pull that, so this
-- aggregates in SQL and returns no patient-identifying column at all.
--
-- SAME filter as treatments_completed_by_practice, so the numbers reconcile to
-- the Business Hub card rather than quietly disagreeing with it:
--   completed IS TRUE, base_chart IS FALSE, bucketed on completed_at.
-- base_chart rows are the charting of existing work, not treatment performed.
--
-- KEYED ON pms_practitioner_id, not associate_id, because that is what
-- practitioner_utilisation_daily returns and this has to join to it. A page
-- that joined utilisation by one identity and treatments by another would
-- attribute a clinician's chair time to one row and their treatments to
-- another, and both rows would look plausible.
--
-- patients is a DISTINCT count of pms_patient_id: a course of treatment is
-- several items for one person, so summing items would answer a different
-- question from the one the column is labelled with.
--
-- TOP TREATMENT is the most REPEATED one, by item count, with ties broken on
-- the name so the same window always returns the same answer. Deliberately not
-- by value: "most repeated" is a question about what a clinician spends their
-- day doing, and ranking by money would answer a different one and silently
-- hand back whichever single implant outweighed two hundred check-ups.
-- treatment_name is a catalogue label, never patient-identifying.
--
-- THE RANKING EXCLUDES NON-INVOICEABLE ITEMS, and by a STRUCTURAL test rather
-- than a name list. Measured on one month of this group: real treatments are
-- essentially always invoiceable while admin items essentially never are --
--   Scale & Polish 176 items / 176 on invoice     General Note 148 / 2
--   Exam           138 / 138                      Review        86 / 1
--   Composite Filling 128 / 128
-- Without the filter "General Note" is the practice's SECOND most repeated
-- "treatment" at 148 items and zero value, and it would become an individual
-- clinician's top treatment on the card. Matching the name would be a
-- hardcoded per-customer rule; appear_on_invoice is a property of the item.
--
-- The TOTALS above are deliberately left alone: treatments/patients/value keep
-- the same filter as treatments_completed_by_practice, so this page's counts
-- still reconcile to the Business Hub's "Treatments Completed" card. Only the
-- RANKING narrows -- a note completed is work logged, it just is not the
-- answer to "what does this clinician spend their days doing".
--
-- Idempotent.
-- ============================================================================

create or replace function public.treatments_completed_by_practitioner(
  p_org      uuid,
  p_since    date,
  p_until    date,
  p_practice uuid default null
)
returns table (
  practitioner_id     text,
  treatments          bigint,
  patients            bigint,
  value_pence         bigint,
  duration_minutes    bigint,
  top_treatment       text,
  top_treatment_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    with items as (
      select
        ti.pms_practitioner_id::text as practitioner_id,
        ti.pms_patient_id,
        ti.price_pence,
        ti.duration,
        -- An unnamed item still counts toward the totals; it just cannot win
        -- "top treatment", because "" is not an answer anyone can act on.
        nullif(btrim(ti.treatment_name), '') as treatment_name,
        ti.appear_on_invoice is true         as invoiceable
      from public.dentally_treatment_items ti
      where ti.organisation_id = $1
        and ti.completed  is true
        and ti.base_chart is false
        and ti.pms_practitioner_id is not null
        -- London dates, matching how every other window in this product
        -- buckets. completed_at is an instant; bucketing it in UTC would move
        -- a 00:30 BST completion onto the previous day.
        and (ti.completed_at at time zone 'Europe/London')::date >= $2
        and (ti.completed_at at time zone 'Europe/London')::date <= $3
        and ($4::uuid is null or ti.practice_id = $4)
    ),
    totals as (
      select
        practitioner_id,
        count(*)::bigint                          as treatments,
        count(distinct pms_patient_id)::bigint    as patients,
        coalesce(sum(price_pence), 0)::bigint     as value_pence,
        coalesce(sum(duration), 0)::bigint        as duration_minutes
      from items
      group by 1
    ),
    ranked as (
      select
        practitioner_id,
        treatment_name,
        count(*)::bigint as n,
        row_number() over (
          partition by practitioner_id
          -- Ties broken on the NAME so one window always returns one answer.
          order by count(*) desc, treatment_name asc
        ) as rn
      from items
      where treatment_name is not null
        and invoiceable            -- see the header: structural, not a name list
      group by 1, 2
    )
    select
      t.practitioner_id,
      t.treatments,
      t.patients,
      t.value_pence,
      t.duration_minutes,
      r.treatment_name,
      r.n
    from totals t
    left join ranked r on r.practitioner_id = t.practitioner_id and r.rn = 1
  $q$ using p_org, p_since, p_until, p_practice;
end;
$fn$;

revoke all on function public.treatments_completed_by_practitioner(uuid, date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.treatments_completed_by_practitioner(uuid, date, date, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- The same question for the whole practice.
--
-- A separate function rather than a null-practitioner row folded into the one
-- above: the group's most repeated treatment is NOT derivable from each
-- practitioner's top one. Twelve clinicians whose top item is a different
-- check-up variant can be beaten outright by a thirteenth treatment nobody
-- ranked first, and summing per-practitioner winners would return a confident
-- wrong answer that looks entirely reasonable.
--
-- Capped at five rows in SQL. PostgREST truncates a set-returning function at
-- 1000 rows in silence, and a practice's treatment catalogue runs to hundreds.
-- ---------------------------------------------------------------------------
create or replace function public.treatments_top_by_org(
  p_org      uuid,
  p_since    date,
  p_until    date,
  p_practice uuid default null
)
returns table (
  treatment_name text,
  treatments     bigint,
  patients       bigint,
  value_pence    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    select
      nullif(btrim(ti.treatment_name), '')      as treatment_name,
      count(*)::bigint                          as treatments,
      count(distinct ti.pms_patient_id)::bigint as patients,
      coalesce(sum(ti.price_pence), 0)::bigint  as value_pence
    from public.dentally_treatment_items ti
    where ti.organisation_id = $1
      and ti.completed  is true
      and ti.base_chart is false
      and nullif(btrim(ti.treatment_name), '') is not null
      -- Same structural exclusion as the per-practitioner ranking, so the two
      -- cards cannot name different winners for the same reason.
      and ti.appear_on_invoice is true
      and (ti.completed_at at time zone 'Europe/London')::date >= $2
      and (ti.completed_at at time zone 'Europe/London')::date <= $3
      and ($4::uuid is null or ti.practice_id = $4)
    group by 1
    order by 2 desc, 1 asc
    limit 5
  $q$ using p_org, p_since, p_until, p_practice;
end;
$fn$;

revoke all on function public.treatments_top_by_org(uuid, date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.treatments_top_by_org(uuid, date, date, uuid)
  to service_role;

-- Covers the filter above: org first, then the completed subset by day.
create index if not exists dentally_treatment_items_org_completed_idx
  on public.dentally_treatment_items (organisation_id, completed_at)
  where completed is true and base_chart is false;

notify pgrst, 'reload schema';
