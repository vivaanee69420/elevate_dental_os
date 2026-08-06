-- Collected used the appointment's exact start TIME as its cutoff while
-- Invoiced used the whole day (dated_on >= date) — a deposit paid earlier on
-- conversion day was excluded from Collected but its invoice counted. Align
-- both windows to the start of the conversion day.

create or replace function public.sheet_export_revenue(p_org uuid, p_contact uuid, p_since timestamptz)
returns table (invoiced_pence bigint, collected_pence bigint)
language sql
security definer
set search_path = public as $$
  select
    coalesce((select sum(i.amount_pence) from public.invoices i
      where i.organisation_id = p_org and i.contact_id = p_contact
        and i.dated_on >= p_since::date), 0)::bigint,
    coalesce((select sum(p.amount_pence) from public.payments p
      where p.organisation_id = p_org and p.contact_id = p_contact
        and p.status = 'settled'
        and coalesce(p.processed_at, p.created_at) >= p_since::date), 0)::bigint;
$$;

grant execute on function public.sheet_export_revenue(uuid, uuid, timestamptz) to service_role;
revoke all on function public.sheet_export_revenue(uuid, uuid, timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';
