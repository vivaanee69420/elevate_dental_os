-- ============================================================================
-- Practitioner rota — the denominator, from Dentally, at last.
--
-- WHAT CHANGED. Utilisation needs available time. Every earlier attempt to get
-- it from Dentally failed: 29 candidate paths 404, /practitioners carries no
-- hours, /appointments/availability refuses a past start_time. The conclusion
-- recorded in 000186 and in commit 1f33f64 — "WE CANNOT REPRODUCE DENTALLY'S
-- TOTAL" — was WRONG, and only because of a missing parameter.
--
-- GET /v1/rota_practitioner_diaries?{after, before, practitioner_id, site_id}
--
-- `after` and `before` are REQUIRED. Without them it returns 400 with an empty
-- body, which is why 48 further parameter combinations all failed while three
-- nonsense control paths (/zzz_practitioner_diaries, /rota_zzz_diaries,
-- /rota_practitioner_zzzz) returned a clean 404 — the endpoint was there the
-- whole time, rejecting the request rather than denying the route.
--
-- IT RECONCILES TO DENTALLY EXACTLY. The one cell we had a Dentally reading
-- for is practitioner 201099 on 21 September: Dentally showed 4h15 utilised
-- against a total of 3h00 (142%); we showed the same 4h15 against 9h30 (45%).
-- The rota says 3h00. The whole discrepancy was the denominator.
--
-- WHAT THE FEED IS, measured not assumed:
--   * Historical, not projected. The week of 1 September holds 188 rostered
--     slots in 2024, 120 in 2025 and 105 in 2026, and 151 of 385
--     practitioner-weekday slots differ between 2024 and 2026. It reaches back
--     to at least 2023 and forward four years.
--   * One row per practitioner per day, always. 6,758 rows over one month,
--     6,758 distinct practitioner-days, ZERO days carrying more than one row —
--     which is what makes (organisation_id, pms_practitioner_id, day) a safe
--     primary key here and keeps the join below one-to-one.
--   * A day off is a row with unavailable=true and NULL times, NOT a missing
--     row. That distinction is kept: "not rostered" and "no rota at all" are
--     different states and must not both read as zero.
--   * Named breaks come with it ("Lunch" 14:00-15:00), so gross and net of
--     breaks are both available rather than assumed.
--   * A row carries no site_id in its body, but site_id IS a query filter, and
--     the sites PARTITION the rota: per-site counts summed to 1,705 against an
--     unfiltered 1,705 with a union of 1,705 and no orphans. So practice is
--     stamped by fetching once per mapped site, and that is complete.
--   * It requires the Rota feature to be enabled on the practice, so
--     practitioner_schedules (000187) stays as the manual fallback for a
--     tenant that does not have it. Neither replaces the other.
--
-- THE TRAP THIS TABLE DOES NOT SOLVE, recorded so the reader does not repeat
-- it: the rota rosters EVERY member of staff, not just clinicians. In August
-- 2026 this group had 55 rostered people of whom 20 treated no patient at all,
-- each carrying about 235 hours. Divide by all of them and utilisation reads
-- 16.8%, which is a fabricated collapse, not a finding. Restricting the
-- denominator to people who actually treated a patient gives 42.7% (August),
-- 44.3% (June), 38.8% (April) — a stable series. That restriction is a
-- REPORTING rule and lives in the service, which has the whole window in hand;
-- it is deliberately not baked into this function, because a day's rota is a
-- fact and who counts as a clinician is a judgement.
--
-- ALSO REPAIRED HERE. clinical_secs was added to
-- practitioner_utilisation_daily on hosted by commit 1f33f64 but the widening
-- was never written into a migration, so the repo's 000186 still returns the
-- old column list and a fresh `supabase db reset` builds a function the
-- service crashes on. The body below is the LIVE hosted definition plus the
-- rota columns, so this file — not 000186 — is now the authoritative one.
--
-- Idempotent.
-- ============================================================================

create table if not exists public.practitioner_rota_days (
  organisation_id     uuid        not null references public.organisations(id) on delete cascade,
  -- Dentally's own practitioner id, as text, matching
  -- appointments.pms_practitioner_id so the join needs no translation table.
  pms_practitioner_id text        not null,
  day                 date        not null,
  -- Stamped from the site the row was fetched under; null when the org has
  -- mapped no sites, which reads as "group-wide", never as a practice.
  practice_id         uuid        references public.practices(id) on delete set null,
  pms_site_id         text,
  -- Real instants, not minutes-from-midnight. A rota row is a concrete dated
  -- session and Dentally hands us offsets ("2026-09-01T09:30:00.000+01:00"),
  -- so storing instants keeps it DST-correct without a conversion. This is
  -- deliberately unlike practitioner_schedules (000187), which stores minutes
  -- because it is a RECURRING WEEKLY PATTERN with no date to anchor an offset.
  starts_at           timestamptz,
  ends_at             timestamptz,
  break_secs          integer     not null default 0 check (break_secs >= 0),
  -- true = rostered off. Distinct from having no row at all.
  unavailable         boolean     not null default false,
  -- Dentally's row uuid, kept for tracing a figure back to its source record.
  rota_external_id    text,
  synced_at           timestamptz not null default now(),
  primary key (organisation_id, pms_practitioner_id, day),
  -- A rostered row must carry both ends or neither; a half-open session would
  -- silently contribute a null duration to a sum.
  constraint practitioner_rota_days_window_chk
    check ((starts_at is null) = (ends_at is null)),
  constraint practitioner_rota_days_order_chk
    check (starts_at is null or ends_at > starts_at)
);

alter table public.practitioner_rota_days enable row level security;

-- The read path is the RPC below and the sync writes as service_role, so no
-- policy is granted — matching every other table on this path.

create index if not exists practitioner_rota_days_org_day_idx
  on public.practitioner_rota_days (organisation_id, day);
create index if not exists practitioner_rota_days_org_practice_day_idx
  on public.practitioner_rota_days (organisation_id, practice_id, day)
  where practice_id is not null;

comment on table public.practitioner_rota_days is
  'Dentally rota (GET /v1/rota_practitioner_diaries, after+before required). One row per practitioner per day; unavailable=true is a rostered day off, a missing row is no rota at all.';

-- ---------------------------------------------------------------------------
-- practitioner_utilisation_daily — widened with the rota.
--
-- DROP is required: a return type cannot be widened in place. Confirmed with
-- the owner before applying, as it was for the clinical_secs widening.
-- ---------------------------------------------------------------------------
drop function if exists public.practitioner_utilisation_daily(uuid, date, date, uuid);

create function public.practitioner_utilisation_daily(
  p_org      uuid,
  p_since    date,
  p_until    date,
  p_practice uuid default null
)
returns table (
  practitioner_id text,
  practitioner_name text,
  practice_id uuid,
  day date,
  available_secs bigint,
  clinical_secs bigint,
  utilised_secs bigint,
  -- Rostered seconds from the Dentally rota, gross of breaks.
  rota_secs bigint,
  -- Break seconds inside that rostered window, so net is available without a
  -- second read and without anyone assuming a break length.
  rota_break_secs bigint,
  -- THREE STATES, not two. true = rostered and working. false = rostered OFF.
  -- null = we hold no rota row for this practitioner-day at all. A caller that
  -- collapses null and false will divide by a denominator it does not have.
  rostered boolean,
  patient_appts bigint,
  block_appts bigint,
  revenue_pence bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  return query execute $q$
    with day_rows as (
      select
        a.pms_practitioner_id                                   as practitioner_id,
        -- London dates throughout. `starts_at` is an instant; bucketing it in
        -- UTC would put an 00:30 BST appointment on the previous day.
        (a.starts_at at time zone 'Europe/London')::date         as day,
        (array_agg(a.practice_id) filter (where a.practice_id is not null))[1] as practice_id,
        -- DIARY SPAN: first to last of ANYTHING in the diary. Wide, because a
        -- non-clinical block at either end stretches it.
        min(a.starts_at)                                         as first_start,
        max(a.ends_at)                                           as last_end,
        -- CLINICAL WINDOW: first to last appointment that actually saw a
        -- patient. Excludes the leading and trailing blocks that inflate the
        -- span - measured on one practitioner, a 60-minute block at 08:30 and
        -- a "No more Bookings" at 17:15 turned a 4h15 clinical day into a
        -- 9h30 span.
        min(a.starts_at) filter (where a.pms_patient_id is not null
                                   and a.status not in ('cancelled','no_show')) as first_patient,
        max(a.ends_at)   filter (where a.pms_patient_id is not null
                                   and a.status not in ('cancelled','no_show')) as last_patient,
        coalesce(sum(extract(epoch from (a.ends_at - a.starts_at))
          ) filter (where a.pms_patient_id is not null
                      and a.status not in ('cancelled', 'no_show')), 0)::bigint as utilised_secs,
        count(*) filter (where a.pms_patient_id is not null
                           and a.status not in ('cancelled', 'no_show'))::bigint as patient_appts,
        count(*) filter (where a.pms_patient_id is null)::bigint     as block_appts
      from public.appointments a
      where a.organisation_id = $1
        and a.source = 'dentally'
        and a.pms_practitioner_id is not null
        and a.ends_at > a.starts_at
        and (a.starts_at at time zone 'Europe/London')::date >= $2
        and (a.starts_at at time zone 'Europe/London')::date <= $3
        and ($4::uuid is null or a.practice_id = $4)
      group by 1, 2
    ),
    fees as (
      select
        ii.pms_practitioner_id as practitioner_id,
        ii.invoiced_on         as day,
        sum(ii.fee_pence)::bigint as revenue_pence
      from public.invoice_items ii
      where ii.organisation_id = $1
        and ii.pms_practitioner_id is not null
        and ii.invoiced_on >= $2 and ii.invoiced_on <= $3
        and ($4::uuid is null or ii.practice_id = $4)
      group by 1, 2
    )
    select
      d.practitioner_id::text,
      coalesce(nullif(btrim(s.full_name), ''), 'Practitioner ' || d.practitioner_id)::text,
      d.practice_id,
      d.day,
      greatest(extract(epoch from (d.last_end - d.first_start)), 0)::bigint as available_secs,
      case
        when d.first_patient is null then 0
        else greatest(extract(epoch from (d.last_patient - d.first_patient)), 0)
      end::bigint as clinical_secs,
      d.utilised_secs,
      -- NULL, not 0, when there is no rota row or the day is rostered off. A
      -- zero here would be divided into and read as an infinite utilisation;
      -- a null forces the caller to decide, which is the point.
      case
        when r.pms_practitioner_id is null or r.unavailable or r.starts_at is null then null
        else greatest(extract(epoch from (r.ends_at - r.starts_at)), 0)::bigint
      end as rota_secs,
      case
        when r.pms_practitioner_id is null or r.unavailable or r.starts_at is null then null
        else r.break_secs::bigint
      end as rota_break_secs,
      case
        when r.pms_practitioner_id is null then null
        else (not r.unavailable and r.starts_at is not null)
      end as rostered,
      d.patient_appts,
      d.block_appts,
      f.revenue_pence
    from day_rows d
    left join public.associates s
      on s.organisation_id = $1 and s.pms_external_id = d.practitioner_id
    left join fees f
      on f.practitioner_id = d.practitioner_id and f.day = d.day
    -- One-to-one by construction: the rota's primary key is exactly this pair
    -- within an organisation, and the feed was verified to hold no day with
    -- two rows. The practice filter is NOT repeated here — a rota row's
    -- practice comes from the site it was fetched under, while the day row's
    -- comes from the appointments themselves, and requiring both to agree
    -- would drop a rostered day whenever a practitioner covered elsewhere.
    left join public.practitioner_rota_days r
      on r.organisation_id = $1
     and r.pms_practitioner_id = d.practitioner_id
     and r.day = d.day
    order by d.day, 2
  $q$ using p_org, p_since, p_until, p_practice;
end;
$fn$;

revoke all on function public.practitioner_utilisation_daily(uuid, date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.practitioner_utilisation_daily(uuid, date, date, uuid)
  to service_role;

notify pgrst, 'reload schema';
