-- 20260101000025_associate_dentally.sql
-- Link Dentally practitioners to associates + per-associate appointment stats.
-- Idempotent.

ALTER TABLE associates ADD COLUMN IF NOT EXISTS pms_external_id TEXT;

-- Non-partial unique index: Postgres treats NULLs as distinct, so existing
-- manually-created associates (null pms id) remain valid and many can coexist.
-- Also serves as the ON CONFLICT arbiter for the sync upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_associates_org_pms
  ON associates(organisation_id, pms_external_id);

-- Per-associate appointment rollup over a rolling window. Mirrors
-- appointments_rollup_by_practice. service_role calls it; grant to
-- authenticated too for parity with the other analytics RPCs.
create or replace function public.associate_appointment_stats(
  p_org uuid, p_since timestamptz
)
returns table(associate_id uuid, total bigint, completed bigint, no_shows bigint)
language sql stable security definer set search_path = public as $$
  select a.associate_id,
         count(*)::bigint                                           as total,
         count(*) filter (where a.status = 'completed')::bigint    as completed,
         count(*) filter (where a.status = 'no_show')::bigint      as no_shows
  from public.appointments a
  where a.organisation_id = p_org
    and a.associate_id is not null
    and a.starts_at >= p_since
  group by a.associate_id;
$$;

grant execute on function public.associate_appointment_stats(uuid, timestamptz) to service_role, authenticated;
