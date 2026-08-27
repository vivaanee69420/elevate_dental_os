-- Data Room summaries must equal the dashboard rules. Replace :org, :since, :until.
with win as (select :'org'::uuid as org, :'since'::timestamptz as since, :'until'::timestamptz as until),
pm as (
  select practice_id, sum(occurred) as occurred, sum(dna) as dna, sum(settled_pence) as settled_pence,
         sum(treatment_items) as treatment_items, sum(treatment_items_pence) as treatment_items_pence
  from win, data_room_practice_month(win.org, win.since, win.until, null) group by 1
),
ref as (
  select a.practice_id,
         count(*) filter (where a.pms_patient_id is not null and a.status = 'completed') as occurred,
         count(*) filter (where a.pms_patient_id is not null and a.status = 'no_show')   as dna
  from win, appointments a
  where a.organisation_id = win.org and a.source = 'dentally' and a.starts_at >= win.since and a.starts_at < win.until
  group by 1
),
cash as (
  select p.practice_id, sum(p.amount_pence) as settled_pence
  from win, payments p
  where p.organisation_id = win.org and p.status = 'settled' and p.processed_at >= win.since and p.processed_at < win.until
  group by 1
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
       pm.settled_pence = coalesce(cash.settled_pence, 0)         as settled_ok,
       pm.treatment_items = coalesce(act.n, 0)                    as activity_ok,
       pm.treatment_items_pence = coalesce(act.pence, 0)          as activity_pence_ok,
       (pm.occurred = coalesce(ref.occurred, 0) and pm.dna = coalesce(ref.dna, 0)
        and pm.settled_pence = coalesce(cash.settled_pence, 0)
        and pm.treatment_items = coalesce(act.n, 0)
        and pm.treatment_items_pence = coalesce(act.pence, 0))    as ok
from pm
left join ref  on ref.practice_id  is not distinct from pm.practice_id
left join cash on cash.practice_id is not distinct from pm.practice_id
left join act  on act.practice_id  is not distinct from pm.practice_id
order by 1;
