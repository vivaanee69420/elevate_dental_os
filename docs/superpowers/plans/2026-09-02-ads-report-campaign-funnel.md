# Ads Report Part A — Booking Funnel and Campaign Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every campaign row reports leads → booked → attended → new patients with CPL / CPB / CPA, and clicking a campaign opens a page naming the people behind those numbers and where each one stopped.

**Architecture:** Two new columns on the existing per-person RPC `ad_lead_conversions`, then a campaign-grain aggregate `ad_campaign_funnel` defined *over* it so booked / attended / new-patient have one definition in one place. The service stops paging ten thousand person rows to count them and reads the aggregate instead. The frontend gains one route and no new endpoints.

**Tech Stack:** Postgres (Supabase, plpgsql RPCs), Express + native ESM backend, vitest, Next.js 14 App Router, React Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-02-ads-report-campaign-funnel-design.md`

## Global Constraints

- **Money is integer pence.** Never floats. Display via `formatPence`.
- **British English in all UI** — organisation, colour, optimise, centre.
- **No emojis** in code or UI.
- **No dark mode** — light/white only.
- **Tenant isolation (rule 3):** repositories use `serviceClient`, which bypasses RLS. Every query and every RPC arm filters `organisation_id` explicitly. A cross-org leak here is not theoretical: measured on the live data, dropping the org filter from the matcher moved `booked` from 236 to 240.
- **Every new RPC takes the grant idiom**, no exceptions:
  ```sql
  REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION … TO service_role;
  ```
- **Every migration ends with** `NOTIFY pgrst, 'reload schema';`
- **RPC bodies are `plpgsql` + `RETURN QUERY EXECUTE … USING`.** `SECURITY DEFINER` and `SET search_path` block SQL-function inlining, so a `LANGUAGE sql` body is planned generically with `p_org` unknown and never probes the org indexes — measured at 10.7s against 608ms. Do not "simplify" this.
- **PostgREST caps a set-returning function at 1000 rows exactly as it caps a table.** Page every RPC read; stop on an **empty** page, never a short one.
- **Costs are null, never zero, on a zero denominator.** Rendered `—`. A zero reads as "free".
- **`attended = false` means unknown**, not "did not attend", for anyone whose only booking is a GoHighLevel one. Never compute a no-show rate against a GHL denominator.
- **Frontend API paths carry the `/api` prefix.** The Next proxy forwards the path verbatim; a missing prefix 404s *silently* into an empty state.
- Backend: `cd backend && npx vitest run <file>`. Frontend: `cd frontend && npm run typecheck && npm run lint`.

### Verification fixture

Several tasks verify SQL against the live hosted project `mkfhpzjbijbachoonytt`. The reference window is **org `1a5f888a-0dfe-4802-acf8-6003665089ad`, `since = '2026-05-31T23:00:00Z'`, `until = '2026-08-31T23:00:00Z'`** (June–August 2026, London). Measured expected values:

| Figure | Value |
|---|---|
| leads (all people who enquired) | 3,325 |
| of those, carrying a campaign id | 1,946 |
| booked | 533 |
| attended | 323 |

These are **read-only** verifications. Do not apply DDL to hosted during implementation; the migration is applied after merge (see Task 12).

---

### Task 1: Migration — widen `ad_lead_conversions` with `booked_at` and `attended`

**Files:**
- Create: `supabase/migrations/20260101000144_ad_lead_conversions_booked.sql`
- Reference (read, do not edit): `supabase/migrations/20260101000142_ad_lead_conversions_detail.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `ad_lead_conversions(p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL)` returning `(contact_id uuid, practice_id uuid, ad_campaign_id text, attribution_source text, converted boolean, is_new_patient boolean, matched_by text, first_lead_at timestamptz, patient_contact uuid, booked_at timestamptz, attended boolean)`. The two new columns are appended **last** so positional readers of the existing nine are unaffected.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260101000144_ad_lead_conversions_booked.sql`:

```sql
-- ============================================================================
-- ad_lead_conversions — add the booking stage between "enquired" and "became a
-- patient". The section could say a campaign was expensive but never where it
-- leaked: booking or attendance.
--
-- BOOKED = a GoHighLevel calendar booking, OR a Dentally appointment. The
-- Dentally arm probes the matched PATIENT record as well as the lead contact
-- itself, because only 52 ad-attributed contacts link to a Dentally appointment
-- by contact_id directly against 157 that resolve through the match. Dropping
-- that second probe collapses the signal.
--
-- BOTH ARMS EXCLUDE CANCELLATIONS and BOTH require the appointment to start AT
-- OR AFTER the person enquired. Without the second rule an existing patient who
-- enquired again counts as "booked" on a visit from two years ago, which is the
-- same class of error is_new_patient was added in 000142 to correct.
--
-- ATTENDED comes from Dentally ONLY. GoHighLevel has recorded 1,096 confirmed,
-- 15 cancelled and TWO noshow across its entire history — nobody updates those
-- statuses. So attended=false means UNKNOWN for a GHL-only booking, and the API
-- and UI must say so rather than reporting it as a no-show.
--
-- The return type changes, so this DROPs before CREATEing.
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

-- The GHL booking probe needs (org, contact) together; idx_ghl_appts_org_start
-- is on starts_at and cannot bound a per-contact lookup.
CREATE INDEX IF NOT EXISTS idx_ghl_appts_org_contact
  ON public.ghl_appointments (organisation_id, contact_id)
  WHERE contact_id IS NOT NULL;

DROP FUNCTION IF EXISTS ad_lead_conversions(uuid, timestamptz, timestamptz, uuid);

CREATE FUNCTION ad_lead_conversions(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  contact_id uuid, practice_id uuid, ad_campaign_id text, attribution_source text,
  converted boolean, is_new_patient boolean, matched_by text,
  first_lead_at timestamptz, patient_contact uuid,
  booked_at timestamptz, attended boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- plpgsql + EXECUTE ... USING is deliberate and load-bearing. SECURITY
  -- DEFINER and SET search_path both block SQL-function inlining, so a
  -- LANGUAGE sql body is planned GENERICALLY with p_org unknown and never
  -- chooses the per-lead index probes: 10.7s against 608ms for the identical
  -- query inline. Do NOT "simplify" this back to LANGUAGE sql.
  RETURN QUERY EXECUTE $q$
    WITH lead_contacts AS (
      SELECT DISTINCT ON (c.id)
             c.id, l.practice_id, l.created_at AS first_lead_at,
             c.ad_campaign_id, c.attribution_source,
             c.email_norm AS em, c.phone10 AS ph,
             (c.pms_external_id IS NOT NULL) AS is_patient
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = $1
      WHERE l.organisation_id = $1
        AND l.created_at >= $2 AND l.created_at < $3
        AND ($4::uuid IS NULL OR l.practice_id = $4::uuid)
      ORDER BY c.id, l.created_at
    ),
    matched AS (
      SELECT lc.id AS lead_id, p.id AS patient_id, 'email'::text AS how
      FROM lead_contacts lc
      JOIN contacts p ON p.organisation_id = $1
                     AND p.pms_external_id IS NOT NULL
                     AND p.email_norm IS NOT NULL
                     AND p.email_norm = lc.em
      UNION ALL
      SELECT lc.id, p.id, 'phone'::text
      FROM lead_contacts lc
      JOIN contacts p ON p.organisation_id = $1
                     AND p.pms_external_id IS NOT NULL
                     AND p.phone10 IS NOT NULL
                     AND p.phone10 = lc.ph
      WHERE length(lc.ph) >= 10
      UNION ALL
      SELECT lc.id, lc.id, 'self'::text FROM lead_contacts lc WHERE lc.is_patient
    ),
    agg AS (
      SELECT lead_id, min(patient_id::text)::uuid AS patient_id, min(how) AS how
      FROM matched GROUP BY lead_id
    ),
    prior_visit AS (
      SELECT DISTINCT pr.lead_id
      FROM (SELECT DISTINCT lead_id, patient_id FROM matched) pr
      WHERE EXISTS (
        SELECT 1 FROM appointments a
         WHERE a.organisation_id = $1
           AND a.contact_id = pr.patient_id
           AND a.starts_at < $2
      )
    ),
    -- The booking stage. UNION ALL of three equi-joins, then one aggregate --
    -- never an OR'd join, which cannot use either index (the 000112 lesson).
    -- min() picks the earliest booking; bool_or() says whether ANY of the
    -- Dentally appointments was completed.
    booking AS (
      SELECT lead_id, min(booked_at) AS booked_at, bool_or(attended) AS attended
      FROM (
        -- GoHighLevel calendar. Contributes to booked, NEVER to attended.
        SELECT lc.id AS lead_id, g.starts_at AS booked_at, false AS attended
        FROM lead_contacts lc
        JOIN ghl_appointments g
          ON g.organisation_id = $1
         AND g.contact_id = lc.id
         AND g.starts_at >= lc.first_lead_at
         AND coalesce(g.status, '') NOT IN ('cancelled', 'invalid')
        UNION ALL
        -- Dentally, on the PATIENT record this person matched to.
        SELECT lc.id, a.starts_at, (a.status = 'completed')
        FROM lead_contacts lc
        JOIN (SELECT DISTINCT lead_id, patient_id FROM matched) pr
          ON pr.lead_id = lc.id
        JOIN appointments a
          ON a.organisation_id = $1
         AND a.contact_id = pr.patient_id
         AND a.starts_at >= lc.first_lead_at
         AND coalesce(a.status, '') <> 'cancelled'
        UNION ALL
        -- Dentally, on the lead contact itself. Not redundant with the arm
        -- above: a contact can hold appointments without ever matching a
        -- patient record.
        SELECT lc.id, a.starts_at, (a.status = 'completed')
        FROM lead_contacts lc
        JOIN appointments a
          ON a.organisation_id = $1
         AND a.contact_id = lc.id
         AND a.starts_at >= lc.first_lead_at
         AND coalesce(a.status, '') <> 'cancelled'
      ) b
      GROUP BY lead_id
    )
    SELECT lc.id, lc.practice_id, lc.ad_campaign_id, lc.attribution_source,
           (agg.lead_id IS NOT NULL) AS converted,
           (agg.lead_id IS NOT NULL AND pv.lead_id IS NULL) AS is_new_patient,
           CASE WHEN lc.is_patient THEN 'self' ELSE agg.how END AS matched_by,
           lc.first_lead_at,
           agg.patient_id,
           bk.booked_at,
           -- NULL from the aggregate means "no Dentally row at all", which is
           -- unknown, not attended. Coalescing to false here is safe only
           -- because the API layer reports attendance as unknown whenever
           -- booked_at came from GoHighLevel alone.
           coalesce(bk.attended, false) AS attended
    FROM lead_contacts lc
    LEFT JOIN agg         ON agg.lead_id = lc.id
    LEFT JOIN prior_visit pv ON pv.lead_id = lc.id
    LEFT JOIN booking     bk ON bk.lead_id = lc.id
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

REVOKE ALL ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verify the logic against live data, read-only**

Do **not** apply the migration. Run the function's body as an inline query against hosted project `mkfhpzjbijbachoonytt`, substituting the fixture values for `$1`–`$4` (`'1a5f888a-0dfe-4802-acf8-6003665089ad'`, `'2026-05-31T23:00:00Z'`, `'2026-08-31T23:00:00Z'`, `NULL`), wrapped as:

```sql
SELECT count(*) AS leads,
       count(*) FILTER (WHERE ad_campaign_id IS NOT NULL) AS attributed,
       count(booked_at) AS booked,
       count(*) FILTER (WHERE attended) AS attended
FROM ( <the body query> ) t;
```

Expected: `leads = 3325` and `attributed = 1946` **exactly** — the lead window is closed, so its population is stable.

`booked` and `attended` are a **floor, not an equality**: `booked >= 533` and `attended >= 323`. Both counts drift upward as syncs land, because nothing bounds a booking's date from above — a lead who enquired in August can book in December, and that booking appears the moment the sync pulls it. Measured drift of +1 on each within an hour of the plan being written.

A count **below** the floor, or `leads`/`attributed` off at all, means a real bug. A count far above it — tens, not ones — most likely means a missing `organisation_id` predicate on one of the three booking arms, which is a cross-org leak; re-check each arm before adjusting anything else. Small upward drift is expected and is not a finding.

The invariants in Step 3 are the durable check. Absolute counts against a database that syncs nightly are a smoke test, not a specification.

- [ ] **Step 3: Verify `booked_at` is the EARLIEST booking, not an arbitrary one**

The aggregate counts in Step 2 would pass even if `min()` were `max()`. Check the ordering directly, still read-only, on the same body query:

```sql
SELECT count(*) AS both_arms,
       count(*) FILTER (WHERE t.booked_at <= t.first_ghl) AS never_later_than_ghl,
       count(*) FILTER (WHERE t.booked_at <= t.first_dentally) AS never_later_than_dentally
FROM (
  SELECT f.contact_id, f.booked_at, f.first_lead_at,
         (SELECT min(g.starts_at) FROM ghl_appointments g
           WHERE g.organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad'
             AND g.contact_id = f.contact_id AND g.starts_at >= f.first_lead_at
             AND coalesce(g.status,'') NOT IN ('cancelled','invalid')) AS first_ghl,
         (SELECT min(a.starts_at) FROM appointments a
           WHERE a.organisation_id = '1a5f888a-0dfe-4802-acf8-6003665089ad'
             AND a.contact_id = f.contact_id AND a.starts_at >= f.first_lead_at
             AND coalesce(a.status,'') <> 'cancelled') AS first_dentally
  FROM ( <the body query> ) f
  WHERE f.booked_at IS NOT NULL
) t
WHERE t.first_ghl IS NOT NULL AND t.first_dentally IS NOT NULL;
```

Expected: `never_later_than_ghl` and `never_later_than_dentally` both equal `both_arms`. If `both_arms` is 0 the check proved nothing — nobody in the window holds both kinds of booking — so say so in review rather than recording it as a pass.

Also confirm no booking predates its enquiry, which is what the `>= lc.first_lead_at` bound exists to prevent:

```sql
SELECT count(*) FROM ( <the body query> ) f WHERE f.booked_at < f.first_lead_at;
```

Expected: `0`.

- [ ] **Step 4: Confirm the SQL parses**

Run the whole migration file inside an aborted transaction against hosted so nothing is committed:

```sql
BEGIN; \i supabase/migrations/20260101000144_ad_lead_conversions_booked.sql ROLLBACK;
```

If you cannot run `\i`, paste the file contents between `BEGIN;` and `ROLLBACK;`. Expected: no error. `NOTIFY` inside an aborted transaction is discarded, which is what we want here.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260101000144_ad_lead_conversions_booked.sql
git commit -m "feat(marketing): add the booking stage to ad_lead_conversions"
```

---

### Task 2: Migration — `ad_campaign_funnel` aggregate

**Files:**
- Create: `supabase/migrations/20260101000145_ad_campaign_funnel.sql`

**Interfaces:**
- Consumes: `ad_lead_conversions(uuid, timestamptz, timestamptz, uuid)` from Task 1.
- Produces: `ad_campaign_funnel(p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL)` returning `(ad_campaign_id text, attribution_source text, practice_id uuid, leads bigint, booked bigint, attended bigint, patients bigint, new_patients bigint)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260101000145_ad_campaign_funnel.sql`:

```sql
-- ============================================================================
-- ad_campaign_funnel — the campaign table's counts, aggregated in SQL.
--
-- WHY: ad_lead_conversions returns ONE ROW PER PERSON — 10,429 rows at 2.8s
-- over a year — and PostgREST caps a set-returning function at 1000 rows, so
-- the service was making eleven calls purely to count them. This returns at
-- most (campaigns x sources x practices) rows, realistically a few hundred.
-- The row-level function stays the right tool for the leads list and the
-- campaign detail page, where the per-person detail is the point.
--
-- IT READS THROUGH ad_lead_conversions rather than restating its query. booked,
-- attended, converted and is_new_patient then have exactly ONE definition. The
-- section already carries duplicated channel resolution between
-- marketing_monthly_rollup and marketing.service.js; a third copy of the funnel
-- rules is not acceptable.
--
-- GROUPED BY (campaign, source, practice), not campaign alone, because the same
-- call feeds the campaign table, the channel split AND the practice comparison.
-- This is exact rather than approximate because ad_lead_conversions emits
-- DISTINCT ON (c.id) — one row per person — so each person lands in exactly one
-- group and the group counts sum to the population without double-counting.
--
-- Idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================

DROP FUNCTION IF EXISTS ad_campaign_funnel(uuid, timestamptz, timestamptz, uuid);

CREATE FUNCTION ad_campaign_funnel(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  ad_campaign_id text, attribution_source text, practice_id uuid,
  leads bigint, booked bigint, attended bigint,
  patients bigint, new_patients bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- plpgsql + EXECUTE ... USING for the same reason as ad_lead_conversions:
  -- SECURITY DEFINER + SET search_path block inlining, so a LANGUAGE sql body
  -- would be planned generically with p_org unknown. Do NOT "simplify" this.
  RETURN QUERY EXECUTE $q$
    SELECT f.ad_campaign_id,
           f.attribution_source,
           f.practice_id,
           count(*)::bigint                                        AS leads,
           count(f.booked_at)::bigint                              AS booked,
           count(*) FILTER (WHERE f.attended)::bigint              AS attended,
           count(*) FILTER (WHERE f.converted)::bigint             AS patients,
           count(*) FILTER (WHERE f.is_new_patient)::bigint        AS new_patients
    FROM ad_lead_conversions($1, $2, $3, $4::uuid) f
    GROUP BY f.ad_campaign_id, f.attribution_source, f.practice_id
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

REVOKE ALL ON FUNCTION ad_campaign_funnel(uuid, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ad_campaign_funnel(uuid, timestamptz, timestamptz, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verify it reconciles to Task 1**

Read-only against hosted. Because `ad_lead_conversions` is not yet applied, substitute its body inline as in Task 1 Step 2, aggregate it with the `GROUP BY` above, and check the sums:

```sql
SELECT sum(leads) AS leads, sum(booked) AS booked, sum(attended) AS attended
FROM ( <the grouped query> ) g;
```

Expected, matching Task 1 exactly: `leads = 3325`, `booked = 533`, `attended = 323`. A mismatch means a group key is nullable in a way that drops rows — `GROUP BY` keeps NULL groups, so any shortfall is a real bug, not expected behaviour.

- [ ] **Step 3: Check the row count is well under the PostgREST cap**

```sql
SELECT count(*) FROM ( <the grouped query> ) g;
```

Record the number in the commit message. If it exceeds 1000, say so in review — the repository pages defensively (Task 3), so it is not a correctness problem, but it is worth knowing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000145_ad_campaign_funnel.sql
git commit -m "feat(marketing): aggregate the campaign funnel in SQL"
```

---

### Task 3: Repository — `campaignFunnel`, and booking fields on `leadsByCampaign`

**Files:**
- Modify: `backend/src/repositories/marketing.repository.js`
- Test: `backend/test/marketing.repository.test.mjs`

**Interfaces:**
- Consumes: `ad_campaign_funnel` (Task 2), `ad_lead_conversions` (Task 1).
- Produces:
  - `marketingRepository.campaignFunnel(orgId, since, until, practiceId = null)` → `Array<{ ad_campaign_id: string|null, attribution_source: string|null, practice_id: string|null, leads: number, booked: number, attended: number, patients: number, newPatients: number }>`
  - `marketingRepository.leadsByCampaign(...)` — unchanged signature, each row gains `booked_at: string|null` and `attended: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/marketing.repository.test.mjs`:

```javascript
// The repository pages: it calls the RPC until a page comes back EMPTY. Serve
// the pages in order, ending with [] so the loop terminates.
function servePages(...pages) {
    let call = 0;
    supaRec.rpcProvider = () => ({ data: pages[call++] ?? [], error: null });
}

describe('campaignFunnel', () => {
    beforeEach(() => { supaRec.rpcCalls = []; });

    it('maps snake_case RPC columns to numbers, defaulting missing counts to 0', async () => {
        servePages([
            { ad_campaign_id: 'c1', attribution_source: 'Paid Social', practice_id: 'p1',
              leads: '12', booked: '3', attended: '1', patients: '2', new_patients: '2' },
            { ad_campaign_id: null, attribution_source: null, practice_id: null, leads: '5' },
        ], []);
        const rows = await marketingRepository.campaignFunnel(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(rows[0]).toEqual({
            ad_campaign_id: 'c1', attribution_source: 'Paid Social', practice_id: 'p1',
            leads: 12, booked: 3, attended: 1, patients: 2, newPatients: 2,
        });
        // A group the RPC returned without every count must not become NaN.
        expect(rows[1]).toEqual({
            ad_campaign_id: null, attribution_source: null, practice_id: null,
            leads: 5, booked: 0, attended: 0, patients: 0, newPatients: 0,
        });
    });

    it('passes the org through as p_org — there is no automatic isolation', async () => {
        servePages([]);
        await marketingRepository.campaignFunnel('org-9', AUG_SINCE, AUG_UNTIL, 'prac-2');
        expect(supaRec.rpcCalls[0]).toMatchObject({
            fn: 'ad_campaign_funnel',
            params: { p_org: 'org-9', p_since: AUG_SINCE, p_until: AUG_UNTIL, p_practice: 'prac-2' },
        });
    });

    it('stops on an EMPTY page, not a short one', async () => {
        // A short page must not be treated as the last: the server's cap is its
        // own setting and could sit below PAGE, which would reintroduce the
        // truncation this paging exists to prevent.
        const short = new Array(700).fill(0).map((_, i) => ({ ad_campaign_id: `c${i}`, leads: '1' }));
        servePages(short, []);
        const rows = await marketingRepository.campaignFunnel(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(rows).toHaveLength(700);
        expect(supaRec.rpcCalls).toHaveLength(2);
    });
});

describe('leadsByCampaign booking fields', () => {
    beforeEach(() => { supaRec.rpcCalls = []; });

    it('carries booked_at and attended through to the caller', async () => {
        servePages([{ contact_id: 'x1', booked_at: '2026-07-02T09:00:00Z', attended: true }], []);
        const rows = await marketingRepository.leadsByCampaign(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(rows[0].booked_at).toBe('2026-07-02T09:00:00Z');
        expect(rows[0].attended).toBe(true);
    });

    it('defaults a missing booked_at to null and attended to false', async () => {
        servePages([{ contact_id: 'x2' }], []);
        const rows = await marketingRepository.leadsByCampaign(ORG, AUG_SINCE, AUG_UNTIL, null);
        expect(rows[0].booked_at).toBeNull();
        expect(rows[0].attended).toBe(false);
    });
});
```

`supaRec`, `ORG`, `AUG_SINCE` and `AUG_UNTIL` are already defined at the top of this file — reuse them, do not redeclare. `supaRec.rpcProvider` and `supaRec.rpcCalls` are the harness's built-in RPC recorder (`test/setup.js`); its `.rpc()` returns a thenable builder that already survives `.order().range()` chaining, so no local mock helper is needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run test/marketing.repository.test.mjs`
Expected: FAIL — `marketingRepository.campaignFunnel is not a function`, and the `leadsByCampaign` cases fail on `undefined` rather than `null`/`false`.

- [ ] **Step 3: Implement**

In `backend/src/repositories/marketing.repository.js`, add `booked_at` and `attended` to the mapping returned by `leadsByCampaign`:

```javascript
        return rows.map((r) => ({
            ad_campaign_id: r.ad_campaign_id ?? null,
            attribution_source: r.attribution_source ?? null,
            contact_id: r.contact_id,
            practice_id: r.practice_id ?? null,
            converted: r.converted === true,
            is_new_patient: r.is_new_patient === true,
            matched_by: r.matched_by ?? null,
            first_lead_at: r.first_lead_at ?? null,
            booked_at: r.booked_at ?? null,
            attended: r.attended === true,
        }));
```

Then add `campaignFunnel` immediately after `leadsByCampaign`:

```javascript
    // Campaign-grain counts: leads, booked, attended, patients, new patients.
    //
    // A dedicated aggregate rather than counting leadsByCampaign in JS. That
    // function returns one row per PERSON — 10,429 over a year at 2.8s a call,
    // which PostgREST's 1000-row cap turns into eleven calls just to produce
    // counts. This returns campaigns x sources x practices, a few hundred rows.
    //
    // Grouped rather than collapsed to campaign so ONE call still feeds the
    // campaign table, the channel split and the practice comparison. Exact, not
    // approximate: ad_lead_conversions emits one row per person, so each person
    // lands in exactly one group.
    //
    // Paged on principle. The row count should sit well under the cap, but the
    // cap has silently truncated this file twice and four lines buy immunity.
    async campaignFunnel(orgId, since, until, practiceId = null) {
        const PAGE = 1000;
        const rows = [];
        for (let from = 0; ; ) {
            const { data, error } = await supabase_1.serviceClient
                .rpc('ad_campaign_funnel', {
                    p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
                })
                // OFFSET without a UNIQUE sort key may repeat one row and skip
                // another. ad_campaign_id ALONE is not unique here: the RPC
                // groups by three columns, and unattributed leads carry a null
                // campaign id across several practices and sources, so ordering
                // on it alone ties. All three together ARE the group key and so
                // are unique per row. Each is nullable, hence explicit null
                // placement on every key.
                .order('ad_campaign_id', { ascending: true, nullsFirst: true })
                .order('attribution_source', { ascending: true, nullsFirst: true })
                .order('practice_id', { ascending: true, nullsFirst: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(`ad_campaign_funnel: ${error.message}`);
            const page = data ?? [];
            rows.push(...page);
            // Stop on an EMPTY page, never a short one — see leadsByCampaign.
            if (page.length === 0) break;
            from += page.length;
        }
        return rows.map((r) => ({
            ad_campaign_id: r.ad_campaign_id ?? null,
            attribution_source: r.attribution_source ?? null,
            practice_id: r.practice_id ?? null,
            leads: Number(r.leads ?? 0),
            booked: Number(r.booked ?? 0),
            attended: Number(r.attended ?? 0),
            patients: Number(r.patients ?? 0),
            newPatients: Number(r.new_patients ?? 0),
        }));
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/marketing.repository.test.mjs`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/marketing.repository.js backend/test/marketing.repository.test.mjs
git commit -m "feat(marketing): read the campaign funnel as an aggregate"
```

---

### Task 4: Service — `joinSpendToLeads` over funnel groups

**Files:**
- Modify: `backend/src/services/marketing.service.js`
- Test: `backend/test/marketing.service.test.mjs`

**Interfaces:**
- Consumes: `marketingRepository.campaignFunnel` rows (Task 3).
- Produces: `__test.joinSpendToLeads(spendRows, funnelRows)` — **second argument changes from person rows to funnel groups**. Returns `{ rows, totals }` where each row gains `booked: number`, `attended: number`, `costPerBookingPence: number|null`, `costPerNewPatientPence: number|null`, and `totals` gains `booked`, `attended`, `attributedBooked`, `attributedNewPatients`, `costPerBookingPence`, `costPerNewPatientPence`.

Funnel group shape, for reference in this and the next two tasks:

```javascript
{ ad_campaign_id: string|null, attribution_source: string|null, practice_id: string|null,
  leads: number, booked: number, attended: number, patients: number, newPatients: number }
```

- [ ] **Step 1: Write the failing tests**

The existing `joinSpendToLeads` describe block feeds it person rows. Replace that block's fixtures with funnel groups and add the new cases. In `backend/test/marketing.service.test.mjs`, replace the `describe('joinSpendToLeads', …)` block with:

```javascript
describe('joinSpendToLeads', () => {
    const spend = [
        { provider: 'meta_ads', campaign_id: '120249721894530517', campaign_name: 'Dental Implant Open Day Sept 26',
          spend_pence: 147265, impressions: 105437, clicks: 2400, conversions: 412 },
        { provider: 'google_ads', campaign_id: '22794584316', campaign_name: '.G New Patient',
          spend_pence: 88668, impressions: 10916, clicks: 764, conversions: 52 },
    ];
    // One group per (campaign, source, practice). Each PERSON appears in
    // exactly one group, so the counts add up without double-counting.
    const funnel = [
        { ad_campaign_id: '120249721894530517', attribution_source: 'Paid Social', practice_id: 'p1',
          leads: 2, booked: 1, attended: 1, patients: 1, newPatients: 1 },
        { ad_campaign_id: '22794584316', attribution_source: 'Paid Search', practice_id: 'p1',
          leads: 1, booked: 1, attended: 0, patients: 1, newPatients: 0 },
        { ad_campaign_id: null, attribution_source: 'Referral', practice_id: 'p1',
          leads: 1, booked: 0, attended: 0, patients: 0, newPatients: 0 },
    ];

    it('computes cost per lead, per booking and per new patient in integer pence', () => {
        const { rows } = __test.joinSpendToLeads(spend, funnel);
        const meta = rows.find((r) => r.campaignId === '120249721894530517');
        expect(meta.leads).toBe(2);
        expect(meta.booked).toBe(1);
        expect(meta.attended).toBe(1);
        expect(meta.costPerLeadPence).toBe(73633);        // round(147265 / 2)
        expect(meta.costPerBookingPence).toBe(147265);    // 147265 / 1
        expect(meta.costPerNewPatientPence).toBe(147265); // 147265 / 1
    });

    it('sums several groups that share a campaign', () => {
        // The same campaign reached two practices, so it arrives as two groups.
        const split = [
            { ad_campaign_id: '22794584316', attribution_source: 'Paid Search', practice_id: 'p1',
              leads: 3, booked: 2, attended: 1, patients: 1, newPatients: 1 },
            { ad_campaign_id: '22794584316', attribution_source: 'Paid Search', practice_id: 'p2',
              leads: 4, booked: 1, attended: 0, patients: 2, newPatients: 1 },
        ];
        const { rows } = __test.joinSpendToLeads(spend, split);
        const g = rows.find((r) => r.campaignId === '22794584316');
        expect(g.leads).toBe(7);
        expect(g.booked).toBe(3);
        expect(g.attended).toBe(1);
        expect(g.patients).toBe(3);
    });

    it('never divides by zero — spend with no bookings has null CPB, not Infinity', () => {
        const noneBooked = [{ ad_campaign_id: '22794584316', attribution_source: 'Paid Search',
                              practice_id: null, leads: 4, booked: 0, attended: 0, patients: 0, newPatients: 0 }];
        const { rows } = __test.joinSpendToLeads(spend, noneBooked);
        const g = rows.find((r) => r.campaignId === '22794584316');
        expect(g.costPerBookingPence).toBeNull();
        expect(g.costPerNewPatientPence).toBeNull();
    });

    it('keeps unattributed leads out of every row but counted in totals', () => {
        const { rows, totals } = __test.joinSpendToLeads(spend, funnel);
        expect(rows.some((r) => r.campaignId === null)).toBe(false);
        expect(totals.unattributedLeads).toBe(1);
        expect(totals.leads).toBe(4);
    });

    it('reports platform conversions separately from real patients', () => {
        const { totals } = __test.joinSpendToLeads(spend, funnel);
        expect(totals.platformConversions).toBe(464);   // 412 + 52, from the ad platforms
        expect(totals.patients).toBe(2);                // matched to a Dentally record
    });

    it('totals the funnel over every person, and costs over the attributed ones', () => {
        const { totals } = __test.joinSpendToLeads(spend, funnel);
        expect(totals.booked).toBe(2);                 // everyone, referral included
        expect(totals.attended).toBe(1);
        expect(totals.attributedBooked).toBe(2);       // only campaigns with spend
        expect(totals.attributedNewPatients).toBe(1);
        expect(totals.costPerBookingPence).toBe(117967);      // round(235933 / 2)
        expect(totals.costPerNewPatientPence).toBe(235933);   // 235933 / 1
    });

    // A lead whose campaign has no spend IN THIS WINDOW produces no row. It
    // must still be accounted for, or the table silently loses people.
    it('reconciles: sum(rows.leads) + unattributedLeads === totals.leads', () => {
        const orphan = [...funnel, { ad_campaign_id: 'no-spend-here', attribution_source: 'Paid Social',
                                     practice_id: 'p1', leads: 6, booked: 0, attended: 0, patients: 0, newPatients: 0 }];
        const { rows, totals } = __test.joinSpendToLeads(spend, orphan);
        const shown = rows.reduce((n, r) => n + r.leads, 0);
        expect(shown + totals.unattributedLeads).toBe(totals.leads);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run test/marketing.service.test.mjs -t joinSpendToLeads`
Expected: FAIL — the current implementation reads `l.contact_id` and `l.converted` off each row, so counts come back as 0 or NaN and `costPerBookingPence` is `undefined`.

- [ ] **Step 3: Implement**

Replace `joinSpendToLeads` in `backend/src/services/marketing.service.js` with:

```javascript
// Campaign rows and window totals, from SPEND joined to FUNNEL GROUPS.
//
// The second argument is one row per (campaign, source, practice) — NOT one row
// per person. ad_lead_conversions emits exactly one row per contact, so every
// person lands in exactly one group and summing group counts is exact. That is
// what lets this stop paging ten thousand rows in order to count them.
function joinSpendToLeads(spendRows, funnelRows) {
    // Collapse the groups to campaign for the table.
    const byCampaign = new Map();
    const blank = () => ({ leads: 0, booked: 0, attended: 0, patients: 0, newPatients: 0 });
    for (const g of funnelRows) {
        if (!g.ad_campaign_id) continue;
        const e = byCampaign.get(g.ad_campaign_id) ?? blank();
        e.leads += g.leads;
        e.booked += g.booked;
        e.attended += g.attended;
        e.patients += g.patients;
        e.newPatients += g.newPatients;
        byCampaign.set(g.ad_campaign_id, e);
    }

    // A lead is attributed only if its campaign produced a ROW — carrying a
    // campaign id whose spend falls outside the window is not enough, or the
    // person appears in neither the rows nor the unattributed count and the
    // table stops reconciling to the tiles.
    const attributed = blank();
    const rows = spendRows.map((s) => {
        const f = byCampaign.get(s.campaign_id) ?? blank();
        attributed.leads += f.leads;
        attributed.booked += f.booked;
        attributed.attended += f.attended;
        attributed.patients += f.patients;
        attributed.newPatients += f.newPatients;
        return {
            provider: s.provider,
            campaignId: s.campaign_id,
            campaignName: s.campaign_name,
            spendPence: s.spend_pence,
            impressions: s.impressions,
            clicks: s.clicks,
            platformConversions: s.conversions,
            leads: f.leads,
            booked: f.booked,
            attended: f.attended,
            patients: f.patients,
            newPatients: f.newPatients,
            costPerLeadPence: perUnitPence(s.spend_pence, f.leads),
            costPerBookingPence: perUnitPence(s.spend_pence, f.booked),
            costPerPatientPence: perUnitPence(s.spend_pence, f.patients),
            costPerNewPatientPence: perUnitPence(s.spend_pence, f.newPatients),
            tier: 'campaign',
        };
    }).sort((a, b) => b.spendPence - a.spendPence);

    // The whole population, organic and unattributed included.
    const all = funnelRows.reduce((n, g) => ({
        leads: n.leads + g.leads,
        booked: n.booked + g.booked,
        attended: n.attended + g.attended,
        patients: n.patients + g.patients,
        newPatients: n.newPatients + g.newPatients,
    }), blank());

    const totals = {
        spendPence: rows.reduce((n, r) => n + r.spendPence, 0),
        impressions: rows.reduce((n, r) => n + r.impressions, 0),
        clicks: rows.reduce((n, r) => n + r.clicks, 0),
        platformConversions: rows.reduce((n, r) => n + r.platformConversions, 0),
        // Honest and shown on the screen — but NOT a denominator for paid spend.
        leads: all.leads,
        booked: all.booked,
        attended: all.attended,
        patients: all.patients,
        newPatients: all.newPatients,
        // The cost denominators: the population the spend can be measured
        // against. Dividing paid spend by organic enquiries understates every
        // cost per unit.
        attributedLeads: attributed.leads,
        attributedBooked: attributed.booked,
        attributedPatients: attributed.patients,
        attributedNewPatients: attributed.newPatients,
        unattributedLeads: all.leads - attributed.leads,
    };
    totals.costPerLeadPence = perUnitPence(totals.spendPence, totals.attributedLeads);
    totals.costPerBookingPence = perUnitPence(totals.spendPence, totals.attributedBooked);
    totals.costPerPatientPence = perUnitPence(totals.spendPence, totals.attributedPatients);
    totals.costPerNewPatientPence = perUnitPence(totals.spendPence, totals.attributedNewPatients);
    return { rows, totals };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/marketing.service.test.mjs -t joinSpendToLeads`
Expected: PASS, all eight cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/marketing.service.js backend/test/marketing.service.test.mjs
git commit -m "feat(marketing): report booked and attended per campaign"
```

---

### Task 5: Service — `channelSplit` and `practiceSplit` over funnel groups

**Files:**
- Modify: `backend/src/services/marketing.service.js`
- Test: `backend/test/marketing.service.test.mjs`

**Interfaces:**
- Consumes: funnel groups (Task 3), `resolveLeadChannel` (unchanged).
- Produces: `__test.channelSplit(spendRows, funnelRows, campaignProvider)` and `__test.practiceSplit(spendByPractice, funnelRows, campaignProvider)` — both second arguments change from person rows to funnel groups. Output shapes are unchanged except that each channel row gains `booked` and `attended`, and each practice row gains `booked`.

**Note:** `resolveLeadChannel(lead, campaignProvider)` reads `lead.ad_campaign_id` and `lead.attribution_source`. Both are group-key fields, so it works on a funnel group unchanged. Do **not** modify it — it must stay in step with the channel resolution inside `marketing_monthly_rollup`.

- [ ] **Step 1: Write the failing tests**

Replace the existing `channelSplit` and `practiceSplit` describe blocks in `backend/test/marketing.service.test.mjs` with:

```javascript
describe('channelSplit', () => {
    const spend = [
        { provider: 'meta_ads', spendPence: 100000, impressions: 1000, clicks: 100, platformConversions: 10 },
        { provider: 'google_ads', spendPence: 50000, impressions: 500, clicks: 50, platformConversions: 5 },
    ];
    const campaignProvider = new Map([['m1', 'meta_ads'], ['g1', 'google_ads']]);
    const funnel = [
        { ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: 'p1',
          leads: 10, booked: 4, attended: 2, patients: 3, newPatients: 2 },
        { ad_campaign_id: 'g1', attribution_source: 'Paid Search', practice_id: 'p1',
          leads: 5, booked: 2, attended: 1, patients: 1, newPatients: 1 },
        { ad_campaign_id: null, attribution_source: 'Referral', practice_id: 'p1',
          leads: 7, booked: 1, attended: 1, patients: 2, newPatients: 1 },
    ];

    it('carries booked and attended per channel', () => {
        const out = __test.channelSplit(spend, funnel, campaignProvider);
        const meta = out.find((c) => c.channel === 'meta_ads');
        expect(meta.leads).toBe(10);
        expect(meta.booked).toBe(4);
        expect(meta.attended).toBe(2);
    });

    it('gives the organic channel leads and bookings but never a cost', () => {
        // Organic enquiries cost nothing; averaging them into a paid
        // denominator would quietly flatter every cost per unit.
        const out = __test.channelSplit(spend, funnel, campaignProvider);
        const other = out.find((c) => c.channel === 'other');
        expect(other.leads).toBe(7);
        expect(other.booked).toBe(1);
        expect(other.costPerLeadPence).toBeNull();
        expect(other.costPerBookingPence).toBeNull();
    });

    it('every lead lands in exactly one channel, so channels sum to the total', () => {
        const out = __test.channelSplit(spend, funnel, campaignProvider);
        expect(out.reduce((n, c) => n + c.leads, 0)).toBe(22);
    });
});

describe('practiceSplit', () => {
    const campaignProvider = new Map([['m1', 'meta_ads']]);
    const funnel = [
        { ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: 'p1',
          leads: 10, booked: 4, attended: 2, patients: 3, newPatients: 2 },
        { ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: 'p2',
          leads: 6, booked: 1, attended: 0, patients: 1, newPatients: 1 },
    ];

    it('carries booked per practice and costs it against that practice spend', () => {
        const out = __test.practiceSplit([['p1', 200000], ['p2', 60000]], funnel, campaignProvider);
        const p1 = out.find((p) => p.practiceId === 'p1');
        expect(p1.booked).toBe(4);
        expect(p1.costPerBookingPence).toBe(50000);       // 200000 / 4
        expect(p1.costPerNewPatientPence).toBe(100000);   // 200000 / 2
    });

    it('has no cost per booking where the practice booked nobody', () => {
        const none = [{ ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: 'p3',
                        leads: 3, booked: 0, attended: 0, patients: 0, newPatients: 0 }];
        const out = __test.practiceSplit([['p3', 90000]], none, campaignProvider);
        expect(out[0].costPerBookingPence).toBeNull();
    });

    it('practices sum to the group total rather than double-counting', () => {
        const out = __test.practiceSplit([['p1', 200000], ['p2', 60000]], funnel, campaignProvider);
        expect(out.reduce((n, p) => n + p.leads, 0)).toBe(16);
    });
});
```

Also replace the `describe('totals.patients population', …)` block. It is a THIRD block feeding
per-person rows — the plan originally missed it, and Task 4 left its three tests failing. Do not
delete it: it pins the population rules corrected in a prior session (patients counted over
everyone, cost divided only by the attributable denominator, channel cards reconciling to
totals). Convert its fixture to groups, preserving every assertion:

```javascript
describe('totals.patients population', () => {
  const { joinSpendToLeads } = __test;
  const SPEND = [{
    provider: 'meta_ads', campaign_id: 'm1', campaign_name: 'A',
    spend_pence: 10000, impressions: 0, clicks: 0, conversions: 0,
  }];
  // The same four people as before, now grouped: a and b share a campaign AND a
  // source, so they are ONE group of two. c's campaign has no spend in this
  // window; d is organic.
  const FUNNEL = [
    { ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: null,
      leads: 2, booked: 0, attended: 0, patients: 1, newPatients: 0 },
    { ad_campaign_id: 'zz', attribution_source: 'Paid Search', practice_id: null,
      leads: 1, booked: 0, attended: 0, patients: 1, newPatients: 0 },
    { ad_campaign_id: null, attribution_source: 'Social media', practice_id: null,
      leads: 1, booked: 0, attended: 0, patients: 1, newPatients: 0 },
  ];

  it('counts every converted person, not only the campaign-matched ones', () => {
    const { totals } = joinSpendToLeads(SPEND, FUNNEL);
    expect(totals.leads).toBe(4);
    expect(totals.patients).toBe(3);           // the m1, zz and organic converters
    expect(totals.attributedPatients).toBe(1); // only m1 sits on a campaign with spend
  });

  it('still divides spend by the attributable patients, never by all of them', () => {
    const { totals } = joinSpendToLeads(SPEND, FUNNEL);
    expect(totals.costPerPatientPence).toBe(10000);   // 10000 / 1, not / 3
  });

  it('reconciles with the channel cards — both count the same patients', () => {
    const { rows, totals } = joinSpendToLeads(SPEND, FUNNEL);
    const provider = new Map(SPEND.map((c) => [c.campaign_id, c.provider]));
    const channels = __test.channelSplit(rows, FUNNEL, provider);
    expect(channels.reduce((n, c) => n + c.patients, 0)).toBe(totals.patients);
    expect(channels.reduce((n, c) => n + c.leads, 0)).toBe(totals.leads);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run test/marketing.service.test.mjs -t Split`
Expected: FAIL — both functions currently increment by 1 per person row, so counts read 1 or 2 instead of the group sums, and `booked` is `undefined`.

- [ ] **Step 3: Implement**

In `backend/src/services/marketing.service.js`, change the lead loop inside `channelSplit` from counting rows to summing groups. Replace the `blank()` helper and the `for (const l of leadRows)` loop:

```javascript
    const blank = () => ({
        spendPence: 0, impressions: 0, clicks: 0, platformConversions: 0,
        campaigns: 0, leads: 0, booked: 0, attended: 0, patients: 0,
    });
```

```javascript
    for (const g of funnelRows) {
        const e = by.get(resolveLeadChannel(g, campaignProvider));
        e.leads += g.leads;
        e.booked += g.booked;
        e.attended += g.attended;
        e.patients += g.patients;
    }
```

and rename the parameter from `leadRows` to `funnelRows` in the signature. Then extend the costed mapping at the end of `channelSplit`:

```javascript
            return {
                ...e,
                costPerLeadPence: costed ? perUnitPence(e.spendPence, e.leads) : null,
                costPerBookingPence: costed ? perUnitPence(e.spendPence, e.booked) : null,
                costPerPatientPence: costed ? perUnitPence(e.spendPence, e.patients) : null,
            };
```

In `practiceSplit`, rename `leadRows` to `funnelRows`, extend the row factory with `booked`, and replace the loop:

```javascript
    const row = (id) => {
        if (!by.has(id)) {
            by.set(id, {
                practiceId: id, spendPence: 0, leads: 0, booked: 0, patients: 0, newPatients: 0,
                channels: { meta_ads: 0, google_ads: 0, other: 0 },
            });
        }
        return by.get(id);
    };
```

```javascript
    for (const g of funnelRows) {
        const e = row(g.practice_id ?? null);
        e.leads += g.leads;
        e.booked += g.booked;
        e.patients += g.patients;
        e.newPatients += g.newPatients;
        e.channels[resolveLeadChannel(g, campaignProvider)] += g.leads;
    }
```

and add cost per booking to its mapping:

```javascript
        .map((e) => ({
            ...e,
            costPerLeadPence: e.spendPence > 0 ? perUnitPence(e.spendPence, e.leads) : null,
            costPerBookingPence: e.spendPence > 0 && e.booked > 0
                ? perUnitPence(e.spendPence, e.booked)
                : null,
            costPerNewPatientPence: e.spendPence > 0 && e.newPatients > 0
                ? perUnitPence(e.spendPence, e.newPatients)
                : null,
        }))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/marketing.service.test.mjs -t Split`
Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/marketing.service.js backend/test/marketing.service.test.mjs
git commit -m "feat(marketing): split bookings by channel and by practice"
```

---

### Task 6: Service — wire `campaignPerformance` to the aggregate

**Files:**
- Modify: `backend/src/services/marketing.service.js`
- Test: `backend/test/marketing.service.test.mjs`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces: `marketingService.campaignPerformance` payload with the new fields; `PAYLOAD_VERSION = 6`.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/marketing.service.test.mjs`:

```javascript
describe('campaignPerformance', () => {
    it('reads the aggregate, NOT the per-person function', async () => {
        // The per-person function returns one row per contact and has to be
        // paged around PostgREST's 1000-row cap. Counting through it here was
        // eleven round trips to produce numbers SQL can produce in one.
        const repo = await import('../src/repositories/marketing.repository.js');
        const funnel = vi.spyOn(repo.marketingRepository, 'campaignFunnel').mockResolvedValue([]);
        const perPerson = vi.spyOn(repo.marketingRepository, 'leadsByCampaign').mockResolvedValue([]);
        vi.spyOn(repo.marketingRepository, 'campaignSpend').mockResolvedValue({
            campaigns: [], series: [], unmappedSpendPence: 0, spendByPractice: [],
        });
        vi.spyOn(repo.marketingRepository, 'adAccounts').mockResolvedValue([]);

        const { marketingService } = await import('../src/services/marketing.service.js');
        await marketingService.campaignPerformance('org-1', {
            since: SINCE, until: UNTIL, refresh: true,
        });
        expect(funnel).toHaveBeenCalledTimes(1);
        expect(perPerson).not.toHaveBeenCalled();
    });
});

describe('cacheKey', () => {
    it('is versioned, so a payload with new fields is never served from an old entry', () => {
        // A cache entry written before the deploy is read after it. Without the
        // bump, every hit for the whole TTL renders against a shape that no
        // longer exists.
        expect(__test.cacheKey(SINCE, UNTIL, null)).toContain('v6');
    });
});
```

Add `const SINCE = '2026-05-31T23:00:00Z';` and `const UNTIL = '2026-08-31T23:00:00Z';` near the top of the file if not already present.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/marketing.service.test.mjs -t campaignPerformance`
Expected: FAIL — `campaignFunnel` is never called (the service still calls `leadsByCampaign`), and the cache key reads `v5`.

- [ ] **Step 3: Implement**

In `backend/src/services/marketing.service.js`, bump the version constant:

```javascript
const PAYLOAD_VERSION = 6;   // v6: booked, attended, CPB, cost per new patient
```

and change the body of `campaignPerformance` to read the aggregate:

```javascript
        const [spend, funnel, accounts] = await Promise.all([
            marketingRepository.campaignSpend(orgId, since, until, practiceId),
            marketingRepository.campaignFunnel(orgId, since, until, practiceId),
            marketingRepository.adAccounts(orgId),
        ]);
        const payload = joinSpendToLeads(spend.campaigns, funnel);
        const campaignProvider = new Map(
            spend.campaigns.map((c) => [c.campaign_id, c.provider]),
        );
        payload.byChannel = channelSplit(payload.rows, funnel, campaignProvider);
        payload.byPractice = practiceSplit(spend.spendByPractice, funnel, campaignProvider);
```

Leave the `series`, `coverage`, cache read and cache write lines unchanged.

- [ ] **Step 4: Run the whole marketing suite**

Run: `cd backend && npx vitest run test/marketing.service.test.mjs test/marketing.repository.test.mjs test/marketing.routes.test.mjs test/marketing-roi.test.mjs`
Expected: PASS. If a `marketing.routes` case asserts on the payload shape, update it to the new fields rather than reverting the service.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/marketing.service.js backend/test/marketing.service.test.mjs
git commit -m "feat(marketing): serve the campaigns payload from one aggregate call"
```

---

### Task 7: Service and controller — campaign filter and booking fields on the leads list

**Files:**
- Modify: `backend/src/services/marketing.service.js`
- Modify: `backend/src/controllers/marketing.controller.js`
- Test: `backend/test/marketing.service.test.mjs`
- Test: `backend/test/marketing.routes.test.mjs`

**Interfaces:**
- Consumes: `marketingRepository.leadsByCampaign` with `booked_at` / `attended` (Task 3).
- Produces: `marketingService.leadList(orgId, { since, until, practiceId, channel, converted, campaignId, page, size })`; each returned row gains `bookedAt: string|null`, `attended: boolean`, `stage: 'enquired'|'booked'|'attended'|'new_patient'`.

`stage` is computed once, server-side, so the table and any future export can never disagree about where a person stopped. Precedence, highest first: `new_patient` → `attended` → `booked` → `enquired`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/marketing.service.test.mjs`:

```javascript
describe('leadList', () => {
    const people = [
        { contact_id: 'a', ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: 'p1',
          converted: true, is_new_patient: true, matched_by: 'email',
          first_lead_at: '2026-07-01T10:00:00Z', booked_at: '2026-07-04T09:00:00Z', attended: true },
        { contact_id: 'b', ad_campaign_id: 'm1', attribution_source: 'Paid Social', practice_id: 'p1',
          converted: false, is_new_patient: false, matched_by: null,
          first_lead_at: '2026-07-02T10:00:00Z', booked_at: '2026-07-06T09:00:00Z', attended: false },
        { contact_id: 'c', ad_campaign_id: 'g1', attribution_source: 'Paid Search', practice_id: 'p1',
          converted: false, is_new_patient: false, matched_by: null,
          first_lead_at: '2026-07-03T10:00:00Z', booked_at: null, attended: false },
    ];

    // leadRows is a PARAMETER, not a pre-set mock. vi.spyOn on an
    // already-spied method returns the SAME spy, so a test that mocked
    // leadsByCampaign before calling run() would have its rows silently
    // overwritten here by the default fixture — the test would then pass
    // under any implementation at all.
    async function run(opts, leadRows = people) {
        const repo = await import('../src/repositories/marketing.repository.js');
        vi.spyOn(repo.marketingRepository, 'leadsByCampaign').mockResolvedValue(leadRows);
        vi.spyOn(repo.marketingRepository, 'campaignSpend').mockResolvedValue({
            campaigns: [{ provider: 'meta_ads', campaign_id: 'm1', campaign_name: 'Implants', spend_pence: 1, impressions: 0, clicks: 0, conversions: 0 },
                        { provider: 'google_ads', campaign_id: 'g1', campaign_name: 'New Patient', spend_pence: 1, impressions: 0, clicks: 0, conversions: 0 }],
            series: [], unmappedSpendPence: 0, spendByPractice: [],
        });
        vi.spyOn(repo.marketingRepository, 'contactsByIds').mockResolvedValue([
            { id: 'a', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com', phone: '07700900001' },
            { id: 'b', first_name: 'Bea', last_name: 'Webb', email: 'bea@example.com', phone: '07700900002' },
            { id: 'c', first_name: 'Cai', last_name: 'Jones', email: 'cai@example.com', phone: '07700900003' },
        ]);
        const { marketingService } = await import('../src/services/marketing.service.js');
        return marketingService.leadList('org-1', { since: SINCE, until: UNTIL, ...opts });
    }

    it('filters to one campaign', async () => {
        const out = await run({ campaignId: 'm1' });
        expect(out.total).toBe(2);
        expect(out.rows.every((r) => r.campaignId === 'm1')).toBe(true);
    });

    it('reports the stage each person reached', async () => {
        const out = await run({});
        const stage = Object.fromEntries(out.rows.map((r) => [r.contactId, r.stage]));
        expect(stage.a).toBe('new_patient');
        expect(stage.b).toBe('booked');
        expect(stage.c).toBe('enquired');
    });

    it('carries bookedAt and attended per person', async () => {
        const out = await run({ campaignId: 'm1' });
        const b = out.rows.find((r) => r.contactId === 'b');
        expect(b.bookedAt).toBe('2026-07-06T09:00:00Z');
        // false here means UNKNOWN, not "did not attend" — GoHighLevel has
        // recorded two no-shows in its entire history.
        expect(b.attended).toBe(false);
    });

    it('an attended person who is not new reads as attended, not new_patient', async () => {
        const out = await run({}, [{ ...people[0], contact_id: 'd', is_new_patient: false }]);
        expect(out.rows.find((r) => r.contactId === 'd').stage).toBe('attended');
    });
});
```

Append to `backend/test/marketing.routes.test.mjs`. That file has **no supertest harness** — it imports modules and asserts declaratively — so this tests the schema directly rather than an HTTP round trip:

```javascript
describe('leads query validation', () => {
    it('accepts campaignId as a free-text platform id, not a uuid', async () => {
        // ad_campaign_id is Google's or Meta's OWN id: '120249721894530517' is
        // a real one. Validating it as a uuid would reject every live campaign
        // and the filter would silently never match.
        const { LeadListQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = LeadListQuerySchema.parse({
            since: '2026-07-31T23:00:00.000Z',
            until: '2026-08-31T23:00:00.000Z',
            scope: 'all',
            campaignId: '120249721894530517',
        });
        expect(parsed.campaignId).toBe('120249721894530517');
    });

    it('rejects an over-long campaignId', async () => {
        const { LeadListQuerySchema } = await import('../src/controllers/marketing.controller.js');
        expect(() => LeadListQuerySchema.parse({
            since: '2026-07-31T23:00:00.000Z',
            until: '2026-08-31T23:00:00.000Z',
            campaignId: 'x'.repeat(129),
        })).toThrow();
    });

    it('leaves campaignId optional — the unfiltered list still validates', async () => {
        const { LeadListQuerySchema } = await import('../src/controllers/marketing.controller.js');
        const parsed = LeadListQuerySchema.parse({
            since: '2026-07-31T23:00:00.000Z',
            until: '2026-08-31T23:00:00.000Z',
        });
        expect(parsed.campaignId).toBeUndefined();
    });
});
```

This requires the schema to be exported. In `backend/src/controllers/marketing.controller.js`, change `const LeadListQuerySchema = …` to `export const LeadListQuerySchema = …`. It is exported for the test and for nothing else; do not import it anywhere but the test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run test/marketing.service.test.mjs -t leadList`
Expected: FAIL — `stage`, `bookedAt` and `attended` are absent from the rows, and `campaignId` is not filtered.

- [ ] **Step 3: Implement**

In `backend/src/services/marketing.service.js`, add the stage helper immediately above `marketingService`:

```javascript
// Where a person stopped. Computed once, server-side, so the leads table and
// anything else that reports the funnel can never disagree about a person.
//
// attended is Dentally-only: false means UNKNOWN for someone whose only booking
// is a GoHighLevel one, so a person never falls BELOW 'booked' on its account.
function leadStage(lead) {
    if (lead.is_new_patient) return 'new_patient';
    if (lead.attended) return 'attended';
    if (lead.booked_at) return 'booked';
    return 'enquired';
}
```

In `leadList`, extend the row mapping and add the filter. Replace the `rows = leads.map(...)` block and the filters that follow it:

```javascript
        let rows = leads.map((l) => ({
            contactId: l.contact_id,
            practiceId: l.practice_id,
            channel: resolveLeadChannel(l, campaignProvider),
            campaignId: l.ad_campaign_id,
            campaignName: l.ad_campaign_id ? campaignName.get(l.ad_campaign_id) ?? null : null,
            attributionSource: l.attribution_source,
            enquiredAt: l.first_lead_at,
            bookedAt: l.booked_at,
            attended: l.attended,
            stage: leadStage(l),
            converted: l.converted,
            isNewPatient: l.is_new_patient,
            matchedBy: l.matched_by,
        }));
        if (campaignId) rows = rows.filter((r) => r.campaignId === campaignId);
        if (channel) rows = rows.filter((r) => r.channel === channel);
        if (converted === true) rows = rows.filter((r) => r.converted);
        if (converted === false) rows = rows.filter((r) => !r.converted);
```

and add `campaignId = null,` to the destructured options of `leadList`.

Export the helper for the tests by adding it to the `__test` block:

```javascript
export const __test = {
    joinSpendToLeads, perUnitPence, cacheKey, channelSplit, buildCoverage, resolveLeadChannel,
    practiceSplit, leadStage,
};
```

In `backend/src/controllers/marketing.controller.js`, extend the schema:

```javascript
const LeadListQuerySchema = PerformanceQuerySchema.extend({
    channel: z.enum(CHANNELS).optional(),
    // Sent as a string on the query string; 'any' means no filter.
    converted: z.enum(['true', 'false', 'any']).optional(),
    // The ad platform's OWN campaign id (e.g. '120249721894530517'), not a
    // uuid. Bounded in length so the filter cannot be used to send a payload.
    campaignId: z.string().min(1).max(128).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    size: z.coerce.number().int().min(1).max(200).optional(),
});
```

and pass it through in `getLeads`:

```javascript
            campaignId: q.campaignId ?? null,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/marketing.service.test.mjs test/marketing.routes.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/marketing.service.js backend/src/controllers/marketing.controller.js backend/test/marketing.service.test.mjs backend/test/marketing.routes.test.mjs
git commit -m "feat(marketing): filter the leads list by campaign and report each stage"
```

---

### Task 8: Backend — cross-org isolation test

**Files:**
- Test: `backend/test/marketing.isolation.test.mjs` (create)

**Interfaces:**
- Consumes: `marketingRepository` (Task 3).
- Produces: nothing consumed by later tasks.

This task exists on its own because the booking probes added three new joins, and every one of them is a place an `organisation_id` predicate can be forgotten. Measured on live data, dropping the org filter from the matcher moved `booked` from 236 to 240 — a silent cross-tenant read of patient data.

- [ ] **Step 1: Write the failing test**

Create `backend/test/marketing.isolation.test.mjs`:

```javascript
// serviceClient bypasses RLS (rule 3): isolation here is the explicit
// organisation_id argument on every call, and nothing else. These tests pin
// that the org reaches the database on every marketing read path.
//
// The booking stage added three new joins to ad_lead_conversions, and every
// join is a place an organisation_id predicate can be forgotten. Measured on
// live data, dropping it from the matcher moved `booked` from 236 to 240 — a
// silent cross-tenant read of patient records.
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { marketingRepository } from '../src/repositories/marketing.repository.js';

const SINCE = '2026-05-31T23:00:00.000Z';
const UNTIL = '2026-08-31T23:00:00.000Z';

beforeEach(() => {
    supaRec.rpcCalls = [];
    // One empty page ends the repository's paging loop immediately.
    supaRec.rpcProvider = () => ({ data: [], error: null });
});

describe('marketing reads are org-scoped', () => {
    it('sends p_org on the funnel aggregate', async () => {
        await marketingRepository.campaignFunnel('org-A', SINCE, UNTIL, null);
        expect(supaRec.rpcCalls[0]).toMatchObject({
            fn: 'ad_campaign_funnel', params: { p_org: 'org-A' },
        });
    });

    it('sends p_org on the per-person function', async () => {
        await marketingRepository.leadsByCampaign('org-B', SINCE, UNTIL, null);
        expect(supaRec.rpcCalls[0]).toMatchObject({
            fn: 'ad_lead_conversions', params: { p_org: 'org-B' },
        });
    });

    it('never calls a marketing RPC without an org', async () => {
        await marketingRepository.campaignFunnel('org-C', SINCE, UNTIL, 'prac-1');
        await marketingRepository.leadsByCampaign('org-C', SINCE, UNTIL, 'prac-1');
        expect(supaRec.rpcCalls.length).toBeGreaterThan(0);
        for (const call of supaRec.rpcCalls) {
            expect(call.params.p_org).toBeTruthy();
        }
    });

    it('one org cannot ask for another org rows by passing a practice', async () => {
        // p_practice narrows WITHIN an org; it must never widen across orgs.
        await marketingRepository.campaignFunnel('org-D', SINCE, UNTIL, 'prac-belonging-elsewhere');
        expect(supaRec.rpcCalls[0].params.p_org).toBe('org-D');
    });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/marketing.isolation.test.mjs`
Expected: PASS. This test pins behaviour built in Task 3 rather than driving new code — if it fails, Task 3 is wrong and must be fixed before continuing.

- [ ] **Step 3: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, no regressions. Record the total count in the commit message.

- [ ] **Step 4: Commit**

```bash
git add backend/test/marketing.isolation.test.mjs
git commit -m "test(marketing): pin org scoping on both funnel read paths"
```

---

### Task 9: Frontend — types, hook parameter, and the shared leads table

**Files:**
- Modify: `frontend/features/marketing/api.ts`
- Modify: `frontend/features/marketing/hooks.ts`
- Create: `frontend/features/marketing/components/MarketingLeadsTable.tsx`
- Modify: `frontend/features/marketing/components/LeadsScreen.tsx`

**Interfaces:**
- Consumes: the backend payload from Tasks 6–7.
- Produces:
  - `CampaignRow` gains `booked: number`, `attended: number`, `costPerBookingPence: number|null`, `costPerNewPatientPence: number|null`.
  - `MarketingTotals` gains `booked`, `attended`, `attributedBooked`, `attributedNewPatients`, `costPerBookingPence`, `costPerNewPatientPence`.
  - `ChannelRow` gains `booked`, `attended`, `costPerBookingPence`. `PracticeRow` gains `booked`, `costPerBookingPence`.
  - `MarketingLead` gains `bookedAt: string|null`, `attended: boolean`, `stage: LeadStage`.
  - `export type LeadStage = 'enquired' | 'booked' | 'attended' | 'new_patient'`.
  - `export const STAGE_LABEL: Record<LeadStage, string>`.
  - `useMarketingLeads(opts)` gains `campaignId?: string | null`.
  - `<MarketingLeadsTable rows={MarketingLead[]} />`.

- [ ] **Step 1: Extend the types**

In `frontend/features/marketing/api.ts`, add the new fields to the existing interfaces:

```typescript
export interface CampaignRow {
  provider: 'google_ads' | 'meta_ads';
  campaignId: string;
  campaignName: string | null;
  spendPence: number;
  impressions: number;
  clicks: number;
  platformConversions: number;
  leads: number;
  /** Held a GoHighLevel calendar slot or a Dentally appointment after enquiring. */
  booked: number;
  /** Dentally-only: a completed appointment. Never derived from GoHighLevel. */
  attended: number;
  patients: number;
  newPatients: number;
  costPerLeadPence: number | null;
  costPerBookingPence: number | null;
  costPerPatientPence: number | null;
  costPerNewPatientPence: number | null;
  tier: Tier;
}
```

Add to `MarketingTotals`: `booked: number; attended: number; attributedBooked: number; attributedNewPatients: number; costPerBookingPence: number | null; costPerNewPatientPence: number | null;`

Add to `ChannelRow`: `booked: number; attended: number; costPerBookingPence: number | null;`

Add to `PracticeRow`: `booked: number; costPerBookingPence: number | null;`

Add to `MarketingLead`: `bookedAt: string | null; attended: boolean; stage: LeadStage;`

Add the stage type and labels, and update `EMPTY_PERFORMANCE.totals`:

```typescript
export type LeadStage = 'enquired' | 'booked' | 'attended' | 'new_patient';

/**
 * How far a person got. Attendance comes from Dentally only — GoHighLevel has
 * recorded two no-shows in its entire history — so a person who booked through
 * GoHighLevel alone stays at "Booked" rather than being reported as a no-show.
 */
export const STAGE_LABEL: Record<LeadStage, string> = {
  enquired: 'Enquired',
  booked: 'Booked',
  attended: 'Attended',
  new_patient: 'New patient',
};
```

```typescript
  totals: {
    spendPence: 0, impressions: 0, clicks: 0, platformConversions: 0,
    leads: 0, attributedLeads: 0, booked: 0, attended: 0, attributedBooked: 0,
    patients: 0, attributedPatients: 0, newPatients: 0, attributedNewPatients: 0,
    unattributedLeads: 0,
    costPerLeadPence: null, costPerBookingPence: null,
    costPerPatientPence: null, costPerNewPatientPence: null,
  },
```

- [ ] **Step 2: Add the campaign filter to the hook**

In `frontend/features/marketing/hooks.ts`, replace `useMarketingLeads`:

```typescript
export function useMarketingLeads(opts: {
  page: number; size: number; channel: string | null;
  converted: 'true' | 'false' | 'any'; campaignId?: string | null;
}) {
  const { scope, win } = useScopePeriod();
  const params = new URLSearchParams(windowParams(scope, win));
  params.set('page', String(opts.page));
  params.set('size', String(opts.size));
  if (opts.channel) params.set('channel', opts.channel);
  if (opts.converted !== 'any') params.set('converted', opts.converted);
  if (opts.campaignId) params.set('campaignId', opts.campaignId);
  const qs = params.toString();

  return useQuery<MarketingLeadPage>({
    // campaignId is part of the key: without it the detail page for one
    // campaign would serve another campaign's cached page.
    queryKey: ['marketing', 'leads', scopeKey({ scope, win }), opts.page, opts.size,
               opts.channel, opts.converted, opts.campaignId ?? null],
    queryFn: () => fetchMarketingLeads(qs),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
```

- [ ] **Step 3: Extract the shared table**

Create `frontend/features/marketing/components/MarketingLeadsTable.tsx`. Move the `<table>` markup out of `LeadsScreen.tsx` verbatim, add the Stage column, and keep the existing column set and styling:

```tsx
'use client';
// The one table for marketing leads, shared by the leads screen and the
// campaign detail page so the two can never show the same person differently.
//
// NOT features/cockpit/components/LeadsTable: that is typed to CockpitLeadLine
// (pipeline name, treatment-accepted value) and bending a marketing row into it
// would cost the Stage column, which is the point of the campaign drill-down.
import { StatusBadge } from '@/components/ui';
import { CHANNEL_LABEL, STAGE_LABEL, type MarketingLead } from '../api';

const dt = (iso: string | null) =>
  (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export function MarketingLeadsTable({ rows }: { rows: MarketingLead[] }) {
  return (
    <div className="overflow-x-auto rounded-panel border border-border bg-surface">
      <table className="w-full min-w-[880px] text-[13.5px]">
        <thead className="bg-bg">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Name</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Contact</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Channel</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Campaign</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Enquired</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Booked</th>
            <th className="px-4 py-3 text-left font-medium text-ink-muted">Stage reached</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.contactId} className="border-t border-border">
              <td className="px-4 py-3">{r.name ?? '—'}</td>
              <td className="px-4 py-3 text-ink-muted">
                <div>{r.email ?? '—'}</div>
                <div>{r.phone ?? ''}</div>
              </td>
              <td className="px-4 py-3">{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
              <td className="px-4 py-3">{r.campaignName ?? r.campaignId ?? '—'}</td>
              <td className="px-4 py-3">{dt(r.enquiredAt)}</td>
              <td className="px-4 py-3">{dt(r.bookedAt)}</td>
              <td className="px-4 py-3">
                <StatusBadge>{STAGE_LABEL[r.stage]}</StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

If `StatusBadge` does not accept plain children in `frontend/components/ui`, read its props first and pass what it expects rather than changing the component.

- [ ] **Step 4: Use it in `LeadsScreen`**

In `frontend/features/marketing/components/LeadsScreen.tsx`, delete the inline `<table>` and render `<MarketingLeadsTable rows={data?.rows ?? []} />` in its place. Leave the filters, paging controls, empty and loading states exactly as they are — this step must not change what the screen does, only where the table lives.

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both clean. Typecheck is the real gate here — it fails on any interface field you added to `api.ts` but did not supply in `EMPTY_PERFORMANCE`.

- [ ] **Step 6: Commit**

```bash
git add frontend/features/marketing/api.ts frontend/features/marketing/hooks.ts frontend/features/marketing/components/MarketingLeadsTable.tsx frontend/features/marketing/components/LeadsScreen.tsx
git commit -m "feat(marketing): share one leads table and carry the funnel stage"
```

---

### Task 10: Frontend — booking columns and row links on the campaigns table

**Files:**
- Modify: `frontend/features/marketing/components/CampaignsScreen.tsx`

**Interfaces:**
- Consumes: `CampaignRow` (Task 9).
- Produces: each campaign row links to `/marketing-campaigns/${encodeURIComponent(campaignId)}`.

- [ ] **Step 1: Add the columns**

In `frontend/features/marketing/components/CampaignsScreen.tsx`, add three header cells after the existing Leads column — **Booked**, **Attended**, **CPB** — and the matching body cells. Reuse the file's existing `money` helper so a null renders `—`:

```tsx
              <td className="px-4 py-3 text-right">{r.booked.toLocaleString('en-GB')}</td>
              <td className="px-4 py-3 text-right">{r.attended.toLocaleString('en-GB')}</td>
              <td className="px-4 py-3 text-right">{money(r.costPerBookingPence)}</td>
```

Keep the existing column order and alignment conventions in the file; numeric columns are right-aligned.

- [ ] **Step 2: Make the campaign name a link**

Wrap the campaign-name cell contents:

```tsx
              <td className="px-4 py-3">
                <Link
                  href={`/marketing-campaigns/${encodeURIComponent(r.campaignId)}`}
                  className="text-brand hover:underline"
                >
                  {r.campaignName ?? r.campaignId}
                </Link>
              </td>
```

Add `import Link from 'next/link';` at the top. `encodeURIComponent` matters: campaign ids are platform-supplied strings, not values we control.

- [ ] **Step 3: Add a subtitle explaining attendance**

Change the `PageHeader` subtitle so the Attended column is not read as a no-show rate:

```tsx
        subtitle="Every campaign with spend in this window, ordered by spend. Attendance is recorded in Dentally only."
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/marketing/components/CampaignsScreen.tsx
git commit -m "feat(marketing): show bookings and cost per booking per campaign"
```

---

### Task 11: Frontend — the campaign detail page

**Files:**
- Create: `frontend/app/(dashboard)/marketing-campaigns/[campaignId]/page.tsx`
- Create: `frontend/features/marketing/components/CampaignDetailScreen.tsx`

**Interfaces:**
- Consumes: `useMarketingPerformance`, `useMarketingLeads` (Task 9), `MarketingLeadsTable` (Task 9).
- Produces: the route `/marketing-campaigns/[campaignId]`.

- [ ] **Step 1: Create the route**

Create `frontend/app/(dashboard)/marketing-campaigns/[campaignId]/page.tsx`:

```tsx
export { default } from '@/features/marketing/components/CampaignDetailScreen';
```

This matches the one-line re-export every other page in `(dashboard)` uses.

- [ ] **Step 2: Create the screen**

Create `frontend/features/marketing/components/CampaignDetailScreen.tsx`:

```tsx
'use client';
// One campaign, end to end: what it cost, how far the people it produced got,
// and who they were.
//
// No new endpoint. The header and funnel come from the campaigns payload the
// table already fetched and cached, and the people come from the leads endpoint
// with a campaign filter. Two calls the app was already making.
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader, EmptyState, SkeletonTable } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useMarketingPerformance, useMarketingLeads } from '../hooks';
import { MarketingLeadsTable } from './MarketingLeadsTable';
import { CHANNEL_LABEL } from '../api';

const SIZE = 50;
const money = (p: number | null) => (p === null ? '—' : formatPence(p));
const count = (n: number) => n.toLocaleString('en-GB');

// A stage and the cost of reaching it. The cost is null, never zero, when
// nobody reached this stage — £0.00 would read as "free".
function Stage({ label, value, cost, costLabel, note }: {
  label: string; value: string; cost?: string; costLabel?: string; note?: string;
}) {
  return (
    <div className="flex-1 rounded-panel border border-border bg-surface px-4 py-3">
      <div className="text-[12px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-[22px] font-semibold text-ink">{value}</div>
      {cost ? (
        <div className="mt-1 text-[12.5px] text-ink-muted">{costLabel} {cost}</div>
      ) : null}
      {note ? <div className="mt-1 text-[12px] text-ink-muted">{note}</div> : null}
    </div>
  );
}

export default function CampaignDetailScreen() {
  const params = useParams<{ campaignId: string }>();
  const campaignId = decodeURIComponent(String(params?.campaignId ?? ''));
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error } = useMarketingPerformance();
  const campaign = (data?.rows ?? []).find((r) => r.campaignId === campaignId) ?? null;
  const leads = useMarketingLeads({ page, size: SIZE, channel: null, converted: 'any', campaignId });

  const pages = Math.max(1, Math.ceil((leads.data?.total ?? 0) / SIZE));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={campaign?.campaignName ?? campaignId}
        subtitle={campaign
          ? `${CHANNEL_LABEL[campaign.provider] ?? campaign.provider} campaign. Attendance is recorded in Dentally only.`
          : 'Campaign'}
      />
      <div>
        <Link href="/marketing-campaigns" className="text-[13px] text-brand hover:underline">
          Back to campaigns
        </Link>
      </div>
      <ScopePeriodBar />

      {isError ? (
        <EmptyState message={`Couldn't load this campaign: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : !campaign ? (
        <EmptyState message="This campaign had no spend in the selected window. Widen the period or choose another campaign." />
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Stage label="Spend" value={money(campaign.spendPence)} />
          <Stage
            label="Leads" value={count(campaign.leads)}
            costLabel="Cost per lead" cost={money(campaign.costPerLeadPence)}
          />
          <Stage
            label="Booked" value={count(campaign.booked)}
            costLabel="Cost per booking" cost={money(campaign.costPerBookingPence)}
          />
          <Stage
            label="Attended" value={count(campaign.attended)}
            note="Dentally only — a booking made in GoHighLevel has no attendance record."
          />
          <Stage
            label="New patients" value={count(campaign.newPatients)}
            costLabel="Cost per new patient" cost={money(campaign.costPerNewPatientPence)}
          />
        </div>
      )}

      {leads.isLoading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : (leads.data?.rows.length ?? 0) === 0 ? (
        <EmptyState message="No enquiries are attributed to this campaign in this window." />
      ) : (
        <>
          <MarketingLeadsTable rows={leads.data?.rows ?? []} />
          <div className="flex items-center justify-between text-[13px] text-ink-muted">
            <span>{count(leads.data?.total ?? 0)} people</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="py-1.5">Page {page} of {pages}</span>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

Check `frontend/features/marketing/components/LeadsScreen.tsx` for the exact paging control markup already in use and match it rather than introducing a second style.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: succeeds, and the route list includes `/marketing-campaigns/[campaignId]`. Stop any running dev server first — a dev server holding `.next` makes the build fail confusingly.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(dashboard)/marketing-campaigns/[campaignId]/page.tsx" frontend/features/marketing/components/CampaignDetailScreen.tsx
git commit -m "feat(marketing): open a campaign and see who it produced"
```

---

### Task 12: Apply the migrations and verify on hosted

**Files:**
- Modify: `CLAUDE.md` (the "Current state" work log)
- Modify: `docs/API.md` (the `/api/marketing/leads` entry gains `campaignId`)

**Interfaces:**
- Consumes: everything above.
- Produces: a deployed, verified feature.

Do this **after** the branch is reviewed and merged, not before. Applying DDL to hosted from an unmerged branch leaves the database ahead of `main`.

- [ ] **Step 1: Run the full test suite one more time**

Run: `cd backend && npm test` then `cd ../frontend && npm run typecheck && npm run lint && npm run build`
Expected: all pass. Record the backend test count.

- [ ] **Step 2: Scan for secrets**

Run: `ggshield secret scan repo .`
Expected: no findings. Triage any hit rather than assuming it is a false positive.

- [ ] **Step 3: Apply the migrations on hosted**

Apply `20260101000144_ad_lead_conversions_booked.sql` then `20260101000145_ad_campaign_funnel.sql` to project `mkfhpzjbijbachoonytt`, in that order — 145 depends on 144's new columns.

- [ ] **Step 4: Verify the applied functions**

```sql
SELECT count(*) AS leads,
       count(booked_at) AS booked,
       count(*) FILTER (WHERE attended) AS attended
FROM ad_lead_conversions('1a5f888a-0dfe-4802-acf8-6003665089ad',
                         '2026-05-31T23:00:00Z', '2026-08-31T23:00:00Z', NULL);
```

Expected: `leads = 3325` exactly; `booked >= 533` and `attended >= 323` (see Task 1 Step 2 — these two drift upward as syncs land). The numbers must match what Task 1 measured inline, allowing for drift since.

```sql
SELECT sum(leads) AS leads, sum(booked) AS booked, sum(attended) AS attended
FROM ad_campaign_funnel('1a5f888a-0dfe-4802-acf8-6003665089ad',
                        '2026-05-31T23:00:00Z', '2026-08-31T23:00:00Z', NULL);
```

Expected: identical to the row-level totals above, in the SAME query session. This is an equality even though the absolute values drift: both functions read the same data at the same moment, so any difference means the aggregate is not reading through the row-level function.

- [ ] **Step 5: Confirm the grants**

```sql
SELECT p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
WHERE p.proname IN ('ad_lead_conversions', 'ad_campaign_funnel');
```

Expected: `can_execute` is **false** for `anon` and `authenticated`, **true** for `service_role`, on both functions. These are `SECURITY DEFINER` functions taking `p_org` — an end-user role holding EXECUTE would let any authenticated user read any tenant's data by passing another org's id.

- [ ] **Step 6: Reload the PostgREST cache**

```sql
NOTIFY pgrst, 'reload schema';
```

Both migrations end with this, but run it again after applying — the cache going stale after hosted DDL is a recurring gotcha in this project.

- [ ] **Step 7: Check the deployed page**

Open `/marketing-campaigns` on app.elevate.app. Confirm the Booked, Attended and CPB columns render, then click a campaign and confirm the funnel and the people load. If the columns are empty but the page renders, the payload cache was not versioned — check `PAYLOAD_VERSION` is 6.

- [ ] **Step 8: Update the docs**

Add `campaignId` (optional string) to the `GET /api/marketing/leads` entry in `docs/API.md`. Add a "Current state" bullet to `CLAUDE.md` recording: the two migrations and that they are applied on hosted, the booked/attended definitions, that attendance is Dentally-only, and that the campaigns payload now comes from one aggregate call instead of paged person rows.

- [ ] **Step 9: Commit**

```bash
git add docs/API.md CLAUDE.md
git commit -m "docs(marketing): record the booking funnel and its applied migrations"
```

---

## Not in this plan

Named so a reviewer can confirm they were left out on purpose:

- **Ad set and ad grain (part B).** `ad_metrics`'s unique key is campaign-grain and both syncs pull campaign level only. Lands as tiers *inside* the Task 11 detail page.
- **Google keywords and search terms (part C).**
- **Revenue and true ROAS.** Every figure here stops at "became a new patient".
- **Booking in `marketing_monthly_rollup`.** The trend screen keeps its current three measures; adding a fourth to that RPC is a separate change with its own performance question.
