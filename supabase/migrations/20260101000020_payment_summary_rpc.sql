-- Exact payment summary in Postgres (no 1000-row cap) + filterable by practice
-- and date range. received/refunded/count are scoped to [p_since,p_until] by
-- processed_at; outstanding = ALL pending for the practice (a running total, not
-- date-ranged). NULL bounds = open.
create or replace function public.payment_summary(
  p_org uuid,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_practice uuid default null
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
  )
  select
    coalesce(sum(amount_pence) filter (where status = 'settled' and in_range), 0)::bigint,
    coalesce(sum(amount_pence) filter (where status = 'pending'), 0)::bigint,
    coalesce(sum(amount_pence) filter (where status = 'refunded' and in_range), 0)::bigint,
    count(*) filter (where in_range)::bigint
  from f;
$$;

grant execute on function public.payment_summary(uuid, timestamptz, timestamptz, uuid) to service_role, authenticated;
