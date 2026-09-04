-- ============================================================================
-- Google report — blended CPL/CPB/CPA cards.
--
-- Google carries no CRM-style lead funnel of its own (no ad_id attribution
-- from GoHighLevel the way Meta gets one) and CallRail calls carry NO
-- ad/campaign linkage at all (deliberate — see 000154's header). So a
-- per-campaign/ad-group Google CPL, the shape Facebook's report has, is not
-- buildable from what we store. What IS buildable, and what the owner asked
-- for instead: a PRACTICE-level blended figure — Google ad spend for that
-- practice's mapped account(s), divided by every lead attributable to
-- Google (a GoHighLevel lead in a pipeline explicitly mapped to the
-- google_ads channel, OR a CallRail call) that came in for that practice in
-- the window, deduplicated by phone number, then matched against Dentally
-- by phone to say how many booked and how many became an accepted patient.
-- "Rochester's leads come
-- from Rochester" — the practice_id already stamped on ad_metrics (account
-- mapping) and on leads/callrail_calls (practice mapping) is the join key;
-- no per-campaign attribution is needed or attempted.
--
-- TWO RPCs, not one, because they answer different-shaped questions and are
-- read by different endpoints (one feeds the spend side of the cards, the
-- other feeds the lead/booked/accepted side AND the click-through drill-down
-- list of individual leads):
--
--   ad_provider_spend_by_practice — spend/impressions/clicks per practice,
--   any ad provider. DATE-bounded, INCLUSIVE both ends, same convention as
--   campaignSpendByProvider/ad_grain_rollup (metric_date IS a date).
--
--   ad_google_lead_ledger — one row per DEDUPLICATED lead (GoHighLevel lead
--   OR CallRail call, phone-matched) in the window: which practice, source,
--   name/email/treatment for the drill-down table, and whether that phone
--   number matches a Dentally patient who (a) booked an appointment after
--   the lead landed and (b) paid their first treatment-plan invoice. Google
--   ONLY: Facebook's own CPL/CPB/CPA (ad_meta_funnel, GoHighLevel-only,
--   already phone/email-matched to Dentally) is unaffected and untouched.
--   TIMESTAMPTZ-bounded, HALF-OPEN (leads/calls carry a time, not a date) —
--   same convention ad_meta_funnel/ad_lead_conversions already use.
--
-- FIRST TOUCH DEDUP: a phone number appearing as both a GoHighLevel lead and
-- a CallRail call (or twice within either) is ONE lead, attributed to
-- whichever touch happened first — same "DISTINCT ON, ORDER BY created_at"
-- idiom ad_lead_conversions already uses for the identical reason (a person
-- is one funnel entry, not two).
--
-- GHL LEADS ARE FILTERED TO THE GOOGLE ADS PIPELINE(S), NOT "every lead in
-- the org". ad_channel_pipelines (000114) is the EXISTING, already-shipped,
-- operator-maintained map of which GoHighLevel pipeline is which channel —
-- built for this exact reason after a name-regex classifier misfired badly
-- (000114's own header: three 800-1100-lead pipelines named after open days
-- matched neither /google/ nor /facebook/). This function's first version
-- skipped that table entirely and counted every lead in the org regardless
-- of pipeline as a "Google lead" — inflating a ~278-lead, 3-month Google
-- pipeline count into 3,644 org-wide leads. Same discipline the Facebook
-- funnel already applies structurally (ad_id resolving into ad_meta_ads,
-- never a CRM label): a lead counts here ONLY if its
-- (integration_account_id, ghl_pipeline_id) has an ad_channel_pipelines row
-- with channel = 'google_ads'.
--
-- CALLRAIL PHONE MATCHING USES caller_number, RE-NORMALISED HERE — NOT
-- callrail_calls.caller_phone10 directly, despite the name. That column
-- stores normalisePhone().canonical (sheet-export/normalise.js): digits with
-- a leading 0 rewritten to 44, e.g. "447598983651" — a DIFFERENT convention
-- from contacts.phone10's generated column, `right(digits, 10)`, e.g.
-- "7598983651" (the country code dropped, not kept). The two never equal
-- each other for any UK number, so every CallRail row failed the
-- patient_match join before this fix — confirmed live on Plan4growth: 0 of
-- 506 calls (org-wide, 3-month window) matched via caller_phone10, 222 of
-- 506 matched once re-normalised the same way contacts.phone10 is.
-- Re-deriving from the RAW caller_number
-- here (rather than fixing the stored column, which callrail-webhook.js's
-- ingest and any historical row would also need) keeps this self-contained
-- to what this migration owns.
--
-- ACCEPTED = paid their FIRST invoice tied to a treatment plan (owner's own
-- definition, given verbally: "if the patient has paid first invoice for
-- treatment plan") — not "has a treatment_plans row", not "invoice ever
-- paid". invoice_items.invoice_paid is the PARENT invoice's paid flag,
-- denormalised onto every item (000040); DISTINCT ON (contact) ordered by
-- invoiced_on picks the earliest one.
--
-- BOOKED = a Dentally appointment starting on/after the lead's own first
-- touch (l.created_at / call's started_at) — same "not before the lead"
-- discipline ad_lead_conversions' booking CTE uses, so an already-existing
-- patient who merely called in does not count as "this ad campaign booked
-- them" retroactively.
--
-- plpgsql + EXECUTE ... USING, not LANGUAGE sql: SECURITY DEFINER + SET
-- search_path block SQL-function inlining, so a LANGUAGE sql body plans
-- GENERICALLY with p_org UNKNOWN and never chooses the per-org index probes
-- (documented repeatedly elsewhere in this codebase — ad_lead_conversions,
-- ad_meta_funnel — as an 11s-vs-55ms difference). Do NOT "simplify" either
-- function back to LANGUAGE sql.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

DROP FUNCTION IF EXISTS public.ad_provider_spend_by_practice(uuid, text, date, date);

CREATE FUNCTION public.ad_provider_spend_by_practice(
  p_org uuid, p_provider text, p_since date, p_until date
) RETURNS TABLE (
  practice_id uuid, practice_name text,
  spend_pence bigint, impressions bigint, clicks bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT m.practice_id,
           p.name,
           coalesce(sum(m.spend_pence), 0)::bigint,
           coalesce(sum(m.impressions), 0)::bigint,
           coalesce(sum(m.clicks), 0)::bigint
      FROM ad_metrics m
      LEFT JOIN practices p ON p.id = m.practice_id AND p.organisation_id = $1
     WHERE m.organisation_id = $1
       AND m.provider = $2
       AND m.metric_date >= $3 AND m.metric_date <= $4
     GROUP BY m.practice_id, p.name
  $q$ USING p_org, p_provider, p_since, p_until;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_provider_spend_by_practice(uuid, text, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_provider_spend_by_practice(uuid, text, date, date)
  TO service_role;

-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.ad_google_lead_ledger(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.ad_google_lead_ledger(
  p_org uuid, p_since timestamptz, p_until timestamptz
) RETURNS TABLE (
  phone10 text, practice_id uuid, practice_name text, source text,
  lead_at timestamptz, name text, email text, treatment text,
  booked boolean, accepted boolean, is_new_patient boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    WITH pool AS (
      SELECT c.phone10 AS phone10, l.practice_id AS practice_id, l.created_at AS lead_at,
             nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') AS name,
             c.email AS email, 'ghl'::text AS source
        FROM leads l
        JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = $1
        -- THE FIX: only leads sitting in a pipeline this org has explicitly
        -- mapped to the google_ads channel — an inner join, so an
        -- unmapped/other-channel pipeline (or a lead with no
        -- integration_account_id at all, e.g. a manual/CSV lead) is excluded
        -- outright, never counted as "Google" by default.
        JOIN ad_channel_pipelines acp
          ON acp.organisation_id = $1
         AND acp.integration_account_id = l.integration_account_id
         AND acp.ghl_pipeline_id = l.ghl_pipeline_id
         AND acp.channel = 'google_ads'
       WHERE l.organisation_id = $1
         AND l.created_at >= $2 AND l.created_at < $3
         AND c.phone10 IS NOT NULL
      UNION ALL
      -- Re-normalised from caller_number to contacts.phone10's OWN
      -- convention (last 10 digits) — see the file header for why
      -- caller_phone10 itself cannot be used here.
      SELECT nullif(right(regexp_replace(coalesce(cr.caller_number, ''), '[^0-9]', '', 'g'), 10), '') AS phone10,
             cr.practice_id, cr.started_at,
             nullif(cr.caller_name, ''), cr.caller_email, 'callrail'::text
        FROM callrail_calls cr
       WHERE cr.organisation_id = $1
         AND cr.started_at >= $2 AND cr.started_at < $3
         AND nullif(right(regexp_replace(coalesce(cr.caller_number, ''), '[^0-9]', '', 'g'), 10), '') IS NOT NULL
    ),
    -- First touch wins when the same number appears more than once (a GHL
    -- form fill AND a CallRail call, or two of either) — one lead, not two.
    deduped AS (
      SELECT DISTINCT ON (phone10) *
        FROM pool
       ORDER BY phone10, lead_at
    ),
    -- ONE PHONE NUMBER CAN MATCH MORE THAN ONE DENTALLY CONTACT — a shared
    -- family/reception line, or (confirmed live, e.g. "jackie shinnick" /
    -- "Jackie Shinnick") a duplicate patient record recreated by the
    -- Dentally sync (see the "Contacts dedup" memory). Grouping by phone10
    -- FIRST and aggregating every matching contact_id into one array, rather
    -- than treating each contact as an independent candidate row, is
    -- load-bearing: an earlier version checked "is THIS ONE contact new"
    -- per row, and a phone matching BOTH an existing patient (7 appointments,
    -- excluded) and a second, appointment-less duplicate/family member
    -- (kept, but with nothing to find) could make a REAL new booking vanish
    -- — the appointment lands on whichever contact_id the front desk
    -- actually picked (usually the findable, existing one), which was
    -- already excluded by the time booking/accepted looked for it. Grouping
    -- first means "new" and "booked"/"accepted" are each answered ACROSS
    -- every contact this phone number could plausibly be, not one at a time.
    patient_ids AS (
      SELECT d.phone10, d.lead_at, array_agg(DISTINCT p.id) AS ids
        FROM deduped d
        JOIN contacts p ON p.organisation_id = $1
                        AND p.pms_external_id IS NOT NULL
                        AND p.phone10 IS NOT NULL
                        AND p.phone10 = d.phone10
       GROUP BY d.phone10, d.lead_at
    ),
    -- is_new_patient is returned as its OWN column, NOT applied as a filter
    -- here — the toggle between "new patients only" and "including existing
    -- patients" (owner-requested, to see the effect of the exclusion
    -- directly) needs BOTH figures from the SAME query, computed the SAME
    -- way, so they can never silently drift against each other. Same
    -- is_new_patient definition ad_lead_conversions already uses (000156's
    -- prior_visit CTE): NONE of this phone's matched contacts has an
    -- appointment strictly BEFORE this lead's own first touch.
    is_new AS (
      SELECT pi.phone10,
             NOT EXISTS (
               SELECT 1 FROM appointments pa
                WHERE pa.organisation_id = $1
                  AND pa.contact_id = ANY(pi.ids)
                  AND pa.starts_at < pi.lead_at
             ) AS is_new_patient
        FROM patient_ids pi
    ),
    -- BOOKED/ACCEPTED are computed across EVERY matched contact for this
    -- phone (patient_ids, unfiltered) — the caller (service layer) decides
    -- whether to count a row toward its totals using is_new_patient, so
    -- "including existing" and "new patients only" read off the SAME
    -- booked/accepted values rather than two different computations.
    --
    -- BOOKED = ANY of this phone's matched contacts has a Dentally
    -- appointment dated ON OR AFTER the lead's own touch, cancelled ones
    -- excluded — NO upper bound. An earlier version also required
    -- `a.starts_at < $3` (the appointment must occur before the window
    -- closes), reasoning that an appointment booked far in the future ought
    -- not retroactively inflate a past period's booked count. That reasoning
    -- was wrong in practice: checked live against Dentally's own count for
    -- the SAME period, it undercounted by exactly the appointments scheduled
    -- for a date beyond the window — real leads who called/enquired
    -- in-period and got a real appointment on the books, just one dated
    -- further out than the reporting window happens to end. "Booked"
    -- answers "does this lead have an appointment on the books", not "does
    -- their appointment ALSO fall in this window" — Dentally's own count
    -- agrees, so this stays the open upper bound.
    booking AS (
      SELECT pi.phone10
        FROM patient_ids pi
       WHERE EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.organisation_id = $1
            AND a.contact_id = ANY(pi.ids)
            AND a.starts_at >= pi.lead_at
            AND coalesce(a.status, '') <> 'cancelled'
       )
    ),
    -- The EARLIEST invoice tied to a treatment plan across ANY of this
    -- phone's matched contacts, and whether THAT one is paid — not "any
    -- invoice ever paid". treatment_name is carried from THE SAME row for
    -- the drill-down list: Dentally's own treatment-plan invoice line, never
    -- leads.treatment (GoHighLevel free text — on live data this is often
    -- the opportunity's own name, e.g. "Nathan Bell || 16/6/2026", not a
    -- treatment at all).
    --
    -- WINDOW-BOUNDED on invoiced_on, UNLIKE booking above (which is
    -- deliberately open-ended — see its own comment): without this bound,
    -- accepted could exceed booked — a phone match to a patient's TOTALLY
    -- UNRELATED past treatment (paid months or years ago, nothing to do with
    -- the call/lead that landed in THIS window) still counted as "this
    -- window's spend converted them". Found live: CallRail showed 10
    -- accepted against 9 booked for the same window, which cannot happen for
    -- a real funnel — accepting treatment presupposes an appointment. This
    -- bound alone is sufficient to keep accepted <= booked (verified live
    -- across every practice, new-patients-only mode). invoiced_on is a DATE
    -- column; $2/$3 are the same timestamptz window bounds cast to date,
    -- matching every other date-column comparison in this file's sibling RPC
    -- (see ad_provider_spend_by_practice / campaignSpendByProvider's
    -- convention).
    first_invoice AS (
      SELECT DISTINCT ON (pi.phone10)
             pi.phone10, ii.invoice_paid, ii.treatment_name
        FROM patient_ids pi
        JOIN invoice_items ii ON ii.organisation_id = $1
                              AND ii.contact_id = ANY(pi.ids)
                              AND ii.treatment_plan_id IS NOT NULL
                              AND ii.invoiced_on >= $2::date
                              AND ii.invoiced_on < $3::date
       ORDER BY pi.phone10, ii.invoiced_on NULLS LAST, ii.id
    )
    SELECT d.phone10, d.practice_id, pr.name, d.source, d.lead_at, d.name, d.email,
           fi.treatment_name AS treatment,
           (bk.phone10 IS NOT NULL) AS booked,
           coalesce(fi.invoice_paid, false) AS accepted,
           coalesce(inw.is_new_patient, false) AS is_new_patient
      FROM deduped d
      LEFT JOIN practices pr ON pr.id = d.practice_id AND pr.organisation_id = $1
      LEFT JOIN booking bk ON bk.phone10 = d.phone10
      LEFT JOIN first_invoice fi ON fi.phone10 = d.phone10
      LEFT JOIN is_new inw ON inw.phone10 = d.phone10
  $q$ USING p_org, p_since, p_until;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_google_lead_ledger(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_google_lead_ledger(uuid, timestamptz, timestamptz)
  TO service_role;

-- Supports the first_invoice CTE's join — invoice_items had no contact_id
-- index at all (only org/practice/date and org/name existed, 000040).
CREATE INDEX IF NOT EXISTS idx_invoice_items_org_contact
  ON invoice_items(organisation_id, contact_id)
  WHERE contact_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
