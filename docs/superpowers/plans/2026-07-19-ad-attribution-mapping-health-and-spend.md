# Ad Attribution — Mapping Health, Spend Detail, Richer Lead Rows

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two read-only endpoints (mapping health, spend detail) and five additive fields to the leads row, and fix per-practice spend by joining `ad_metrics.customer_id` to `ad_accounts.practice_id`.

**Architecture:** Follows the existing layering — routes → controller (Zod parse) → service → repository. A single pure helper, `accountPracticeByCustomerId`, owns the customer-id-to-practice join and is used by both the new spend endpoint and the existing `computePerformance`, so the two can never drift.

**Tech Stack:** Node ESM, Express, Supabase (PostgREST via `serviceClient`), Zod, vitest.

## Global Constraints

- **Backend only, read-only.** No writes, no migration, no connector change.
- **Money is integer pence.** `null` means "not known", never zero.
- **Every repository method MUST pin `organisation_id` explicitly.** Repositories use `serviceClient`, which bypasses RLS — the chained `.eq('organisation_id', orgId)` is the only tenant guard (CLAUDE.md rule 3).
- **Any read that can exceed 1000 rows MUST page via `fetchAllPages`.** PostgREST silently caps at `db-max-rows` = 1000.
- **All new routes gated by `requireRole('owner', 'practice_manager')`**, matching the existing ad-attribution routes.
- **Query params are snake_case on the wire, camelCase into the service.**
- **Never sum `reach` or `frequency` across days.** They are not summable. `growth.routes.js:461` does this and is wrong; do not copy it.
- **Backend is native ESM.** `import`/`export`, relative imports carry `.js` extensions. Never `require`/`module.exports`.
- **British English** in any user-facing string.
- Run all commands from `/Users/ruhithpasha/code/work/Dental-os/backend`.

## Test Harness Notes

- Repository tests use `supaRec` from `test/setup.js`. `supaRec.last` records the last query: `{ table, op, eqs:[{col,val}], gtes, lts, order, upsertVals }`. `supaRec.resultProvider = () => ({ data, error })` supplies rows.
- **Paging gotcha:** `fetchAllPages` loops until a page returns fewer than 1000 rows. A `resultProvider` returning a full 1000-row page every call loops forever. Return fewer than 1000 rows, or use a call-counting provider that returns a short page on the second call.
- Service tests mock repositories with `vi.mock` factories that **enumerate every method**. A new repository method not added to that factory is `undefined` at call time, and the failure looks unrelated. Add new methods to the factory in the same step you add them to the repository.

## File Structure

| File | Responsibility |
|---|---|
| Modify `src/services/ad-attribution.service.js` | New exported helper `accountPracticeByCustomerId`; new `getMappingHealth`/`getSpend` service methods; additive fields in `getLeads`; the join wired into `computePerformance`. |
| Modify `src/repositories/ad-attribution.repository.js` | New `emergentBusinesses`, `adSpendDetailed`; one column added to `adSpend`. |
| Modify `src/models/ad-attribution.model.js` | `spendQuerySchema`. |
| Modify `src/controllers/ad-attribution.controller.js` | `mappingHealth`, `spend` handlers. |
| Modify `src/routes/ad-attribution.routes.js` | Two new GET routes, registered before param routes. |
| Modify `test/ad-attribution.isolation.test.mjs` | New repository reads added to the enumeration. |
| Modify `test/ad-attribution.repository.test.mjs` | Select-string and paging assertions for new methods. |
| Modify `test/ad-attribution.service.test.mjs` | Helper, mapping-health, spend, leads and join tests. |
| Modify `docs/API.md` | Both new endpoints. |

---

### Task 1: The `accountPracticeByCustomerId` join helper

**Files:**
- Modify: `src/services/ad-attribution.service.js`
- Test: `test/ad-attribution.service.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function accountPracticeByCustomerId(adAccounts): Map<string, string|null>` — key is `` `${provider}|${customer_id}` ``, value is `practice_id` or null.

Keyed on provider AND customer id because `ad_accounts` is unique on `(organisation_id, provider, customer_id)`; a bare customer id is not guaranteed unique across providers.

- [ ] **Step 1: Write the failing tests**

Append to `test/ad-attribution.service.test.mjs`:

```js
describe('accountPracticeByCustomerId', () => {
  it('keys on provider AND customer id so two providers cannot collide', () => {
    const map = accountPracticeByCustomerId([
      { provider: 'google_ads', customer_id: '123', practice_id: 'p-google' },
      { provider: 'meta_ads', customer_id: '123', practice_id: 'p-meta' },
    ]);
    expect(map.get('google_ads|123')).toBe('p-google');
    expect(map.get('meta_ads|123')).toBe('p-meta');
  });

  it('keeps an unmapped account as null rather than dropping it', () => {
    const map = accountPracticeByCustomerId([
      { provider: 'google_ads', customer_id: '123', practice_id: null },
    ]);
    expect(map.has('google_ads|123')).toBe(true);
    expect(map.get('google_ads|123')).toBeNull();
  });

  it('returns an empty map for no accounts', () => {
    expect(accountPracticeByCustomerId([]).size).toBe(0);
  });

  it('tolerates a null or undefined account list', () => {
    expect(accountPracticeByCustomerId(null).size).toBe(0);
    expect(accountPracticeByCustomerId(undefined).size).toBe(0);
  });
});
```

Add `accountPracticeByCustomerId` to the existing import from `../src/services/ad-attribution.service.js` at the top of the file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ad-attribution.service.test.mjs -t "accountPracticeByCustomerId"`
Expected: FAIL — `accountPracticeByCustomerId is not a function`.

- [ ] **Step 3: Implement**

In `src/services/ad-attribution.service.js`, immediately after the `personKey` export (around line 36), add:

```js
// ad_metrics.practice_id is written as literal null by BOTH ad connectors
// (meta-ads-sync.js, google-ads-sync.js) and nothing backfills it, so a spend
// row cannot say which practice it belongs to on its own. The mapping that IS
// maintained lives on ad_accounts.practice_id, reachable from a spend row via
// customer_id. This map is that join, and it is the ONLY place it is
// expressed — both the spend endpoint and computePerformance use it.
//
// Keyed on provider AND customer_id: ad_accounts is unique on
// (organisation_id, provider, customer_id), so a bare customer id could
// collide across providers.
export function accountPracticeByCustomerId(adAccounts) {
    const map = new Map();
    for (const a of adAccounts ?? []) {
        map.set(`${a.provider}|${a.customer_id}`, a.practice_id ?? null);
    }
    return map;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/ad-attribution.service.test.mjs -t "accountPracticeByCustomerId"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/ad-attribution.service.js test/ad-attribution.service.test.mjs
git commit -m "feat(ads): customer_id -> practice_id join helper"
```

---

### Task 2: `emergentBusinesses` repository read

**Files:**
- Modify: `src/repositories/ad-attribution.repository.js`
- Test: `test/ad-attribution.repository.test.mjs`, `test/ad-attribution.isolation.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `adAttributionRepository.emergentBusinesses(orgId)` → `[{ businessId, businessName, practiceId }]`.

- [ ] **Step 1: Write the failing tests**

Append to `test/ad-attribution.repository.test.mjs`:

```js
describe('emergentBusinesses', () => {
  it('scopes by org and maps to camelCase', async () => {
    supaRec.resultProvider = () => ({
      data: [{ business_id: 'BIZ1', business_name: 'Ashford', practice_id: 'p1' }],
      error: null,
    });
    const rows = await adAttributionRepository.emergentBusinesses(ORG);
    expect(supaRec.last.table).toBe('emergent_practice_map');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(rows).toEqual([{ businessId: 'BIZ1', businessName: 'Ashford', practiceId: 'p1' }]);
  });

  it('keeps an intentionally unmapped business with a null practice', async () => {
    supaRec.resultProvider = () => ({
      data: [{ business_id: 'BIZ2', business_name: null, practice_id: null }],
      error: null,
    });
    const rows = await adAttributionRepository.emergentBusinesses(ORG);
    expect(rows[0]).toEqual({ businessId: 'BIZ2', businessName: null, practiceId: null });
  });
});
```

In `test/ad-attribution.isolation.test.mjs`, add to the `reads` array:

```js
    ['emergentBusinesses', () => adAttributionRepository.emergentBusinesses(ORG_A)],
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ad-attribution.repository.test.mjs -t "emergentBusinesses"`
Expected: FAIL — `adAttributionRepository.emergentBusinesses is not a function`.

- [ ] **Step 3: Implement**

In `src/repositories/ad-attribution.repository.js`, add inside `adAttributionRepository` after `practiceOptions`:

```js
    // Emergent businesses and the practice each is mapped to. Read here rather
    // than through emergent-practice-map.repository.js so this feature's reads
    // stay in one repository; the alternative couples two features'
    // repositories together for a single query.
    //
    // practice_id null is legitimate and means "intentionally unmapped" — it is
    // kept in the result, not filtered out, because the whole point of the
    // mapping-health endpoint is to show what is unmapped.
    async emergentBusinesses(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_practice_map')
            .select('business_id, business_name, practice_id')
            .eq('organisation_id', orgId)
            .order('business_name', { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => ({
            businessId: r.business_id,
            businessName: r.business_name ?? null,
            practiceId: r.practice_id ?? null,
        }));
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/ad-attribution.repository.test.mjs test/ad-attribution.isolation.test.mjs`
Expected: PASS, including the new isolation case.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/ad-attribution.repository.js test/ad-attribution.repository.test.mjs test/ad-attribution.isolation.test.mjs
git commit -m "feat(ads): emergentBusinesses repository read"
```

---

### Task 3: `adSpendDetailed`, and one column added to `adSpend`

**Files:**
- Modify: `src/repositories/ad-attribution.repository.js`
- Test: `test/ad-attribution.repository.test.mjs`, `test/ad-attribution.isolation.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `adAttributionRepository.adSpendDetailed(orgId, since, until)` → raw `ad_metrics` rows carrying `id, provider, customer_id, campaign_id, campaign_name, campaign_status, spend_pence, impressions, clicks, conversions, metric_date`. `adSpend` additionally selects `customer_id`.

`adSpend` gains exactly one column because the join in Task 7 cannot reach `practice_id` without it. It deliberately does NOT gain the campaign or engagement columns — the performance path stays narrow.

- [ ] **Step 1: Write the failing tests**

Append to `test/ad-attribution.repository.test.mjs`:

```js
describe('adSpend selects customer_id', () => {
  it('includes customer_id so spend can be joined to an ad account practice', async () => {
    await adAttributionRepository.adSpend(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.select).toContain('customer_id');
  });
});

describe('adSpendDetailed', () => {
  it('scopes by org and the date window', async () => {
    await adAttributionRepository.adSpendDetailed(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.table).toBe('ad_metrics');
    expect(orgFilter(supaRec.last)).toEqual({ col: 'organisation_id', val: ORG });
    expect(supaRec.last.gtes).toContainEqual({ col: 'metric_date', val: '2026-07-01' });
    expect(supaRec.last.lts).toContainEqual({ col: 'metric_date', val: '2026-08-01' });
  });

  it('selects the campaign and engagement columns adSpend omits', async () => {
    await adAttributionRepository.adSpendDetailed(ORG, '2026-07-01', '2026-08-01');
    for (const col of ['customer_id', 'campaign_id', 'campaign_name', 'campaign_status',
      'impressions', 'clicks', 'conversions']) {
      expect(supaRec.last.select).toContain(col);
    }
  });

  it('does not select reach or frequency — they are not summable across days', async () => {
    await adAttributionRepository.adSpendDetailed(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.select).not.toContain('reach');
    expect(supaRec.last.select).not.toContain('frequency');
  });

  it('orders by id (required for deterministic pagination)', async () => {
    await adAttributionRepository.adSpendDetailed(ORG, '2026-07-01', '2026-08-01');
    expect(supaRec.last.order).toEqual({ col: 'id', opts: { ascending: true } });
  });

  it('pages past the 1000-row PostgREST cap', async () => {
    let call = 0;
    supaRec.resultProvider = () => {
      call += 1;
      // First page full (1000) forces a second request; second page short ends it.
      if (call === 1) return { data: Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` })), error: null };
      return { data: [{ id: 'last' }], error: null };
    };
    const rows = await adAttributionRepository.adSpendDetailed(ORG, '2026-07-01', '2026-08-01');
    expect(call).toBe(2);
    expect(rows).toHaveLength(1001);
  });
});
```

In `test/ad-attribution.isolation.test.mjs`, add to the `reads` array:

```js
    ['adSpendDetailed', () => adAttributionRepository.adSpendDetailed(ORG_A, '2026-07-01', '2026-08-01')],
```

**Note on the `select` assertion:** these tests assume `supaRec.last.select` records the select string, as the existing `adSpend` tests rely on `table`/`eqs`/`order`. If `test/setup.js` does not record `select`, add that recording to the harness in this step — it is a one-line addition to the recorder and other repository tests benefit from it.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ad-attribution.repository.test.mjs -t "adSpendDetailed"`
Expected: FAIL — `adAttributionRepository.adSpendDetailed is not a function`.

- [ ] **Step 3: Implement**

In `src/repositories/ad-attribution.repository.js`, change the `adSpend` select line from:

```js
            .select('id, provider, practice_id, spend_pence, metric_date')
```

to:

```js
            .select('id, provider, practice_id, customer_id, spend_pence, metric_date')
```

Then add a new method after `adSpend`:

```js
    // Spend at its real grain — org x provider x account (customer_id) x
    // CAMPAIGN x day — for the spend drill-down. adSpend deliberately keeps a
    // narrower select because the performance path only needs a total.
    //
    // reach/frequency are NOT selected: they cannot be summed across days (the
    // same person seen on three days is one person, not three). Any
    // window-level reach must come from ad_accounts.period_* instead.
    async adSpendDetailed(orgId, since, until) {
        return fetchAllPages(() => supabase_1.serviceClient
            .from('ad_metrics')
            .select('id, provider, customer_id, campaign_id, campaign_name, campaign_status, spend_pence, impressions, clicks, conversions, metric_date')
            .eq('organisation_id', orgId)
            .gte('metric_date', since)
            .lt('metric_date', until)
            .order('id', { ascending: true }));
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/ad-attribution.repository.test.mjs test/ad-attribution.isolation.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/ad-attribution.repository.js test/ad-attribution.repository.test.mjs test/ad-attribution.isolation.test.mjs test/setup.js
git commit -m "feat(ads): adSpendDetailed at campaign grain, customer_id on adSpend"
```

---

### Task 4: `GET /api/ad-attribution/mapping-health`

**Files:**
- Modify: `src/services/ad-attribution.service.js`, `src/controllers/ad-attribution.controller.js`, `src/routes/ad-attribution.routes.js`, `docs/API.md`
- Test: `test/ad-attribution.service.test.mjs`

**Interfaces:**
- Consumes: `adAttributionRepository.emergentBusinesses` (Task 2).
- Produces: `adAttributionService.getMappingHealth(orgId)` returning `{ adAccounts, ghlAccounts, emergentBusinesses, summary }` as specified below.

- [ ] **Step 1: Write the failing tests**

Append to `test/ad-attribution.service.test.mjs`:

```js
describe('getMappingHealth', () => {
  beforeEach(() => {
    adAttributionRepository.practiceOptions.mockResolvedValue([
      { id: 'p1', name: 'Ashford' },
    ]);
    adAttributionRepository.adAccounts.mockResolvedValue([]);
    adAttributionRepository.ghlAccounts.mockResolvedValue([]);
    adAttributionRepository.emergentBusinesses.mockResolvedValue([]);
    adChannelPipelineRepository.channelMap.mockResolvedValue(new Map());
  });

  it('resolves a mapped ad account to its practice name and marks it mapped', async () => {
    adAttributionRepository.adAccounts.mockResolvedValue([
      { id: 'a1', provider: 'google_ads', customer_id: '123', name: 'Main', practice_id: 'p1' },
    ]);
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.adAccounts[0]).toEqual({
      id: 'a1', provider: 'google_ads', customerId: '123', name: 'Main',
      practiceId: 'p1', practiceName: 'Ashford', mapped: true,
    });
    expect(out.summary.adAccountsUnmapped).toBe(0);
  });

  it('marks an unmapped ad account and counts it, with a null practice name', async () => {
    adAttributionRepository.adAccounts.mockResolvedValue([
      { id: 'a1', provider: 'meta_ads', customer_id: '999', name: null, practice_id: null },
    ]);
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.adAccounts[0].mapped).toBe(false);
    expect(out.adAccounts[0].practiceName).toBeNull();
    expect(out.summary.adAccountsUnmapped).toBe(1);
  });

  it('counts a GHL subaccount pipeline with no channel as unmapped', async () => {
    adAttributionRepository.ghlAccounts.mockResolvedValue([
      {
        id: 'g1', label: 'Ashford', external_account_id: 'LOC1', practice_id: 'p1',
        status: 'active', pipelines: [{ id: 'pl1', name: 'A' }, { id: 'pl2', name: 'B' }],
      },
    ]);
    adChannelPipelineRepository.channelMap.mockResolvedValue(new Map([['g1|pl1', 'google_ads']]));
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.ghlAccounts[0].pipelineCount).toBe(2);
    expect(out.ghlAccounts[0].unmappedPipelineCount).toBe(1);
    expect(out.summary.pipelinesUnmapped).toBe(1);
  });

  it('excludes a practice-less GHL subaccount from pipelinesUnmapped', async () => {
    // The academy and accounting Locations live in integration_accounts too.
    // Their pipelines must never inflate the count — same rule getPerformance
    // already applies.
    adAttributionRepository.ghlAccounts.mockResolvedValue([
      {
        id: 'g2', label: 'Academy', external_account_id: 'LOC2', practice_id: null,
        status: 'active', pipelines: [{ id: 'plx', name: 'X' }],
      },
    ]);
    adChannelPipelineRepository.channelMap.mockResolvedValue(new Map());
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.summary.pipelinesUnmapped).toBe(0);
    expect(out.ghlAccounts[0].mapped).toBe(false);
    expect(out.summary.ghlAccountsUnmapped).toBe(1);
  });

  it('reports an intentionally unmapped Emergent business', async () => {
    adAttributionRepository.emergentBusinesses.mockResolvedValue([
      { businessId: 'BIZ1', businessName: 'Ashford', practiceId: 'p1' },
      { businessId: 'BIZ2', businessName: 'Unknown', practiceId: null },
    ]);
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.emergentBusinesses[0]).toEqual({
      businessId: 'BIZ1', businessName: 'Ashford',
      practiceId: 'p1', practiceName: 'Ashford', mapped: true,
    });
    expect(out.emergentBusinesses[1].mapped).toBe(false);
    expect(out.summary.emergentUnmapped).toBe(1);
  });

  it('returns empty surfaces rather than throwing when nothing is configured', async () => {
    const out = await adAttributionService.getMappingHealth('org1');
    expect(out.adAccounts).toEqual([]);
    expect(out.ghlAccounts).toEqual([]);
    expect(out.emergentBusinesses).toEqual([]);
    expect(out.summary).toEqual({
      adAccountsUnmapped: 0, ghlAccountsUnmapped: 0, emergentUnmapped: 0, pipelinesUnmapped: 0,
    });
  });
});
```

Add `emergentBusinesses: vi.fn(),` to the `vi.mock` factory for `ad-attribution.repository.js` at the top of the file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ad-attribution.service.test.mjs -t "getMappingHealth"`
Expected: FAIL — `adAttributionService.getMappingHealth is not a function`.

- [ ] **Step 3: Implement the service method**

In `src/services/ad-attribution.service.js`, add to the `adAttributionService` object after `getConfig`:

```js
    // What is and is not mapped, across all three mapping surfaces. Deliberately
    // NOT narrowed by practice: its purpose is to show what is missing across
    // the whole group, and a practice filter would hide exactly the rows the
    // operator needs to see.
    async getMappingHealth(orgId) {
        const [adAccountRows, ghlRows, emergentRows, practices, channelMap] = await Promise.all([
            adAttributionRepository.adAccounts(orgId),
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.emergentBusinesses(orgId),
            adAttributionRepository.practiceOptions(orgId),
            adChannelPipelineRepository.channelMap(orgId),
        ]);
        const practiceName = new Map(practices.map((p) => [p.id, p.name]));
        const named = (practiceId) => practiceName.get(practiceId) ?? null;

        const adAccounts = (adAccountRows ?? []).map((a) => ({
            id: a.id,
            provider: a.provider,
            customerId: a.customer_id,
            name: a.name ?? null,
            practiceId: a.practice_id ?? null,
            practiceName: a.practice_id ? named(a.practice_id) : null,
            mapped: a.practice_id !== null && a.practice_id !== undefined,
        }));

        const ghlAccounts = (ghlRows ?? []).map((g) => {
            const unmappedPipelines = g.pipelines.filter(
                (p) => !channelMap.has(pipeKey(g.id, p.id)),
            ).length;
            return {
                id: g.id,
                label: g.label ?? null,
                externalAccountId: g.external_account_id,
                practiceId: g.practice_id,
                practiceName: g.practice_id ? named(g.practice_id) : null,
                mapped: g.practice_id !== null,
                status: g.status,
                pipelineCount: g.pipelines.length,
                unmappedPipelineCount: unmappedPipelines,
            };
        });

        const emergentBusinesses = (emergentRows ?? []).map((e) => ({
            businessId: e.businessId,
            businessName: e.businessName,
            practiceId: e.practiceId,
            practiceName: e.practiceId ? named(e.practiceId) : null,
            mapped: e.practiceId !== null,
        }));

        return {
            adAccounts,
            ghlAccounts,
            emergentBusinesses,
            summary: {
                adAccountsUnmapped: adAccounts.filter((a) => !a.mapped).length,
                ghlAccountsUnmapped: ghlAccounts.filter((g) => !g.mapped).length,
                emergentUnmapped: emergentBusinesses.filter((e) => !e.mapped).length,
                // Only a subaccount that IS mapped to a practice can have
                // mappable pipelines — an academy/accounting Location's
                // pipelines must never inflate this. Same rule as
                // getPerformance's unmappedPipelineCount, so the two agree.
                pipelinesUnmapped: ghlAccounts
                    .filter((g) => g.mapped)
                    .reduce((n, g) => n + g.unmappedPipelineCount, 0),
            },
        };
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/ad-attribution.service.test.mjs -t "getMappingHealth"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the controller and route**

In `src/controllers/ad-attribution.controller.js`, add to `adAttributionController`:

```js
    async mappingHealth(req, res) {
        res.json(await adAttributionService.getMappingHealth(req.user.organisation_id));
    },
```

In `src/routes/ad-attribution.routes.js`, add after the `/leads` line (static paths stay before param routes):

```js
router.get('/mapping-health', gate, (0, async_handler_1.asyncHandler)(adAttributionController.mappingHealth));
```

- [ ] **Step 6: Document the endpoint**

Add to `docs/API.md`, in the ad-attribution section:

```markdown
### GET /api/ad-attribution/mapping-health

Roles: `owner`, `practice_manager`. No query parameters — deliberately group-wide, not narrowed by practice.

Returns every ad account, GoHighLevel subaccount and Emergent business with the practice it maps to, plus a `summary` of what is unmapped. `mapped` is `practiceId !== null`. `practiceName` is null when unmapped. `summary.pipelinesUnmapped` counts pipelines with no channel, excluding subaccounts that have no practice (academy/accounting Locations), matching the `unmappedPipelineCount` returned by `/performance`.
```

- [ ] **Step 7: Run the full ad-attribution suite**

Run: `npx vitest run test/ad-attribution.service.test.mjs test/ad-attribution.repository.test.mjs test/ad-attribution.isolation.test.mjs`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/services/ad-attribution.service.js src/controllers/ad-attribution.controller.js src/routes/ad-attribution.routes.js test/ad-attribution.service.test.mjs docs/API.md
git commit -m "feat(ads): mapping-health endpoint"
```

---

### Task 5: `GET /api/ad-attribution/spend`

**Files:**
- Modify: `src/models/ad-attribution.model.js`, `src/services/ad-attribution.service.js`, `src/controllers/ad-attribution.controller.js`, `src/routes/ad-attribution.routes.js`, `docs/API.md`
- Test: `test/ad-attribution.service.test.mjs`

**Interfaces:**
- Consumes: `accountPracticeByCustomerId` (Task 1), `adAttributionRepository.adSpendDetailed` (Task 3).
- Produces: `adAttributionService.getSpend(orgId, { since, until, practiceId })` returning `{ byAccount, byCampaign, unattributedSpendPence }`; `spendQuerySchema` in the model.

- [ ] **Step 1: Write the failing tests**

Append to `test/ad-attribution.service.test.mjs`:

```js
describe('getSpend', () => {
  const ACCOUNTS = [
    { id: 'a1', provider: 'google_ads', customer_id: '111', name: 'G Main', practice_id: 'p1' },
    { id: 'a2', provider: 'meta_ads', customer_id: '222', name: 'M Main', practice_id: null },
  ];

  beforeEach(() => {
    adAttributionRepository.adAccounts.mockResolvedValue(ACCOUNTS);
    adAttributionRepository.practiceOptions.mockResolvedValue([{ id: 'p1', name: 'Ashford' }]);
    adAttributionRepository.adSpendDetailed.mockResolvedValue([]);
  });

  it('rolls day rows up to one row per account and one per campaign', async () => {
    adAttributionRepository.adSpendDetailed.mockResolvedValue([
      { provider: 'google_ads', customer_id: '111', campaign_id: 'c1', campaign_name: 'Brand', campaign_status: 'ENABLED', spend_pence: 1000, impressions: 10, clicks: 2, conversions: 1, metric_date: '2026-07-01' },
      { provider: 'google_ads', customer_id: '111', campaign_id: 'c1', campaign_name: 'Brand', campaign_status: 'ENABLED', spend_pence: 500, impressions: 5, clicks: 1, conversions: 0, metric_date: '2026-07-02' },
      { provider: 'google_ads', customer_id: '111', campaign_id: 'c2', campaign_name: 'Generic', campaign_status: 'PAUSED', spend_pence: 250, impressions: 3, clicks: 0, conversions: 0, metric_date: '2026-07-01' },
    ]);
    const out = await adAttributionService.getSpend('org1', { since: '2026-07-01', until: '2026-08-01' });
    expect(out.byAccount).toHaveLength(1);
    expect(out.byAccount[0]).toMatchObject({
      customerId: '111', provider: 'google_ads', accountName: 'G Main',
      practiceId: 'p1', practiceName: 'Ashford',
      spendPence: 1750, impressions: 18, clicks: 3, conversions: 1,
    });
    expect(out.byCampaign).toHaveLength(2);
    expect(out.byCampaign[0]).toMatchObject({ campaignId: 'c1', spendPence: 1500 });
  });

  it('sorts both arrays by spend descending', async () => {
    adAttributionRepository.adSpendDetailed.mockResolvedValue([
      { provider: 'google_ads', customer_id: '111', campaign_id: 'small', campaign_name: 'S', spend_pence: 100, impressions: 0, clicks: 0, conversions: 0, metric_date: '2026-07-01' },
      { provider: 'meta_ads', customer_id: '222', campaign_id: 'big', campaign_name: 'B', spend_pence: 9000, impressions: 0, clicks: 0, conversions: 0, metric_date: '2026-07-01' },
    ]);
    const out = await adAttributionService.getSpend('org1', { since: '2026-07-01', until: '2026-08-01' });
    expect(out.byCampaign.map((c) => c.campaignId)).toEqual(['big', 'small']);
    expect(out.byAccount.map((a) => a.customerId)).toEqual(['222', '111']);
  });

  it('reports spend on an unknown customer_id as unattributed rather than dropping it', async () => {
    adAttributionRepository.adSpendDetailed.mockResolvedValue([
      { provider: 'google_ads', customer_id: 'GHOST', campaign_id: 'c9', campaign_name: 'Z', spend_pence: 700, impressions: 0, clicks: 0, conversions: 0, metric_date: '2026-07-01' },
    ]);
    const out = await adAttributionService.getSpend('org1', { since: '2026-07-01', until: '2026-08-01' });
    expect(out.unattributedSpendPence).toBe(700);
  });

  it('is zero, not null, when everything is attributed — it is a real sum', async () => {
    adAttributionRepository.adSpendDetailed.mockResolvedValue([
      { provider: 'google_ads', customer_id: '111', campaign_id: 'c1', campaign_name: 'B', spend_pence: 100, impressions: 0, clicks: 0, conversions: 0, metric_date: '2026-07-01' },
    ]);
    const out = await adAttributionService.getSpend('org1', { since: '2026-07-01', until: '2026-08-01' });
    expect(out.unattributedSpendPence).toBe(0);
  });

  it('filters to accounts mapped to the requested practice, excluding unmapped ones', async () => {
    adAttributionRepository.adSpendDetailed.mockResolvedValue([
      { provider: 'google_ads', customer_id: '111', campaign_id: 'c1', campaign_name: 'B', spend_pence: 100, impressions: 0, clicks: 0, conversions: 0, metric_date: '2026-07-01' },
      { provider: 'meta_ads', customer_id: '222', campaign_id: 'c2', campaign_name: 'M', spend_pence: 900, impressions: 0, clicks: 0, conversions: 0, metric_date: '2026-07-01' },
    ]);
    const out = await adAttributionService.getSpend('org1', {
      since: '2026-07-01', until: '2026-08-01', practiceId: 'p1',
    });
    expect(out.byAccount.map((a) => a.customerId)).toEqual(['111']);
    expect(out.byCampaign.map((c) => c.campaignId)).toEqual(['c1']);
  });

  it('does not count unattributed spend into a practice-scoped view', async () => {
    // Spend that cannot be tied to any account certainly cannot be tied to one
    // practice, so a practice-scoped request must not inherit it.
    adAttributionRepository.adSpendDetailed.mockResolvedValue([
      { provider: 'google_ads', customer_id: 'GHOST', campaign_id: 'c9', campaign_name: 'Z', spend_pence: 700, impressions: 0, clicks: 0, conversions: 0, metric_date: '2026-07-01' },
    ]);
    const out = await adAttributionService.getSpend('org1', {
      since: '2026-07-01', until: '2026-08-01', practiceId: 'p1',
    });
    expect(out.unattributedSpendPence).toBe(0);
  });

  it('does not return reach or frequency — they are not summable across days', async () => {
    adAttributionRepository.adSpendDetailed.mockResolvedValue([
      { provider: 'google_ads', customer_id: '111', campaign_id: 'c1', campaign_name: 'B', spend_pence: 100, impressions: 0, clicks: 0, conversions: 0, metric_date: '2026-07-01' },
    ]);
    const out = await adAttributionService.getSpend('org1', { since: '2026-07-01', until: '2026-08-01' });
    expect(out.byAccount[0]).not.toHaveProperty('reach');
    expect(out.byCampaign[0]).not.toHaveProperty('frequency');
  });
});
```

Add `adSpendDetailed: vi.fn(),` to the `vi.mock` factory for `ad-attribution.repository.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ad-attribution.service.test.mjs -t "getSpend"`
Expected: FAIL — `adAttributionService.getSpend is not a function`.

- [ ] **Step 3: Implement the service method**

In `src/services/ad-attribution.service.js`, add to `adAttributionService` after `getMappingHealth`:

```js
    // Spend broken out per account and per campaign, so the Spend tile has
    // something to open. Practice attribution comes from the ad_accounts join,
    // NOT from ad_metrics.practice_id — that column is null on every row.
    //
    // reach/frequency are deliberately absent: they are not summable across
    // days, and summing them (as growth.routes.js does) overcounts.
    async getSpend(orgId, { since, until, practiceId }) {
        const [rows, accounts, practices] = await Promise.all([
            adAttributionRepository.adSpendDetailed(orgId, since, until),
            adAttributionRepository.adAccounts(orgId),
            adAttributionRepository.practiceOptions(orgId),
        ]);
        const practiceOf = accountPracticeByCustomerId(accounts);
        const accountName = new Map(
            (accounts ?? []).map((a) => [`${a.provider}|${a.customer_id}`, a.name ?? null]),
        );
        const practiceName = new Map((practices ?? []).map((p) => [p.id, p.name]));

        const byAccount = new Map();
        const byCampaign = new Map();
        let unattributedSpendPence = 0;

        for (const r of rows ?? []) {
            const acctKey = `${r.provider}|${r.customer_id}`;
            const known = practiceOf.has(acctKey);
            const practice = known ? practiceOf.get(acctKey) : null;
            // Spend on a customer_id with no ad_accounts row cannot be tied to
            // an account at all. Reported separately so byAccount and the group
            // total visibly reconcile rather than quietly disagreeing.
            //
            // Only counted when NO practice filter is applied: spend that
            // cannot be attributed to any account certainly cannot be
            // attributed to a specific practice, so adding it to a
            // practice-scoped view would overstate that practice's spend.
            if (!known) {
                if (!practiceId) unattributedSpendPence += r.spend_pence || 0;
                continue;
            }
            if (practiceId && practice !== practiceId) continue;

            if (!byAccount.has(acctKey)) {
                byAccount.set(acctKey, {
                    customerId: r.customer_id,
                    provider: r.provider,
                    accountName: accountName.get(acctKey) ?? null,
                    practiceId: practice,
                    practiceName: practice ? (practiceName.get(practice) ?? null) : null,
                    spendPence: 0, impressions: 0, clicks: 0, conversions: 0,
                });
            }
            const a = byAccount.get(acctKey);
            a.spendPence += r.spend_pence || 0;
            a.impressions += r.impressions || 0;
            a.clicks += r.clicks || 0;
            a.conversions += r.conversions || 0;

            const campKey = `${acctKey}|${r.campaign_id ?? ''}`;
            if (!byCampaign.has(campKey)) {
                byCampaign.set(campKey, {
                    customerId: r.customer_id,
                    provider: r.provider,
                    campaignId: r.campaign_id ?? null,
                    campaignName: r.campaign_name ?? null,
                    campaignStatus: r.campaign_status ?? null,
                    practiceId: practice,
                    practiceName: practice ? (practiceName.get(practice) ?? null) : null,
                    spendPence: 0, impressions: 0, clicks: 0, conversions: 0,
                });
            }
            const c = byCampaign.get(campKey);
            c.spendPence += r.spend_pence || 0;
            c.impressions += r.impressions || 0;
            c.clicks += r.clicks || 0;
            c.conversions += r.conversions || 0;
        }

        const bySpendDesc = (x, y) => y.spendPence - x.spendPence;
        return {
            byAccount: [...byAccount.values()].sort(bySpendDesc),
            byCampaign: [...byCampaign.values()].sort(bySpendDesc),
            unattributedSpendPence,
        };
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/ad-attribution.service.test.mjs -t "getSpend"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the Zod schema, controller and route**

In `src/models/ad-attribution.model.js`, add:

```js
// Same window/scope contract as performanceQuerySchema — the spend drill-down
// is opened from the same ScopePeriod bar.
export const spendQuerySchema = zod_1.z.object({
    since: zod_1.z.string(),
    until: zod_1.z.string(),
    practice_id: zod_1.z.string().uuid().optional(),
});
```

In `src/controllers/ad-attribution.controller.js`, add `spendQuerySchema` to the import from the model, and add:

```js
    async spend(req, res) {
        const q = spendQuerySchema.parse(req.query);
        res.json(await adAttributionService.getSpend(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId: q.practice_id,
        }));
    },
```

In `src/routes/ad-attribution.routes.js`, add after the `/mapping-health` line:

```js
router.get('/spend', gate, (0, async_handler_1.asyncHandler)(adAttributionController.spend));
```

- [ ] **Step 6: Document the endpoint**

Add to `docs/API.md`:

```markdown
### GET /api/ad-attribution/spend

Roles: `owner`, `practice_manager`. Query: `since`, `until`, optional `practice_id`.

Returns `byAccount[]` and `byCampaign[]` (both sorted by `spendPence` descending) plus `unattributedSpendPence`. Money is integer pence.

Practice attribution comes from joining `ad_metrics.customer_id` to `ad_accounts.practice_id` — `ad_metrics.practice_id` is null on every row and is not used. `unattributedSpendPence` is spend on a `customer_id` with no matching `ad_accounts` row; it is 0, never null, because it is a real sum. `reach` and `frequency` are deliberately not returned: they cannot be summed across days.
```

- [ ] **Step 7: Run the full ad-attribution suite**

Run: `npx vitest run test/ad-attribution.service.test.mjs test/ad-attribution.repository.test.mjs test/ad-attribution.isolation.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/models/ad-attribution.model.js src/services/ad-attribution.service.js src/controllers/ad-attribution.controller.js src/routes/ad-attribution.routes.js test/ad-attribution.service.test.mjs docs/API.md
git commit -m "feat(ads): spend endpoint with account and campaign rows"
```

---

### Task 6: Additive fields on the leads row

**Files:**
- Modify: `src/services/ad-attribution.service.js` (`getLeads`)
- Test: `test/ad-attribution.service.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getLeads` rows gain `personKey`, `practiceId`, `practiceName`, `matchedPatientName`, `matchedAcceptedDate`. Nothing is removed or renamed.

`personKey` and the practice are already in scope at the row-construction site; the matcher already returns `patientName` and `acceptedDate` and `getLeads` simply discards them. `practiceName` requires threading `practiceOptions` in, exactly as `getPerformance` already does.

- [ ] **Step 1: Write the failing tests**

Append to `test/ad-attribution.service.test.mjs`:

```js
describe('getLeads additive fields', () => {
  beforeEach(() => {
    adChannelPipelineRepository.channelMap.mockResolvedValue(new Map([['g1|pl1', 'google_ads']]));
    adAttributionRepository.ghlAccounts.mockResolvedValue([
      { id: 'g1', label: 'Ashford', external_account_id: 'LOC1', practice_id: 'p1', status: 'active', pipelines: [{ id: 'pl1', name: 'Open Day' }] },
    ]);
    adAttributionRepository.practiceOptions.mockResolvedValue([{ id: 'p1', name: 'Ashford' }]);
    adAttributionRepository.acceptedForMatching.mockResolvedValue([]);
    adAttributionRepository.leadsInWindow.mockResolvedValue([]);
  });

  it('exposes personKey as the contact id when there is one', async () => {
    adAttributionRepository.leadsInWindow.mockResolvedValue([
      { id: 'l1', contact_id: 'c1', integration_account_id: 'g1', ghl_pipeline_id: 'pl1', created_at: '2026-07-01T00:00:00Z', contacts: { first_name: 'A', last_name: 'B' } },
    ]);
    const out = await adAttributionService.getLeads('org1', { since: '2026-07-01', until: '2026-08-01', limit: 500 });
    expect(out.leads[0].personKey).toBe('c1');
  });

  it('falls back to the synthetic lead key when the contact id is null', async () => {
    adAttributionRepository.leadsInWindow.mockResolvedValue([
      { id: 'l1', contact_id: null, integration_account_id: 'g1', ghl_pipeline_id: 'pl1', created_at: '2026-07-01T00:00:00Z', contacts: {} },
    ]);
    const out = await adAttributionService.getLeads('org1', { since: '2026-07-01', until: '2026-08-01', limit: 500 });
    expect(out.leads[0].personKey).toBe('lead:l1');
  });

  it('carries the practice id and resolved name', async () => {
    adAttributionRepository.leadsInWindow.mockResolvedValue([
      { id: 'l1', contact_id: 'c1', integration_account_id: 'g1', ghl_pipeline_id: 'pl1', created_at: '2026-07-01T00:00:00Z', contacts: {} },
    ]);
    const out = await adAttributionService.getLeads('org1', { since: '2026-07-01', until: '2026-08-01', limit: 500 });
    expect(out.leads[0].practiceId).toBe('p1');
    expect(out.leads[0].practiceName).toBe('Ashford');
  });

  it('exposes the matched patient name and accepted date the matcher already computed', async () => {
    adAttributionRepository.leadsInWindow.mockResolvedValue([
      { id: 'l1', contact_id: 'c1', integration_account_id: 'g1', ghl_pipeline_id: 'pl1', created_at: '2026-07-01T00:00:00Z', contacts: { phone: '07700900000' } },
    ]);
    adAttributionRepository.acceptedForMatching.mockResolvedValue([
      { id: 't1', practice_id: 'p1', patient_name: 'Jane Doe', value_pence: 5000, treatment_name: 'Implant', accepted_date: '2026-07-05', raw: { phone: '07700900000' } },
    ]);
    const out = await adAttributionService.getLeads('org1', { since: '2026-07-01', until: '2026-08-01', limit: 500 });
    expect(out.leads[0].matchedPatientName).toBe('Jane Doe');
    expect(out.leads[0].matchedAcceptedDate).toBe('2026-07-05');
    expect(out.leads[0].matchedValuePence).toBe(5000);
  });

  it('leaves the matched fields null when nothing matched', async () => {
    adAttributionRepository.leadsInWindow.mockResolvedValue([
      { id: 'l1', contact_id: 'c1', integration_account_id: 'g1', ghl_pipeline_id: 'pl1', created_at: '2026-07-01T00:00:00Z', contacts: {} },
    ]);
    const out = await adAttributionService.getLeads('org1', { since: '2026-07-01', until: '2026-08-01', limit: 500 });
    expect(out.leads[0].matchedPatientName).toBeNull();
    expect(out.leads[0].matchedAcceptedDate).toBeNull();
    expect(out.leads[0].converted).toBe(false);
  });

  it('still returns every pre-existing field, so consumers do not break', async () => {
    adAttributionRepository.leadsInWindow.mockResolvedValue([
      { id: 'l1', contact_id: 'c1', integration_account_id: 'g1', ghl_pipeline_id: 'pl1', created_at: '2026-07-01T00:00:00Z', contacts: { first_name: 'A', last_name: 'B', email: 'a@b.c', phone: '07700900000' } },
    ]);
    const out = await adAttributionService.getLeads('org1', { since: '2026-07-01', until: '2026-08-01', limit: 500 });
    for (const k of ['id', 'contactId', 'name', 'email', 'phone', 'channel', 'pipelineName',
      'createdAt', 'converted', 'matchedTreatmentName', 'matchedValuePence']) {
      expect(out.leads[0]).toHaveProperty(k);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ad-attribution.service.test.mjs -t "getLeads additive fields"`
Expected: FAIL — `personKey` is undefined on the row.

- [ ] **Step 3: Implement**

In `src/services/ad-attribution.service.js`, in `getLeads`, add `practiceOptions` to the `Promise.all` destructuring:

```js
        const [channelMap, accounts, leads, accepted, practices] = await Promise.all([
            adChannelPipelineRepository.channelMap(orgId),
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.leadsInWindow(orgId, since, until),
            adAttributionRepository.acceptedForMatching(orgId, since, until),
            adAttributionRepository.practiceOptions(orgId),
        ]);
```

Immediately after the existing `const accountPractice = ...` line, add:

```js
        const practiceName = new Map((practices ?? []).map((p) => [p.id, p.name]));
```

Then extend the pushed row. Replace the existing `rows.push({ ... })` object with:

```js
            rows.push({
                id: lead.id,
                contactId: lead.contact_id ?? null,
                // The same identity the dedupe above uses. Exposed so the client
                // can group a person across channels exactly rather than
                // re-deriving it and getting a lower bound.
                personKey: personKey(lead),
                name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
                email: c.email ?? null,
                phone: c.phone ?? null,
                channel: ch,
                practiceId: practice,
                practiceName: practiceName.get(practice) ?? null,
                pipelineName: pipelineName.get(pipeKey(lead.integration_account_id, lead.ghl_pipeline_id)) ?? null,
                createdAt: lead.created_at,
                converted: matched !== null,
                matchedTreatmentName: matched?.treatmentName ?? null,
                matchedPatientName: matched?.patientName ?? null,
                matchedAcceptedDate: matched?.acceptedDate ?? null,
                matchedValuePence: matched?.valuePence ?? 0,
            });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/ad-attribution.service.test.mjs -t "getLeads additive fields"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Update the endpoint documentation**

In `docs/API.md`, under `GET /api/ad-attribution/leads`, add:

```markdown
Each row also carries `personKey` (the identity used to dedupe per person — contact id, or `lead:<id>` when there is no contact), `practiceId`, `practiceName`, `matchedPatientName` and `matchedAcceptedDate`.
```

- [ ] **Step 6: Commit**

```bash
git add src/services/ad-attribution.service.js test/ad-attribution.service.test.mjs docs/API.md
git commit -m "feat(ads): personKey, practice and matched patient/date on lead rows"
```

---

### Task 7: Wire the join into `computePerformance`

**Files:**
- Modify: `src/services/ad-attribution.service.js` (`computePerformance`, `getPerformance`)
- Test: `test/ad-attribution.service.test.mjs`

**Interfaces:**
- Consumes: `accountPracticeByCustomerId` (Task 1); `adSpend` now selects `customer_id` (Task 3).
- Produces: `computePerformance` accepts an additional `adAccountPractice` parameter (a `Map` from `accountPracticeByCustomerId`). Existing callers that omit it get an empty map and behave exactly as before.

This replaces the dead `if (row.practice_id)` branches. `ad_metrics.practice_id` is null on every live row, so those branches never fire and per-practice spend is silently absent.

**On live data this changes nothing yet** — every `ad_accounts` row currently has `practice_id` null, so the join resolves to null and per-practice spend stays "Not reporting". It begins working the moment an operator maps an account, with no re-sync.

- [ ] **Step 1: Write the failing tests**

Append to `test/ad-attribution.service.test.mjs`:

```js
describe('computePerformance per-practice spend via the ad_accounts join', () => {
  const base = {
    leads: [], accepted: [], channelMap: new Map(), accountPractice: new Map(),
  };

  it('attributes spend to a practice through customer_id, not ad_metrics.practice_id', () => {
    const out = computePerformance({
      ...base,
      spend: [
        // practice_id null on the row, exactly as both connectors write it.
        { provider: 'google_ads', customer_id: '111', practice_id: null, spend_pence: 4000, metric_date: '2026-07-01' },
      ],
      adAccountPractice: accountPracticeByCustomerId([
        { provider: 'google_ads', customer_id: '111', practice_id: 'p1' },
      ]),
    });
    const practice = out.byPractice.find((p) => p.practiceId === 'p1');
    expect(practice).toBeDefined();
    const google = practice.channels.find((c) => c.channel === 'google_ads');
    expect(google.spendPence).toBe(4000);
  });

  it('leaves spend group-only when the account is not mapped to a practice', () => {
    const out = computePerformance({
      ...base,
      spend: [
        { provider: 'google_ads', customer_id: '111', practice_id: null, spend_pence: 4000, metric_date: '2026-07-01' },
      ],
      adAccountPractice: accountPracticeByCustomerId([
        { provider: 'google_ads', customer_id: '111', practice_id: null },
      ]),
    });
    expect(out.byPractice.find((p) => p.practiceId === 'p1')).toBeUndefined();
    const google = out.channels.find((c) => c.channel === 'google_ads');
    expect(google.spendPence).toBe(4000);
  });

  it('still counts group spend when no ad account map is supplied at all', () => {
    const out = computePerformance({
      ...base,
      spend: [
        { provider: 'google_ads', customer_id: '111', practice_id: null, spend_pence: 4000, metric_date: '2026-07-01' },
      ],
    });
    const google = out.channels.find((c) => c.channel === 'google_ads');
    expect(google.spendPence).toBe(4000);
  });

  it('attributes the per-practice trend through the same join', () => {
    const out = computePerformance({
      ...base,
      spend: [
        { provider: 'google_ads', customer_id: '111', practice_id: null, spend_pence: 4000, metric_date: '2026-07-01' },
      ],
      adAccountPractice: accountPracticeByCustomerId([
        { provider: 'google_ads', customer_id: '111', practice_id: 'p1' },
      ]),
    });
    const practice = out.byPractice.find((p) => p.practiceId === 'p1');
    const july = practice.trend.find((t) => t.month === '2026-07');
    expect(july).toBeDefined();
    expect(july.channels.find((c) => c.channel === 'google_ads').spendPence).toBe(4000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ad-attribution.service.test.mjs -t "per-practice spend via the ad_accounts join"`
Expected: FAIL — the practice bucket is undefined, because the current code only fires on `row.practice_id`.

- [ ] **Step 3: Implement**

In `computePerformance`, add `adAccountPractice` to the destructured parameters, defaulting to an empty map:

```js
export function computePerformance({
    leads, accepted, spend, channelMap, accountPractice, adAccountPractice = new Map(),
}) {
```

(Keep every other existing parameter exactly as it is; only the new one is added.)

Then in the spend loop, replace both `if (row.practice_id)` guards. The loop becomes:

```js
    for (const row of spend || []) {
        if (!AD_CHANNELS.includes(row.provider)) continue;
        const g = group.get(row.provider);
        g.spendPence += row.spend_pence || 0;
        // ad_metrics.practice_id is written as literal null by BOTH connectors
        // and nothing backfills it, so it can never attribute spend below group
        // level. The mapping that IS maintained is ad_accounts.practice_id,
        // reached from this row via customer_id — see
        // accountPracticeByCustomerId. Only spend on an account mapped to a
        // practice can be attributed to that practice.
        const rowPractice = adAccountPractice.get(`${row.provider}|${row.customer_id}`) ?? null;
        if (rowPractice) {
            const p = practiceStats(rowPractice, row.provider);
            p.spendPence += row.spend_pence || 0;
        }
        const m = monthKey(row.metric_date);
        // A null/blank metric_date must not become an "Invalid Date" point on
        // the trend chart's X axis — skip it for the trend only; the
        // channel/practice totals above already captured this spend.
        if (m === '') continue;
        const t = trendStats(m, row.provider);
        t.spendPence += row.spend_pence || 0;
        if (rowPractice) {
            const pt = practiceTrendStats(rowPractice, m, row.provider);
            pt.spendPence += row.spend_pence || 0;
        }
    }
```

- [ ] **Step 4: Pass the map in from `getPerformance`**

In `getPerformance`, the existing `accounts` variable holds **GHL** subaccounts (`ghlAccounts`), not ad accounts — do not reuse it. Add a separate `adAccounts` read to the `Promise.all` and pass the derived map through. The `Promise.all` becomes:

```js
        const [channelMap, accounts, leads, accepted, spend, practiceOptions, adAccountRows] = await Promise.all([
            adChannelPipelineRepository.channelMap(orgId),
            adAttributionRepository.ghlAccounts(orgId),
            adAttributionRepository.leadsInWindow(orgId, since, until),
            adAttributionRepository.acceptedForMatching(orgId, since, until),
            adAttributionRepository.adSpend(orgId, since, until),
            adAttributionRepository.practiceOptions(orgId),
            adAttributionRepository.adAccounts(orgId),
        ]);
```

and the `computePerformance` call gains one argument:

```js
        const result = computePerformance({
            leads, accepted, spend, channelMap, accountPractice,
            adAccountPractice: accountPracticeByCustomerId(adAccountRows),
        });
```

- [ ] **Step 5: Run the whole backend suite**

Run: `npm test`
Expected: PASS. Note that some test files fail on `main` for unrelated reasons; if any failure appears, confirm it also fails on `main` before treating it as caused by this change. Report the comparison rather than assuming.

- [ ] **Step 6: Commit**

```bash
git add src/services/ad-attribution.service.js test/ad-attribution.service.test.mjs
git commit -m "fix(ads): attribute per-practice spend via ad_accounts, not the always-null ad_metrics.practice_id"
```

---

## Verification

After all seven tasks:

```bash
cd /Users/ruhithpasha/code/work/Dental-os/backend
npm run lint && npm run typecheck && npm test
```

All three must pass. `npm run typecheck` is a syntax check (`node --check`), not TypeScript.

Manual check against the live org, once deployed:

- `GET /api/ad-attribution/mapping-health` should report all six ad accounts as `mapped: false` — that is the current, correct state and the reason cost-per-lead is group-only.
- `GET /api/ad-attribution/spend` should return account and campaign rows whose `spendPence` sums to the same group total `/performance` reports, with any difference accounted for by `unattributedSpendPence`.

## Explicitly out of scope

- Any write path. Mapping is edited on the existing `/settings/ad-attribution` screen.
- Any migration or connector change. `ad_metrics.practice_id` stays null.
- Frontend work consuming these endpoints.
- `reach` and `frequency` at campaign level.
