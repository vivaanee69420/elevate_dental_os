-- ============================================================================
-- ad_google_lead_ledger — "accepted" becomes MONEY PAID, above a consultation
-- floor, instead of "the first treatment-plan invoice is marked paid".
--
-- WHY THE DEFINITION CHANGED. 000158 defined accepted as: the EARLIEST
-- invoice tied to a treatment plan, raised inside the window, is
-- invoice_paid. That reads acceptance off the BILLING record. It misses the
-- case the owner actually cares about — a patient who has handed over money
-- but whose treatment plan has not been invoiced yet. Checked live
-- (Plan4growth, Google, Jun-Aug 2026, new patients only): 6 such leads paid
-- real money and were reported as NOT accepted, while the invoice rule
-- counted others whose money never appears in payments at all.
--
-- The owner's rule, in their words: an appointment costs about £40, so
-- anything ABOVE £40 is a patient committing to treatment rather than
-- paying for the consultation they just had. Hence:
--
--   accepted = settled payments attributable to this lead, summed, > £40
--
-- WHY A FLOOR AND NOT "> £0". Without it, every routine exam/consultation
-- fee counts as a treatment acceptance. Measured on the same window: 62 of
-- the 64 booked new-patient leads had paid SOMETHING, so a >£0 rule would
-- have reported a 97% acceptance rate — a number that says nothing. With
-- the £40 floor it is 45, against 35 under the old invoice rule.
--
-- THE FLOOR IS A PARAMETER, NOT A LITERAL. £40 is THIS group's
-- consultation fee; another tenant's is not. p_min_paid_pence defaults to
-- 4000 so existing callers keep working, and a per-tenant fee becomes a
-- value to pass rather than a migration to write.
--
-- ============================================================================
-- THE SAME-DAY TRAP, and why this compares DATES and not INSTANTS.
--
-- Every payment row on this instance is stamped at exactly midnight UTC
-- (3,210 of 3,210 settled rows since 1 Jun 2026): Dentally sends a payment
-- DATE, coerced to timestamptz. The obvious predicate --
--
--     pm.processed_at >= pi.lead_at
--
-- -- therefore compares a midnight against a real time of day, and DISCARDS
-- every payment made on the same day as the lead. That is not an edge case,
-- it is the common case: the patient calls, comes in, and pays. Measured
-- before the fix, 12 of 13 apparently-unpaid new-patient leads were exactly
-- this — first_pay equal to the lead's own date, with invoices from £40 to
-- £305 behind them. Comparing London CALENDAR DATES on both sides is what
-- makes a same-day payment count, which is the behaviour anyone reading
-- "paid more than £40" expects.
--
-- The lower bound stays "on or after the lead's own day" for the same reason
-- booking does (see its comment below): a payment made BEFORE someone became
-- a lead is an existing patient settling an older bill, not this window's ad
-- spend converting them. Dropping that bound counted 78 accepted against 86
-- booked on the live window, most of it unrelated history.
--
-- WINDOW BOUNDS go through london_day() too, replacing `$2::date`. Today's
-- caller passes plain YYYY-MM-DD from leadLedgerUntil, for which the two are
-- identical — but `::date` resolves a timestamptz in the SERVER's zone, so
-- the day a caller hands this a real London instant (which every period
-- picker in the app already produces) `::date` reads 1 Aug London as 31 July
-- for the whole of BST, and the report silently shifts a day early every
-- summer. That is the exact bug the in-flight london_window_convention
-- migration was written to fix elsewhere in the schema; there is no reason
-- to leave a new instance of it here waiting to be found.
--
-- WHAT ELSE CHANGED: a new paid_pence column is returned so the drill-down
-- can show the amount behind the flag. A boolean whose threshold nobody can
-- see is a number you cannot check; £43 and £4,300 both read as "Yes".
--
-- ============================================================================
-- THE SAME TRAP, ON THE BOOKING SIDE. Fixed here too.
--
-- `booked` compared instants the same way, and lost same-day appointments
-- for the mirror-image reason: a CRM record is written when someone gets
-- round to writing it, and an appointment can be EARLIER in the day than the
-- lead row describing it. Found live: a Barnet caller whose CallRail record
-- is stamped 29 Jun 15:21 and whose appointment that same day at 12:45 is
-- marked `completed` — they attended, and paid £88 — read booked = FALSE,
-- because 12:45 is not >= 15:21. Every predicate in this function that asks
-- "did X happen on or after this lead" now asks it in London CALENDAR DAYS.
-- One convention, or the funnel contradicts itself: that row was already
-- reporting accepted = true against booked = false, which cannot happen for
-- a real funnel.
--
-- Measured: booked 86 -> 87 across all patients, unchanged at 64 for new
-- patients only (the default view), and one of the four accepted-without-
-- booked anomalies disappears. The three that remain are data, not rule —
-- one cancelled appointment that was still paid for, two patients with no
-- appointment row at all.
--
-- ============================================================================
-- THE TREATMENT LABEL: LARGEST LINE, NEVER AN ARBITRARY ONE.
--
-- The CTE that names the treatment for the drill-down took DISTINCT ON
-- ordered by (invoiced_on, id) — i.e. whichever line happened to sort first
-- on the earliest invoice. On a real invoice that is frequently a £0.00
-- filler line. Found live: a patient who paid £89 for "Exam & Scale &
-- Polish" was labelled "Bitewings", a £0.00 line on the same invoice.
-- Ordering by fee_pence DESC names the most substantial treatment behind
-- the money, and can only return a £0 line when every line is £0.
--
-- Return type changes, so DROP + CREATE. Idempotent; re-applies cleanly.
-- ============================================================================

-- The convention, given a NAME so it cannot be quietly rewritten back into
-- an instant comparison. Both defects above were the same edit: someone
-- writes `a >= b` between two timestamptz columns, which type-checks, runs,
-- and returns a confidently wrong answer. `london_day(a) >= london_day(b)`
-- says out loud what is being compared, and a future `a.starts_at >=
-- pi.lead_at` in this file now reads as a visible deviation rather than as
-- the house style.
--
-- STABLE, not IMMUTABLE: AT TIME ZONE depends on the tz database, which can
-- be updated under the server. That rules out indexing on it — fine, no
-- index here needs it — and marking it IMMUTABLE to buy one would be a lie
-- the planner is entitled to act on.
CREATE OR REPLACE FUNCTION public.london_day(ts timestamptz)
RETURNS date LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT (ts AT TIME ZONE 'Europe/London')::date $$;

COMMENT ON FUNCTION public.london_day(timestamptz) IS
  'The London calendar day an instant falls on. Use for every "did X happen '
  'on or after Y" comparison against feeds that carry a date rather than a '
  'time (Dentally payments are all stamped midnight UTC), and for any '
  'comparison between a clinical timestamp and a CRM one — the CRM row is '
  'written after the fact, so same-day ordering between them is meaningless.';

-- Deliberately NOT revoked from anon/authenticated, unlike every p_org RPC
-- in this schema: it touches no table, takes no org, and returns a date.
-- The revoke idiom exists to stop a browser JWT reading another tenant's
-- rows; there are no rows here to read.

-- PERFORMANCE COMPANION to london_day(), and the reason it exists:
-- `london_day(col) >= london_day(x)` wraps the COLUMN in a function call, so
-- no index on that column can serve it. Measured on the live org, that shape
-- cost 866ms on a cold connection against 33ms for the form below — the
-- appointments and payments scans fell back to reading far more pages.
--
-- london_day is monotonic in its argument, so
--
--     london_day(a) >= london_day(b)   ==   a >= london_day_start(b)
--
-- and the second form leaves the column bare. Verified as an identity, not
-- assumed: 3,265 real appointment/lead pairs including 61 same-day ones, zero
-- disagreements in either direction. Prefer this shape in any predicate; use
-- london_day() for reading a day out, or when comparing a DATE column (which
-- is already sargable against a date bound).
--
-- STABLE for the same reason london_day is, and so equally un-indexable
-- itself — which does not matter, because it is only ever applied to a bound.
CREATE OR REPLACE FUNCTION public.london_day_start(ts timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT ((ts AT TIME ZONE 'Europe/London')::date::timestamp AT TIME ZONE 'Europe/London') $$;

COMMENT ON FUNCTION public.london_day_start(timestamptz) IS
  'The instant the London calendar day containing ts began. Use it to write a '
  'day-grain comparison in a SARGABLE shape: london_day(a) >= london_day(b) is '
  'equivalent to a >= london_day_start(b), but leaves the column bare so an '
  'index on it stays usable.';

DROP FUNCTION IF EXISTS public.ad_google_lead_ledger(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.ad_google_lead_ledger(uuid, timestamptz, timestamptz, integer);

CREATE FUNCTION public.ad_google_lead_ledger(
  p_org uuid, p_since timestamptz, p_until timestamptz,
  p_min_paid_pence integer DEFAULT 4000
) RETURNS TABLE (
  phone10 text, practice_id uuid, practice_name text, source text,
  lead_at timestamptz, name text, email text, treatment text,
  booked boolean, accepted boolean, is_new_patient boolean, paid_pence bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- format() with %L, not EXECUTE ... USING, and the window bounds resolved
  -- ONCE here rather than per row inside the query. london_day_start() is
  -- STABLE, so applied to a parameter it cannot be folded to a constant at
  -- plan time and never reaches the index as a bound; resolved out here it
  -- arrives as a literal the planner can use. Every value interpolated is a
  -- uuid, timestamptz, date or integer — types that cannot carry quotes — and
  -- %L quotes them regardless, so this is not a string-building injection
  -- risk. The org still comes from the caller's session, never from a body.
  RETURN QUERY EXECUTE format($q$
    WITH pool AS (
      SELECT c.phone10 AS phone10, l.practice_id AS practice_id, l.created_at AS lead_at,
             nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') AS name,
             c.email AS email, 'ghl'::text AS source
        FROM leads l
        JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = %1$L
        -- Only leads sitting in a pipeline this org has explicitly mapped to
        -- the google_ads channel — an inner join, so an unmapped/other-channel
        -- pipeline (or a lead with no integration_account_id at all, e.g. a
        -- manual/CSV lead) is excluded outright, never counted as "Google".
        JOIN ad_channel_pipelines acp
          ON acp.organisation_id = %1$L
         AND acp.integration_account_id = l.integration_account_id
         AND acp.ghl_pipeline_id = l.ghl_pipeline_id
         AND acp.channel = 'google_ads'
       WHERE l.organisation_id = %1$L
         AND l.created_at >= %2$L AND l.created_at < %3$L
         AND c.phone10 IS NOT NULL
      UNION ALL
      -- Re-normalised from caller_number to contacts.phone10's OWN convention
      -- (last 10 digits) — see 000158's header for why caller_phone10 itself
      -- cannot be used here.
      SELECT nullif(right(regexp_replace(coalesce(cr.caller_number, ''), '[^0-9]', '', 'g'), 10), '') AS phone10,
             cr.practice_id, cr.started_at,
             nullif(cr.caller_name, ''), cr.caller_email, 'callrail'::text
        FROM callrail_calls cr
       WHERE cr.organisation_id = %1$L
         AND cr.started_at >= %2$L AND cr.started_at < %3$L
         AND nullif(right(regexp_replace(coalesce(cr.caller_number, ''), '[^0-9]', '', 'g'), 10), '') IS NOT NULL
         -- EXCLUDE what is provably another channel; do NOT allow-list
         -- Google. This org's calls are 527/527 "Google Ads", so a
         -- Google-only allow-list would look correct here and silently return
         -- ZERO leads for the first tenant whose CallRail names the source
         -- anything else ("Paid Search", "google-cpc", a custom label) — an
         -- empty report that looks perfectly healthy. An exclusion list can
         -- only ever remove a call we can PROVE belongs to another channel.
         AND coalesce(cr.source, '') !~* '(facebook|instagram|meta|bing|yahoo|organic|direct|referral|offline|email|sms)'
    ),
    -- First touch wins when the same number appears more than once (a GHL form
    -- fill AND a CallRail call, or two of either) — one lead, not two.
    deduped AS (
      SELECT DISTINCT ON (phone10) *
        FROM pool
       ORDER BY phone10, lead_at
    ),
    -- ONE PHONE NUMBER CAN MATCH MORE THAN ONE DENTALLY CONTACT — a shared
    -- family/reception line, or a duplicate patient record recreated by the
    -- Dentally sync (see the "Contacts dedup" memory). Grouping by phone10
    -- FIRST and aggregating every matching contact_id into one array is
    -- load-bearing: "new", "booked" and "accepted" are each answered ACROSS
    -- every contact this phone could plausibly be, never one at a time.
    --
    -- lead_day_start is computed HERE, once per lead, so the three predicates
    -- below can compare a bare column against it — see london_day_start().
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
    -- is_new_patient is returned as its OWN column, NOT applied as a filter
    -- here — the "new patients only" / "including existing" toggle needs BOTH
    -- figures from the SAME query, computed the SAME way, so they can never
    -- silently drift against each other.
    is_new AS (
      SELECT pi.phone10,
             NOT EXISTS (
               SELECT 1 FROM appointments pa
                WHERE pa.organisation_id = %1$L
                  AND pa.contact_id = ANY(pi.ids)
                  -- London DAYS, like booking and paid below. Currently a tie
                  -- on live data (0 rows change either way), but leaving the
                  -- file with two conventions is how the next reader concludes
                  -- the instant form is fine.
                  AND pa.starts_at < pi.lead_day_start
             ) AS is_new_patient
        FROM patient_ids pi
    ),
    -- BOOKED = ANY of this phone's matched contacts has a Dentally appointment
    -- on or after the lead's own DAY, cancelled ones excluded — NO upper
    -- bound. An earlier version also required the appointment to fall before
    -- the window closed; checked against Dentally's own count for the same
    -- period it undercounted by exactly the appointments scheduled beyond the
    -- window. "Booked" answers "does this lead have an appointment on the
    -- books", not "does it also fall in this window".
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
    -- MONEY PAID, the acceptance signal. See this file's header for the
    -- date-not-instant reasoning, for why the lower bound is the lead's own
    -- day, and for why refunds net off rather than being filtered out.
    -- status='settled' only: 'pending' means the cash has not landed.
    --
    -- NO UPPER BOUND, exactly like booking above. This is a COHORT question —
    -- "of the leads this window's spend bought, how many have paid" — not a
    -- cash-in-period question, so money counts whenever it arrives. Bounding
    -- it to the window truncated every lead who paid after the period closed,
    -- and the damage grew as the window narrowed: on July 2026 it reported 16
    -- accepted against a true 20, a 25% undercount of 28 booked, while the
    -- 92-day view lost only one. That is why it survived being tested on a
    -- wide window and surfaced on a single month.
    --
    -- The cost of this is real and accepted: a past period's CPA improves as
    -- its leads convert, so the same month re-read later can show a better
    -- figure. `booked` has always behaved that way (checked against Dentally's
    -- own count), and a funnel whose two halves answer different questions is
    -- worse than one that moves.
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
    -- The drill-down's `treatment` label ONLY — it does not decide acceptance.
    -- LARGEST LINE WINS: ordering by invoiced_on/id picked whatever sorted
    -- first, which on a real invoice is regularly a £0.00 filler (see the
    -- header's £89 patient labelled with a £0.00 "Bitewings").
    --
    -- Lead-relative and open-ended, like paid and booking. Window-bounding it
    -- left an accepted patient with a blank treatment whenever the invoice
    -- landed after the period closed — the same truncation, showing up as a
    -- row that says someone paid £173 for nothing in particular.
    --
    -- invoiced_on is a DATE column, so a plain date bound is already sargable
    -- and needs no london_day_start.
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
           coalesce(pd.paid_pence, 0)::bigint AS paid_pence
      FROM deduped d
      LEFT JOIN practices pr ON pr.id = d.practice_id AND pr.organisation_id = %1$L
      LEFT JOIN booking bk ON bk.phone10 = d.phone10
      LEFT JOIN main_treatment fi ON fi.phone10 = d.phone10
      LEFT JOIN is_new inw ON inw.phone10 = d.phone10
      LEFT JOIN paid pd ON pd.phone10 = d.phone10
  $q$,
    p_org, p_since, p_until, p_min_paid_pence);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_google_lead_ledger(uuid, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_google_lead_ledger(uuid, timestamptz, timestamptz, integer)
  TO service_role;

-- Supports the new paid CTE. payments had (contact_id) alone and
-- (organisation_id) alone, so the org-scoped contact lookup could not be
-- served by one index — same gap 000158 closed on invoice_items.
CREATE INDEX IF NOT EXISTS idx_payments_org_contact_settled
  ON payments(organisation_id, contact_id, processed_at)
  WHERE status = 'settled' AND contact_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
