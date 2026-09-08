-- ============================================================================
-- Pipeline -> ad channel, detected from the leads themselves.
--
-- THE PROBLEM. Since 000171/000178/000179 the pipeline map DEFINES each
-- report's lead pool: "if a lead has come from a google ads pipeline that lead
-- belongs to google ads, whether it has a gclid or not, and the same goes for
-- meta". That was the right call, but it made an unmapped org a silently empty
-- one — and the map has only ever been fillable BY HAND, on a settings screen
-- an owner has to find. A sub-account measured on 2026-09-08 had GBP 5,478 of
-- September Meta spend, 86 of that month's leads carrying a Meta ad id, zero
-- rows in this table, and a Facebook report reading "0 leads" with an em-dash
-- cost per lead. Nothing was broken; nobody had done a step nobody mentioned.
--
-- WHAT THIS ADDS. Detection from the leads' OWN attribution, so a new
-- organisation is mapped the first time its data lands instead of waiting for
-- someone to know about a screen. Deliberately NOT by pipeline name: this
-- table exists in the first place because a name regex was wrong on live data
-- (see 000114's header — the three biggest pipelines are "Open Day Archive -
-- IMPLANTS" and friends, which match neither /google/ nor /facebook/), and
-- rules.md forbids matching on a name where an id exists.
--
-- The evidence is structural: a Meta lead carries an ad id or a campaign id
-- that resolves inside this org's own Meta ad_metrics; a Google lead carries a
-- gclid or a campaign id that resolves inside its own Google ad_metrics. Both
-- come from the CRM's own attribution fields, never from a channel LABEL — a
-- label is a name by another route, and another tenant may not use the same
-- words or the same CRM.
--
-- THREE STATES, NOT TWO. Mapping a pipeline is a strong claim — every lead in
-- it joins that channel's pool — so "nobody has decided" and "the owner
-- decided none" must not look alike:
--
--   no row            nobody has decided. Detection may fill it.
--   channel IS NULL   the owner deliberately assigned no channel. Detection
--                     must LEAVE IT ALONE. Before this migration, clearing a
--                     channel DELETED the row, which made a deliberate
--                     exclusion indistinguishable from an undecided pipeline —
--                     and detection would have re-added it every night.
--   channel set       mapped, by 'owner' or by 'auto' (see source).
--
-- source = 'owner' is never overwritten by detection, so a human decision is
-- permanent until a human changes it. detected_leads / detected_share record
-- the evidence a guess was made on, so the screen can show its working rather
-- than assert a channel the owner has no way to check.
--
-- Idempotent + additive; re-applies cleanly on a local `supabase db reset`.
-- After applying on hosted: NOTIFY pgrst, 'reload schema';
-- ============================================================================

alter table public.ad_channel_pipelines
  add column if not exists source         text,
  add column if not exists detected_leads integer,
  add column if not exists detected_share numeric;

update public.ad_channel_pipelines set source = 'owner' where source is null;

alter table public.ad_channel_pipelines
  alter column source set default 'owner',
  alter column source set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ad_channel_pipelines_source_chk'
  ) then
    alter table public.ad_channel_pipelines
      add constraint ad_channel_pipelines_source_chk check (source in ('owner', 'auto'));
  end if;
end $$;

-- channel becomes nullable so "the owner assigned none" is a row rather than
-- an absence. Every reader compares channel = 'meta_ads' / 'google_ads', so a
-- null simply fails to match — no reader changes.
alter table public.ad_channel_pipelines alter column channel drop not null;

alter table public.ad_channel_pipelines
  drop constraint if exists ad_channel_pipelines_channel_chk;
alter table public.ad_channel_pipelines
  add constraint ad_channel_pipelines_channel_chk
  check (channel is null or channel in ('google_ads', 'meta_ads'));

-- ============================================================================
-- ad_pipeline_attribution_counts — the evidence, aggregated IN SQL.
--
-- An RPC and not a table read for two reasons this codebase has been bitten by:
-- PostgREST truncates a table read at 1000 rows in silence (an org here has
-- 13,276 contacts and 2,957 leads, so counting in the client would report the
-- page, not the population), and the join is leads x contacts x ad_metrics,
-- which belongs in the database.
--
-- plpgsql RETURN QUERY EXECUTE ... USING, not LANGUAGE sql: a SECURITY DEFINER
-- sql function with SET search_path never inlines, so it is planned with p_org
-- UNKNOWN and picks a generic plan (measured elsewhere here at 11.1s against
-- 55ms). See the rpc-generic-plan-trap note.
--
-- ONE LEAD PER CONTACT: a contact with five opportunities is one person, and
-- counting the opportunities would let a busy pipeline outvote a real one.
-- ============================================================================
create or replace function public.ad_pipeline_attribution_counts(p_org uuid)
returns table (
  integration_account_id uuid,
  ghl_pipeline_id        text,
  pipeline_name          text,
  leads                  bigint,
  meta_leads             bigint,
  google_leads           bigint
)
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  return query execute $q$
    WITH camp AS (
      SELECT DISTINCT m.provider, m.campaign_id
        FROM ad_metrics m
       WHERE m.organisation_id = $1
         AND m.campaign_id IS NOT NULL
    ),
    -- One row per (pipeline, contact): the person, not the opportunity.
    people AS (
      SELECT DISTINCT ON (l.integration_account_id, l.ghl_pipeline_id, c.id)
             l.integration_account_id,
             l.ghl_pipeline_id,
             c.id AS contact_id,
             c.ad_id,
             c.gclid,
             c.ad_campaign_id
        FROM leads l
        JOIN contacts c
          ON c.id = l.contact_id
         AND c.organisation_id = $1
       WHERE l.organisation_id = $1
         AND l.integration_account_id IS NOT NULL
         AND l.ghl_pipeline_id IS NOT NULL
       ORDER BY l.integration_account_id, l.ghl_pipeline_id, c.id
    )
    SELECT p.integration_account_id,
           p.ghl_pipeline_id,
           NULL::text AS pipeline_name,
           count(*)::bigint AS leads,
           count(*) FILTER (
             WHERE p.ad_id IS NOT NULL
                OR EXISTS (SELECT 1 FROM camp k
                            WHERE k.provider = 'meta_ads'
                              AND k.campaign_id = p.ad_campaign_id)
           )::bigint AS meta_leads,
           count(*) FILTER (
             WHERE p.gclid IS NOT NULL
                OR EXISTS (SELECT 1 FROM camp k
                            WHERE k.provider = 'google_ads'
                              AND k.campaign_id = p.ad_campaign_id)
           )::bigint AS google_leads
      FROM people p
     GROUP BY p.integration_account_id, p.ghl_pipeline_id
  $q$ USING p_org;
end;
$fn$;

REVOKE ALL ON FUNCTION public.ad_pipeline_attribution_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_pipeline_attribution_counts(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
