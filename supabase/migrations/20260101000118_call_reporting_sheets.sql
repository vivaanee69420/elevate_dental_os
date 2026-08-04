-- 20260101000118_call_reporting_sheets.sql
-- Call Reporting — Google Sheets lead-response dashboard.
-- One connected sheet per org (raw lead rows), synced into sheet_leads and
-- aggregated per practice + date by sheet_leads_dashboard(). Practice
-- resolution is an EXPLICIT map (sheet_practice_map) — never name-matching
-- (Emergent lesson). Only the five mapped columns are ever stored: no names,
-- phones or emails (data minimisation is the primary security control).
-- Idempotent. After hosted apply run: NOTIFY pgrst, 'reload schema';

-- 1) Connected sheet source (one per org) ----------------------------------
create table if not exists public.sheet_sources (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations(id) on delete cascade,
  spreadsheet_id   text not null,
  spreadsheet_url  text,
  title            text,
  tab_name         text,
  sheet_timezone   text,
  -- {practice: colIdx, created_at: colIdx, first_call_at: colIdx,
  --  source: colIdx, pipeline_status: colIdx} + header_row (1-based)
  column_mapping   jsonb,
  header_row       int not null default 1,
  last_synced_row  int not null default 0,
  row_count        int not null default 0,
  skipped_rows     int not null default 0,
  status           text not null default 'pending'
                   check (status in ('pending','active','failed')),
  last_error       text,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id)
);
alter table public.sheet_sources enable row level security;
-- App path uses serviceClient + explicit .eq('organisation_id', orgId) (rule 3).

-- 2) Explicit sheet practice value -> practice map -------------------------
create table if not exists public.sheet_practice_map (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations(id) on delete cascade,
  sheet_value      text not null,
  practice_id      uuid references public.practices(id) on delete set null,  -- null = unmapped
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, sheet_value)
);
create index if not exists sheet_practice_map_org_idx
  on public.sheet_practice_map (organisation_id);
alter table public.sheet_practice_map enable row level security;

-- 3) Synced lead rows (minimised: the five mapped fields only) -------------
create table if not exists public.sheet_leads (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations(id) on delete cascade,
  source_id        uuid not null references public.sheet_sources(id) on delete cascade,
  practice_id      uuid references public.practices(id) on delete set null,
  practice_value   text,
  created_at       timestamptz not null,
  first_call_at    timestamptz,
  lead_source      text,
  pipeline_status  text,
  sheet_row_index  int not null,           -- 1-based row number in the sheet
  row_hash         text not null,          -- sha256 of the mapped values
  synced_at        timestamptz not null default now(),
  unique (source_id, sheet_row_index)
);
create index if not exists sheet_leads_org_practice_created_idx
  on public.sheet_leads (organisation_id, practice_id, created_at);
create index if not exists sheet_leads_org_created_idx
  on public.sheet_leads (organisation_id, created_at);
alter table public.sheet_leads enable row level security;

-- 4) Restamp practice_id from the map (instant apply on mapping change) ----
-- Case-insensitive trimmed equality — the SAME normalisation the sync uses at
-- write time, so restamp and stamp can never disagree.
create or replace function public.restamp_sheet_lead_practices(p_org uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.sheet_leads l
  set practice_id = m.practice_id
  from public.sheet_practice_map m
  where l.organisation_id = p_org
    and m.organisation_id = p_org
    and lower(trim(coalesce(l.practice_value, ''))) = lower(trim(m.sheet_value))
    and l.practice_id is distinct from m.practice_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 5) Dashboard aggregate: all cards in one round trip ----------------------
-- Dates bucket in p_tz (default Europe/London). p_practice null = group view.
-- unmapped = today's rows with no resolved practice (surfaced, never dropped).
create or replace function public.sheet_leads_dashboard(
  p_org uuid,
  p_date date,
  p_practice uuid default null,
  p_tz text default 'Europe/London'
)
returns table (
  total bigint,
  called_3m bigint,
  called_10m bigint,
  in_pipeline bigint,
  not_called bigint,
  facebook bigint,
  google bigint,
  unmapped bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) as total,
    count(*) filter (where first_call_at is not null
                       and first_call_at - created_at <= interval '3 minutes')  as called_3m,
    count(*) filter (where first_call_at is not null
                       and first_call_at - created_at <= interval '10 minutes') as called_10m,
    count(*) filter (where nullif(trim(coalesce(pipeline_status, '')), '') is not null) as in_pipeline,
    count(*) filter (where first_call_at is null) as not_called,
    count(*) filter (where lead_source ~* '(facebook|\mfb\M|meta)')  as facebook,
    count(*) filter (where lead_source ~* '(google|adwords|\mppc\M)') as google,
    count(*) filter (where practice_id is null) as unmapped
  from public.sheet_leads
  where organisation_id = p_org
    and (created_at at time zone p_tz)::date = p_date
    and (p_practice is null or practice_id = p_practice)
$$;

notify pgrst, 'reload schema';
