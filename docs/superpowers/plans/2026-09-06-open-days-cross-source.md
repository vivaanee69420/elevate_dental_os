# Open Days Cross-Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GoHighLevel the source of truth for Facebook leads, and turn open days into an event with both Meta campaigns (spend) and GHL pipelines (leads) attached.

**Architecture:** The Meta lead ledger stops identifying leads by Meta's `ad_id` and takes its pool from GHL pipelines — those mapped `channel='meta_ads'` (always-on) or mapped to an open day. Spend still splits by campaign→event; leads now split by pipeline→event. A lead's *campaign* still comes from its `ad_id`, which is what ties it to a campaign/ad set/ad row.

**Tech Stack:** Postgres RPCs (plpgsql, SECURITY DEFINER), native-ESM Express backend, vitest, Next.js 14 App Router, React Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-06-open-days-cross-source-design.md`

## Global Constraints

- Money is **integer pence**; never floats. Display `(pence/100).toLocaleString('en-GB')`.
- British English in all UI (organisation, colour, optimise, centre).
- No emojis in code or UI.
- Every repository query carries an explicit `.eq('organisation_id', orgId)` — these run on `serviceClient`, which bypasses RLS, so that filter IS the tenant boundary.
- New tables: RLS **enabled**, **zero policies**, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT ALL … TO service_role`. New functions: `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`.
- Every migration ends with `NOTIFY pgrst, 'reload schema';`.
- RPCs that take `p_org` are `LANGUAGE plpgsql … RETURN QUERY EXECUTE`, never `LANGUAGE sql` — DEFINER + `SET search_path` block inlining, so a sql body is planned generically with `p_org` unknown and never chooses the per-lead index probes (10.7s vs 608ms, see `000156`).
- A cost with a zero denominator is `null`, never `0`.
- Migration numbers continue from `000169`. Apply each to hosted project `mkfhpzjbijbachoonytt` and verify before moving on.
- Backend suite must stay green: `cd backend && npm test`.

---

### Task 1: `ad_open_day_pipelines` table

**Files:**
- Create: `supabase/migrations/20260101000170_ad_open_day_pipelines.sql`
- Test: verified by SQL after applying (no unit test — DDL)

**Interfaces:**
- Consumes: `ad_open_days (organisation_id, id)` unique index from `000168`.
- Produces: table `public.ad_open_day_pipelines` with columns `organisation_id, open_day_id, integration_account_id, ghl_pipeline_id, created_at`.

- [ ] **Step 1: Write the migration**

```sql
-- ===========================================================================
-- ad_open_day_pipelines — which GHL pipelines feed which open day.
--
-- Spend comes from ad_open_day_campaigns; LEADS come from here. Every Facebook
-- lead reaches this system through GoHighLevel, so the pipeline is the
-- authority on which event a lead belongs to. Measured on live data, 237 of an
-- open day's 432 leads carry no Meta attribution at all and are invisible to a
-- Meta-attributed pool.
--
-- The primary key is the partition guarantee, exactly as on the campaign
-- table: a pipeline belongs to at most ONE open day, so "always-on" is exactly
-- "not mapped to an event".
--
-- integration_account_id is in the key because GHL pipeline ids are unique
-- only within a Location, and the same pipeline NAME exists in several
-- subaccounts ("2. Facebook Ads Leads" appears three times for this org).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.ad_open_day_pipelines (
  organisation_id        uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  open_day_id            uuid NOT NULL,
  integration_account_id uuid NOT NULL,
  ghl_pipeline_id        text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, integration_account_id, ghl_pipeline_id),
  FOREIGN KEY (organisation_id, open_day_id)
    REFERENCES public.ad_open_days (organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ad_open_day_pipelines_event
  ON public.ad_open_day_pipelines (open_day_id);

ALTER TABLE public.ad_open_day_pipelines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_open_day_pipelines FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ad_open_day_pipelines TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply to hosted and verify**

Apply via the Supabase MCP `apply_migration` (name `ad_open_day_pipelines`), then run:

```sql
select c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.tablename='ad_open_day_pipelines') as policies,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('service_role', c.oid, 'INSERT') as service_insert
from pg_class c where c.relname='ad_open_day_pipelines' and c.relnamespace='public'::regnamespace;

select conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid='public.ad_open_day_pipelines'::regclass order by conname;
```

Expected: `rls=true`, `policies=0`, `anon_select=false`, `service_insert=true`, and a `FOREIGN KEY (organisation_id, open_day_id) REFERENCES ad_open_days(organisation_id, id)` plus `PRIMARY KEY (organisation_id, integration_account_id, ghl_pipeline_id)`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101000170_ad_open_day_pipelines.sql
git commit -m "feat(open-days): map GHL pipelines to an open day"
```

---

### Task 2: Pipeline mapping in the repository and service

**Files:**
- Modify: `backend/src/repositories/open-day.repository.js`
- Modify: `backend/src/services/open-day.service.js`
- Test: `backend/test/open-day.repository.test.mjs`

**Interfaces:**
- Consumes: `ad_open_day_pipelines` from Task 1.
- Produces:
  - `openDayRepository.pipelineMappings(orgId) -> Promise<{ openDayId, integrationAccountId, ghlPipelineId }[]>`
  - `openDayRepository.setPipeline(orgId, { integrationAccountId, ghlPipelineId, openDayId }) -> Promise<void>` — `openDayId: null` clears.
  - `openDayService.list(orgId)` gains `pipelineAssignedTo: Record<'accountId|pipelineId', openDayId>`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/open-day.repository.test.mjs`, inside the existing `describe('openDayRepository org scoping')`:

```js
    it('lists only the caller org\'s pipeline mappings', async () => {
        await openDayRepository.pipelineMappings(ORG);
        const q = seen.find((x) => x.table === 'ad_open_day_pipelines');
        expect(orgFilterOf(q)).toBe(ORG);
    });

    it('upserts a pipeline mapping keyed on the account AND the pipeline', async () => {
        await openDayRepository.setPipeline(ORG, {
            integrationAccountId: 'acct-1', ghlPipelineId: 'pipe-1', openDayId: 'e-1',
        });
        const q = seen.find((x) => x.upsertVals);
        expect(q.table).toBe('ad_open_day_pipelines');
        expect(q.upsertVals).toMatchObject({
            organisation_id: ORG, integration_account_id: 'acct-1',
            ghl_pipeline_id: 'pipe-1', open_day_id: 'e-1',
        });
        // GHL pipeline ids are unique only within a Location, so the conflict
        // target must carry the account or two subaccounts collide.
        expect(q.upsertOpts.onConflict)
            .toBe('organisation_id,integration_account_id,ghl_pipeline_id');
    });

    it('clearing a pipeline deletes its row rather than writing a null event', async () => {
        await openDayRepository.setPipeline(ORG, {
            integrationAccountId: 'acct-1', ghlPipelineId: 'pipe-1', openDayId: null,
        });
        const q = seen.find((x) => x.op === 'delete');
        expect(q.table).toBe('ad_open_day_pipelines');
        expect(orgFilterOf(q)).toBe(ORG);
        expect(q.eqs).toEqual(expect.arrayContaining([
            { col: 'integration_account_id', val: 'acct-1' },
            { col: 'ghl_pipeline_id', val: 'pipe-1' },
        ]));
        expect(seen.some((x) => x.upsertVals)).toBe(false);
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/open-day.repository.test.mjs`
Expected: FAIL — `openDayRepository.pipelineMappings is not a function`.

- [ ] **Step 3: Implement**

Add to `backend/src/repositories/open-day.repository.js`, before the closing `};`:

```js
    // pipeline -> event, for every subaccount. Small (one row per mapped
    // pipeline), so it is read whole and joined in memory.
    async pipelineMappings(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('ad_open_day_pipelines')
            .select('open_day_id, integration_account_id, ghl_pipeline_id')
            .eq('organisation_id', orgId);
        if (error) throw new Error(`ad_open_day_pipelines: ${error.message}`);
        return (data ?? []).map((r) => ({
            openDayId: r.open_day_id,
            integrationAccountId: r.integration_account_id,
            ghlPipelineId: String(r.ghl_pipeline_id),
        }));
    },

    // Set or clear ONE pipeline's event.
    //
    // Clearing DELETES rather than writing a null open_day_id: the column is
    // NOT NULL and part of the foreign key, and "no row" is already the
    // representation of always-on. A nullable event id would give the same
    // state two spellings.
    async setPipeline(orgId, { integrationAccountId, ghlPipelineId, openDayId }) {
        if (openDayId == null) {
            const { error } = await supabase_1.serviceClient
                .from('ad_open_day_pipelines')
                .delete()
                .eq('organisation_id', orgId)
                .eq('integration_account_id', integrationAccountId)
                .eq('ghl_pipeline_id', String(ghlPipelineId));
            if (error) throw new Error(`ad_open_day_pipelines delete: ${error.message}`);
            return;
        }
        const { error } = await supabase_1.serviceClient
            .from('ad_open_day_pipelines')
            .upsert({
                organisation_id: orgId,
                open_day_id: openDayId,
                integration_account_id: integrationAccountId,
                ghl_pipeline_id: String(ghlPipelineId),
            }, { onConflict: 'organisation_id,integration_account_id,ghl_pipeline_id' });
        if (error) throw new Error(`ad_open_day_pipelines upsert: ${error.message}`);
    },
```

In `backend/src/services/open-day.service.js`, extend `list`:

```js
    async list(orgId) {
        const [events, mappings, campaigns, pipelineMappings] = await Promise.all([
            openDayRepository.list(orgId),
            openDayRepository.mappings(orgId, PROVIDER),
            marketingRepository.campaignCatalogue(orgId, PROVIDER),
            openDayRepository.pipelineMappings(orgId),
        ]);
        const byEvent = new Map();
        for (const m of mappings) {
            if (!byEvent.has(m.openDayId)) byEvent.set(m.openDayId, []);
            byEvent.get(m.openDayId).push(m.campaignId);
        }
        const assignedTo = Object.fromEntries(
            mappings.map((m) => [m.campaignId, m.openDayId]),
        );
        // Keyed accountId|pipelineId because a bare pipeline id collides
        // across subaccounts.
        const pipelineAssignedTo = Object.fromEntries(
            pipelineMappings.map((m) => [
                `${m.integrationAccountId}|${m.ghlPipelineId}`, m.openDayId,
            ]),
        );
        return {
            openDays: events.map((e) => ({ ...e, campaignIds: byEvent.get(e.id) ?? [] })),
            campaigns,
            assignedTo,
            pipelineAssignedTo,
        };
    },

    async setPipeline(orgId, args) {
        await openDayRepository.setPipeline(orgId, args);
        return { ok: true };
    },
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && npx vitest run test/open-day.repository.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/open-day.repository.js backend/src/services/open-day.service.js backend/test/open-day.repository.test.mjs
git commit -m "feat(open-days): read and write pipeline mappings"
```

---

### Task 3: Rewrite `ad_meta_lead_ledger` on the GHL pool

**Files:**
- Create: `supabase/migrations/20260101000171_meta_ledger_ghl_pool.sql`

**Interfaces:**
- Consumes: `ad_open_day_pipelines` (Task 1), `ad_channel_pipelines`, `ad_lead_conversions`.
- Produces: `ad_meta_lead_ledger(p_org uuid, p_since timestamptz, p_until timestamptz, p_min_paid_pence integer DEFAULT 4000)` returning the previous columns **plus** `open_day_id uuid` and `meta_attributed boolean`.

- [ ] **Step 1: Write the migration**

```sql
-- ===========================================================================
-- ad_meta_lead_ledger v2 — GoHighLevel is the source of truth for leads.
--
-- v1 (000167) identified a Meta lead by its ad_id resolving to a Meta campaign,
-- which made META the arbiter of which leads exist. Every Facebook lead reaches
-- this system through GHL; Meta supplies spend, impressions and clicks and
-- nothing else. The Google ledger (000158) already takes its pool from
-- ad_channel_pipelines; this brings Facebook into line.
--
-- Measured, Plan4growth, Jun-Aug 2026, switching the pool:
--   +346 leads in meta_ads pipelines that Meta never attributed (invisible before)
--   -212 Meta-attributed leads whose pipeline nobody has categorised
-- The second number is a mapping gap the report NAMES rather than swallows.
--
-- POOL = leads whose pipeline is mapped channel='meta_ads' (always-on) OR
-- mapped to an open day. An open-day pipeline counts WITHOUT a channel
-- mapping, so a half-finished mapping still reports correctly.
--
-- A lead's CAMPAIGN still comes from its ad_id. That is what ties it to a
-- campaign/ad set/ad row; a lead without one lands in the visible
-- "Not attributed" bucket rather than being dropped.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.ad_meta_lead_ledger(uuid, timestamptz, timestamptz, integer);

CREATE FUNCTION public.ad_meta_lead_ledger(
  p_org uuid, p_since timestamptz, p_until timestamptz,
  p_min_paid_pence integer DEFAULT 4000
) RETURNS TABLE (
  contact_id uuid, practice_id uuid, practice_name text,
  campaign_id text, campaign_name text, ad_set_id text, ad_id text,
  lead_at timestamptz, name text, email text, treatment text,
  booked boolean, accepted boolean, is_new_patient boolean, paid_pence bigint,
  open_day_id uuid, meta_attributed boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    WITH first_lead AS (
      -- One row per contact, its FIRST lead in the window. Matches
      -- ad_lead_conversions' own DISTINCT ON (contact) ORDER BY created_at, so
      -- the pipeline we read is the pipeline that funnel used.
      SELECT DISTINCT ON (l.contact_id)
             l.contact_id, l.integration_account_id, l.ghl_pipeline_id, l.created_at
        FROM leads l
       WHERE l.organisation_id = $1
         AND l.created_at >= $2 AND l.created_at < $3
       ORDER BY l.contact_id, l.created_at
    ),
    pooled AS (
      SELECT fl.contact_id, fl.created_at, odp.open_day_id
        FROM first_lead fl
        LEFT JOIN ad_open_day_pipelines odp
          ON odp.organisation_id = $1
         AND odp.integration_account_id = fl.integration_account_id
         AND odp.ghl_pipeline_id = fl.ghl_pipeline_id
        LEFT JOIN ad_channel_pipelines acp
          ON acp.organisation_id = $1
         AND acp.integration_account_id = fl.integration_account_id
         AND acp.ghl_pipeline_id = fl.ghl_pipeline_id
       WHERE odp.open_day_id IS NOT NULL OR acp.channel = 'meta_ads'
    ),
    funnel AS (
      SELECT f.* FROM ad_lead_conversions($1, $2, $3, NULL) f
    ),
    paid AS (
      SELECT p.contact_id, sum(pm.amount_pence)::bigint AS paid_pence
        FROM pooled p
        JOIN funnel f ON f.contact_id = p.contact_id
        JOIN payments pm
          ON pm.organisation_id = $1
         AND pm.contact_id = f.patient_contact
         AND pm.status = 'settled'
         AND pm.processed_at >= london_day_start(p.created_at)
       GROUP BY p.contact_id
    ),
    main_treatment AS (
      SELECT DISTINCT ON (p.contact_id) p.contact_id, ii.treatment_name
        FROM pooled p
        JOIN funnel f ON f.contact_id = p.contact_id
        JOIN invoice_items ii
          ON ii.organisation_id = $1
         AND ii.contact_id = f.patient_contact
         AND ii.treatment_plan_id IS NOT NULL
         AND ii.invoiced_on >= london_day(p.created_at)
       ORDER BY p.contact_id, ii.fee_pence DESC NULLS LAST, ii.invoiced_on, ii.id
    ),
    ad_parent AS (
      SELECT DISTINCT ON (entity_id) entity_id, parent_id
        FROM ad_meta_ads WHERE organisation_id = $1
       ORDER BY entity_id, metric_date DESC
    ),
    campaign_names AS (
      SELECT DISTINCT ON (m.campaign_id) m.campaign_id, m.campaign_name
        FROM ad_metrics m
       WHERE m.organisation_id = $1 AND m.provider = 'meta_ads'
         AND m.campaign_id IS NOT NULL
       ORDER BY m.campaign_id, m.metric_date DESC
    )
    SELECT p.contact_id,
           f.practice_id,
           pr.name AS practice_name,
           c.ad_campaign_id AS campaign_id,
           cn.campaign_name,
           ap.parent_id AS ad_set_id,
           c.ad_id,
           p.created_at AS lead_at,
           nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') AS name,
           c.email,
           mt.treatment_name AS treatment,
           (f.booked_at IS NOT NULL) AS booked,
           (coalesce(pd.paid_pence, 0) > $4::bigint) AS accepted,
           coalesce(f.is_new_patient, false) AS is_new_patient,
           coalesce(pd.paid_pence, 0)::bigint AS paid_pence,
           p.open_day_id,
           -- Whether META can account for this lead. Not a filter any more —
           -- a column, so the report can state how much of a cost figure
           -- rests on leads the ads cannot be shown to have bought.
           (cn.campaign_id IS NOT NULL) AS meta_attributed
      FROM pooled p
      LEFT JOIN funnel f          ON f.contact_id = p.contact_id
      LEFT JOIN contacts c        ON c.id = p.contact_id AND c.organisation_id = $1
      LEFT JOIN practices pr      ON pr.id = f.practice_id AND pr.organisation_id = $1
      LEFT JOIN paid pd           ON pd.contact_id = p.contact_id
      LEFT JOIN main_treatment mt ON mt.contact_id = p.contact_id
      LEFT JOIN ad_parent ap      ON ap.entity_id = c.ad_id
      LEFT JOIN campaign_names cn ON cn.campaign_id = c.ad_campaign_id
  $q$ USING p_org, p_since, p_until, p_min_paid_pence;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_meta_lead_ledger(uuid, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_meta_lead_ledger(uuid, timestamptz, timestamptz, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply to hosted and verify against the measured figures**

Apply via `apply_migration` (name `meta_ledger_ghl_pool`), then run:

```sql
select count(*) as leads,
       count(*) filter (where meta_attributed) as attributed,
       count(*) filter (where open_day_id is not null) as open_day_leads,
       count(*) filter (where booked) as booked,
       count(*) filter (where accepted) as accepted
from ad_meta_lead_ledger('1a5f888a-0dfe-4802-acf8-6003665089ad'::uuid,
  '2026-06-01T00:00:00+01'::timestamptz, '2026-09-01T00:00:00+01'::timestamptz);
```

Expected: `leads = 1843` (contacts whose FIRST lead sits in a meta_ads pipeline — no open-day pipelines are mapped yet, so `open_day_leads = 0`), `attributed = 1497`. If `leads` comes back 1709 the pool is still the old ad_id test; if 3325 the `WHERE` lost its pipeline predicate; if 3753 it also lost the DISTINCT ON.

Also confirm isolation and grants:

```sql
select (select count(*) from ad_meta_lead_ledger('d3256296-afde-4aec-a87b-db3304c1c8d5'::uuid,
          '2026-06-01T00:00:00+01'::timestamptz,'2026-09-01T00:00:00+01'::timestamptz)) as other_org,
       has_function_privilege('anon','public.ad_meta_lead_ledger(uuid,timestamptz,timestamptz,integer)','EXECUTE') as anon,
       has_function_privilege('service_role','public.ad_meta_lead_ledger(uuid,timestamptz,timestamptz,integer)','EXECUTE') as service;
```

Expected: `other_org = 0`, `anon = false`, `service = true`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101000171_meta_ledger_ghl_pool.sql
git commit -m "feat(marketing): Facebook leads come from GHL pipelines, not Meta attribution"
```

---

### Task 4: Rework `splitByOpenDay` — spend by campaign, leads by pipeline

**Files:**
- Modify: `backend/src/lib/marketing/open-days.js`
- Modify: `backend/test/open-day-split.test.mjs`

**Interfaces:**
- Consumes: campaign rows from `campaignLeadPerformance`, ledger rows from Task 3 (carrying `open_day_id`, `meta_attributed`).
- Produces: `splitByOpenDay(campaignRows, ledgerRows, events, { keepEmpty }) -> { alwaysOn, openDays, events[] }` where every bucket carries `spendPence, impressions, clicks, conversions, leads, attributedLeads, booked, accepted, paidPence` plus the cost fields, and each event row carries `openDayId, name, eventDate, campaigns`.

The signature **changes**: v1 took `(campaignRows, eventByCampaign, opts)`. Spend still comes from campaigns, but leads now come from the ledger's own `open_day_id`, so the function needs both row sets.

- [ ] **Step 1: Rewrite the tests**

Replace the whole body of `backend/test/open-day-split.test.mjs` after the imports:

```js
const campaign = (id, over = {}) => ({
    campaignId: id, campaignName: `Campaign ${id}`, attributed: true,
    spendPence: 0, impressions: 0, clicks: 0, conversions: 0,
    leads: 0, booked: 0, accepted: 0, paidPence: 0,
    ...over,
});

const lead = (over = {}) => ({
    open_day_id: null, meta_attributed: true,
    booked: false, accepted: false, is_new_patient: true, paid_pence: 0,
    ...over,
});

const EVENTS = [
    { id: 'e-july', name: 'July 26', eventDate: '2026-07-15' },
    { id: 'e-april', name: 'April 26', eventDate: '2026-04-18' },
];

describe('splitByOpenDay', () => {
    it('splits spend by campaign and leads by the pipeline the lead came through', () => {
        const campaigns = [
            campaign('c1', { spendPence: 40000 }),
            campaign('c2', { spendPence: 60000 }),
        ];
        const leads = [
            lead({ open_day_id: 'e-july', booked: true, accepted: true, paid_pence: 9000 }),
            lead({ open_day_id: 'e-july' }),
            lead({}),
        ];
        const out = splitByOpenDay(campaigns, leads, EVENTS, {
            eventByCampaign: new Map([['c1', EVENTS[0]]]),
        });
        expect(out.openDays).toMatchObject({ spendPence: 40000, leads: 2, booked: 1, accepted: 1 });
        expect(out.alwaysOn).toMatchObject({ spendPence: 60000, leads: 1, booked: 0, accepted: 0 });
        expect(out.events[0]).toMatchObject({ name: 'July 26', spendPence: 40000, leads: 2 });
    });

    it('partitions: always-on plus open days equals the whole, metric for metric', () => {
        const campaigns = [
            campaign('c1', { spendPence: 1234, impressions: 90, clicks: 9 }),
            campaign('c2', { spendPence: 5678, impressions: 80, clicks: 8 }),
        ];
        const leads = [
            lead({ open_day_id: 'e-july', booked: true, accepted: true, paid_pence: 500 }),
            lead({ open_day_id: 'e-april', booked: true }),
            lead({ meta_attributed: false }),
            lead({}),
        ];
        const out = splitByOpenDay(campaigns, leads, EVENTS, {
            eventByCampaign: new Map([['c2', EVENTS[0]]]),
        });
        // Spend metrics must sum to the CAMPAIGN rows.
        for (const k of ['spendPence', 'impressions', 'clicks']) {
            expect(out.alwaysOn[k] + out.openDays[k], k)
                .toBe(campaigns.reduce((a, c) => a + c[k], 0));
        }
        // Lead metrics must sum to the LEDGER rows — a different source, which
        // is the whole point of the rework and the thing a single loop over
        // both would have quietly stopped checking.
        expect(out.alwaysOn.leads + out.openDays.leads).toBe(leads.length);
        expect(out.alwaysOn.attributedLeads + out.openDays.attributedLeads)
            .toBe(leads.filter((l) => l.meta_attributed).length);
        expect(out.alwaysOn.booked + out.openDays.booked)
            .toBe(leads.filter((l) => l.booked).length);
    });

    it('counts a lead Meta could not account for, and says so separately', () => {
        const out = splitByOpenDay([], [
            lead({ open_day_id: 'e-july', meta_attributed: false }),
            lead({ open_day_id: 'e-july', meta_attributed: true }),
        ], EVENTS, { eventByCampaign: new Map() });
        expect(out.openDays).toMatchObject({ leads: 2, attributedLeads: 1 });
    });

    it('recomputes each bucket\'s costs from its own totals, never by averaging', () => {
        const out = splitByOpenDay(
            [campaign('c1', { spendPence: 100000 })],
            [lead({ open_day_id: 'e-july', booked: true, accepted: true }),
             lead({ open_day_id: 'e-july' }),
             lead({ open_day_id: 'e-july' }),
             lead({ open_day_id: 'e-july' })],
            EVENTS,
            { eventByCampaign: new Map([['c1', EVENTS[0]]]) },
        );
        expect(out.events[0].cplPence).toBe(25000);   // £1000 / 4
        expect(out.events[0].cpaPence).toBe(100000);  // £1000 / 1
        expect(out.alwaysOn.cpbPence).toBeNull();     // a cost per nothing is unknowable
    });

    it('keeps an event that produced leads but spent nothing this window', () => {
        const out = splitByOpenDay([], [lead({ open_day_id: 'e-april' })], EVENTS, {
            eventByCampaign: new Map(),
        });
        expect(out.events.map((e) => e.name)).toEqual(['April 26']);
        expect(out.events[0]).toMatchObject({ spendPence: 0, leads: 1 });
        expect(out.events[0].cplPence).toBeNull();    // no spend: not "free leads"
    });

    it('keeps an event that spent but produced no leads', () => {
        const out = splitByOpenDay([campaign('c1', { spendPence: 5000 })], [], EVENTS, {
            eventByCampaign: new Map([['c1', EVENTS[0]]]),
        });
        expect(out.events.map((e) => e.name)).toEqual(['July 26']);
        expect(out.events[0]).toMatchObject({ spendPence: 5000, leads: 0 });
    });

    it('omits an event with neither spend nor leads in this window', () => {
        const out = splitByOpenDay([], [], EVENTS, { eventByCampaign: new Map() });
        expect(out.events).toEqual([]);
    });

    it('leaves an org that has mapped nothing exactly as it was', () => {
        const out = splitByOpenDay(
            [campaign('c1', { spendPence: 30000 })],
            [lead({}), lead({ booked: true })],
            [],
            { eventByCampaign: new Map() },
        );
        expect(out.events).toEqual([]);
        expect(out.openDays).toMatchObject({ spendPence: 0, leads: 0 });
        expect(out.alwaysOn).toMatchObject({ spendPence: 30000, leads: 2, booked: 1 });
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/open-day-split.test.mjs`
Expected: FAIL — the new signature is not implemented, so `out.openDays.leads` is 0 and `attributedLeads` is undefined.

- [ ] **Step 3: Rewrite the implementation**

Replace the body of `backend/src/lib/marketing/open-days.js` below the header comment:

```js
import { withLeadCosts } from './lead-performance.js';

// Spend-side columns come from campaign rows; lead-side columns from ledger
// rows. They are separate on purpose: since 000171 a lead's event comes from
// its GHL PIPELINE while spend's event comes from its META CAMPAIGN, and
// deriving one from the other is what would put a lead in the wrong bucket.
const SPEND_METRICS = ['spendPence', 'impressions', 'clicks', 'conversions'];
const LEAD_METRICS = ['leads', 'attributedLeads', 'booked', 'accepted', 'paidPence'];

function emptyBucket() {
    return Object.fromEntries([...SPEND_METRICS, ...LEAD_METRICS].map((k) => [k, 0]));
}

function addSpend(target, row) {
    for (const k of SPEND_METRICS) target[k] += Number(row[k] ?? 0);
}

function addLead(target, row) {
    target.leads += 1;
    if (row.meta_attributed) target.attributedLeads += 1;
    if (row.booked) target.booked += 1;
    if (row.accepted) target.accepted += 1;
    target.paidPence += Number(row.paid_pence ?? 0);
}

/**
 * @param campaignRows    campaignLeadPerformance() output — the SPEND side.
 * @param ledgerRows      ad_meta_lead_ledger rows — the LEAD side. Each row's
 *                        `open_day_id` is its event, from its pipeline.
 * @param events          [{ id, name, eventDate }] for the org.
 * @param eventByCampaign Map<campaignId, { id }> — which event owns each
 *                        campaign's SPEND.
 * @param keepEmpty       include events with neither spend nor leads.
 */
export function splitByOpenDay(campaignRows, ledgerRows, events, {
    eventByCampaign = new Map(), keepEmpty = false,
} = {}) {
    const alwaysOn = emptyBucket();
    const openDays = emptyBucket();
    const byEvent = new Map();

    const bucketFor = (event) => {
        let b = byEvent.get(event.id);
        if (!b) {
            b = {
                openDayId: event.id,
                name: event.name ?? null,
                eventDate: event.eventDate ?? null,
                campaigns: 0,
                ...emptyBucket(),
            };
            byEvent.set(event.id, b);
        }
        return b;
    };
    for (const e of events ?? []) bucketFor(e);

    for (const row of campaignRows ?? []) {
        const event = eventByCampaign.get(row.campaignId);
        if (!event) { addSpend(alwaysOn, row); continue; }
        addSpend(openDays, row);
        const b = bucketFor(event);
        b.campaigns += 1;
        addSpend(b, row);
    }

    for (const row of ledgerRows ?? []) {
        const id = row.open_day_id ?? null;
        if (!id || !byEvent.has(id)) { addLead(alwaysOn, row); continue; }
        addLead(openDays, row);
        addLead(byEvent.get(id), row);
    }

    const out = [...byEvent.values()]
        .filter((e) => keepEmpty || e.spendPence > 0 || e.leads > 0)
        // Newest first. An undated event sorts LAST rather than being dropped
        // or treated as 1970 — the date is optional on purpose.
        .sort((a, b) => {
            if (a.eventDate === b.eventDate) return String(a.name).localeCompare(String(b.name));
            if (!a.eventDate) return 1;
            if (!b.eventDate) return -1;
            return a.eventDate < b.eventDate ? 1 : -1;
        })
        .map(withLeadCosts);

    return {
        alwaysOn: withLeadCosts(alwaysOn),
        openDays: withLeadCosts(openDays),
        events: out,
    };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && npx vitest run test/open-day-split.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/marketing/open-days.js backend/test/open-day-split.test.mjs
git commit -m "feat(open-days): split spend by campaign and leads by pipeline"
```

---

### Task 5: Wire the service, and publish coverage

**Files:**
- Modify: `backend/src/services/facebook-report.service.js`
- Modify: `backend/src/repositories/marketing.repository.js`
- Test: `backend/test/facebook-lead-performance.test.mjs`

**Interfaces:**
- Consumes: Task 3's ledger columns, Task 4's `splitByOpenDay`.
- Produces: `leadPerformance()` gains `coverage: { uncategorisedLeads, uncategorisedAttributedLeads }` and its `openDays`/`openDaysAll` now come from the new split. `marketingRepository.metaLeadLedger` passes through `open_day_id` and `meta_attributed`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/facebook-lead-performance.test.mjs`:

```js
describe('facebookReportService.leadPerformance — GHL pool and coverage', () => {
    it('buckets a lead by its own open_day_id, not by its campaign', async () => {
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P1, practice_name: 'Rochester', spend_pence: 100000, impressions: 1, clicks: 1 },
        ]);
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'c1', campaign_name: 'Always On', spend_pence: 100000, impressions: 1, clicks: 1, conversions: 0 },
        ]);
        // Attributed to an ALWAYS-ON campaign, but arrived through an
        // open-day pipeline: the pipeline wins.
        marketingRepository.metaLeadLedger.mockResolvedValue([
            ledgerRow({ campaign_id: 'c1', open_day_id: 'e1', meta_attributed: true }),
        ]);
        openDayRepository.list.mockResolvedValue([{ id: 'e1', name: 'July 26', eventDate: '2026-07-15' }]);
        openDayRepository.mappings.mockResolvedValue([]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.openDays.openDays.leads).toBe(1);
        expect(out.openDays.alwaysOn.leads).toBe(0);
        // Its SPEND is still always-on: no campaign is mapped to the event.
        expect(out.openDays.alwaysOn.spendPence).toBe(100000);
    });

    it('publishes how many leads sit in pipelines nobody has categorised', async () => {
        marketingRepository.uncategorisedLeadCounts.mockResolvedValue({
            leads: 1251, attributed: 209,
        });
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.coverage).toEqual({
            uncategorisedLeads: 1251, uncategorisedAttributedLeads: 209,
        });
    });

    // The spec's requirement: an org with nothing mapped must get an empty
    // report that says WHY, not a zeroed one that looks healthy.
    it('an org with no categorised pipelines reports zero leads and names the reason', async () => {
        marketingRepository.metaLeadLedger.mockResolvedValue([]);
        marketingRepository.uncategorisedLeadCounts.mockResolvedValue({
            leads: 640, attributed: 91,
        });
        marketingRepository.adSpendByPractice.mockResolvedValue([
            { practice_id: P1, practice_name: 'Rochester', spend_pence: 50000, impressions: 1, clicks: 1 },
        ]);
        const out = await facebookReportService.leadPerformance(ORG, WIN);
        expect(out.total.leads).toBe(0);
        // Spend with no leads is a real state, so the cost is unknowable, not free.
        expect(out.total.cplPence).toBeNull();
        expect(out.coverage.uncategorisedLeads).toBe(640);
    });
});
```

Add `uncategorisedLeadCounts: vi.fn(() => Promise.resolve({ leads: 0, attributed: 0 }))` to the `marketingRepository` mock at the top of the file, and `open_day_id: null, meta_attributed: true` to the `ledgerRow` factory's defaults.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/facebook-lead-performance.test.mjs`
Expected: FAIL — `out.coverage` is undefined.

- [ ] **Step 3: Implement**

In `backend/src/repositories/marketing.repository.js`, add `open_day_id` and `meta_attributed` to `metaLeadLedger`'s row mapping:

```js
            paid_pence: Number(r.paid_pence ?? 0),
            // Which open day this lead's PIPELINE belongs to (000171). Null is
            // always-on and is the common case.
            open_day_id: r.open_day_id ?? null,
            // Whether Meta can account for this lead. A column, not a filter:
            // the report states how much of a cost figure rests on leads the
            // ads cannot be shown to have bought.
            meta_attributed: Boolean(r.meta_attributed),
```

and add a new method beside it:

```js
    // Leads in pipelines nobody has categorised — the honest home for the
    // leads the GHL pool leaves out. Aggregated in SQL: PostgREST truncates a
    // table read at 1000 rows in silence and this counts thousands.
    async uncategorisedLeadCounts(orgId, since, until) {
        const { data, error } = await supabase_1.serviceClient
            .rpc('ad_uncategorised_lead_counts', {
                p_org: orgId, p_since: since, p_until: until,
            });
        if (error) throw new Error(`ad_uncategorised_lead_counts: ${error.message}`);
        const row = Array.isArray(data) ? data[0] : data;
        return {
            leads: Number(row?.leads ?? 0),
            attributed: Number(row?.attributed ?? 0),
        };
    },
```

In `backend/src/services/facebook-report.service.js`, change the split call and add coverage. Replace the open-days block introduced earlier with:

```js
        const eventByCampaign = new Map();
        for (const m of openDayMappings) {
            const event = openDayEvents.find((e) => e.id === m.openDayId);
            if (event) eventByCampaign.set(m.campaignId, event);
        }
        const splitOf = (campaignRows, rows) => {
            const split = splitByOpenDay(campaignRows, rows, openDayEvents, { eventByCampaign });
            return {
                ...split,
                events: split.events.map((e) => ({
                    ...e,
                    practices: practicesByEvent.get(e.openDayId)?.size ?? 0,
                })),
            };
        };
```

and in the returned object:

```js
            openDays: splitOf(campaigns, ledgerRows),
            openDaysAll: splitOf(campaignsAll, ledgerRows.filter(() => true)),
            coverage: {
                uncategorisedLeads: uncategorised.leads,
                uncategorisedAttributedLeads: uncategorised.attributed,
            },
```

adding `marketingRepository.uncategorisedLeadCounts(orgId, rawSince, funnelUntil(rawUntil))` to the existing `Promise.all`, destructured as `uncategorised`. Add the same `coverage` shape, zeroed, to the `empty()` helper.

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && npx vitest run test/facebook-lead-performance.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add the coverage RPC migration**

Create `supabase/migrations/20260101000172_uncategorised_lead_counts.sql`:

```sql
-- Leads whose GHL pipeline has no channel and no open day. The report states
-- this instead of silently dropping them: switching the Facebook pool to the
-- GHL mapping leaves 212 Meta-attributed leads out for this org today, and a
-- number nobody can see is a number nobody will fix.
DROP FUNCTION IF EXISTS public.ad_uncategorised_lead_counts(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.ad_uncategorised_lead_counts(
  p_org uuid, p_since timestamptz, p_until timestamptz
) RETURNS TABLE (leads bigint, attributed bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY EXECUTE $q$
    WITH first_lead AS (
      SELECT DISTINCT ON (l.contact_id)
             l.contact_id, l.integration_account_id, l.ghl_pipeline_id
        FROM leads l
       WHERE l.organisation_id = $1 AND l.created_at >= $2 AND l.created_at < $3
       ORDER BY l.contact_id, l.created_at
    )
    SELECT count(*)::bigint,
           count(*) FILTER (WHERE c.ad_campaign_id IN (
             SELECT m.campaign_id FROM ad_metrics m
              WHERE m.organisation_id = $1 AND m.provider = 'meta_ads'
                AND m.campaign_id IS NOT NULL))::bigint
      FROM first_lead fl
      LEFT JOIN contacts c ON c.id = fl.contact_id AND c.organisation_id = $1
      LEFT JOIN ad_channel_pipelines acp
        ON acp.organisation_id = $1
       AND acp.integration_account_id = fl.integration_account_id
       AND acp.ghl_pipeline_id = fl.ghl_pipeline_id
      LEFT JOIN ad_open_day_pipelines odp
        ON odp.organisation_id = $1
       AND odp.integration_account_id = fl.integration_account_id
       AND odp.ghl_pipeline_id = fl.ghl_pipeline_id
     WHERE acp.channel IS NULL AND odp.open_day_id IS NULL
  $q$ USING p_org, p_since, p_until;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ad_uncategorised_lead_counts(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_uncategorised_lead_counts(uuid, timestamptz, timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';
```

Apply it, then verify:

```sql
select * from ad_uncategorised_lead_counts('1a5f888a-0dfe-4802-acf8-6003665089ad'::uuid,
  '2026-06-01T00:00:00+01'::timestamptz, '2026-09-01T00:00:00+01'::timestamptz);
```

Expected: `leads = 1251`, `attributed = 209`.

- [ ] **Step 6: Run the whole backend suite and commit**

Run: `cd backend && npm test && npm run lint`
Expected: all green, 0 lint errors.

```bash
git add backend/src/services/facebook-report.service.js backend/src/repositories/marketing.repository.js backend/test/facebook-lead-performance.test.mjs supabase/migrations/20260101000172_uncategorised_lead_counts.sql
git commit -m "feat(marketing): bucket leads by pipeline and publish mapping coverage"
```

---

### Task 6: Routes and the gate change

**Files:**
- Modify: `backend/src/middleware/agency.js`
- Modify: `backend/src/routes/ad-attribution.routes.js:21`
- Modify: `backend/src/routes/marketing.routes.js`
- Modify: `backend/src/controllers/open-day.controller.js`
- Test: `backend/test/open-day.routes.test.mjs`

**Interfaces:**
- Produces: `requireOwnerOrAgencyActor` middleware; `PUT /api/marketing/facebook/open-days/pipelines` accepting `{ integrationAccountId, ghlPipelineId, openDayId }`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/open-day.routes.test.mjs`:

```js
describe('pipeline mapping gate', () => {
    it('lets a tenant owner map a pipeline, and an agency actor who is not an owner', async () => {
        const { requireOwnerOrAgencyActor } = await import('../src/middleware/agency.js');
        const run = (user) => new Promise((resolve) => {
            const res = { status() { return this; }, json() { resolve({ blocked: true }); return this; } };
            requireOwnerOrAgencyActor({ user }, res, () => resolve({ blocked: false }));
        });
        await expect(run({ role: 'owner', organisation_id: 'o' })).resolves.toMatchObject({ blocked: false });
        await expect(run({ role: 'practice_manager', organisation_id: 'o', is_agency_admin: true }))
            .resolves.toMatchObject({ blocked: false });
        await expect(run({ role: 'practice_manager', organisation_id: 'o' }))
            .resolves.toMatchObject({ blocked: true });
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run test/open-day.routes.test.mjs`
Expected: FAIL — `requireOwnerOrAgencyActor` is not exported.

- [ ] **Step 3: Implement**

Add to `backend/src/middleware/agency.js`, after the existing exports:

```js
// Mapping a GHL pipeline is the one mapping a TENANT may do: an open day is
// their own event and waiting on their agency to categorise its pipeline would
// make the monthly routine unusable. Owner OR agency actor, never owner-only —
// an agency admin need not be an owner of the sub-account they administer.
//
// Subaccount -> practice and ad account -> practice stay requireAgencyActor:
// those decide how an agency's client data is attributed.
export async function requireOwnerOrAgencyActor(req, res, next) {
    if (req.user?.role === 'owner') return next();
    try {
        if (await isAgencyActor(req)) return next();
    } catch (err) {
        req.log?.warn({ err }, 'pipeline mapping gate lookup failed');
    }
    return res.status(403).json({ error: 'Owner or agency access required', code: 'OWNER_OR_AGENCY' });
}
```

In `backend/src/routes/ad-attribution.routes.js`, change line 21's gate from `requireAgencyActor` to `requireOwnerOrAgencyActor` and update the import.

In `backend/src/controllers/open-day.controller.js`, add:

```js
const pipelineSchema = zod_1.z.object({
    integrationAccountId: zod_1.z.string().uuid(),
    ghlPipelineId: zod_1.z.string().min(1),
    // null clears the mapping — "always-on" has exactly one representation.
    openDayId: zod_1.z.string().uuid().nullable(),
});
```

and a handler:

```js
    async setPipeline(req, res, next) {
        try {
            const body = pipelineSchema.parse(req.body);
            res.json(await openDayService.setPipeline(req.user.organisation_id, body));
        } catch (err) { next(err); }
    },
```

In `backend/src/routes/marketing.routes.js`, beside the other open-day routes:

```js
router.put('/facebook/open-days/pipelines', requireOwnerOrAgencyActor, openDayController.setPipeline);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run test/open-day.routes.test.mjs && npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/agency.js backend/src/routes/ad-attribution.routes.js backend/src/routes/marketing.routes.js backend/src/controllers/open-day.controller.js backend/test/open-day.routes.test.mjs
git commit -m "feat(open-days): owners may map their own pipelines"
```

---

### Task 7: Pipeline mapping gains an open-day column, mounted on Integrations

**Files:**
- Modify: `frontend/features/ad-attribution/api.ts`
- Modify: `frontend/features/ad-attribution/hooks.ts`
- Modify: `frontend/features/ad-attribution/components/PipelineChannelStep.tsx`
- Modify: `frontend/features/system/components/IntegrationsScreen.tsx`

**Interfaces:**
- Consumes: Task 6's `PUT /api/marketing/facebook/open-days/pipelines`; Task 2's `pipelineAssignedTo`.
- Produces: `PipelineChannelStep` accepting `openDays: { id, name }[]` and `assignedTo: Record<string, string>`.

- [ ] **Step 1: Add the API call and hook**

In `frontend/features/marketing/facebook/api.ts`:

```ts
export function setOpenDayPipeline(body: {
  integrationAccountId: string; ghlPipelineId: string; openDayId: string | null;
}) {
  return api('/api/marketing/facebook/open-days/pipelines', {
    method: 'PUT', body: JSON.stringify(body),
  });
}
```

In `frontend/features/marketing/facebook/hooks.ts`, beside the other open-day mutations:

```ts
export function useSetOpenDayPipeline() {
  return useOpenDayMutation((a: {
    integrationAccountId: string; ghlPipelineId: string; openDayId: string | null;
  }) => setOpenDayPipeline(a));
}
```

Add `setOpenDayPipeline` to that file's import list from `./api`.

- [ ] **Step 2: Add the column to the step**

In `PipelineChannelStep.tsx`, add to the component's props:

```tsx
  openDays?: { id: string; name: string }[];
  /** `${accountId}|${pipelineId}` -> open day id. */
  openDayAssignedTo?: Record<string, string>;
```

and render, in each pipeline row after the channel buttons — only when that row's channel is Facebook, because an open day is a Facebook concept here and offering it on a Google row would invite a mapping that reports nothing:

```tsx
{row.channel === 'meta_ads' && (openDays?.length ?? 0) > 0 && (
  <select
    className="rounded-panel border border-border bg-white px-2 py-1 text-[12.5px] text-ink"
    value={openDayAssignedTo?.[pipelineKey(row.accountId, row.pipelineId)] ?? ''}
    onChange={(e) => setPipeline.mutate({
      integrationAccountId: row.accountId,
      ghlPipelineId: row.pipelineId,
      openDayId: e.target.value || null,
    })}
  >
    <option value="">Always-on</option>
    {openDays.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
  </select>
)}
```

with `const setPipeline = useSetOpenDayPipeline();` at the top of the component.

- [ ] **Step 3: Mount it in the GoHighLevel tile**

In `frontend/features/system/components/IntegrationsScreen.tsx`, inside the GoHighLevel tile's `body` (currently `<GoHighLevelPanel />`):

```tsx
        body: ghlPanelVisible ? (
          <>
            <GoHighLevelPanel />
            {/* Pipeline categorisation lives here, beside the connection it
                describes, as well as on Settings -> Ad attribution. The SAME
                component, not a copy: two screens editing one mapping drift. */}
            <PipelineChannelStep
              config={adAttributionConfig}
              openDays={openDayList}
              openDayAssignedTo={openDayPipelineMap}
            />
          </>
        ) : undefined,
```

sourcing `adAttributionConfig` from `useAdAttributionConfig()` and `openDayList` / `openDayPipelineMap` from `useOpenDays()` (`data.openDays`, `data.pipelineAssignedTo`).

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/ad-attribution frontend/features/marketing/facebook frontend/features/system/components/IntegrationsScreen.tsx
git commit -m "feat(open-days): categorise pipelines from the GoHighLevel tile"
```

---

### Task 8: The Open days tab

**Files:**
- Create: `frontend/features/marketing/facebook/components/FacebookOpenDaysTab.tsx`
- Modify: `frontend/features/marketing/facebook/components/FacebookReportScreen.tsx`

**Interfaces:**
- Consumes: `useFacebookLeadPerformance()` → `openDays.events[]` from Task 5.

- [ ] **Step 1: Write the tab**

```tsx
'use client';
// One row per open day. Shown only to tenants that have at least one — an
// always-empty tab is noise for everyone else, which is why the tab itself is
// conditional in FacebookReportScreen rather than this component rendering a
// placeholder.
import { DataGrid, type GridColumn } from '../../_shared/DataGrid';
import { money, money0, num, DASH } from '../../_shared/format';
import { useFacebookLeadPerformance } from '../hooks';
import type { FacebookOpenDayEvent } from '../api';

const COLUMNS: GridColumn<FacebookOpenDayEvent>[] = [
  {
    key: 'event',
    header: 'Open day',
    render: (r) => (
      <div>
        <div>{r.name ?? 'Untitled'}</div>
        <div className="text-[12px] text-ink-2">
          {r.eventDate ?? 'no date'} · {num(r.campaigns)} campaign{r.campaigns === 1 ? '' : 's'}
          {r.practices > 0 ? ` · ${num(r.practices)} practice${r.practices === 1 ? '' : 's'}` : ''}
        </div>
      </div>
    ),
  },
  { key: 'spend', header: 'Spend', align: 'right', render: (r) => money0(r.spendPence) },
  {
    key: 'leads',
    header: 'Leads',
    align: 'right',
    // The denominator AND how much of it Meta can account for, so a reader can
    // see when a cost per lead rests on leads the ads cannot be shown to have
    // bought.
    render: (r) => (
      <div>
        {num(r.leads)}
        <div className="text-[12px] text-ink-2">{num(r.attributedLeads)} attributed</div>
      </div>
    ),
  },
  { key: 'booked', header: 'Booked', align: 'right', render: (r) => num(r.booked) },
  { key: 'patients', header: 'Patients', align: 'right', render: (r) => num(r.accepted) },
  { key: 'cpl', header: 'Cost / lead', align: 'right', render: (r) => money(r.cplPence) },
  { key: 'cpa', header: 'Cost / patient', align: 'right', render: (r) => money(r.cpaPence) },
  { key: 'collected', header: 'Collected', align: 'right', render: (r) => (r.paidPence > 0 ? money0(r.paidPence) : DASH) },
];

export function FacebookOpenDaysTab() {
  const { data } = useFacebookLeadPerformance();
  const events = data?.openDays.events ?? [];
  return (
    <DataGrid
      columns={COLUMNS}
      rows={events}
      rowKey={(r) => r.openDayId}
      emptyState="No open day was active in this period."
    />
  );
}
```

- [ ] **Step 2: Add `attributedLeads` to the payload types**

In `frontend/features/marketing/facebook/api.ts`, add `attributedLeads: number;` to `FacebookOpenDayBucket`.

- [ ] **Step 3: Add the tab conditionally**

In `FacebookReportScreen.tsx`, replace the static `TABS` with:

```tsx
const BASE_TABS: AdReportTab[] = [
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'adsets', label: 'Ad sets' },
  { id: 'ads', label: 'Ads' },
];
```

and inside the component:

```tsx
  const { data: perf } = useFacebookLeadPerformance();
  // Only for tenants that actually run open days. Computed from this tenant's
  // own rows, never assumed.
  const hasOpenDays = (perf?.openDays.events.length ?? 0) > 0;
  const TABS = hasOpenDays
    ? [...BASE_TABS, { id: 'opendays', label: 'Open days' }]
    : BASE_TABS;
```

plus `{tab === 'opendays' && <FacebookOpenDaysTab />}` beside the other tab bodies.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/marketing/facebook
git commit -m "feat(open-days): a tab for tenants that run them"
```

---

### Task 9: "New since you last mapped", with suggestions

**Files:**
- Create: `backend/src/lib/marketing/open-day-suggest.js`
- Create: `backend/test/open-day-suggest.test.mjs`
- Modify: `backend/src/services/open-day.service.js`
- Modify: `frontend/features/integrations/components/OpenDaysPanel.tsx`

**Interfaces:**
- Produces: `suggestOpenDay(name, events) -> string | null` (an event id, or null).

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
const { suggestOpenDay } = await import('../src/lib/marketing/open-day-suggest.js');

const EVENTS = [
    { id: 'e-jul', name: 'July 26', eventDate: '2026-07-15' },
    { id: 'e-oct', name: 'October 26', eventDate: '2026-10-12' },
];

describe('suggestOpenDay', () => {
    it('suggests nothing for a name that does not mention an open day', () => {
        expect(suggestOpenDay('Mint: Retargeting LF - £10/day', EVENTS)).toBeNull();
    });

    it('matches an event whose month and year appear in the name', () => {
        expect(suggestOpenDay('Mint: Implants Open Day LF July 26', EVENTS)).toBe('e-jul');
        expect(suggestOpenDay('3. Dental Implants Open Day (12 Oct 2026)', EVENTS)).toBe('e-oct');
    });

    it('tolerates the naming this org actually uses', () => {
        expect(suggestOpenDay('Mint: Cosmetic Open Day LF 07/26', EVENTS)).toBe('e-jul');
        expect(suggestOpenDay('Mint: GM Dental: Dental Implants Open Day July 2026', EVENTS)).toBe('e-jul');
    });

    it('suggests nothing when it recognises an open day but no event matches', () => {
        // A tenant whose naming this does not understand gets NO suggestion,
        // never a wrong one. The cost is a missing shortcut, not a bad mapping.
        expect(suggestOpenDay('Open Day Spring Special', EVENTS)).toBeNull();
    });

    it('suggests nothing when the org has no events yet', () => {
        expect(suggestOpenDay('Mint: Implants Open Day LF July 26', [])).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx vitest run test/open-day-suggest.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// ============================================================================
// Which open day a newly-seen campaign or pipeline probably belongs to.
//
// A SUGGESTION, NEVER A MAPPING. The caller pre-ticks a checkbox with this and
// writes nothing until a human confirms. That is the whole difference between
// this and the name matching that has burned this codebase twice — practice
// names, and Emergent's fuzzy business match. A name is a shortcut for a
// person; it is never the stored answer.
//
// It fails SILENT: an unrecognised name returns null, so a tenant whose naming
// this does not understand ticks boxes by hand rather than getting a wrong
// event. The cost of a miss is a missing shortcut; the cost of a false match
// would be an event's numbers quietly wrong.
// ============================================================================
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];

function monthsIn(text) {
    const found = new Set();
    for (let i = 0; i < MONTHS.length; i++) {
        // Three letters is enough ("Aug", "Sept", "October") and avoids
        // matching "may" inside an unrelated word by requiring a boundary.
        const stem = MONTHS[i].slice(0, 3);
        if (new RegExp(`\\b${stem}`, 'i').test(text)) found.add(i + 1);
    }
    for (const m of text.matchAll(/\b(0?[1-9]|1[0-2])\s*\/\s*(\d{2,4})\b/g)) {
        found.add(Number(m[1]));
    }
    return found;
}

function yearsIn(text) {
    const found = new Set();
    for (const m of text.matchAll(/\b(20)?(\d{2})\b/g)) {
        const y = Number(m[2]);
        if (y >= 20 && y <= 99) found.add(2000 + y);
    }
    return found;
}

export function suggestOpenDay(name, events) {
    const text = String(name ?? '');
    if (!/open\s?day/i.test(text)) return null;
    if (!events?.length) return null;

    const months = monthsIn(text);
    const years = yearsIn(text);
    if (months.size === 0) return null;

    const matches = events.filter((e) => {
        const candidate = `${e.name ?? ''} ${e.eventDate ?? ''}`;
        const eventMonths = e.eventDate
            ? new Set([Number(e.eventDate.slice(5, 7))])
            : monthsIn(candidate);
        const eventYears = e.eventDate
            ? new Set([Number(e.eventDate.slice(0, 4))])
            : yearsIn(candidate);
        const monthHit = [...months].some((m) => eventMonths.has(m));
        const yearHit = years.size === 0 || eventYears.size === 0
            || [...years].some((y) => eventYears.has(y));
        return monthHit && yearHit;
    });

    // Exactly one, or nothing. An ambiguous name is precisely when a guess is
    // most likely to be wrong.
    return matches.length === 1 ? matches[0].id : null;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && npx vitest run test/open-day-suggest.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Surface it**

In `openDayService.list`, add a `suggestions` map to the payload:

```js
        const suggestions = {};
        for (const c of campaigns) {
            if (assignedTo[c.campaignId]) continue;
            const id = suggestOpenDay(c.campaignName, events);
            if (id) suggestions[c.campaignId] = id;
        }
```

returned as `suggestions`, with `import { suggestOpenDay } from '../lib/marketing/open-day-suggest.js';` at the top of the service.

In `OpenDaysPanel.tsx`, add above the existing event list:

```tsx
  // Unmapped campaigns, newest activity first — a new open-day campaign lands
  // at the top the day after its first spend. `suggestions` pre-ticks; nothing
  // is written until Confirm.
  const unmapped = useMemo(() => (data?.campaigns ?? [])
    .filter((c) => !data?.assignedTo[c.campaignId])
    .sort((a, b) => String(b.lastDay ?? '').localeCompare(String(a.lastDay ?? ''))),
  [data]);
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const proposed = { ...(data?.suggestions ?? {}), ...confirmed };

  const confirmSuggestions = async () => {
    // One request per affected event: setCampaigns replaces an event's whole
    // set, so the existing ids must be sent alongside the new ones or the
    // confirm would unmap everything already there.
    const byEvent = new Map<string, string[]>();
    for (const [campaignId, eventId] of Object.entries(proposed)) {
      if (!eventId) continue;
      if (!byEvent.has(eventId)) {
        byEvent.set(eventId, [...(data?.openDays.find((d) => d.id === eventId)?.campaignIds ?? [])]);
      }
      byEvent.get(eventId)!.push(campaignId);
    }
    const byId = new Map((data?.campaigns ?? []).map((c) => [c.campaignId, c]));
    for (const [eventId, ids] of byEvent) {
      await setCampaigns.mutateAsync({
        id: eventId,
        campaigns: [...new Set(ids)].map((id) => ({
          campaign_id: id, customer_id: byId.get(id)?.customerId ?? null,
        })),
      });
    }
    setConfirmed({});
  };
```

rendered as:

```tsx
{unmapped.length > 0 && (
  <div className="flex flex-col gap-2 border-b border-border pb-3">
    <p className="text-[13px] font-medium">New since you last mapped ({unmapped.length})</p>
    {unmapped.slice(0, 20).map((c) => (
      <label key={c.campaignId} className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={Boolean(proposed[c.campaignId])}
          onChange={(e) => setConfirmed((v) => ({
            ...v,
            [c.campaignId]: e.target.checked
              ? (proposed[c.campaignId] ?? data?.openDays[0]?.id ?? '')
              : '',
          }))}
        />
        <span className="flex-1">{c.campaignName ?? c.campaignId}</span>
        <span className="text-ink-2">{c.accountName ?? 'Unknown account'} · {c.lastDay ?? ''}</span>
        {data?.suggestions?.[c.campaignId] && (
          <span className="text-[12px] text-brand">
            suggested: {data.openDays.find((d) => d.id === data.suggestions[c.campaignId])?.name}
          </span>
        )}
      </label>
    ))}
    <button
      type="button"
      className="self-start px-3 py-1.5 rounded-lg bg-brand text-white text-[13px] disabled:opacity-50"
      disabled={Object.values(proposed).filter(Boolean).length === 0 || setCampaigns.isPending}
      onClick={confirmSuggestions}
    >
      Confirm {Object.values(proposed).filter(Boolean).length} mapping(s)
    </button>
  </div>
)}
```

- [ ] **Step 6: Verify and commit**

Run: `cd backend && npm test && npm run lint` then `cd ../frontend && npm run typecheck && npm run lint && npm run build`
Expected: all green.

```bash
git add backend/src/lib/marketing/open-day-suggest.js backend/test/open-day-suggest.test.mjs backend/src/services/open-day.service.js frontend/features/integrations/components/OpenDaysPanel.tsx
git commit -m "feat(open-days): suggest an event for newly-seen campaigns"
```

---

## Verification after all tasks

- [ ] `cd backend && npm test` — whole suite green
- [ ] `cd backend && npm run lint && npm run typecheck` — 0 errors
- [ ] `cd frontend && npm run typecheck && npm run lint && npm run build` — clean
- [ ] `ggshield secret scan path <changed files>` — no secrets
- [ ] On hosted, the ledger returns 1,843 leads / 1,497 attributed for
      Plan4growth Jun–Aug 2026, and 0 rows for another org
- [ ] `ad_uncategorised_lead_counts` returns 1,251 / 209 for the same window
- [ ] Map one real open-day pipeline in the UI, reload the Facebook page, and
      confirm the event appears with a lead count matching
      `select count(*) from ad_meta_lead_ledger(...) where open_day_id = '<id>'`
