-- Data Room summaries cross-checked against the shipped dashboard RPCs, not
-- re-derived from source tables — this tests the same code path the
-- dashboard runs, so a bug in the RPC itself would still be caught (a
-- from-scratch re-derivation would silently agree with a shared bug).
-- Replace :org, :since, :until.
--
--   pm   <- data_room_practice_month (the Data Room summary under test)
--   ref  <- appointments_rollup_by_practice (Business Hub RPC, 000019/000076)
--           for occurred/dna/appointments. Its p_until bound is INCLUSIVE
--           (<=); data_room_practice_day's is EXCLUSIVE (<) on starts_at. To
--           compare like-for-like we call the rollup with
--           win.until - interval '1 second' so both sides see the same rows.
--   cash <- settled_revenue_by_practice (payments RPC, 000019/000049/000071)
--           for settled_pence, same inclusive/exclusive adjustment.
--   act  <- still re-derived inline from dentally_treatment_items: there is
--           no dashboard RPC returning practice+pence-grain treatment
--           activity, so this CTE is NOT a cross-check against shipped code,
--           only a rule re-derivation (documented, not fixed by this script).
with win as (select :'org'::uuid as org, :'since'::timestamptz as since, :'until'::timestamptz as until),
pm as (
  select practice_id, sum(appointments) as appointments, sum(occurred) as occurred, sum(dna) as dna,
         sum(settled_pence) as settled_pence, sum(treatment_items) as treatment_items,
         sum(treatment_items_pence) as treatment_items_pence
  from win, data_room_practice_month(win.org, win.since, win.until, null) group by 1
),
ref as (
  select practice_id, completed as occurred, no_shows as dna, total as appointments
  from win, appointments_rollup_by_practice(win.org, win.since, win.until - interval '1 second')
),
cash as (
  select practice_id, pence as settled_pence
  from win, settled_revenue_by_practice(win.org, win.since, win.until - interval '1 second')
),
act as (
  select ti.practice_id, count(*) as n, sum(ti.price_pence) as pence
  from win, dentally_treatment_items ti
  where ti.organisation_id = win.org and ti.completed and not ti.base_chart
    and ti.completed_at >= win.since and ti.completed_at < win.until
  group by 1
)
select pm.practice_id,
       pm.occurred = coalesce(ref.occurred, 0)                    as occurred_ok,
       pm.dna = coalesce(ref.dna, 0)                              as dna_ok,
       pm.appointments = coalesce(ref.appointments, 0)            as appointments_ok,
       pm.settled_pence = coalesce(cash.settled_pence, 0)         as settled_ok,
       pm.treatment_items = coalesce(act.n, 0)                    as activity_ok,
       pm.treatment_items_pence = coalesce(act.pence, 0)          as activity_pence_ok,
       (pm.occurred = coalesce(ref.occurred, 0) and pm.dna = coalesce(ref.dna, 0)
        and pm.appointments = coalesce(ref.appointments, 0)
        and pm.settled_pence = coalesce(cash.settled_pence, 0)
        and pm.treatment_items = coalesce(act.n, 0)
        and pm.treatment_items_pence = coalesce(act.pence, 0))    as ok
from pm
left join ref  on ref.practice_id  is not distinct from pm.practice_id
left join cash on cash.practice_id is not distinct from pm.practice_id
left join act  on act.practice_id  is not distinct from pm.practice_id
order by 1;
