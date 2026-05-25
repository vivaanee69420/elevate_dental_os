-- Exact settled-payment revenue aggregation, computed in Postgres so totals are
-- not silently truncated by PostREST's 1000-row read cap (orgs have >1000
-- payments; summing fetched rows in Node undercounts). Returns one row per day
-- (<=366 for a 12-month window — well under any cap); callers bucket days into
-- months/weeks and sum for TTM. p_practice NULL = org-wide.
create or replace function public.settled_receipts_by_day(
  p_org uuid,
  p_since timestamptz,
  p_practice uuid default null
)
returns table(day date, pence bigint)
language sql
stable
security definer
set search_path = public
as $$
  select date_trunc('day', processed_at)::date as day,
         coalesce(sum(amount_pence), 0)::bigint as pence
  from public.payments
  where organisation_id = p_org
    and status = 'settled'
    and processed_at >= p_since
    and (p_practice is null or practice_id = p_practice)
  group by 1
  order by 1;
$$;

grant execute on function public.settled_receipts_by_day(uuid, timestamptz, uuid)
  to service_role, authenticated;
