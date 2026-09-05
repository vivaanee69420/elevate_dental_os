-- ============================================================================
-- Which lead came from which campaign — Google.
--
-- 000158's header states flatly that this is not buildable: "CallRail calls
-- carry NO ad/campaign linkage at all". That was wrong, and this migration is
-- the correction. CallRail's own call record carries the Google campaign NAME,
-- the bid KEYWORD and the GCLID, captured from the click that led to the call.
-- Measured on this org before writing a line of it (1 Jun - 5 Sep 2026, 448
-- calls):
--
--     campaign name present   402 / 448   (90%)
--     gclid present           410 / 448   (92%)
--     bid keyword present     201 / 448   (45%)
--
-- Those campaign strings resolve to a real campaign id — but ONLY once the
-- lookup treats a campaign's whole rename history as aliases; see the long
-- note on gcamp_alias below, which is where the first version of this
-- migration lost more than half its coverage. The keyword side matched 246 of
-- 250 once the match-type punctuation is stripped.
--
-- The 45% keyword coverage is not a gap to chase: the remainder are Performance
-- Max campaigns, which have no keywords at all by design. Reporting that as
-- missing data would be reporting Google's product as a defect.
--
-- The GoHighLevel side is thinner and stays thinner: 124 of 228 Google-pipeline
-- leads resolve to a campaign, via the gad_campaignid Google writes into the
-- landing-page URL (ghl-attribution.js). Raising that is an account-config
-- change in Google Ads (a final-URL suffix carrying ValueTrack parameters),
-- not code.
--
-- ============================================================================
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not attribute a lead to an individual AD. Nothing stored can support
-- that: the only route is Google's click_view resource, keyed on gclid, which
-- is limited to a 90-day window and must be queried one single day at a time.
-- The gclid is carried through to the output so that lookup has somewhere to
-- land when it is built, and until then an ad-grain lead count would be a
-- fabrication.
--
-- It does not fall back to fuzzy name matching. A campaign string that does not
-- equal a known campaign name resolves to NULL and the lead is reported as
-- unattributed. The alternative — a similarity match — would silently move
-- someone else's leads onto a campaign, and a CPA is exactly the kind of number
-- that gets acted on without being checked.
--
-- ============================================================================
-- WHY UNATTRIBUTED LEADS ARE RETURNED, NOT DROPPED
--
-- The per-campaign table this feeds must reconcile to the practice-level cards
-- above it. If a lead with no resolvable campaign simply vanished from the
-- per-campaign view, the campaign rows would sum to fewer leads than the card,
-- and the difference would be invisible. Every lead is returned with a NULL
-- campaign_id instead, and the reader shows them as an explicit
-- "Not attributed" row. Same discipline as the reconciliation panel: a visible
-- gap is recoverable, a total that looks right and is not is not.
--
-- Return type changes, so DROP + CREATE. Idempotent; re-applies cleanly.
-- After applying on hosted:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The normalisation, given a name so the ledger and any future reader cannot
-- disagree about it.
--
-- CallRail stores the bid keyword WITH its match-type punctuation — "dentist
-- appointment" for phrase, [emergency dentist ashford] for exact, +dental
-- +implants for the retired broad-match-modifier form. Google's own
-- keyword.text field is the bare text, so the two never compare equal as
-- stored: verified live, 2 of 250 matched raw against 246 of 250 normalised.
--
-- IMMUTABLE, unlike london_day: this depends on nothing outside its argument,
-- so it is safe to index on should a future volume need it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.google_keyword_key(kw text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT nullif(lower(btrim(regexp_replace(coalesce(kw, ''), '\s+', ' ', 'g'), '"[]+ ')), '') $$;

COMMENT ON FUNCTION public.google_keyword_key(text) IS
  'Normalises a Google keyword to a comparable key: match-type punctuation '
  '("phrase", [exact], +modified) stripped, whitespace collapsed, lowercased. '
  'CallRail stores the punctuated form and the Google Ads API stores the bare '
  'text, so a raw comparison between them matches almost nothing.';

DROP FUNCTION IF EXISTS public.ad_google_lead_ledger(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.ad_google_lead_ledger(uuid, timestamptz, timestamptz, integer);

CREATE FUNCTION public.ad_google_lead_ledger(
  p_org uuid, p_since timestamptz, p_until timestamptz,
  p_min_paid_pence integer DEFAULT 4000
) RETURNS TABLE (
  phone10 text, practice_id uuid, practice_name text, source text,
  lead_at timestamptz, name text, email text, treatment text,
  booked boolean, accepted boolean, is_new_patient boolean, paid_pence bigint,
  campaign_id text, campaign_name text,
  ad_group_id text, ad_group_name text,
  keyword_id text, keyword_text text,
  gclid text, attribution text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- format() with %L, not EXECUTE ... USING, and the window bounds resolved
  -- ONCE here rather than per row inside the query — see 000162's note on
  -- london_day_start being STABLE and therefore unfoldable at plan time when
  -- applied to a parameter. Every interpolated value is a uuid, timestamptz or
  -- integer, types that cannot carry quotes, and %L quotes them regardless.
  -- The org still comes from the caller's session, never from a request body.
  RETURN QUERY EXECUTE format($q$
    WITH pool AS (
      SELECT c.phone10 AS phone10, l.practice_id AS practice_id, l.created_at AS lead_at,
             nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') AS name,
             c.email AS email, 'ghl'::text AS source,
             -- GoHighLevel's attribution row, already parsed into columns by
             -- ghl-attribution.js. ad_campaign_id is Meta's id direct from the
             -- payload OR Google's, recovered from gad_campaignid in the
             -- landing-page URL; which of the two it is gets decided below by
             -- whether it resolves against THIS org's Google campaigns.
             nullif(c.ad_campaign_id, '') AS raw_campaign_id,
             NULL::text  AS raw_campaign_name,
             NULL::text  AS raw_keyword,
             nullif(c.gclid, '') AS gclid
        FROM leads l
        JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = %1$L
        JOIN ad_channel_pipelines acp
          ON acp.organisation_id = %1$L
         AND acp.integration_account_id = l.integration_account_id
         AND acp.ghl_pipeline_id = l.ghl_pipeline_id
         AND acp.channel = 'google_ads'
       WHERE l.organisation_id = %1$L
         AND l.created_at >= %2$L AND l.created_at < %3$L
         AND c.phone10 IS NOT NULL
      UNION ALL
      SELECT nullif(right(regexp_replace(coalesce(cr.caller_number, ''), '[^0-9]', '', 'g'), 10), '') AS phone10,
             cr.practice_id, cr.started_at,
             nullif(cr.caller_name, ''), cr.caller_email, 'callrail'::text,
             NULL::text AS raw_campaign_id,
             nullif(cr.campaign, '')  AS raw_campaign_name,
             nullif(cr.keywords, '')  AS raw_keyword,
             nullif(cr.gclid, '')     AS gclid
        FROM callrail_calls cr
       WHERE cr.organisation_id = %1$L
         AND cr.started_at >= %2$L AND cr.started_at < %3$L
         AND nullif(right(regexp_replace(coalesce(cr.caller_number, ''), '[^0-9]', '', 'g'), 10), '') IS NOT NULL
         AND coalesce(cr.source, '') !~* '(facebook|instagram|meta|bing|yahoo|organic|direct|referral|offline|email|sms)'
    ),
    deduped AS (
      SELECT DISTINCT ON (phone10) *
        FROM pool
       ORDER BY phone10, lead_at
    ),

    -- ===================================================================
    -- ATTRIBUTION LOOKUPS. All three are built from THIS org's own rows and
    -- span the whole of what we hold, not the report window: a lead that
    -- arrived in the window may name a campaign whose spend fell outside it,
    -- and refusing to name that campaign would be pedantry, not accuracy.
    -- ===================================================================

    -- Every Google campaign this org has, labelled with its CURRENT name —
    -- the name carried on the most recent day it reported, not max() over the
    -- lot. Renames are frequent (this org renamed four campaigns in three
    -- months) and a report that labels one campaign with a name it stopped
    -- using in June is a report nobody can tie back to the Google interface.
    gcamp AS (
      SELECT DISTINCT ON (m.campaign_id) m.campaign_id, m.campaign_name
        FROM ad_metrics m
       WHERE m.organisation_id = %1$L AND m.provider = 'google_ads'
       ORDER BY m.campaign_id, m.metric_date DESC
    ),

    -- ===================================================================
    -- EVERY NAME A CAMPAIGN HAS EVER CARRIED, not just its current one.
    --
    -- This is the whole reason the first version of this migration under-
    -- attributed by more than half, and it is worth stating plainly because
    -- the bug looks exactly like working code.
    --
    -- Advertisers rename campaigns constantly — this org appends the monthly
    -- budget to the name, so ".G PMAX Cosmetic Dentistry - Mint" became
    -- ".G PMAX Cosmetic Dentistry - Mint - £500 P/M" on 6 June 2026 while
    -- remaining campaign 21004483567 throughout. CallRail stamps each call
    -- with the name AS IT WAS AT CLICK TIME and never revises it. So a lookup
    -- built from one name per campaign resolves calls from after the rename
    -- and silently drops every call from before it.
    --
    -- Measured: 289 of 331 deduplicated calls carry a campaign name, and a
    -- current-name-only lookup resolved 115 of them. Every one of the 174
    -- misses was a live, spending campaign sitting right there in ad_metrics
    -- under a name it no longer uses.
    --
    -- ad_metrics keeps one row per (campaign, day) and stores the name as it
    -- stood on that day, so the rename history is already there — it just has
    -- to be read as a set of ALIASES rather than as one label.
    --
    -- DISTINCT ON because a name is not guaranteed unique across campaigns:
    -- two accounts can use the same name, and a campaign deleted and recreated
    -- keeps its name under a new id. Higher lifetime spend wins. That is a
    -- judgement — the alternative is refusing to attribute a call whose
    -- campaign we can see perfectly well — so it is written down rather than
    -- left to whichever row the planner happened to return.
    -- ===================================================================
    gcamp_alias AS (
      SELECT DISTINCT ON (lower(x.campaign_name))
             lower(x.campaign_name) AS name_key, x.campaign_id
        FROM (
          SELECT m.campaign_id, m.campaign_name, sum(m.spend_pence) AS spend_pence
            FROM ad_metrics m
           WHERE m.organisation_id = %1$L AND m.provider = 'google_ads'
             AND m.campaign_name IS NOT NULL
           GROUP BY m.campaign_id, m.campaign_name
        ) x
       ORDER BY lower(x.campaign_name), x.spend_pence DESC, x.campaign_id
    ),
    -- Keyword text -> the keyword itself, its ad group and its campaign.
    -- Keyed on (campaign, normalised text) rather than text alone: the same
    -- keyword is routinely bid on in several campaigns, and the call already
    -- tells us which campaign it came from, so that ambiguity is resolvable
    -- rather than something to guess at. Within a campaign the same text can
    -- still sit in more than one ad group; the highest-impression one wins,
    -- for the same stated reason as above.
    gkw AS (
      SELECT DISTINCT ON (k.campaign_id, google_keyword_key(k.entity_name))
             k.campaign_id,
             google_keyword_key(k.entity_name) AS kw_key,
             k.entity_id   AS keyword_id,
             k.entity_name AS keyword_text,
             k.parent_id   AS ad_group_id
        FROM (
          SELECT campaign_id, entity_name, entity_id, parent_id,
                 sum(impressions) AS impressions
            FROM ad_google_keywords
           WHERE organisation_id = %1$L AND entity_name IS NOT NULL
           GROUP BY campaign_id, entity_name, entity_id, parent_id
        ) k
       ORDER BY k.campaign_id, google_keyword_key(k.entity_name), k.impressions DESC, k.entity_id
    ),
    -- Ad group id -> its CURRENT name, so the drill-down prints something a
    -- human set rather than a 12-digit number. Latest day wins, for the same
    -- reason campaigns do: ad groups get renamed too.
    gadgroup AS (
      SELECT DISTINCT ON (a.entity_id) a.entity_id AS ad_group_id, a.entity_name AS ad_group_name
        FROM ad_google_adgroups a
       WHERE a.organisation_id = %1$L
       ORDER BY a.entity_id, a.metric_date DESC
    ),

    -- ===================================================================
    -- RESOLUTION, most specific source first.
    --
    --   1. CallRail keyword, narrowed by the call's own campaign. Yields
    --      campaign + ad group + keyword: the full chain.
    --   2. CallRail campaign name alone. Yields campaign only — correct for
    --      Performance Max, which genuinely has no keyword to report.
    --   3. GoHighLevel's ad_campaign_id, ACCEPTED ONLY IF it resolves against
    --      this org's Google campaigns. That column also holds Meta campaign
    --      ids (the same GHL attribution row feeds both), and the inner join
    --      to gcamp is what keeps a Meta id from being reported as a Google
    --      campaign. It is a structural test, not a label test — the same
    --      rule ad_meta_funnel uses in the other direction.
    -- ===================================================================
    resolved AS (
      SELECT d.phone10,
             coalesce(cn.campaign_id, gc.campaign_id) AS campaign_id,
             kw.keyword_id, kw.keyword_text, kw.ad_group_id,
             -- Which route actually produced the campaign. Surfaced so the
             -- reader can say HOW a lead was attributed instead of asking
             -- anyone to trust it, and so a coverage regression — a renamed
             -- campaign we failed to alias, a CallRail tracking template
             -- someone edited — shows up as a shift in this mix rather than
             -- as a silent drift in cost per patient.
             CASE WHEN kw.keyword_id  IS NOT NULL THEN 'callrail_keyword'
                  WHEN cn.campaign_id IS NOT NULL THEN 'callrail_campaign'
                  WHEN gc.campaign_id IS NOT NULL THEN 'ghl_campaign'
                  ELSE NULL END AS attribution
        FROM deduped d
        -- CallRail campaign name -> id, through the alias table above
        LEFT JOIN gcamp_alias cn
               ON d.raw_campaign_name IS NOT NULL
              AND cn.name_key = lower(d.raw_campaign_name)
        -- keyword, only within the campaign that call already named
        LEFT JOIN gkw kw
               ON cn.campaign_id IS NOT NULL
              AND kw.campaign_id = cn.campaign_id
              AND kw.kw_key = google_keyword_key(d.raw_keyword)
        -- GoHighLevel's own campaign id, ACCEPTED ONLY IF it resolves against
        -- this org's Google campaigns. That column also holds Meta campaign
        -- ids (one GHL attribution row feeds both), and this join is what
        -- keeps a Meta id from being reported as a Google campaign. A
        -- structural test, not a label test — the same rule ad_meta_funnel
        -- applies in the other direction.
        LEFT JOIN gcamp gc
               ON d.raw_campaign_id IS NOT NULL
              AND gc.campaign_id = d.raw_campaign_id
    ),

    -- Everything below is unchanged from 000162 and carries its reasoning:
    -- London calendar days on every "did X happen on or after this lead"
    -- comparison, no upper bound on booking or payment (both are COHORT
    -- questions), payments netted for refunds, treatment labelled by the
    -- largest line.
    patient_ids AS (
      SELECT d.phone10, d.lead_at,
             london_day_start(d.lead_at) AS lead_day_start,
             array_agg(DISTINCT p.id) AS ids
        FROM deduped d
        JOIN contacts p ON p.organisation_id = %1$L
                        AND p.pms_external_id IS NOT NULL
                        AND p.phone10 IS NOT NULL
                        AND p.phone10 = d.phone10
       GROUP BY d.phone10, d.lead_at
    ),
    is_new AS (
      SELECT pi.phone10,
             NOT EXISTS (
               SELECT 1 FROM appointments pa
                WHERE pa.organisation_id = %1$L
                  AND pa.contact_id = ANY(pi.ids)
                  AND pa.starts_at < pi.lead_day_start
             ) AS is_new_patient
        FROM patient_ids pi
    ),
    booking AS (
      SELECT pi.phone10
        FROM patient_ids pi
       WHERE EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.organisation_id = %1$L
            AND a.contact_id = ANY(pi.ids)
            AND a.starts_at >= pi.lead_day_start
            AND coalesce(a.status, '') <> 'cancelled'
       )
    ),
    paid AS (
      SELECT pi.phone10, sum(pm.amount_pence)::bigint AS paid_pence
        FROM patient_ids pi
        JOIN payments pm
          ON pm.organisation_id = %1$L
         AND pm.contact_id = ANY(pi.ids)
         AND pm.status = 'settled'
         AND pm.processed_at >= pi.lead_day_start
       GROUP BY pi.phone10
    ),
    main_treatment AS (
      SELECT DISTINCT ON (pi.phone10)
             pi.phone10, ii.treatment_name
        FROM patient_ids pi
        JOIN invoice_items ii ON ii.organisation_id = %1$L
                              AND ii.contact_id = ANY(pi.ids)
                              AND ii.treatment_plan_id IS NOT NULL
                              AND ii.invoiced_on >= london_day(pi.lead_at)
       ORDER BY pi.phone10, ii.fee_pence DESC NULLS LAST, ii.invoiced_on, ii.id
    )
    SELECT d.phone10, d.practice_id, pr.name, d.source, d.lead_at, d.name, d.email,
           fi.treatment_name AS treatment,
           (bk.phone10 IS NOT NULL) AS booked,
           (coalesce(pd.paid_pence, 0) > %4$L::bigint) AS accepted,
           coalesce(inw.is_new_patient, false) AS is_new_patient,
           coalesce(pd.paid_pence, 0)::bigint AS paid_pence,
           rs.campaign_id,
           cur.campaign_name,
           rs.ad_group_id,
           ag.ad_group_name,
           rs.keyword_id,
           rs.keyword_text,
           d.gclid,
           rs.attribution
      FROM deduped d
      LEFT JOIN practices pr ON pr.id = d.practice_id AND pr.organisation_id = %1$L
      LEFT JOIN booking bk ON bk.phone10 = d.phone10
      LEFT JOIN main_treatment fi ON fi.phone10 = d.phone10
      LEFT JOIN is_new inw ON inw.phone10 = d.phone10
      LEFT JOIN paid pd ON pd.phone10 = d.phone10
      LEFT JOIN resolved rs ON rs.phone10 = d.phone10
      LEFT JOIN gcamp cur ON cur.campaign_id = rs.campaign_id
      LEFT JOIN gadgroup ag ON ag.ad_group_id = rs.ad_group_id
  $q$,
    p_org, p_since, p_until, p_min_paid_pence);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_google_lead_ledger(uuid, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_google_lead_ledger(uuid, timestamptz, timestamptz, integer)
  TO service_role;

-- The campaign-name and keyword lookups both scan an org's whole history of
-- ad_metrics / ad_google_keywords. Both already have an (organisation_id, ...)
-- leading index, so no new index is needed; these are here as a reminder that
-- the lookups are org-scoped and must stay that way.

NOTIFY pgrst, 'reload schema';
