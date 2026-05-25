-- Add an optional upper bound (p_until) to the exact settled-receipts sum, so
-- finance pages can request a custom date range (not just "since"). NULL p_until
-- = no upper bound (unchanged behaviour). Replaces the 3-arg signature in-place
-- via a new 4-arg overload; the old 3-arg form is dropped so callers move over.
drop function if exists public.settled_receipts_by_day(uuid, timestamptz, uuid);

create or replace function public.settled_receipts_by_day(
  p_org uuid,
  p_since timestamptz,
  p_practice uuid default null,
  p_until timestamptz default null
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
    and (p_until is null or processed_at <= p_until)
    and (p_practice is null or practice_id = p_practice)
  group by 1
  order by 1;
$$;

grant execute on function public.settled_receipts_by_day(uuid, timestamptz, uuid, timestamptz)
  to service_role, authenticated;
