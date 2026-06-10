-- Integration gating ("hide data while revoked"): the payment-aggregation RPCs
-- sum across ALL sources, so a disconnected Dentally/QuickBooks would still show
-- its money on revenue surfaces. Add an optional p_exclude_sources text[] so the
-- backend can drop a revoked source's rows IN SQL (the aggregate can't be
-- filtered after the fact). Empty array {} = exclude nothing (unchanged behaviour).
-- payments.source is the integration provider id ('dentally' | 'quickbooks');
-- manual rows are 'manual' or NULL and must always survive -> coalesce(source,'')
-- so a NULL source is never matched by <> all(...).

-- settled_receipts_by_day: drop the 4-arg form, recreate with the 5th param.
drop function if exists public.settled_receipts_by_day(uuid, timestamptz, uuid, timestamptz);

create or replace function public.settled_receipts_by_day(
  p_org uuid,
  p_since timestamptz,
  p_practice uuid default null,
  p_until timestamptz default null,
  p_exclude_sources text[] default '{}'
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
    and (cardinality(p_exclude_sources) = 0 or coalesce(source, '') <> all(p_exclude_sources))
  group by 1
  order by 1;
$$;

grant execute on function public.settled_receipts_by_day(uuid, timestamptz, uuid, timestamptz, text[])
  to service_role, authenticated;

-- settled_revenue_by_practice: drop the 3-arg form, recreate with the 4th param.
drop function if exists public.settled_revenue_by_practice(uuid, timestamptz, timestamptz);

create or replace function public.settled_revenue_by_practice(
  p_org uuid, p_since timestamptz, p_until timestamptz default null,
  p_exclude_sources text[] default '{}'
)
returns table(practice_id uuid, pence bigint)
language sql stable security definer set search_path = public as $$
  select practice_id, coalesce(sum(amount_pence), 0)::bigint
  from public.payments
  where organisation_id = p_org and status = 'settled' and processed_at >= p_since
    and (p_until is null or processed_at <= p_until)
    and (cardinality(p_exclude_sources) = 0 or coalesce(source, '') <> all(p_exclude_sources))
  group by practice_id;
$$;

grant execute on function public.settled_revenue_by_practice(uuid, timestamptz, timestamptz, text[])
  to service_role, authenticated;

-- payment_summary: drop the 4-arg form, recreate with the 5th param.
drop function if exists public.payment_summary(uuid, timestamptz, timestamptz, uuid);

create or replace function public.payment_summary(
  p_org uuid,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_practice uuid default null,
  p_exclude_sources text[] default '{}'
)
returns table(received_pence bigint, outstanding_pence bigint, refunded_pence bigint, txn_count bigint)
language sql stable security definer set search_path = public as $$
  with f as (
    select amount_pence, status,
           ((p_since is null or processed_at >= p_since)
            and (p_until is null or processed_at <= p_until)) as in_range
    from public.payments
    where organisation_id = p_org
      and (p_practice is null or practice_id = p_practice)
      and (cardinality(p_exclude_sources) = 0 or coalesce(source, '') <> all(p_exclude_sources))
  )
  select
    coalesce(sum(amount_pence) filter (where status = 'settled' and in_range), 0)::bigint,
    coalesce(sum(amount_pence) filter (where status = 'pending'), 0)::bigint,
    coalesce(sum(amount_pence) filter (where status = 'refunded' and in_range), 0)::bigint,
    count(*) filter (where in_range)::bigint
  from f;
$$;

grant execute on function public.payment_summary(uuid, timestamptz, timestamptz, uuid, text[])
  to service_role, authenticated;

notify pgrst, 'reload schema';
