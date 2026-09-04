# Facebook Reporting Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Meta ad-set and ad grain landed by sub-project 1 as a Facebook report — campaign → ad set → ad, with CPL, CPB and CPA at every tier — correct for any tenant, not just the one whose data was available while designing.

**Architecture:** Widen the existing `ad_lead_conversions` RPC with `ad_id` (appended last), add one `ad_meta_funnel` RPC that reads *through* it so "booked" keeps a single definition, and resolve the ad set by joining a lead's `ad_id` to `ad_meta_ads.entity_id` and taking its `parent_id`. A new service joins that funnel to the paged deep-grain rollups. Two page routes with one level of in-place row expansion.

**Tech Stack:** Postgres/Supabase plpgsql RPCs, native-ESM Node backend, vitest, Next.js 14 App Router, React Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-03-facebook-reporting-page-design.md`

## Global Constraints

- **MULTI-TENANT, M1 — the org id comes ONLY from `req.user.organisation_id`.** Never a query parameter, never a body field. Under an agency switch that value already resolves to the target sub-account (validated `parent_organisation_id === agencyOrgId` in `middleware/auth.js`), so reading it there makes every endpoint work per tenant for free. An endpoint accepting an org parameter is a cross-tenant hole and a Critical defect.
- **MULTI-TENANT, M2 — no lead is identified by a CRM's own vocabulary.** `attribution_source = 'Paid Social'` and any equivalent string test is FORBIDDEN anywhere in this feature. A lead is a Meta lead because its campaign id appears in that org's Meta rows — a structural test, not a string one.
- **MULTI-TENANT, M3 — every coverage figure is computed per tenant and displayed, never assumed.** The figures gathered while designing (5,475 leads with a campaign, 4,695 with an ad id, 86% coverage) describe ONE organisation.
- **MULTI-TENANT, M5 — nothing assumes this tenant's volumes.** Paged reads: order on a unique key, `.range()`, stop on an EMPTY page NEVER a short one. PostgREST caps responses at 1000 rows silently and that applies to set-returning RPCs identically.
- **MULTI-TENANT, M6 — gating matches the sibling marketing routes:** `requirePermission('marketing.view')`. Reception never holds that key (project rule 5). The nav entry respects `SECTION_FEATURE.Marketing === 'marketing'`.
- **Costs are `null` on a zero denominator, never `0`.** A cost per nothing is unknowable, not free.
- **Money is integer pence.** Display `£` via `formatPence` from `frontend/lib/format.ts` — do not write a second formatter.
- **RPCs are `LANGUAGE plpgsql` with `RETURN QUERY EXECUTE ... USING`**, `SECURITY DEFINER`, `SET search_path = public`. A `LANGUAGE sql` body with `SECURITY DEFINER` cannot be inlined, is planned with `p_org` UNKNOWN, and measured 10.7s against 608ms on this exact RPC family.
- **Mandatory grant idiom on every RPC:** `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION ... TO service_role;` — a newly created function in `public` IS anon-executable on this project by default (verified against the live database).
- **Attended is Dentally-only** and must be labelled wherever it appears. A GoHighLevel booking cannot say whether someone turned up.
- **No platform-conversions column at ad set or ad level.** Meta's `actions` are not requested at those grains, so the column would be a permanent zero indistinguishable from "converted nobody".
- **Reach is non-additive** — ad-set level only, labelled. It counts unique people.
- **NO DARK MODE** (project rule 1). **British English** in all UI copy (rule 4). **No emojis** (rule 7).
- **Do NOT invent Tailwind classes.** This project has its own tokens (`ink`, `ink-muted`, `border`, `surface`, `bg`, `success`, `danger`, `warning`, `rounded-panel`). Read `frontend/tailwind.config.ts` and two sibling components in `frontend/features/marketing/components/` before writing any markup. A previous plan's invented `slate`/`emerald` classes do not exist here.
- **Native ESM backend:** `import`/`export`, `.js` extensions on relative imports, never `require`/`module.exports`.
- **Strict layering:** `routes/ → controllers/ → services/ → repositories/`. Controllers parse and shape HTTP only.
- **Migration number:** `20260101000149_ad_meta_funnel.sql`. `000148` is applied on hosted.
- **Verification note:** Docker and the `supabase` CLI are NOT installed on this machine. Do not attempt `supabase start` or `supabase db reset`. The controller verifies SQL against the hosted database inside `BEGIN … ROLLBACK`.

---

### Task 1: Migration — widen `ad_lead_conversions`, add `ad_meta_funnel`

**Files:**
- Create: `supabase/migrations/20260101000149_ad_meta_funnel.sql`

**Interfaces:**
- Consumes: `ad_lead_conversions` (migration `000146`), `ad_meta_ads` (migration `000148`).
- Produces:
  - `ad_lead_conversions(p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL)` — unchanged columns PLUS `ad_id text` appended LAST.
  - `ad_meta_funnel(p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL) RETURNS TABLE (campaign_id text, ad_set_id text, ad_id text, practice_id uuid, leads bigint, booked bigint, attended bigint, patients bigint, new_patients bigint)`

- [ ] **Step 1: Read the function you are widening**

Run: `sed -n '1,200p' supabase/migrations/20260101000146_ad_lead_conversions_pipeline.sql`

You are going to reproduce that function with ONE extra column. Do NOT retype it from memory or from this plan — copy its body from that file, so the many subtleties in it (the `DISTINCT ON (c.id) ORDER BY l.created_at` first-touch rule, the email/phone match ladder, the booking CTE) survive byte-for-byte.

The return type changes, so the new migration must `DROP FUNCTION IF EXISTS ad_lead_conversions(uuid, timestamptz, timestamptz, uuid);` before `CREATE FUNCTION`. That is safe and is exactly what `000146` did: `ad_campaign_funnel` calls this function from inside a dynamic `EXECUTE` string, so there is no catalogue dependency to block the drop, and it selects its columns BY NAME so an appended column cannot disturb it.

**The two edits, and only these two:**
1. In the `lead_contacts` CTE's `SELECT DISTINCT ON (c.id)` list, add `c.ad_id`.
2. In the function's final `SELECT`, add the corresponding `lc.ad_id` in LAST position, and add `ad_id text` as the LAST entry of `RETURNS TABLE`.

- [ ] **Step 2: Write the assertion you want the controller to run**

Put this in your report file for the controller to execute against hosted inside `BEGIN … ROLLBACK`:

```sql
-- 1. ad_id is appended LAST, so positional consumers are unaffected.
SELECT a.attname AS col, a.attnum AS position
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN unnest(p.proallargtypes) WITH ORDINALITY AS t(typ, ord) ON true
  JOIN unnest(p.proargnames)    WITH ORDINALITY AS a(attname, ord2) ON a.ord2 = t.ord
 WHERE n.nspname = 'public' AND p.proname = 'ad_lead_conversions'
 ORDER BY a.attnum;
-- Expect: ad_id is the LAST OUT parameter.

-- 2. ad_campaign_funnel still works after the drop/recreate.
SELECT count(*) AS campaign_funnel_rows
  FROM ad_campaign_funnel(
    (SELECT id FROM organisations LIMIT 1),
    now() - interval '90 days', now(), NULL);

-- 3. ad_meta_funnel returns rows and never emits a non-Meta campaign.
--    ad_meta_ads is EMPTY until the first sync, so expect 0 rows here and a
--    clean execution — an error is the failure, not an empty result.
SELECT count(*) AS meta_funnel_rows
  FROM ad_meta_funnel(
    (SELECT id FROM organisations LIMIT 1),
    now() - interval '90 days', now(), NULL);

-- 4. Grants: anon and authenticated must not execute either function.
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('ad_lead_conversions','ad_meta_funnel')
 ORDER BY 1;
-- Expect: anon = false, auth = false, svc = true on both.
```

- [ ] **Step 3: Write the migration**

Header comment first, then the widened `ad_lead_conversions` (body copied per Step 1), then this new RPC verbatim:

```sql
-- ---------------------------------------------------------------------------
-- ad_meta_funnel — the Facebook report's counts, at ad and ad-set grain.
--
-- Reads THROUGH ad_lead_conversions rather than re-deriving anything: booked,
-- attended, converted and is_new_patient keep ONE definition across every
-- grain. A second copy at ad grain would be two definitions of "booked" that
-- can silently disagree.
--
-- MULTI-TENANT (M2): a lead is a Meta lead because its ad_id resolves inside
-- THIS org's ad_meta_ads rows — a structural test. It is deliberately NOT
-- `attribution_source = 'Paid Social'`, which is a GoHighLevel label: another
-- tenant's CRM may label it differently, or not at all, and the report would
-- render nothing while appearing to work.
--
-- AD SET BY ID, NOT NAME: contacts.ad_set_id is null for every row GoHighLevel
-- has ever sent, but ad_meta_ads.parent_id IS the ad set id. Joining a lead's
-- ad_id to ad_meta_ads.entity_id therefore names its ad set exactly, and
-- survives a rename. A lead with no resolvable ad set emits ad_set_id NULL —
-- the "not identified" bucket, which carries leads but never spend.
--
-- LEFT JOIN, not inner: a lead whose ad_id is absent from ad_meta_ads (the ad
-- is older than the 92-day window, or was deleted) must still be counted at
-- campaign grain rather than vanishing from the report.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_meta_funnel(
  p_org      uuid,
  p_since    timestamptz,
  p_until    timestamptz,
  p_practice uuid DEFAULT NULL
) RETURNS TABLE (
  campaign_id text, ad_set_id text, ad_id text, practice_id uuid,
  leads bigint, booked bigint, attended bigint,
  patients bigint, new_patients bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    SELECT f.ad_campaign_id                                   AS campaign_id,
           a.parent_id                                        AS ad_set_id,
           f.ad_id                                            AS ad_id,
           f.practice_id                                      AS practice_id,
           count(*)::bigint                                   AS leads,
           count(f.booked_at)::bigint                         AS booked,
           count(*) FILTER (WHERE f.attended)::bigint         AS attended,
           count(*) FILTER (WHERE f.converted)::bigint        AS patients,
           count(*) FILTER (WHERE f.is_new_patient)::bigint   AS new_patients
      FROM ad_lead_conversions($1, $2, $3, $4::uuid) f
      -- DISTINCT ON collapses the ad's day rows to one, so a lead is counted
      -- once however many days its ad ran.
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, parent_id
          FROM ad_meta_ads
         WHERE organisation_id = $1
         ORDER BY entity_id, metric_date DESC
      ) a ON a.entity_id = f.ad_id
     WHERE f.ad_campaign_id IS NOT NULL
     GROUP BY f.ad_campaign_id, a.parent_id, f.ad_id, f.practice_id
  $q$ USING p_org, p_since, p_until, p_practice;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_meta_funnel(uuid, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_meta_funnel(uuid, timestamptz, timestamptz, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4: Static self-checks (you cannot run SQL here)**

Report the result of each:
- `grep -c "ad_id" supabase/migrations/20260101000149_ad_meta_funnel.sql` — expect at least 4 (the CTE select, the final select, the RETURNS TABLE entry, the funnel join).
- Every dollar-quote tag opened is closed: `$fn$`, `$q$`, and any in the copied body.
- The copied `ad_lead_conversions` body differs from `000146`'s ONLY by the two additions. Prove it: `diff <(sed -n '/CREATE FUNCTION ad_lead_conversions/,/^\$fn\$;/p' supabase/migrations/20260101000146_ad_lead_conversions_pipeline.sql) <(sed -n '/CREATE FUNCTION ad_lead_conversions/,/^\$fn\$;/p' supabase/migrations/20260101000149_ad_meta_funnel.sql)` and paste the diff — it must show only your two additions.
- The file ends with `NOTIFY pgrst, 'reload schema';`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260101000149_ad_meta_funnel.sql
git commit -m "feat(marketing): ad_meta_funnel, and carry ad_id on ad_lead_conversions

Reads through ad_lead_conversions so booked/attended/converted keep one
definition at every grain — a second copy at ad grain would be two
definitions of booked that can disagree.

A lead is a Meta lead because its ad_id resolves inside this org's own
ad_meta_ads rows, not because a CRM labelled it 'Paid Social'. That label
is GoHighLevel's; another tenant may not use it, and the report would have
rendered nothing while appearing to work.

Ad set comes from ad_meta_ads.parent_id via the lead's ad_id, so it is
exact and survives a rename. contacts.ad_set_id is null on every row
GoHighLevel has ever sent."
```

---

### Task 2: Repository — paged `metaFunnel`

**Files:**
- Modify: `backend/src/repositories/marketing.repository.js`
- Test: `backend/test/marketing.repository.test.mjs`

**Interfaces:**
- Consumes: `ad_meta_funnel` from Task 1.
- Produces: `marketingRepository.metaFunnel(orgId, since, until, practiceId = null) -> Promise<Array<{campaign_id, ad_set_id, ad_id, practice_id, leads, booked, attended, patients, new_patients}>>`

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/marketing.repository.test.mjs`. Read the file's existing `campaignSpendByProvider` paging tests FIRST and copy their harness usage — they already solve this exact shape.

```javascript
describe('metaFunnel', () => {
    it('passes org, window and practice through to the RPC', async () => {
        supaRec.rpcCalls = [];
        supaRec.rpcProvider = () => ({ data: [], error: null });
        await marketingRepository.metaFunnel(ORG, '2026-06-01', '2026-08-31', null);
        const call = supaRec.rpcCalls.find((c) => c.fn === 'ad_meta_funnel');
        expect(call.params).toEqual({
            p_org: ORG, p_since: '2026-06-01', p_until: '2026-08-31', p_practice: null,
        });
    });

    // The row total CANNOT discriminate a correct pager from one that stops on
    // a short page — both return every row when the mock slices by range. The
    // READ COUNT can: 1064 rows is 1000 + 64 + a confirming empty read.
    it('reads every page and makes the confirming empty read', async () => {
        const rows = Array.from({ length: 1064 }, (_, i) => ({
            campaign_id: 'CMP', ad_set_id: 'AS1', ad_id: `AD${i}`,
            practice_id: null, leads: 1, booked: 0, attended: 0,
            patients: 0, new_patients: 0,
        }));
        let reads = 0;
        supaRec.rpcProvider = () => { reads += 1; return { data: rows, error: null }; };
        const out = await marketingRepository.metaFunnel(ORG, '2026-06-01', '2026-08-31');
        expect(out).toHaveLength(1064);
        expect(reads).toBe(3);
    });

    it('does not mistake a short-but-nonempty page for the last one', async () => {
        const rows = Array.from({ length: 700 }, (_, i) => ({
            campaign_id: 'CMP', ad_set_id: null, ad_id: `AD${i}`,
            practice_id: null, leads: 1, booked: 0, attended: 0,
            patients: 0, new_patients: 0,
        }));
        let reads = 0;
        supaRec.rpcProvider = () => { reads += 1; return { data: rows, error: null }; };
        const out = await marketingRepository.metaFunnel(ORG, '2026-06-01', '2026-08-31');
        expect(out).toHaveLength(700);
        expect(reads).toBe(2);
    });

    it('surfaces an RPC error rather than returning an empty list', async () => {
        supaRec.rpcProvider = () => ({ data: null, error: { message: 'boom' } });
        await expect(marketingRepository.metaFunnel(ORG, '2026-06-01', '2026-08-31'))
            .rejects.toThrow(/ad_meta_funnel: boom/);
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/marketing.repository.test.mjs -t metaFunnel`
Expected: FAIL — `marketingRepository.metaFunnel is not a function`.

- [ ] **Step 3: Implement**

Add to `marketingRepository`. Model it on the `campaignSpendByProvider` paging loop already in this file.

```javascript
    // The Facebook report's funnel, at (campaign, ad set, ad) grain.
    //
    // PAGED, and it must be: PostgREST caps a response at 1000 rows
    // server-side and reports nothing, and that cap applies to set-returning
    // RPCs exactly as it does to tables. Calling an RPC is not an escape from
    // it. `ad_id` is the unique sort key — a lead resolves to at most one ad.
    async metaFunnel(orgId, since, until, practiceId = null) {
        const PAGE = 1000;
        const rows = [];
        for (let from = 0; ; ) {
            const { data, error } = await supabase_1.serviceClient
                .rpc('ad_meta_funnel', {
                    p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
                })
                .order('ad_id', { ascending: true, nullsFirst: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(`ad_meta_funnel: ${error.message}`);
            const page = data ?? [];
            rows.push(...page);
            // Stop on an EMPTY page, never a short one. The server's cap is its
            // own setting; treating a short page as the last reintroduces the
            // truncation at whatever that cap happens to be.
            if (page.length === 0) break;
            from += page.length;
        }
        return rows;
    },
```

- [ ] **Step 4: Run to verify they pass, then prove the paging test discriminates**

Run: `cd backend && npx vitest run test/marketing.repository.test.mjs`
Expected: PASS.

Then temporarily change `if (page.length === 0) break;` to `if (page.length < PAGE) break;`, re-run, and confirm the two read-count tests FAIL. Revert and confirm they pass. Report both outcomes. Do not commit the temporary change.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/marketing.repository.js backend/test/marketing.repository.test.mjs
git commit -m "feat(marketing): paged metaFunnel read for the Facebook report

Paged because PostgREST's silent 1000-row cap applies to set-returning
RPCs identically — calling an RPC is not an escape from it. Pinned by
read-count assertions, since a row total cannot tell a correct pager from
one that stops on a short page."
```

---

### Task 3: Service — `facebookReportService`

**Files:**
- Create: `backend/src/services/facebook-report.service.js`
- Test: `backend/test/facebook-report.service.test.mjs`

**Interfaces:**
- Consumes: `marketingRepository.metaFunnel` (Task 2); `marketingRepository.campaignSpendByProvider(orgId, since, until, provider)` and `marketingRepository.adAccounts(orgId)` (existing); `adGrainRepository.rollup(orgId, grain, {since, until, practiceId, campaignId, parentId})` (existing, already paged).
- Produces:
  - `facebookReportService.campaigns(orgId, {since, until, practiceId}) -> Promise<{state, coverage, rows, excludedAccounts, totals}>`
  - `facebookReportService.adSets(orgId, campaignId, {since, until, practiceId}) -> Promise<{state, coverage, rows, notIdentified}>`
  - `facebookReportService.ads(orgId, adSetId, {since, until, practiceId, cursor}) -> Promise<{rows, nextCursor}>`
  - `state` is one of `'not_connected' | 'never_synced' | 'no_ad_id_coverage' | 'ok'`
  - each row carries `{ id, name, status, spendPence, impressions, clicks, ctr, cpcPence, leads, booked, attended, patients, newPatients, cplPence, cpbPence, cpaPence }`; ad-set rows additionally carry `reach`.

- [ ] **Step 1: Write the failing tests**

```javascript
// The Facebook report. Its job is to be honest for ANY tenant: the figures
// gathered while designing describe one organisation, and another tenant may
// have zero ad-id coverage or none of Meta connected at all.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/marketing.repository.js', () => ({
    marketingRepository: {
        metaFunnel: vi.fn(),
        campaignSpendByProvider: vi.fn(),
        adAccounts: vi.fn(),
    },
}));
vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { rollup: vi.fn() },
}));

const { facebookReportService } = await import('../src/services/facebook-report.service.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const WIN = { since: '2026-06-01', until: '2026-08-31', practiceId: null };

beforeEach(() => {
    marketingRepository.adAccounts.mockResolvedValue([
        { provider: 'meta_ads', customer_id: 'act1', name: 'Acct', currency: 'GBP', practice_id: null },
    ]);
    marketingRepository.campaignSpendByProvider.mockResolvedValue([
        { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 100000, impressions: 5000, clicks: 250 },
    ]);
    marketingRepository.metaFunnel.mockResolvedValue([
        { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
          leads: 10, booked: 4, attended: 2, patients: 2, new_patients: 1 },
    ]);
    adGrainRepository.rollup.mockResolvedValue([]);
});

describe('multi-tenant states', () => {
    it('reports not_connected when the org has no Meta ad account', async () => {
        marketingRepository.adAccounts.mockResolvedValue([
            { provider: 'google_ads', customer_id: 'C1', currency: 'GBP' },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('not_connected');
        expect(out.rows).toEqual([]);
    });

    it('reports never_synced when Meta is connected but no deep rows exist', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        adGrainRepository.rollup.mockResolvedValue([]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('never_synced');
    });

    // A tenant whose GoHighLevel never sends ad_id must not get a report whose
    // only row explains a problem. Platform metrics, and a stated reason.
    it('reports no_ad_id_coverage when no lead resolves to an ad', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 40, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('no_ad_id_coverage');
        expect(out.coverage).toEqual({ leadsTotal: 40, leadsWithAdSet: 0, pct: 0 });
        expect(out.rows[0].spendPence).toBe(100000);   // platform metrics still shown
    });

    it('reports ok and each tenant its OWN coverage figure', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 30, booked: 0, attended: 0, patients: 0, new_patients: 0 },
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 10, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('ok');
        expect(out.coverage).toEqual({ leadsTotal: 40, leadsWithAdSet: 30, pct: 75 });
    });
});

describe('derived costs', () => {
    it('divides spend by the funnel counts', async () => {
        const out = await facebookReportService.campaigns(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'CMP1');
        expect(row.leads).toBe(10);
        expect(row.cplPence).toBe(10000);   // 100000 / 10
        expect(row.cpbPence).toBe(25000);   // 100000 / 4
        expect(row.cpaPence).toBe(50000);   // 100000 / 2
    });

    // A cost per nothing is unknowable, not free. 0 here would read as
    // "this campaign acquires patients for free".
    it('returns null, not 0, on a zero denominator', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 0, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'CMP1');
        expect(row.cplPence).toBeNull();
        expect(row.cpbPence).toBeNull();
        expect(row.cpaPence).toBeNull();
    });

    it('returns null CTR and CPC when there were no impressions or clicks', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'X', spend_pence: 5000, impressions: 0, clicks: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'CMP1');
        expect(row.ctr).toBeNull();
        expect(row.cpcPence).toBeNull();
    });
});

describe('ad sets', () => {
    it('separates the unidentified bucket from real ad sets', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
        ]);
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 6, booked: 3, attended: 1, patients: 1, new_patients: 1 },
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 4, booked: 1, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.adSets(ORG, 'CMP1', WIN);
        expect(out.rows.map((r) => r.id)).toEqual(['AS1']);
        // Leads we could not place: counted, but never given spend or a cost.
        expect(out.notIdentified).toEqual({ leads: 4, booked: 1, attended: 0, patients: 0, newPatients: 0 });
    });

    it('omits the unidentified bucket entirely when coverage is complete', async () => {
        const out = await facebookReportService.adSets(ORG, 'CMP1', WIN);
        expect(out.notIdentified).toBeNull();
    });
});

describe('tenant isolation', () => {
    it('never reads without an organisation id', async () => {
        await facebookReportService.campaigns(ORG, WIN);
        for (const c of marketingRepository.metaFunnel.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of adGrainRepository.rollup.mock.calls) expect(c[0]).toBe(ORG);
    });

    // M2: a CRM's own labels must never decide what counts as a Meta lead.
    it('contains no attribution_source string test', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync('src/services/facebook-report.service.js', 'utf8');
        expect(src).not.toMatch(/Paid Social/i);
        expect(src).not.toMatch(/attribution_source/);
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/facebook-report.service.test.mjs`
Expected: FAIL — cannot resolve `../src/services/facebook-report.service.js`.

- [ ] **Step 3: Implement**

```javascript
// ============================================================================
// Facebook report — campaign / ad set / ad, with the funnel and the costs.
//
// MULTI-TENANT BY CONSTRUCTION. Two rules do the work:
//
//  1. The org id arrives as an argument, resolved by the caller from
//     req.user.organisation_id. Under an agency switch that is already the
//     sub-account's id, so this service works per tenant with no extra code.
//
//  2. Nothing here tests a CRM's own vocabulary. A lead is a Meta lead
//     because ad_meta_funnel resolved its ad_id inside this org's ad_meta_ads
//     rows. An earlier design keyed off attribution_source = 'Paid Social',
//     which is a GoHighLevel label — a tenant whose CRM labels it differently
//     would have seen an empty report that looked perfectly healthy.
//
// Every coverage figure is computed from THIS org's rows and returned for
// display. None is assumed.
// ============================================================================
import { marketingRepository } from "../repositories/marketing.repository.js";
import { adGrainRepository } from "../repositories/ad-grain.repository.js";

// A cost per nothing is unknowable, not free. Returning 0 would render as
// "this campaign acquires patients at no cost".
function perUnitPence(totalPence, units) {
    const n = Number(units ?? 0);
    return n > 0 ? Math.round(Number(totalPence ?? 0) / n) : null;
}

function ratio(numerator, denominator) {
    const d = Number(denominator ?? 0);
    return d > 0 ? Number(numerator ?? 0) / d : null;
}

function sumFunnel(rows) {
    return rows.reduce((acc, r) => ({
        leads: acc.leads + Number(r.leads ?? 0),
        booked: acc.booked + Number(r.booked ?? 0),
        attended: acc.attended + Number(r.attended ?? 0),
        patients: acc.patients + Number(r.patients ?? 0),
        newPatients: acc.newPatients + Number(r.new_patients ?? 0),
    }), { leads: 0, booked: 0, attended: 0, patients: 0, newPatients: 0 });
}

function withCosts(base, spendPence, impressions, clicks, funnel) {
    return {
        ...base,
        spendPence,
        impressions,
        clicks,
        ctr: ratio(clicks, impressions),
        cpcPence: perUnitPence(spendPence, clicks),
        leads: funnel.leads,
        booked: funnel.booked,
        attended: funnel.attended,
        patients: funnel.patients,
        newPatients: funnel.newPatients,
        cplPence: perUnitPence(spendPence, funnel.leads),
        cpbPence: perUnitPence(spendPence, funnel.booked),
        cpaPence: perUnitPence(spendPence, funnel.patients),
    };
}

// Coverage is this tenant's own figure, never an assumed one.
function coverageOf(funnelRows) {
    const leadsTotal = funnelRows.reduce((n, r) => n + Number(r.leads ?? 0), 0);
    const leadsWithAdSet = funnelRows
        .filter((r) => r.ad_set_id)
        .reduce((n, r) => n + Number(r.leads ?? 0), 0);
    return {
        leadsTotal,
        leadsWithAdSet,
        pct: leadsTotal > 0 ? Math.round((leadsWithAdSet / leadsTotal) * 100) : 0,
    };
}

async function metaAccounts(orgId) {
    const accounts = await marketingRepository.adAccounts(orgId);
    return (accounts ?? []).filter((a) => a.provider === 'meta_ads');
}

export const facebookReportService = {
    async campaigns(orgId, { since, until, practiceId = null } = {}) {
        const accounts = await metaAccounts(orgId);
        if (accounts.length === 0) {
            return { state: 'not_connected', coverage: null, rows: [], excludedAccounts: [], totals: null };
        }

        const [spendRows, funnelRows] = await Promise.all([
            marketingRepository.campaignSpendByProvider(orgId, since, until, 'meta_ads'),
            marketingRepository.metaFunnel(orgId, since, until, practiceId),
        ]);

        if ((spendRows ?? []).length === 0) {
            return { state: 'never_synced', coverage: null, rows: [], excludedAccounts: [], totals: null };
        }

        const coverage = coverageOf(funnelRows ?? []);
        const byCampaign = new Map();
        for (const r of funnelRows ?? []) {
            const list = byCampaign.get(r.campaign_id) ?? [];
            list.push(r);
            byCampaign.set(r.campaign_id, list);
        }

        const rows = (spendRows ?? []).map((s) => withCosts(
            { id: s.campaign_id, name: s.campaign_name ?? null, status: s.campaign_status ?? null },
            Number(s.spend_pence ?? 0), Number(s.impressions ?? 0), Number(s.clicks ?? 0),
            sumFunnel(byCampaign.get(s.campaign_id) ?? []),
        ));

        const totals = withCosts(
            { id: null, name: null, status: null },
            rows.reduce((n, r) => n + r.spendPence, 0),
            rows.reduce((n, r) => n + r.impressions, 0),
            rows.reduce((n, r) => n + r.clicks, 0),
            sumFunnel(funnelRows ?? []),
        );

        // A tenant whose CRM sends no ad ids cannot have an ad-set tier. Say so
        // and show the platform metrics, rather than render one useless row.
        const state = coverage.leadsWithAdSet === 0 ? 'no_ad_id_coverage' : 'ok';
        return { state, coverage, rows, excludedAccounts: [], totals };
    },

    async adSets(orgId, campaignId, { since, until, practiceId = null } = {}) {
        const accounts = await metaAccounts(orgId);
        if (accounts.length === 0) {
            return { state: 'not_connected', coverage: null, rows: [], notIdentified: null };
        }

        const [grainRows, funnelRows] = await Promise.all([
            adGrainRepository.rollup(orgId, 'meta_adset', { since, until, practiceId, campaignId }),
            marketingRepository.metaFunnel(orgId, since, until, practiceId),
        ]);

        const forCampaign = (funnelRows ?? []).filter((r) => r.campaign_id === campaignId);
        const coverage = coverageOf(forCampaign);

        const byAdSet = new Map();
        for (const r of forCampaign) {
            if (!r.ad_set_id) continue;
            const list = byAdSet.get(r.ad_set_id) ?? [];
            list.push(r);
            byAdSet.set(r.ad_set_id, list);
        }

        const rows = (grainRows ?? []).map((g) => ({
            ...withCosts(
                { id: g.entity_id, name: g.entity_name ?? null, status: g.entity_status ?? null },
                Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0),
                sumFunnel(byAdSet.get(g.entity_id) ?? []),
            ),
            // Reach counts unique PEOPLE, so it is never additive. Carried
            // per ad set and never summed into a total.
            reach: g.reach ?? null,
        }));

        // Leads whose ad set we could not determine. They carry no spend, so
        // they carry no cost either — inventing one would be a fiction.
        const orphan = sumFunnel(forCampaign.filter((r) => !r.ad_set_id));
        const notIdentified = orphan.leads > 0 ? orphan : null;

        const state = (grainRows ?? []).length === 0 ? 'never_synced'
            : coverage.leadsWithAdSet === 0 ? 'no_ad_id_coverage' : 'ok';
        return { state, coverage, rows, notIdentified };
    },

    async ads(orgId, adSetId, { since, until, practiceId = null, cursor = null } = {}) {
        const PAGE = 50;
        const [grainRows, funnelRows] = await Promise.all([
            adGrainRepository.rollup(orgId, 'meta_ad', { since, until, practiceId, parentId: adSetId }),
            marketingRepository.metaFunnel(orgId, since, until, practiceId),
        ]);

        const byAd = new Map();
        for (const r of funnelRows ?? []) {
            if (!r.ad_id) continue;
            const list = byAd.get(r.ad_id) ?? [];
            list.push(r);
            byAd.set(r.ad_id, list);
        }

        const all = (grainRows ?? [])
            .slice()
            .sort((a, b) => Number(b.spend_pence ?? 0) - Number(a.spend_pence ?? 0))
            .map((g) => withCosts(
                { id: g.entity_id, name: g.entity_name ?? null, status: g.entity_status ?? null },
                Number(g.spend_pence ?? 0), Number(g.impressions ?? 0), Number(g.clicks ?? 0),
                sumFunnel(byAd.get(g.entity_id) ?? []),
            ));

        // Cursor is an offset into the spend-sorted list. A tenant with many
        // times this org's ad count must not be rendered in one response.
        const start = cursor ? Number(cursor) : 0;
        const page = all.slice(start, start + PAGE);
        const nextCursor = start + PAGE < all.length ? String(start + PAGE) : null;
        return { rows: page, nextCursor };
    },
};

export const __test = { perUnitPence, ratio, coverageOf, sumFunnel };
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && npx vitest run test/facebook-report.service.test.mjs`
Expected: PASS.

Then run the full suite to prove no regression: `cd backend && npm test`. Report the totals.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/facebook-report.service.js backend/test/facebook-report.service.test.mjs
git commit -m "feat(marketing): Facebook report service, multi-tenant by construction

Four explicit states — not_connected, never_synced, no_ad_id_coverage, ok —
because most tenants sit in one of them rather than the happy path, and a
generic empty table is a bug in a multi-tenant product.

Coverage is computed from each org's own rows and returned for display. A
tenant whose CRM sends no ad ids gets platform metrics and a stated reason
rather than a report whose only row explains a problem.

Costs are null on a zero denominator: 0 would render as acquiring patients
for free. A test asserts the source contains no attribution_source string
test, since that is a CRM's vocabulary and not every tenant shares it."
```

---

### Task 4: Endpoints

**Files:**
- Modify: `backend/src/controllers/marketing.controller.js`
- Modify: `backend/src/routes/marketing.routes.js`
- Modify: `docs/API.md`
- Test: `backend/test/marketing.routes.test.mjs`

**Interfaces:**
- Consumes: `facebookReportService` (Task 3).
- Produces:
  - `GET /api/marketing/facebook/campaigns`
  - `GET /api/marketing/facebook/campaigns/:campaignId/adsets`
  - `GET /api/marketing/facebook/adsets/:adSetId/ads?cursor=`
  - Exported `export const FacebookQuerySchema` for testability.
  - Controller functions `getFacebookCampaigns`, `getFacebookAdSets`, `getFacebookAds`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/marketing.routes.test.mjs`, mirroring the existing `reconciliation query validation` block.

```javascript
describe('facebook query validation', () => {
    it('accepts an omitted window and lets the server default it', () => {
        const parsed = FacebookQuerySchema.parse({});
        expect(parsed.since).toBeUndefined();
        expect(parsed.until).toBeUndefined();
    });

    it('still rejects a malformed date when one IS supplied', () => {
        expect(() => FacebookQuerySchema.parse({ since: '2026-8-1' })).toThrow();
        expect(() => FacebookQuerySchema.parse({ until: 'not-a-date' })).toThrow();
    });

    it('accepts a well-formed window and an optional cursor', () => {
        const parsed = FacebookQuerySchema.parse({ since: '2026-06-01', until: '2026-08-31', cursor: '50' });
        expect(parsed).toEqual({ since: '2026-06-01', until: '2026-08-31', cursor: '50' });
    });

    // M1: an org id must never be accepted from the request.
    it('has no organisation field', () => {
        const parsed = FacebookQuerySchema.parse({ organisation_id: 'other-org' });
        expect(parsed.organisation_id).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/marketing.routes.test.mjs -t "facebook query"`
Expected: FAIL — `FacebookQuerySchema is not defined`.

- [ ] **Step 3: Implement the controller**

In `backend/src/controllers/marketing.controller.js`. Read how `getReconciliation` defaults its window server-side and copy that exactly — the client must never compute a window on a different clock from the sync.

```javascript
import { facebookReportService } from "../services/facebook-report.service.js";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// since/until are OPTIONAL: when absent the server defaults them from the same
// helpers the sync uses, so both sides of every comparison use one clock.
// There is deliberately no organisation field — the org comes from
// req.user.organisation_id, which under an agency switch is already the
// sub-account's id. Accepting it from the request would be a cross-tenant hole.
export const FacebookQuerySchema = z.object({
    since: z.string().regex(YMD_RE).optional(),
    until: z.string().regex(YMD_RE).optional(),
    cursor: z.string().regex(/^\d{1,9}$/).optional(),
}).strip();

function windowFrom(q) {
    return {
        since: q.since ?? londonDaysAgo(DEEP_WINDOW_DAYS),
        until: q.until ?? londonYmd(),
    };
}

export async function getFacebookCampaigns(req, res, next) {
    try {
        const q = FacebookQuerySchema.parse(req.query);
        const data = await facebookReportService.campaigns(req.user.organisation_id, {
            ...windowFrom(q), practiceId: req.query.practice_id || null,
        });
        res.json(data);
    } catch (err) { next(err); }
}

export async function getFacebookAdSets(req, res, next) {
    try {
        const q = FacebookQuerySchema.parse(req.query);
        const data = await facebookReportService.adSets(
            req.user.organisation_id, req.params.campaignId,
            { ...windowFrom(q), practiceId: req.query.practice_id || null },
        );
        res.json(data);
    } catch (err) { next(err); }
}

export async function getFacebookAds(req, res, next) {
    try {
        const q = FacebookQuerySchema.parse(req.query);
        const data = await facebookReportService.ads(
            req.user.organisation_id, req.params.adSetId,
            { ...windowFrom(q), practiceId: req.query.practice_id || null, cursor: q.cursor ?? null },
        );
        res.json(data);
    } catch (err) { next(err); }
}
```

Reuse the existing `z`, `londonDaysAgo`, `londonYmd` and `DEEP_WINDOW_DAYS` imports already in that file (added by the reconciliation work) rather than adding duplicates. If `practice_id` validation belongs in the schema in this codebase's style, follow whatever `getLeads` does.

- [ ] **Step 4: Wire the routes and document them**

In `backend/src/routes/marketing.routes.js`:

```javascript
router.get('/facebook/campaigns', requirePermission('marketing.view'), getFacebookCampaigns);
router.get('/facebook/campaigns/:campaignId/adsets', requirePermission('marketing.view'), getFacebookAdSets);
router.get('/facebook/adsets/:adSetId/ads', requirePermission('marketing.view'), getFacebookAds);
```

Append to `docs/API.md`:

```markdown
### GET /api/marketing/facebook/campaigns

Facebook report, campaign tier.

**Permission:** `marketing.view`

**Query:** `since`, `until` (YYYY-MM-DD, both optional — the server defaults to
the trailing 92 days in Europe/London, matching the sync's own window),
`practice_id` (optional).

**Response:** `{ state, coverage, rows[], excludedAccounts[], totals }` where
`state` is `not_connected | never_synced | no_ad_id_coverage | ok` and
`coverage` is `{ leadsTotal, leadsWithAdSet, pct }` — this organisation's own
figure, not a global assumption.

Each row: `{ id, name, status, spendPence, impressions, clicks, ctr, cpcPence,
leads, booked, attended, patients, newPatients, cplPence, cpbPence, cpaPence }`.
Costs are `null` when their denominator is zero. `attended` is Dentally-only.

The organisation is taken from the authenticated session and is NOT accepted as
a parameter; under an agency switch it resolves to the sub-account.

### GET /api/marketing/facebook/campaigns/:campaignId/adsets

As above, for one campaign's ad sets. Adds `reach` per row (non-additive —
unique people, never summed) and `notIdentified`, the leads whose ad set could
not be resolved. `notIdentified` is `null` when coverage is complete.

### GET /api/marketing/facebook/adsets/:adSetId/ads

One ad set's ads, spend-sorted, 50 per page. **Query:** `cursor` (optional,
from the previous response). **Response:** `{ rows[], nextCursor }`.
```

- [ ] **Step 5: Run tests and commit**

Run: `cd backend && npx vitest run test/marketing.routes.test.mjs && npm test && npm run lint`
Expected: all PASS; lint 0 errors.

```bash
git add backend/src/controllers/marketing.controller.js backend/src/routes/marketing.routes.js backend/test/marketing.routes.test.mjs docs/API.md
git commit -m "feat(marketing): Facebook report endpoints

The query schema deliberately has NO organisation field — the org comes from
req.user.organisation_id, which under an agency switch is already the
sub-account's id. Accepting it from the request would be a cross-tenant hole,
and a test asserts the field is stripped.

Window defaults server-side from the same helpers the sync uses, so the
client and server can never compute it on different clocks."
```

---

### Task 5: Frontend slice — api, hooks, types

**Files:**
- Create: `frontend/features/marketing/facebook/api.ts`
- Create: `frontend/features/marketing/facebook/hooks.ts`

**Interfaces:**
- Consumes: the three endpoints from Task 4.
- Produces:
  - Types `FacebookState`, `FacebookCoverage`, `FacebookRow`, `FacebookAdSetRow`, `FacebookCampaignsPayload`, `FacebookAdSetsPayload`, `FacebookAdsPage`.
  - `fetchFacebookCampaigns()`, `fetchFacebookAdSets(campaignId)`, `fetchFacebookAds(adSetId, cursor?)`.
  - `useFacebookCampaigns()`, `useFacebookAdSets(campaignId)`, `useFacebookAds(adSetId, enabled)`.

- [ ] **Step 1: Read the conventions you must match**

Run these and follow what you find, rather than inventing:
- `sed -n '1,40p' frontend/features/marketing/api.ts` — note the `api()` helper from `@/lib/api` and the comment about the `/api` prefix.
- `sed -n '1,40p' frontend/features/marketing/hooks.ts` — note `useScopePeriod`, `windowParams`, `scopeKey`.

**The `/api` prefix is a known trap here:** the Next proxy forwards the path verbatim, so omitting it produces a SILENT 404 that renders as an empty state rather than an error.

- [ ] **Step 2: Write the api client**

```typescript
// Facebook report API client. NOTE the /api prefix: the Next proxy forwards
// the path verbatim, so omitting it 404s SILENTLY into an empty state.
//
// No organisation id is ever sent. The backend takes it from the session,
// which under an agency switch is already the sub-account — sending one would
// be a cross-tenant request.
import { api } from '@/lib/api';

export type FacebookState = 'not_connected' | 'never_synced' | 'no_ad_id_coverage' | 'ok';

export interface FacebookCoverage {
  leadsTotal: number;
  leadsWithAdSet: number;
  /** This organisation's own coverage, not a global assumption. */
  pct: number;
}

export interface FacebookRow {
  id: string;
  name: string | null;
  status: string | null;
  spendPence: number;
  impressions: number;
  clicks: number;
  /** null when there were no impressions. */
  ctr: number | null;
  cpcPence: number | null;
  leads: number;
  booked: number;
  /** Dentally-only: a completed appointment. Never derived from GoHighLevel. */
  attended: number;
  patients: number;
  newPatients: number;
  /** null when the denominator is zero. Nothing is not zero. */
  cplPence: number | null;
  cpbPence: number | null;
  cpaPence: number | null;
}

export interface FacebookAdSetRow extends FacebookRow {
  /** Unique people. NEVER additive — do not sum this column. */
  reach: number | null;
}

export interface FacebookFunnelTotals {
  leads: number; booked: number; attended: number; patients: number; newPatients: number;
}

export interface FacebookCampaignsPayload {
  state: FacebookState;
  coverage: FacebookCoverage | null;
  rows: FacebookRow[];
  excludedAccounts: Array<{ customerId: string; name: string | null; reason: string; currency: string | null }>;
  totals: FacebookRow | null;
}

export interface FacebookAdSetsPayload {
  state: FacebookState;
  coverage: FacebookCoverage | null;
  rows: FacebookAdSetRow[];
  /** Leads whose ad set could not be resolved. null when coverage is complete. */
  notIdentified: FacebookFunnelTotals | null;
}

export interface FacebookAdsPage {
  rows: FacebookRow[];
  nextCursor: string | null;
}

export function fetchFacebookCampaigns(practiceId?: string | null) {
  const qs = new URLSearchParams();
  if (practiceId) qs.set('practice_id', practiceId);
  const suffix = qs.toString() ? `?${qs}` : '';
  return api<FacebookCampaignsPayload>(`/api/marketing/facebook/campaigns${suffix}`);
}

export function fetchFacebookAdSets(campaignId: string, practiceId?: string | null) {
  const qs = new URLSearchParams();
  if (practiceId) qs.set('practice_id', practiceId);
  const suffix = qs.toString() ? `?${qs}` : '';
  return api<FacebookAdSetsPayload>(
    `/api/marketing/facebook/campaigns/${encodeURIComponent(campaignId)}/adsets${suffix}`,
  );
}

export function fetchFacebookAds(adSetId: string, cursor?: string | null, practiceId?: string | null) {
  const qs = new URLSearchParams();
  if (cursor) qs.set('cursor', cursor);
  if (practiceId) qs.set('practice_id', practiceId);
  const suffix = qs.toString() ? `?${qs}` : '';
  return api<FacebookAdsPage>(`/api/marketing/facebook/adsets/${encodeURIComponent(adSetId)}/ads${suffix}`);
}
```

- [ ] **Step 3: Write the hooks**

Match the sibling hooks' `staleTime` and key shape. Read `frontend/features/marketing/hooks.ts` and use the same `useScopePeriod`/`scopeKey` helpers so this page cannot disagree with the rest of the dashboard about which practice is selected.

```typescript
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopePeriod, scopeKey } from '@/features/_shared/scope-context';
import {
  fetchFacebookCampaigns, fetchFacebookAdSets, fetchFacebookAds,
  type FacebookCampaignsPayload, type FacebookAdSetsPayload, type FacebookAdsPage,
} from './api';

// The window is NOT sent: the server defaults it from the same helpers the
// sync uses, so the two can never disagree about which days are in range.
// Practice scope IS sent, from the shared scope bar.
function practiceOf(scope: unknown): string | null {
  const s = scope as { practiceId?: string | null } | null;
  return s?.practiceId ?? null;
}

export function useFacebookCampaigns() {
  const { scope, win } = useScopePeriod();
  const practiceId = practiceOf(scope);
  return useQuery<FacebookCampaignsPayload>({
    queryKey: ['marketing', 'facebook', 'campaigns', scopeKey({ scope, win })],
    queryFn: () => fetchFacebookCampaigns(practiceId),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useFacebookAdSets(campaignId: string) {
  const { scope, win } = useScopePeriod();
  const practiceId = practiceOf(scope);
  return useQuery<FacebookAdSetsPayload>({
    queryKey: ['marketing', 'facebook', 'adsets', campaignId, scopeKey({ scope, win })],
    queryFn: () => fetchFacebookAdSets(campaignId, practiceId),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    enabled: Boolean(campaignId),
  });
}

export function useFacebookAds(adSetId: string, enabled: boolean) {
  const { scope, win } = useScopePeriod();
  const practiceId = practiceOf(scope);
  return useQuery<FacebookAdsPage>({
    queryKey: ['marketing', 'facebook', 'ads', adSetId, scopeKey({ scope, win })],
    queryFn: () => fetchFacebookAds(adSetId, null, practiceId),
    staleTime: 5 * 60_000,
    enabled: enabled && Boolean(adSetId),
  });
}
```

If `useScopePeriod`'s `scope` shape differs from `{ practiceId }`, use whatever the sibling hooks actually read and say so in your report.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/marketing/facebook/api.ts frontend/features/marketing/facebook/hooks.ts
git commit -m "feat(marketing): Facebook report API client and hooks

No organisation id is ever sent — the backend takes it from the session,
which under an agency switch is already the sub-account.

The window is not sent either: the server defaults it from the same helpers
the sync uses, so client and server cannot disagree about which days are in
range. Practice scope comes from the shared scope bar so this page cannot
disagree with the rest of the dashboard."
```

---

### Task 6: Campaign tier page and nav entry

**Files:**
- Create: `frontend/features/marketing/facebook/components/FacebookCampaignsScreen.tsx`
- Create: `frontend/features/marketing/facebook/components/FacebookStateNotice.tsx`
- Create: `frontend/app/(dashboard)/marketing-facebook/page.tsx`
- Modify: `frontend/lib/nav.ts`

**Interfaces:**
- Consumes: `useFacebookCampaigns` (Task 5).
- Produces: `<FacebookCampaignsScreen />` default-exported through the page route; `<FacebookStateNotice state coverage />` reused by Task 7.

- [ ] **Step 1: Read the visual conventions — do not invent classes**

Run and follow:
- `cat frontend/tailwind.config.ts` — the real tokens.
- `sed -n '1,80p' frontend/features/marketing/components/CampaignsScreen.tsx` — the table idiom for this exact kind of page.
- `cat frontend/features/marketing/components/CoverageNotice.tsx` — the notice idiom.
- `grep -n "formatPence" frontend/lib/format.ts` — the money formatter to reuse.

A previous plan invented `slate`/`emerald` classes that do not exist in this project and the implementer had to correct them. Use only tokens you have seen in the config.

- [ ] **Step 2: Write the state notice**

One component, four states, each with its own copy. British English, no emojis, no `dark:` variants.

```tsx
'use client';

import type { FacebookState, FacebookCoverage } from '../api';

// Most tenants sit in one of these states rather than the happy path, so each
// gets its own sentence. A generic empty table would leave an owner unable to
// tell "not connected" from "nothing happened".
const COPY: Record<Exclude<FacebookState, 'ok'>, { title: string; body: string }> = {
  not_connected: {
    title: 'Meta Ads is not connected',
    body: 'Connect a Meta ad account on the Integrations page and this report will fill in after the first sync.',
  },
  never_synced: {
    title: 'Waiting for the first sync',
    body: 'Meta Ads is connected but no performance data has arrived yet. The nightly sync pulls the trailing 92 days.',
  },
  no_ad_id_coverage: {
    title: 'Ad set and ad detail is not available for this organisation',
    body: 'None of the leads recorded here carry the Meta ad they came from, so leads cannot be attributed below campaign level. Spend, impressions and clicks are shown in full.',
  },
};

export function FacebookStateNotice({
  state, coverage,
}: { state: FacebookState; coverage: FacebookCoverage | null }) {
  if (state === 'ok') {
    if (!coverage || coverage.leadsTotal === 0) return null;
    // Each organisation's OWN coverage, stated plainly rather than assumed.
    return (
      <p className="text-xs text-ink-muted">
        {coverage.leadsWithAdSet.toLocaleString('en-GB')} of{' '}
        {coverage.leadsTotal.toLocaleString('en-GB')} leads matched to an ad set
        ({coverage.pct}%). The rest are counted at campaign level only.
      </p>
    );
  }

  const copy = COPY[state];
  return (
    <section className="rounded-panel border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">{copy.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{copy.body}</p>
    </section>
  );
}
```

Adjust the class names to whatever the config and siblings actually use.

- [ ] **Step 3: Write the campaign screen**

Requirements the markup must satisfy — express them in this project's idiom rather than copying a foreign one:

- A table of campaigns: name, spend, impressions, clicks, CTR, CPC, leads, booked, attended, patients, CPL, CPB, CPA.
- Money via `formatPence`. A `null` cost renders as an em dash, NEVER `£0.00` and never `NaN`.
- `null` CTR renders as an em dash.
- The `attended` column header carries a note that it is Dentally-only.
- Each campaign name links to `/marketing-facebook/${encodeURIComponent(id)}`.
- `<FacebookStateNotice />` above the table; when `state` is `not_connected` or `never_synced`, render the notice INSTEAD of the table.
- A totals row from `payload.totals`.
- Loading and error states in the sibling screens' idiom.

- [ ] **Step 4: Wire the route and nav**

`frontend/app/(dashboard)/marketing-facebook/page.tsx`:

```tsx
export { default } from '@/features/marketing/facebook/components/FacebookCampaignsScreen';
```

Check how the sibling `marketing-campaigns/page.tsx` does this and match it — if the screen is a named export there, match that instead.

In `frontend/lib/nav.ts`, add to the existing `Marketing` section, after `marketing-campaigns`:

```typescript
    { id: 'marketing-facebook', label: 'Facebook', isNew: true },
```

The section is already gated by `SECTION_FEATURE.Marketing`, so an org with the Marketing module disabled will not see it. Confirm no extra route allowlist needs the id — grep for `marketing-campaigns` across `frontend/lib/` and add the new id anywhere its sibling appears.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: typecheck and lint clean; build compiles. `npm run build` exits 1 on the pre-existing `/(auth)/forgot-password` prerender failure (no Supabase env at build time) — confirm that is the ONLY failing page and say so. If any other page fails, that is a real problem.

```bash
git add frontend/features/marketing/facebook/components frontend/app/\(dashboard\)/marketing-facebook frontend/lib/nav.ts
git commit -m "feat(marketing): Facebook report campaign tier

Four states with distinct copy rather than one generic empty table: most
tenants sit in one of them, and an owner must be able to tell 'not
connected' from 'nothing happened'.

Coverage is shown as each organisation's own figure. A null cost renders as
an em dash, never as GBP 0.00 — a cost per nothing is unknowable, not free."
```

---

### Task 7: Ad set tier with in-place ad expansion

**Files:**
- Create: `frontend/features/marketing/facebook/components/FacebookAdSetsScreen.tsx`
- Create: `frontend/features/marketing/facebook/components/FacebookAdRows.tsx`
- Create: `frontend/app/(dashboard)/marketing-facebook/[campaignId]/page.tsx`

**Interfaces:**
- Consumes: `useFacebookAdSets`, `useFacebookAds` (Task 5); `<FacebookStateNotice />` (Task 6).
- Produces: `<FacebookAdSetsScreen />` reading `campaignId` from the route.

- [ ] **Step 1: Read the expansion idiom already in this codebase**

Run: `grep -n "▸\|▾\|expanded" frontend/features/intelligence/components/PLMarginScreen.tsx | head -20`

That screen already does click-to-expand rows with a disclosure marker and a count badge. Match it rather than inventing a second pattern.

Also read `frontend/features/marketing/components/CampaignDetailScreen.tsx` for how a `[campaignId]` route reads its param in this codebase.

- [ ] **Step 2: Write the ad rows component**

Requirements:
- Takes `adSetId` and `expanded: boolean`; calls `useFacebookAds(adSetId, expanded)` so no request fires until the row is opened.
- Renders each ad indented under its ad set: name, spend, impressions, clicks, CTR, CPC, leads, booked, attended, patients, CPL, CPB, CPA.
- When `nextCursor` is non-null, render a "Show more" control. A tenant with many times this org's ad count must not render everything at once.
- No platform-conversions column — Meta's `actions` are not requested at this grain, so the column would be a permanent zero indistinguishable from "converted nobody".

- [ ] **Step 3: Write the ad sets screen**

Requirements:
- Table of ad sets for the campaign: name, spend, impressions, clicks, CTR, CPC, **reach**, leads, booked, attended, patients, CPL, CPB, CPA.
- The `reach` header is labelled non-additive (unique people) and reach is NOT summed into any total.
- Each row has a disclosure control that expands `<FacebookAdRows />` in place.
- `<FacebookStateNotice />` above the table.
- When `notIdentified` is non-null, render ONE extra row beneath the ad sets: labelled "Ad set not identified", carrying its leads/booked/attended/patients, with spend and every cost column as em dashes. When `notIdentified` is null the row must not exist at all — a tenant with complete coverage should never see a row explaining a problem they do not have.
- A back link to `/marketing-facebook`.
- Breadcrumb or heading naming the campaign.

- [ ] **Step 4: Wire the route**

`frontend/app/(dashboard)/marketing-facebook/[campaignId]/page.tsx` — match exactly how `frontend/app/(dashboard)/marketing-campaigns/[campaignId]/page.tsx` passes its param.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: typecheck and lint clean; build compiles with only the known `/(auth)/forgot-password` failure.

```bash
git add frontend/features/marketing/facebook/components frontend/app/\(dashboard\)/marketing-facebook
git commit -m "feat(marketing): Facebook report ad set tier with in-place ad expansion

Ads load only when a row is opened, and page 50 at a time, so a tenant with
many times this org's ad count does not hang the page.

The 'Ad set not identified' row exists only when it is non-empty: a tenant
with complete coverage should never see a row explaining a problem they do
not have. It carries leads but no spend, so it carries no cost either —
inventing one would be a fiction.

Reach is labelled non-additive and never summed: it counts unique people."
```

---

### Task 8: Gates, hosted apply, state log

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run every gate and report each verbatim**

```
cd backend  && npm test
cd backend  && npm run lint
cd backend  && npm run typecheck
cd frontend && npm run typecheck
cd frontend && npm run lint
cd frontend && npm run build
ggshield secret scan commit-range origin/main..HEAD
```

`npm run build` exits 1 on `/(auth)/forgot-password` only — pre-existing, no Supabase env at build time. Confirm no OTHER page fails.

- [ ] **Step 2: Hand the migration to the controller**

Do NOT apply it. Put the assertion SQL from Task 1 Step 2 in your report; the controller applies `000149` on hosted and runs those checks. Docker and the `supabase` CLI are absent here.

- [ ] **Step 3: Update the state log**

Add ONE bullet to the "Current state (working session)" section of `CLAUDE.md`. Read two neighbouring bullets first and match their density. It must record:
- the two new page routes and the nav entry;
- `ad_lead_conversions` widened with `ad_id` appended last, and `ad_meta_funnel` added by migration `20260101000149_ad_meta_funnel.sql`, with its applied-status stated accurately;
- ad set resolved by id (`ad_id` → `ad_meta_ads.entity_id` → `parent_id`), NOT by name, and that `contacts.ad_set_id` is null on every GoHighLevel row;
- that the name fallback for leads without an ad id is deliberately NOT built, because the claim that `utm_medium` matches ad-set names is unverified until the first sync;
- the four tenant states and that coverage is computed per tenant;
- that no lead is identified by `attribution_source` or any other CRM label, and why;
- no platform-conversions column at ad set or ad grain, reach non-additive, attended Dentally-only, costs null on a zero denominator.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the Facebook Reporting page in the state log"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| M1 — org only from `req.user.organisation_id` | 4 (schema has no org field, tested); 3 (org is an argument) |
| M2 — no CRM vocabulary test | 1 (structural join), 3 (source-scan test) |
| M3 — coverage per tenant, displayed | 3 (`coverageOf`), 6 (`FacebookStateNotice`) |
| M4 — four states with distinct copy | 3 (detection), 6 (copy) |
| M5 — no volume assumptions | 2 (paged funnel), 3 (`ads` cursor), 7 (show more) |
| M6 — gating matches siblings | 4 (`requirePermission`), 6 (nav under gated section) |
| M7 — not-identified row only when non-empty | 3 (`notIdentified` null), 7 (conditional row) |
| Widen `ad_lead_conversions` with `ad_id` last | 1 |
| `ad_meta_funnel` reads through `ad_lead_conversions` | 1 |
| Ad set by id, LEFT JOIN, null bucket | 1, 3 |
| No name fallback | 1 (comment), 8 (state log) |
| Costs null on zero denominator | 3 (tested), 6 + 7 (em dash) |
| No platform conversions at fine grains | 7 (explicit omission) |
| Reach ad-set only, non-additive | 3 (carried, not summed), 7 (labelled) |
| Attended Dentally-only, labelled | 6, 7 |
| Two routes, one expansion level | 6, 7 |
| Endpoints + `docs/API.md` | 4 |
| Migration applied on hosted | 8 (handed to controller) |

**Gap found and closed:** the spec's testing section requires "two orgs' data never mix", and no task asserted it beyond `p_org` presence. Task 3's `tenant isolation` block covers the org-argument path; the schema test in Task 4 covers the request path. Together those are the two ways an org id could enter, so the requirement is met — but note the plan relies on the service being called only from the controller, which Task 4's code makes true.

**Placeholder scan:** no TBD/TODO. Tasks 6 and 7 deliberately specify markup as REQUIREMENTS plus instructions to read the real tokens and sibling components, rather than inventing class names — a previous plan's invented `slate`/`emerald` classes do not exist in this project and had to be corrected during implementation. The behavioural requirements (em dash for null, conditional row, lazy expansion, labelled reach) are all concrete and testable by inspection.

**Type consistency:** `metaFunnel(orgId, since, until, practiceId)` is positional in Task 2 and called positionally in Task 3. `facebookReportService.campaigns/adSets/ads` signatures match their controller call sites in Task 4. `FacebookState`'s four values are identical in Task 3, Task 5's type and Task 6's `COPY` map. `coverage` is `{leadsTotal, leadsWithAdSet, pct}` in Tasks 3, 5 and 6. Row field names (`spendPence`, `cplPence`, `cpbPence`, `cpaPence`, `newPatients`) are identical across Tasks 3, 5, 6 and 7.
