-- ============================================================================
-- ad_google_lead_ledger — standing correctness checks.
--
-- Run against hosted (or any environment with real data) after touching
-- migration 000162 or 000165, the Google report service, or the Dentally /
-- CallRail / GoHighLevel syncs that feed them:
--
--     psql "$DATABASE_URL" -v org="'<organisation uuid>'" \
--          -v since="'2026-06-01'" -v until="'2026-09-01'" \
--          -f scripts/google-lead-ledger-check.sql
--
-- Every check returns a COUNT that must be 0, with the reason it exists.
--
-- These are not unit tests, and they are not decoration. Every defect this
-- file guards against was found in production data, and every one of them
-- type-checked, ran without error, and answered the wrong question in
-- silence: an instant compared to a date-only feed, a DISTINCT ON that
-- picked a £0.00 line, a refund filtered out of the sum that decides whether
-- a patient was acquired. No mock and no type can see any of that. A count
-- taken over real rows can.
--
-- KNOWN AND DELIBERATE, so do not "fix" it on sight: leads are matched to
-- Dentally patients BY PHONE, and 40 of this org's 528 leads share a number
-- with more than one patient record (a family line, or a duplicate patient
-- the Dentally sync recreated — see the "Contacts dedup" memory). Money and
-- appointments are therefore counted across every patient that phone could
-- be. Measured: exactly one lead's acceptance currently rests on payments
-- from more than one patient. Narrowing it would cost more than it saves —
-- an appointment lands on whichever duplicate the front desk picked, so
-- committing to one record loses real bookings. Listed here so the next
-- person to find it knows it was measured, not missed.
--
-- RUN IT ON A NARROW WINDOW, NOT ONLY A WIDE ONE. This matters more than it
-- sounds. The window-bound bug (a lead that pays after the period closes was
-- never counted) scales INVERSELY with window width: on the 92-day view it
-- lost one acceptance in 44 and every check passed, while July 2026 was
-- reporting 16 against a true 20 — a 25% undercount of 28 booked. It was
-- verified on the wide window, shipped, and found by the owner on a single
-- month. Run this for at least one single month as well as the wide window,
-- and prefer a RECENT month, where conversions are still arriving.
--
-- Same spirit as scripts/data-room-reconcile.sql.
-- ============================================================================

\if :{?org}
\else
  \echo 'Set -v org, -v since, -v until.'
  \quit
\endif

WITH led AS (
  SELECT * FROM ad_google_lead_ledger(:org::uuid, :since::timestamptz, :until::timestamptz)
),
pids AS (
  SELECT led.phone10, min(led.lead_at) AS lead_at, array_agg(DISTINCT c.id) AS ids
    FROM led
    JOIN contacts c ON c.organisation_id = :org::uuid
                   AND c.pms_external_id IS NOT NULL
                   AND c.phone10 IS NOT NULL
                   AND c.phone10 = led.phone10
   GROUP BY led.phone10
),
checks AS (
  -- 1. THE MONEY MUST BE THE MONEY. An INDEPENDENT restatement of what
  --    paid_pence should be, compared against what the ledger returned.
  --    Deliberately a restatement and not a call back into the function:
  --    edit the RPC's predicates without editing this one and the two
  --    disagree, which is the whole point. Four separate live defects are
  --    caught by this single check —
  --
  --      * SAME-DAY PAYMENTS. Every settled row from this feed is stamped
  --        midnight UTC (Dentally sends a date), so `processed_at >=
  --        lead_at` silently drops every payment made on the lead's own day
  --        — the common case, not an edge one. Worth 12 of 13 apparently
  --        unpaid leads when it was live.
  --      * REFUNDS. Filtering `amount_pence > 0` reads a refund as though it
  --        never happened; one lead was counted as an acquired patient whose
  --        money had been returned IN FULL.
  --      * A WINDOW BOUND ON THE MONEY. Acceptance is a COHORT question, so
  --        there is NO upper bound: a lead from 12 July who pays on 15 August
  --        converted, and the July report must say so. This recomputation is
  --        deliberately open-ended for that reason — an earlier version of
  --        this very check carried the same bound the code did and therefore
  --        agreed with the bug. A check that shares the code's assumption
  --        verifies nothing.
  --      * `::date` ON A WINDOW BOUND resolves in the SERVER's zone, so a
  --        London instant reads a day early all summer.
  SELECT 'paid_pence disagrees with an independent net recomputation' AS check_name,
         count(*) AS should_be_zero
    FROM pids p
    JOIN led l ON l.phone10 = p.phone10
   WHERE l.paid_pence <> coalesce((
     SELECT sum(pm.amount_pence) FROM payments pm
      WHERE pm.organisation_id = :org::uuid AND pm.contact_id = ANY(p.ids)
        AND pm.status = 'settled'
        AND london_day(pm.processed_at) >= london_day(p.lead_at)
   ), 0)

  UNION ALL
  -- 1b. TRUNCATION, STATED DIRECTLY. Check 1 compares totals; this one names
  --     the symptom the owner actually reported — a lead that has paid real
  --     money since it landed, sitting on screen as not accepted. It is
  --     redundant with 1 by construction and kept anyway, because it is the
  --     check whose FAILURE MESSAGE a future reader will understand without
  --     first understanding the recomputation.
  SELECT 'a lead has paid over the floor since it landed but is not accepted', count(*)
    FROM pids p
    JOIN led l ON l.phone10 = p.phone10
   WHERE NOT l.accepted
     AND coalesce((
       SELECT sum(pm.amount_pence) FROM payments pm
        WHERE pm.organisation_id = :org::uuid AND pm.contact_id = ANY(p.ids)
          AND pm.status = 'settled'
          AND london_day(pm.processed_at) >= london_day(p.lead_at)
     ), 0) > 4000

  UNION ALL
  -- 2. THE SAME-DAY TRAP, BOOKING SIDE. An appointment EARLIER in the day
  --    than the lead row describing it is still a booking — the CRM record
  --    is written after the fact. Found live as a `completed` 12:45
  --    appointment against a 15:21 CallRail row, reading booked = false.
  SELECT 'appointment on the lead''s own day is not counted as booked', count(*)
    FROM pids p
    JOIN led l ON l.phone10 = p.phone10
   WHERE NOT l.booked
     AND EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.organisation_id = :org::uuid AND a.contact_id = ANY(p.ids)
          AND london_day(a.starts_at) = london_day(p.lead_at)
          AND coalesce(a.status, '') <> 'cancelled'
     )

  UNION ALL
  -- 3. THE FUNNEL MUST NOT CONTRADICT ITSELF. A blanket "accepted <=
  --    booked" is NOT asserted here, because on real data it is false and a
  --    check that always fails is a check nobody reads: two new patients
  --    paid with no appointment row at all. Both are data, not rule.
  --
  --    What IS a defect: accepted, not booked, and a non-cancelled
  --    appointment sitting right there on record. That means the booking
  --    predicate failed to see an appointment it should have seen — exactly
  --    how the instant-vs-day bug announced itself.
  SELECT 'accepted but not booked despite an appointment on record', count(*)
    FROM pids p
    JOIN led l ON l.phone10 = p.phone10
   WHERE l.accepted AND NOT l.booked
     AND EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.organisation_id = :org::uuid AND a.contact_id = ANY(p.ids)
          AND coalesce(a.status, '') <> 'cancelled'
          AND london_day(a.starts_at) >= london_day(p.lead_at)
     )

  UNION ALL
  -- 4. THE FLAG MUST MATCH THE MONEY BESIDE IT. accepted is derived from
  --    paid_pence against the floor, and the drill-down prints both on the
  --    same row. If they ever disagree the page contradicts itself in
  --    public. 4000 is the RPC's own default, so this also catches the
  --    service passing a floor the reader is not being shown.
  SELECT 'accepted disagrees with paid_pence against the £40 floor', count(*)
    FROM led l
   WHERE l.accepted <> (l.paid_pence > 4000)

  UNION ALL
  -- 5. THE TREATMENT LABEL MUST NAME THE MONEY. A £0.00 line is a filler
  --    (bitewings alongside a paid exam, say); naming one as "the treatment"
  --    for a patient who paid hundreds is the failure this check exists for.
  --    Positive only when a real, non-zero line was available and passed over.
  SELECT 'treatment label is a £0 line when a paid line exists', count(*)
    FROM pids p
    JOIN led l ON l.phone10 = p.phone10
   WHERE l.treatment IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM invoice_items ii
        WHERE ii.organisation_id = :org::uuid AND ii.contact_id = ANY(p.ids)
          AND ii.treatment_plan_id IS NOT NULL
          AND ii.invoiced_on >= london_day(:since::timestamptz)
          AND ii.invoiced_on <  london_day(:until::timestamptz)
          AND ii.treatment_name = l.treatment AND coalesce(ii.fee_pence, 0) = 0
     )
     AND EXISTS (
       SELECT 1 FROM invoice_items ii
        WHERE ii.organisation_id = :org::uuid AND ii.contact_id = ANY(p.ids)
          AND ii.treatment_plan_id IS NOT NULL
          AND ii.invoiced_on >= london_day(:since::timestamptz)
          AND ii.invoiced_on <  london_day(:until::timestamptz)
          AND coalesce(ii.fee_pence, 0) > 0
     )

  UNION ALL
  -- 6. NO OTHER CHANNEL'S CALLS COUNTED AS GOOGLE. CallRail carries no
  --    ad/campaign linkage, so its calls enter this ledger on the strength
  --    of the source label alone. On the org this was built against every
  --    call is "Google Ads", which is precisely why the guard matters: the
  --    first tenant to track Facebook or organic calls would have had them
  --    silently inflating Google's lead count and deflating its cost per
  --    lead, with nothing on the page looking wrong.
  SELECT 'a provably non-Google CallRail call reached the ledger', count(*)
    FROM led l
   WHERE l.source = 'callrail'
     AND EXISTS (
       SELECT 1 FROM callrail_calls cr
        WHERE cr.organisation_id = :org::uuid
          AND right(regexp_replace(coalesce(cr.caller_number, ''), '[^0-9]', '', 'g'), 10) = l.phone10
          AND london_day(cr.started_at) = london_day(l.lead_at)
          AND coalesce(cr.source, '') ~* '(facebook|instagram|meta|bing|yahoo|organic|direct|referral|offline|email|sms)'
     )

  UNION ALL
  -- 7. TENANT ISOLATION. serviceClient bypasses RLS, so p_org IS the
  --    boundary. Not a formality: every row the ledger returns must trace to
  --    a contact or a call belonging to the org that asked for it.
  SELECT 'ledger returned a phone this org has no contact or call for', count(*)
    FROM led l
   WHERE NOT EXISTS (
     SELECT 1 FROM contacts c
      WHERE c.organisation_id = :org::uuid AND c.phone10 = l.phone10
   )
     AND NOT EXISTS (
     SELECT 1 FROM callrail_calls cr
      WHERE cr.organisation_id = :org::uuid
        AND right(regexp_replace(coalesce(cr.caller_number, ''), '[^0-9]', '', 'g'), 10) = l.phone10
   )
  UNION ALL
  -- ==========================================================================
  -- 8-11. CAMPAIGN ATTRIBUTION (migration 000165).
  --
  -- This half of the ledger has no unit test — it is SQL inside a migration,
  -- verified against real rows or not at all. These four are that verification.
  -- ==========================================================================

  -- 8. A CAMPAIGN NAMED ON A LEAD MUST BE ONE THIS ORG ACTUALLY HAS. The
  --    resolution joins CallRail's recorded campaign name to ad_metrics
  --    through a rename-alias lookup; a campaign_id that matches no row of
  --    this org's ad_metrics means the join escaped its org scope.
  SELECT 'lead attributed to a campaign this org does not own', count(*)
    FROM led l
   WHERE l.campaign_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM ad_metrics m
        WHERE m.organisation_id = :org::uuid
          AND m.provider = 'google_ads'
          AND m.campaign_id = l.campaign_id
     )
  UNION ALL
  -- 9. THE ROUTE AND THE RESULT MUST AGREE. `attribution` names how the
  --    campaign was resolved, and the page prints it as fact. A row with a
  --    route and no campaign (or a campaign and no route) means the CASE and
  --    the coalesce that produce them have drifted apart — which would show
  --    on screen as a confident coverage percentage over rows that carry
  --    nothing.
  SELECT 'attribution route disagrees with whether a campaign was resolved', count(*)
    FROM led l
   WHERE (l.attribution IS NULL) <> (l.campaign_id IS NULL)
  UNION ALL
  -- 10. A KEYWORD-ROUTED LEAD MUST CARRY ITS AD GROUP. callrail_keyword is
  --     the only route that resolves the full chain, and the ad group comes
  --     from the SAME gkw row as the keyword. One without the other means the
  --     join lost a column.
  SELECT 'keyword-routed lead missing its keyword or ad group', count(*)
    FROM led l
   WHERE l.attribution = 'callrail_keyword'
     AND (l.keyword_id IS NULL OR l.ad_group_id IS NULL)
  UNION ALL
  -- 11. NO LEAD MAY BE COUNTED TWICE. The attribution lookups are LEFT JOINs
  --     against tables where a name or a keyword text can legitimately appear
  --     more than once; every one of them is wrapped in a DISTINCT ON for
  --     exactly that reason. If one is ever removed, the ledger fans out and
  --     every count on the page inflates silently — the campaign rows would
  --     still sum to a plausible-looking total.
  SELECT 'ledger returned the same phone more than once', count(*)
    FROM (SELECT phone10 FROM led GROUP BY phone10 HAVING count(*) > 1) d
)
SELECT check_name, should_be_zero,
       CASE WHEN should_be_zero = 0 THEN 'PASS' ELSE 'FAIL' END AS result
  FROM checks
 ORDER BY should_be_zero DESC, check_name;
