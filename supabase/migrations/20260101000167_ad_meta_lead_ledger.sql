-- ===========================================================================
-- ad_meta_lead_ledger — the Facebook report's lead ledger, with acceptance
-- defined as MONEY PAID.
--
-- WHY. The Google and Facebook reports disagreed about what an acquired
-- patient is, and a group reading both to decide where to put budget was
-- being misled by the difference rather than by the campaigns.
--
--   Google (000162): accepted = settled payments attributable to this lead,
--                    net of refunds, from the lead's own London day onward,
--                    exceeding p_min_paid_pence (£40, this group's
--                    consultation fee — a parameter because another tenant's
--                    differs).
--   Facebook (000156): converted = the lead resolved to ANY Dentally patient
--                    record. No money required.
--
-- Measured on live data, Plan4growth, June-August 2026: 1,708 Meta leads,
-- 230 booked, 267 "patients" under the matched rule and 33 under the paid
-- rule. 234 of the 267 had never paid more than £40. The page was reporting
-- MORE PATIENTS THAN BOOKINGS — an internal contradiction that shows the
-- column was not measuring acquisition at all, and cost per patient was
-- understated by roughly 8x against the Google page beside it.
--
-- WHAT THIS DOES NOT TOUCH, deliberately. ad_lead_conversions feeds five
-- other functions (ad_campaign_funnel, lead_funnel_counts, ad_meta_funnel,
-- the marketing rollup, and marketing.repository directly) and changing its
-- RETURNS TABLE forces a DROP/CREATE of the lot. This function READS it
-- instead and adds the money on top, so nothing that works today changes
-- shape. The Facebook service derives BOTH the practice-grain cards AND the
-- per-campaign accepted counts from this ONE ledger, which is what stops the
-- cards and the table beneath them from drifting apart.
--
-- IDENTIFICATION IS STRUCTURAL, and is copied verbatim from ad_meta_funnel:
-- a lead is a Meta lead because its ad_campaign_id resolves inside THIS org's
-- own Meta ad_metrics rows. It is deliberately NOT attribution_source =
-- 'Paid Social', which is a GoHighLevel label another tenant may write
-- differently or not at all — that would render an empty report that looks
-- perfectly healthy. Keeping the test identical to the funnel's is the point:
-- two different Meta tests on one page is the bug this file exists to close.
--
-- NO CALLRAIL, and that is a measurement rather than an assumption. The
-- Google ledger unions CallRail calls because search drives the phone; this
-- org's 527 calls are 527/527 "Google Ads" and 0 resolve to Meta. Adding a
-- Meta allow-list over a column with no Meta values would be untested code
-- attributing calls on a guess. When a tenant's CallRail does carry Meta
-- traffic, that union belongs here — with the same exclusion-not-allow-list
-- reasoning 000162 sets out.
--
-- is_new_patient is taken from ad_lead_conversions unchanged, so the
-- "Include existing patients" toggle keeps ONE meaning across the whole
-- Facebook page. Note it differs from the Google ledger's: Meta's asks
-- "no appointment before the WINDOW", Google's asks "before this LEAD's own
-- day". Aligning them changes the existing Facebook campaign numbers and is
-- a separate decision from this one, which is only about acceptance.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.ad_meta_lead_ledger(uuid, timestamptz, timestamptz, integer);

CREATE FUNCTION public.ad_meta_lead_ledger(
  p_org uuid, p_since timestamptz, p_until timestamptz,
  p_min_paid_pence integer DEFAULT 4000
) RETURNS TABLE (
  contact_id uuid, practice_id uuid, practice_name text,
  campaign_id text, campaign_name text, ad_set_id text, ad_id text,
  lead_at timestamptz, name text, email text, treatment text,
  booked boolean, accepted boolean, is_new_patient boolean, paid_pence bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- plpgsql + EXECUTE, not LANGUAGE sql: DEFINER and SET search_path both
  -- block SQL-function inlining, so a LANGUAGE sql body is planned
  -- GENERICALLY with p_org unknown and never chooses the per-lead index
  -- probes. See 000156's header for the 10.7s-vs-608ms measurement.
  RETURN QUERY EXECUTE $q$
    WITH meta AS (
      SELECT f.*
        FROM ad_lead_conversions($1, $2, $3, NULL) f
       WHERE f.ad_campaign_id IS NOT NULL
         -- The structural Meta test, identical to ad_meta_funnel's. Not
         -- scoped by date: whether a campaign is Meta is a question of
         -- provider identity, not of the reporting window.
         AND f.ad_campaign_id IN (
           SELECT m.campaign_id FROM ad_metrics m
            WHERE m.organisation_id = $1
              AND m.provider = 'meta_ads'
              AND m.campaign_id IS NOT NULL
         )
    ),
    -- MONEY PAID, the acceptance signal (000162's rules, unchanged):
    --  * status='settled' only — 'pending' means the cash has not landed.
    --  * summed, so refunds NET OFF rather than being filtered out; a lead
    --    whose money was returned in full must not read as acquired.
    --  * lower bound is the lead's own London DAY, not its instant. Payments
    --    are stamped midnight UTC (Dentally sends a DATE), so comparing them
    --    to a lead instant discards every same-day payment — the common case.
    --    The column stays bare and the function sits on the bound, which is
    --    the sargable shape london_day_start() exists for.
    --  * NO UPPER BOUND. This is a COHORT question — "of the leads this
    --    window's spend bought, how many have paid" — so money counts
    --    whenever it arrives. Bounding it to the window truncated every lead
    --    who paid after the period closed, and the damage grew as the window
    --    narrowed. The accepted cost is that a past period's CPA improves as
    --    its leads convert; `booked` has always behaved that way.
    paid AS (
      SELECT m.contact_id, sum(pm.amount_pence)::bigint AS paid_pence
        FROM meta m
        JOIN payments pm
          ON pm.organisation_id = $1
         AND pm.contact_id = m.patient_contact
         AND pm.status = 'settled'
         AND pm.processed_at >= london_day_start(m.first_lead_at)
       GROUP BY m.contact_id
    ),
    -- The drill-down's treatment label ONLY — it does not decide acceptance.
    -- LARGEST LINE WINS: ordering by date/id picks whatever sorts first,
    -- which on a real invoice is regularly a £0.00 filler (000162's header
    -- has the £89 patient labelled with a £0.00 "Bitewings").
    main_treatment AS (
      SELECT DISTINCT ON (m.contact_id) m.contact_id, ii.treatment_name
        FROM meta m
        JOIN invoice_items ii
          ON ii.organisation_id = $1
         AND ii.contact_id = m.patient_contact
         AND ii.treatment_plan_id IS NOT NULL
         AND ii.invoiced_on >= london_day(m.first_lead_at)
       ORDER BY m.contact_id, ii.fee_pence DESC NULLS LAST, ii.invoiced_on, ii.id
    ),
    -- Ad set by ID, never by name (contacts.ad_set_id is null on every row
    -- GoHighLevel has ever sent; ad_meta_ads.parent_id IS the ad set id).
    -- DISTINCT ON collapses the ad's day rows to one, so a lead is named once
    -- however many days its ad ran.
    ad_parent AS (
      SELECT DISTINCT ON (entity_id) entity_id, parent_id
        FROM ad_meta_ads
       WHERE organisation_id = $1
       ORDER BY entity_id, metric_date DESC
    ),
    -- One name per campaign id. DISTINCT ON over the org's own Meta rows,
    -- newest first, so a renamed campaign reports its current name.
    campaign_names AS (
      SELECT DISTINCT ON (m.campaign_id) m.campaign_id, m.campaign_name
        FROM ad_metrics m
       WHERE m.organisation_id = $1
         AND m.provider = 'meta_ads'
         AND m.campaign_id IS NOT NULL
       ORDER BY m.campaign_id, m.metric_date DESC
    )
    SELECT m.contact_id,
           m.practice_id,
           pr.name AS practice_name,
           m.ad_campaign_id AS campaign_id,
           cn.campaign_name,
           ap.parent_id AS ad_set_id,
           m.ad_id,
           m.first_lead_at AS lead_at,
           nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') AS name,
           c.email,
           mt.treatment_name AS treatment,
           (m.booked_at IS NOT NULL) AS booked,
           (coalesce(pd.paid_pence, 0) > $4::bigint) AS accepted,
           coalesce(m.is_new_patient, false) AS is_new_patient,
           coalesce(pd.paid_pence, 0)::bigint AS paid_pence
      FROM meta m
      LEFT JOIN contacts c        ON c.id = m.contact_id AND c.organisation_id = $1
      LEFT JOIN practices pr      ON pr.id = m.practice_id AND pr.organisation_id = $1
      LEFT JOIN paid pd           ON pd.contact_id = m.contact_id
      LEFT JOIN main_treatment mt ON mt.contact_id = m.contact_id
      LEFT JOIN ad_parent ap      ON ap.entity_id = m.ad_id
      LEFT JOIN campaign_names cn ON cn.campaign_id = m.ad_campaign_id
  $q$ USING p_org, p_since, p_until, p_min_paid_pence;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_meta_lead_ledger(uuid, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_meta_lead_ledger(uuid, timestamptz, timestamptz, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
