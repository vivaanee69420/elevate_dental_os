-- 20260101000119_call_reporting_multi_sheet.sql
-- Call Reporting v2 — one Google Sheet per practice (self-contained labels).
-- sheet_sources: N per org + practice_label; sheet_leads: Yes/No call buckets
-- + pipeline_name (per-row practice columns dropped); sheet_practice_map and
-- its restamp RPC removed; dashboard RPC now returns the 10-card counts and
-- filters by source (= practice) instead of practice_id.
-- Spec: docs/superpowers/specs/2026-08-05-call-reporting-v2-multi-sheet-design.md
-- Idempotent. After hosted apply run: NOTIFY pgrst, 'reload schema';

-- 1) sheet_sources: many per org, one per practice --------------------------
alter table public.sheet_sources add column if not exists practice_label text;
alter table public.sheet_sources drop constraint if exists sheet_sources_organisation_id_key;
create unique index if not exists sheet_sources_org_spreadsheet_key
  on public.sheet_sources (organisation_id, spreadsheet_id);

-- 2) sheet_leads: v2 shape. v1 rows are wiped (feature shipped yesterday,
--    a re-sync fully repopulates) — the old columns don't map to the new.
delete from public.sheet_leads;
alter table public.sheet_leads add column if not exists called_3m  boolean not null default false;
alter table public.sheet_leads add column if not exists called_10m boolean not null default false;
alter table public.sheet_leads add column if not exists pipeline_name text;
alter table public.sheet_leads drop column if exists first_call_at;
alter table public.sheet_leads drop column if exists lead_source;
alter table public.sheet_leads drop column if exists pipeline_status;
alter table public.sheet_leads drop column if exists practice_value;
alter table public.sheet_leads drop column if exists practice_id;  -- takes its index with it
create index if not exists sheet_leads_org_source_created_idx
  on public.sheet_leads (organisation_id, source_id, created_at);
-- sheet_leads_org_created_idx (organisation_id, created_at) stays from v1.

-- 3) Per-row practice mapping: obsolete -------------------------------------
drop function if exists public.restamp_sheet_lead_practices(uuid);
drop table if exists public.sheet_practice_map;

-- 4) Dashboard RPC v2 — return shape changed => drop first ------------------
drop function if exists public.sheet_leads_dashboard(uuid, date, uuid, text);
create function public.sheet_leads_dashboard(
  p_org uuid,
  p_date date,
  p_source uuid default null,
  p_tz text default 'Europe/London'
)
returns table (
  total bigint,
  called_3m bigint,
  called_10m bigint,
  in_pipeline bigint,
  not_called bigint,
  office_time bigint,
  outside_office bigint,
  facebook bigint,
  google bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) as total,
    count(*) filter (where l.called_3m)  as called_3m,
    count(*) filter (where l.called_10m) as called_10m,
    count(*) filter (where nullif(trim(coalesce(l.pipeline_name, '')), '') is not null) as in_pipeline,
    count(*) filter (where not l.called_3m and not l.called_10m) as not_called,
    -- Office hours: Mon-Fri 09:00-16:59 local (p_tz). 17:00 exactly is outside.
    count(*) filter (where extract(isodow from (l.created_at at time zone p_tz)) between 1 and 5
                       and (l.created_at at time zone p_tz)::time >= time '09:00'
                       and (l.created_at at time zone p_tz)::time <  time '17:00') as office_time,
    count(*) filter (where not (extract(isodow from (l.created_at at time zone p_tz)) between 1 and 5
                       and (l.created_at at time zone p_tz)::time >= time '09:00'
                       and (l.created_at at time zone p_tz)::time <  time '17:00')) as outside_office,
    count(*) filter (where l.pipeline_name ~* '(facebook|\mfb\M|meta)')  as facebook,
    count(*) filter (where l.pipeline_name ~* '(google|adwords|\mppc\M)') as google
  from public.sheet_leads l
  where l.organisation_id = p_org
    and (l.created_at at time zone p_tz)::date = p_date
    and (p_source is null or l.source_id = p_source)
$$;

notify pgrst, 'reload schema';
