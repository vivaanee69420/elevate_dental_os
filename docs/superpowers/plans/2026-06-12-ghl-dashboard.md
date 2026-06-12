# GHL CRM Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated GoHighLevel dashboard in the Elevate CRM that sums contacts/leads/pipeline/conversations/sync-health across all subaccounts with a per-subaccount filter, and surface the same totals as clickable drill-down cards on Group Overview.

**Architecture:** A single Postgres aggregate RPC groups GHL data (`contacts`, `leads`, `communications`) by `practice_id` per org/window in SQL; a new repository → service → controller chain exposes `GET /api/integrations/gohighlevel/dashboard` returning `{ totals, perAccount }`. The frontend adds a `features/ghl/` slice (api/hooks/components), a `/ghl-dashboard` route, a CRM nav entry, and GHL cards + drill-down on `GroupOverviewScreen`.

**Tech Stack:** Express (native ESM) + Supabase (`serviceClient` + explicit `organisation_id`), Postgres RPC, Zod, Next.js 14 App Router, React Query, Tailwind, vitest.

**Working directory:** worktree `/Users/ruhithpasha/code/work/Dental-os/.claude/worktrees/feat-ghl-dashboard` (branch `feat/ghl-dashboard`). All paths below are relative to that worktree root. Run backend commands in `backend/`, frontend in `frontend/`.

**Conventions to honour (from CLAUDE.md):**
- Money is integer pence; never floats. Display as `(pence/100).toLocaleString('en-GB')` — frontend only.
- Every repo query carries an explicit `.eq('organisation_id', orgId)` (or passes org to the RPC). No RLS on the serviceClient path.
- British English in UI; light theme only; no emojis.
- After hosted DDL: `NOTIFY pgrst, 'reload schema';`.
- ESM only: `import`/`export`, relative imports carry `.js`. Namespace-import locals keep the `import * as x_1` convention seen in converted files.

---

## File Structure

**Backend (create):**
- `supabase/migrations/20260101000086_ghl_dashboard_rpc.sql` — aggregate RPC.
- `backend/src/repositories/ghl-dashboard.repository.js` — calls the RPC.
- `backend/src/services/ghl-dashboard.service.js` — assembles totals + perAccount, decorates with account meta.
- `backend/test/ghl-dashboard.repository.test.mjs`
- `backend/test/ghl-dashboard.service.test.mjs`

**Backend (modify):**
- `backend/src/models/integration.model.js` — add `ghlDashboardQuerySchema`.
- `backend/src/controllers/integration.controller.js` — add `ghlDashboard` method.
- `backend/src/routes/integrations.routes.js` — add the route (static, before param routes).

**Frontend (create):**
- `frontend/features/ghl/api.ts`
- `frontend/features/ghl/hooks.ts`
- `frontend/features/ghl/components/GhlDashboardScreen.tsx`
- `frontend/features/ghl/components/SubaccountFilterBar.tsx`
- `frontend/features/ghl/components/GhlKpiCards.tsx`
- `frontend/features/ghl/components/PipelineByStage.tsx`
- `frontend/features/ghl/components/SourceBreakdown.tsx`
- `frontend/features/ghl/components/ConversationActivity.tsx`
- `frontend/features/ghl/components/SyncHealthTable.tsx`
- `frontend/features/ghl/components/GhlSummaryCards.tsx` — reused by Group Overview.
- `frontend/app/(dashboard)/ghl-dashboard/page.tsx`

**Frontend (modify):**
- `frontend/lib/nav.ts` — add `{ id: 'ghl-dashboard', label: 'GHL Dashboard', isNew: true }` to the Elevate CRM section.
- `frontend/lib/permissions.ts` — map `'ghl-dashboard': 'crm.view'`.
- `frontend/features/overview/GroupOverviewScreen.tsx` — render `GhlSummaryCards` with drill-down.

**Docs (modify):**
- `docs/API.md` — document the new endpoint.

---

## Task 1: Aggregate RPC migration

**Files:**
- Create: `supabase/migrations/20260101000086_ghl_dashboard_rpc.sql`

The RPC returns ONE row per practice bucket plus derived JSON breakdowns. `p_practice` (nullable) optionally restricts to a single practice; when null, all practices for the org are returned. Null-practice GHL rows are bucketed under `practice_id IS NULL` (the service labels that "Unmapped"). All filters are org-scoped. `until` is exclusive.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 20260101000086_ghl_dashboard_rpc.sql
-- Live aggregate for the GHL CRM dashboard. Groups GHL-sourced contacts, leads
-- (opportunities), and conversations (communications) by practice_id for an org
-- over a [since, until) window. One row per practice bucket; the caller sums for
-- totals and uses rows for the per-subaccount breakdown. Money stays in pence.
-- Idempotent. Depends on 000085_integration_accounts. After hosted apply run:
--   NOTIFY pgrst, 'reload schema';

create or replace function public.ghl_dashboard_aggregate(
  p_org uuid,
  p_since timestamptz,
  p_until timestamptz,
  p_practice uuid default null
)
returns table (
  practice_id uuid,
  contacts_total bigint,
  contacts_new bigint,
  contacts_by_source jsonb,
  leads_total bigint,
  leads_new bigint,
  leads_open bigint,
  leads_won bigint,
  leads_lost bigint,
  pipeline_value_pence bigint,
  leads_by_stage jsonb,
  conversations_total bigint,
  conversations_inbound bigint,
  conversations_outbound bigint,
  conversations_last7d bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select
      practice_id,
      count(*) as total,
      count(*) filter (where created_at >= p_since and created_at < p_until) as new_in,
      coalesce(
        jsonb_object_agg(source, src_count) filter (where source is not null),
        '{}'::jsonb
      ) as by_source
    from (
      select practice_id, coalesce(source, 'unknown') as source,
             created_at,
             count(*) over (partition by practice_id, coalesce(source, 'unknown')) as src_count
      from public.contacts
      where organisation_id = p_org
        and ghl_contact_id is not null
        and (p_practice is null or practice_id = p_practice)
    ) raw
    group by practice_id
  ),
  l as (
    select
      practice_id,
      count(*) as total,
      count(*) filter (where created_at >= p_since and created_at < p_until) as new_in,
      count(*) filter (where status not in ('won','lost')) as open_cnt,
      count(*) filter (where status = 'won') as won_cnt,
      count(*) filter (where status = 'lost') as lost_cnt,
      coalesce(sum(estimated_value_pence), 0) as value_pence,
      coalesce(
        jsonb_object_agg(stage, stage_count) filter (where stage is not null),
        '{}'::jsonb
      ) as by_stage
    from (
      select practice_id,
             coalesce(ghl_stage_name, 'Unstaged') as stage,
             status, estimated_value_pence, created_at,
             count(*) over (partition by practice_id, coalesce(ghl_stage_name, 'Unstaged')) as stage_count
      from public.leads
      where organisation_id = p_org
        and source = 'gohighlevel'
        and (p_practice is null or practice_id = p_practice)
    ) raw
    group by practice_id
  ),
  m as (
    select
      practice_id,
      count(*) as total,
      count(*) filter (where direction = 'inbound') as inbound_cnt,
      count(*) filter (where direction = 'outbound') as outbound_cnt,
      count(*) filter (where created_at >= (p_until - interval '7 days')) as last7d
    from public.communications
    where organisation_id = p_org
      and (p_practice is null or practice_id = p_practice)
    group by practice_id
  ),
  keys as (
    select practice_id from c
    union select practice_id from l
    union select practice_id from m
  )
  select
    k.practice_id,
    coalesce(c.total, 0), coalesce(c.new_in, 0), coalesce(c.by_source, '{}'::jsonb),
    coalesce(l.total, 0), coalesce(l.new_in, 0), coalesce(l.open_cnt, 0),
    coalesce(l.won_cnt, 0), coalesce(l.lost_cnt, 0), coalesce(l.value_pence, 0),
    coalesce(l.by_stage, '{}'::jsonb),
    coalesce(m.total, 0), coalesce(m.inbound_cnt, 0), coalesce(m.outbound_cnt, 0),
    coalesce(m.last7d, 0)
  from keys k
  left join c on c.practice_id is not distinct from k.practice_id
  left join l on l.practice_id is not distinct from k.practice_id
  left join m on m.practice_id is not distinct from k.practice_id;
$$;

grant execute on function public.ghl_dashboard_aggregate(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
```

> NOTE on `communications.practice_id` and `direction`: the GHL conversation sync stamps `practice_id` and a `direction` ('inbound'/'outbound') on communications. Before relying on them, the implementer MUST verify the columns exist (Step 2). If `direction` is absent, replace the `filter (where direction = ...)` lines with the actual column (e.g. a boolean `is_inbound` → `filter (where is_inbound)`) and adjust the service/types accordingly. If `communications.practice_id` is absent, join through `contacts` on `contact_id` to derive the practice. Do not invent columns — confirm first.

- [ ] **Step 2: Verify the assumed columns exist before trusting the SQL**

Run (from worktree root):
```bash
grep -nE "practice_id|direction|is_inbound|contact_id" supabase/migrations/*communications* supabase/migrations/*000084* 2>/dev/null
grep -nE "practice_id|direction|is_inbound" backend/src/lib/integrations/gohighlevel-conversations.js
```
Expected: confirm `communications` has `practice_id` and a direction-style column. If the actual column names differ, edit the migration SQL from Step 1 to match (see NOTE above) before continuing. Document any change inline in the SQL comment.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101000086_ghl_dashboard_rpc.sql
git commit -m "feat(ghl): aggregate RPC for GHL dashboard (000086)"
```

> The RPC is applied to hosted later (Task 12). Local `supabase db reset` will pick it up automatically.

---

## Task 2: Dashboard repository

**Files:**
- Create: `backend/src/repositories/ghl-dashboard.repository.js`
- Test: `backend/test/ghl-dashboard.repository.test.mjs`

The repo is a thin wrapper over the RPC, returning the raw per-practice rows (snake_case from SQL) unchanged. It also exposes the integration_accounts list join is left to the service (reuses `integrationAccountRepository`).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/ghl-dashboard.repository.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { ghlDashboardRepository } = await import('../src/repositories/ghl-dashboard.repository.js');

beforeEach(() => {
  supaRec.rpcProvider = undefined;
  supaRec.rpcCalls = [];
});

describe('aggregate', () => {
  it('calls the RPC with org/window/practice args and returns rows', async () => {
    supaRec.rpcProvider = (fn) =>
      fn === 'ghl_dashboard_aggregate'
        ? { data: [{ practice_id: 'p1', contacts_total: 5 }], error: null }
        : { data: null, error: { message: 'wrong fn' } };

    const rows = await ghlDashboardRepository.aggregate('org-1', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', null);

    expect(rows).toEqual([{ practice_id: 'p1', contacts_total: 5 }]);
    expect(supaRec.rpcCalls[0]).toEqual({
      fn: 'ghl_dashboard_aggregate',
      params: { p_org: 'org-1', p_since: '2026-01-01T00:00:00Z', p_until: '2026-02-01T00:00:00Z', p_practice: null },
    });
  });

  it('returns [] when the RPC returns null data', async () => {
    supaRec.rpcProvider = () => ({ data: null, error: null });
    expect(await ghlDashboardRepository.aggregate('org-1', 's', 'u', null)).toEqual([]);
  });

  it('throws on RPC error', async () => {
    supaRec.rpcProvider = () => ({ data: null, error: { message: 'boom' } });
    await expect(ghlDashboardRepository.aggregate('org-1', 's', 'u', null)).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/ghl-dashboard.repository.test.mjs`
Expected: FAIL — cannot find module `../src/repositories/ghl-dashboard.repository.js`.

- [ ] **Step 3: Write the repository**

```javascript
// backend/src/repositories/ghl-dashboard.repository.js
// ============================================================================
// GHL dashboard repository — thin wrapper over the ghl_dashboard_aggregate RPC.
// Returns one raw per-practice row per bucket (snake_case from SQL). Org scope
// is enforced inside the RPC via p_org. The service sums + decorates these.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const ghlDashboardRepository = {
  _client() { return supabase_1.serviceClient; },

  async aggregate(orgId, since, until, practiceId = null) {
    const { data, error } = await this._client().rpc('ghl_dashboard_aggregate', {
      p_org: orgId,
      p_since: since,
      p_until: until,
      p_practice: practiceId ?? null,
    });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/ghl-dashboard.repository.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/ghl-dashboard.repository.js backend/test/ghl-dashboard.repository.test.mjs
git commit -m "feat(ghl): dashboard repository wrapping aggregate RPC"
```

---

## Task 3: Dashboard service

**Files:**
- Create: `backend/src/services/ghl-dashboard.service.js`
- Test: `backend/test/ghl-dashboard.service.test.mjs`

The service: (1) loads GHL accounts (`integrationAccountRepository.list`), (2) calls the repo aggregate, (3) builds `perAccount` by matching each account's `practice_id` to its aggregate row, (4) sums all rows into `totals`, (5) computes conversion %, (6) buckets null-practice rows as "Unmapped". Returns camelCase JSON for the API. Conversion % = won / (won + lost) when (won+lost)>0 else 0, rounded to 1 dp.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/ghl-dashboard.service.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

const { integrationAccountRepository } = await import('../src/repositories/integration-account.repository.js');
const { ghlDashboardRepository } = await import('../src/repositories/ghl-dashboard.repository.js');
const { ghlDashboardService } = await import('../src/services/ghl-dashboard.service.js');

const WINDOW = { since: '2026-01-01T00:00:00Z', until: '2026-02-01T00:00:00Z' };

beforeEach(() => {
  vi.restoreAllMocks();
});

function stubAccounts(accounts) {
  vi.spyOn(integrationAccountRepository, 'list').mockResolvedValue(accounts);
}
function stubAggregate(rows) {
  vi.spyOn(ghlDashboardRepository, 'aggregate').mockResolvedValue(rows);
}

describe('getDashboard', () => {
  it('sums rows into totals and computes conversion %', async () => {
    stubAccounts([
      { id: 'a1', label: 'Ashford', practice_id: 'p1', status: 'active', last_sync_at: '2026-01-30T00:00:00Z', last_error: null },
      { id: 'a2', label: 'Maidstone', practice_id: 'p2', status: 'active', last_sync_at: null, last_error: null },
    ]);
    stubAggregate([
      { practice_id: 'p1', contacts_total: 10, contacts_new: 3, contacts_by_source: { ads: 6, referral: 4 },
        leads_total: 8, leads_new: 2, leads_open: 4, leads_won: 3, leads_lost: 1, pipeline_value_pence: 500000,
        leads_by_stage: { New: 4, Won: 3, Lost: 1 },
        conversations_total: 20, conversations_inbound: 12, conversations_outbound: 8, conversations_last7d: 5 },
      { practice_id: 'p2', contacts_total: 5, contacts_new: 1, contacts_by_source: { ads: 5 },
        leads_total: 2, leads_new: 0, leads_open: 1, leads_won: 1, leads_lost: 0, pipeline_value_pence: 100000,
        leads_by_stage: { New: 1, Won: 1 },
        conversations_total: 4, conversations_inbound: 1, conversations_outbound: 3, conversations_last7d: 0 },
    ]);

    const out = await ghlDashboardService.getDashboard('org-1', { ...WINDOW, accountId: null, practiceId: null });

    expect(out.totals.contacts.total).toBe(15);
    expect(out.totals.contacts.new).toBe(4);
    expect(out.totals.contacts.bySource).toEqual([
      { source: 'ads', count: 11 }, { source: 'referral', count: 4 },
    ]); // descending by count
    expect(out.totals.leads.total).toBe(10);
    expect(out.totals.leads.won).toBe(4);
    expect(out.totals.leads.lost).toBe(1);
    expect(out.totals.leads.pipelineValuePence).toBe(600000);
    expect(out.totals.leads.conversionPct).toBe(80); // 4 / (4+1) = 0.8
    expect(out.totals.conversations.total).toBe(24);
    expect(out.totals.conversations.inbound).toBe(13);
    expect(out.totals.sync.accounts).toBe(2);
    expect(out.totals.sync.active).toBe(2);

    expect(out.perAccount).toHaveLength(2);
    const ashford = out.perAccount.find((a) => a.accountId === 'a1');
    expect(ashford).toMatchObject({
      label: 'Ashford', practiceId: 'p1', contacts: 10, leads: 8,
      pipelineValuePence: 500000, conversations: 20, status: 'active',
    });
  });

  it('returns zeroed totals and empty perAccount when no accounts', async () => {
    stubAccounts([]);
    stubAggregate([]);
    const out = await ghlDashboardService.getDashboard('org-1', { ...WINDOW, accountId: null, practiceId: null });
    expect(out.totals.contacts.total).toBe(0);
    expect(out.totals.leads.conversionPct).toBe(0);
    expect(out.perAccount).toEqual([]);
  });

  it('buckets a null-practice aggregate row as Unmapped in perAccount', async () => {
    stubAccounts([{ id: 'a1', label: 'Ashford', practice_id: 'p1', status: 'active', last_sync_at: null, last_error: null }]);
    stubAggregate([
      { practice_id: 'p1', contacts_total: 4, contacts_new: 0, contacts_by_source: {}, leads_total: 0, leads_new: 0,
        leads_open: 0, leads_won: 0, leads_lost: 0, pipeline_value_pence: 0, leads_by_stage: {},
        conversations_total: 0, conversations_inbound: 0, conversations_outbound: 0, conversations_last7d: 0 },
      { practice_id: null, contacts_total: 7, contacts_new: 0, contacts_by_source: {}, leads_total: 0, leads_new: 0,
        leads_open: 0, leads_won: 0, leads_lost: 0, pipeline_value_pence: 0, leads_by_stage: {},
        conversations_total: 0, conversations_inbound: 0, conversations_outbound: 0, conversations_last7d: 0 },
    ]);
    const out = await ghlDashboardService.getDashboard('org-1', { ...WINDOW, accountId: null, practiceId: null });
    expect(out.totals.contacts.total).toBe(11); // null-practice rows still counted in totals
    const unmapped = out.perAccount.find((a) => a.accountId === null);
    expect(unmapped).toMatchObject({ label: 'Unmapped', contacts: 7 });
  });

  it('scopes the aggregate to a single account practice when accountId given', async () => {
    stubAccounts([
      { id: 'a1', label: 'Ashford', practice_id: 'p1', status: 'active', last_sync_at: null, last_error: null },
      { id: 'a2', label: 'Maidstone', practice_id: 'p2', status: 'active', last_sync_at: null, last_error: null },
    ]);
    const spy = vi.spyOn(ghlDashboardRepository, 'aggregate').mockResolvedValue([]);
    await ghlDashboardService.getDashboard('org-1', { ...WINDOW, accountId: 'a2', practiceId: null });
    // resolved a2 -> practice p2 and passed it to the RPC
    expect(spy).toHaveBeenCalledWith('org-1', WINDOW.since, WINDOW.until, 'p2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/ghl-dashboard.service.test.mjs`
Expected: FAIL — cannot find module `../src/services/ghl-dashboard.service.js`.

- [ ] **Step 3: Write the service**

```javascript
// backend/src/services/ghl-dashboard.service.js
// ============================================================================
// GHL dashboard service — assembles the consolidated GoHighLevel view. Loads the
// org's GHL subaccounts, runs the aggregate RPC (optionally scoped to one
// account's practice), then builds:
//   totals    — every metric summed across all returned practice rows
//   perAccount — one entry per subaccount (+ an "Unmapped" entry for null-practice
//                rows), used for both the single-account filter and drill-downs
// Money stays in integer pence. Conversion % = won / (won + lost).
// ============================================================================
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { ghlDashboardRepository } from "../repositories/ghl-dashboard.repository.js";

const PROVIDER = 'gohighlevel';

const num = (v) => Number(v ?? 0);

// Merge an array of { [key]: count } JSON maps into a descending [{ source, count }].
function mergeCounts(maps, keyName) {
  const acc = new Map();
  for (const map of maps) {
    for (const [k, v] of Object.entries(map ?? {})) {
      acc.set(k, (acc.get(k) ?? 0) + num(v));
    }
  }
  return [...acc.entries()]
    .map(([k, count]) => ({ [keyName]: k, count }))
    .sort((a, b) => b.count - a.count);
}

function conversionPct(won, lost) {
  const decided = won + lost;
  if (decided <= 0) return 0;
  return Math.round((won / decided) * 1000) / 10; // 1 dp
}

export const ghlDashboardService = {
  async getDashboard(orgId, { since, until, accountId = null, practiceId = null }) {
    const accounts = await integrationAccountRepository.list(orgId, PROVIDER);

    // Resolve a single-account filter to its practice_id for the RPC.
    let practiceFilter = practiceId;
    if (accountId) {
      const acct = accounts.find((a) => a.id === accountId);
      practiceFilter = acct?.practice_id ?? null;
    }

    const rows = await ghlDashboardRepository.aggregate(orgId, since, until, practiceFilter);
    const byPractice = new Map(rows.map((r) => [r.practice_id, r]));

    // perAccount: one entry per mapped subaccount.
    const perAccount = accounts.map((a) => {
      const r = byPractice.get(a.practice_id) ?? {};
      return {
        accountId: a.id,
        label: a.label || 'GoHighLevel',
        practiceId: a.practice_id ?? null,
        status: a.status,
        lastSyncAt: a.last_sync_at ?? null,
        lastError: a.last_error ?? null,
        contacts: num(r.contacts_total),
        leads: num(r.leads_total),
        pipelineValuePence: num(r.pipeline_value_pence),
        conversionPct: conversionPct(num(r.leads_won), num(r.leads_lost)),
        conversations: num(r.conversations_total),
      };
    });

    // Any aggregate row whose practice_id matches no account = Unmapped bucket.
    const mappedPractices = new Set(accounts.map((a) => a.practice_id));
    const unmappedRows = rows.filter((r) => !mappedPractices.has(r.practice_id));
    if (unmappedRows.length) {
      const u = unmappedRows;
      perAccount.push({
        accountId: null,
        label: 'Unmapped',
        practiceId: null,
        status: null,
        lastSyncAt: null,
        lastError: null,
        contacts: u.reduce((s, r) => s + num(r.contacts_total), 0),
        leads: u.reduce((s, r) => s + num(r.leads_total), 0),
        pipelineValuePence: u.reduce((s, r) => s + num(r.pipeline_value_pence), 0),
        conversionPct: conversionPct(
          u.reduce((s, r) => s + num(r.leads_won), 0),
          u.reduce((s, r) => s + num(r.leads_lost), 0),
        ),
        conversations: u.reduce((s, r) => s + num(r.conversations_total), 0),
      });
    }

    // totals: sum across ALL aggregate rows (mapped + unmapped).
    const sum = (f) => rows.reduce((s, r) => s + num(r[f]), 0);
    const wonTotal = sum('leads_won');
    const lostTotal = sum('leads_lost');

    const totals = {
      contacts: {
        total: sum('contacts_total'),
        new: sum('contacts_new'),
        bySource: mergeCounts(rows.map((r) => r.contacts_by_source), 'source'),
      },
      leads: {
        total: sum('leads_total'),
        new: sum('leads_new'),
        open: sum('leads_open'),
        won: wonTotal,
        lost: lostTotal,
        pipelineValuePence: sum('pipeline_value_pence'),
        conversionPct: conversionPct(wonTotal, lostTotal),
        byStage: mergeCounts(rows.map((r) => r.leads_by_stage), 'stage'),
      },
      conversations: {
        total: sum('conversations_total'),
        inbound: sum('conversations_inbound'),
        outbound: sum('conversations_outbound'),
        last7d: sum('conversations_last7d'),
      },
      sync: {
        accounts: accounts.length,
        active: accounts.filter((a) => a.status === 'active').length,
        failed: accounts.filter((a) => a.status === 'failed').length,
        lastSyncAt: accounts.reduce((latest, a) => {
          if (!a.last_sync_at) return latest;
          return !latest || a.last_sync_at > latest ? a.last_sync_at : latest;
        }, null),
      },
    };

    return { period: { since, until }, totals, perAccount };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/ghl-dashboard.service.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ghl-dashboard.service.js backend/test/ghl-dashboard.service.test.mjs
git commit -m "feat(ghl): dashboard service — totals + perAccount assembly"
```

---

## Task 4: Query model schema

**Files:**
- Modify: `backend/src/models/integration.model.js` (append at end of file)

- [ ] **Step 1: Add the Zod schema**

Append to `backend/src/models/integration.model.js`:

```javascript
// GHL dashboard query — optional single-account/practice filter + ISO window.
// since/until default in the controller (trailing 30 days) when omitted.
export const ghlDashboardQuerySchema = zod_1.z.object({
    accountId: zod_1.z.string().uuid().optional(),
    practiceId: zod_1.z.string().uuid().optional(),
    since: zod_1.z.string().datetime().optional(),
    until: zod_1.z.string().datetime().optional(),
});
```

> Note: this file uses `zod_1` (namespace import `import * as zod_1 from "zod"` at the top). Confirm that local var name at the top of the file and match it.

- [ ] **Step 2: Verify it parses (syntax check)**

Run: `cd backend && node --check src/models/integration.model.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add backend/src/models/integration.model.js
git commit -m "feat(ghl): ghlDashboardQuerySchema"
```

---

## Task 5: Controller method + route

**Files:**
- Modify: `backend/src/controllers/integration.controller.js`
- Modify: `backend/src/routes/integrations.routes.js`
- Test: `backend/test/ghl-dashboard.controller.test.mjs` (create)

The controller validates the query, defaults the window to the trailing 30 days when `since`/`until` are absent, calls the service, returns JSON. `req.user.organisation_id` is the only org source.

- [ ] **Step 1: Write the failing controller test**

```javascript
// backend/test/ghl-dashboard.controller.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

const { ghlDashboardService } = await import('../src/services/ghl-dashboard.service.js');
const { integrationController } = await import('../src/controllers/integration.controller.js');

function mockRes() {
  return { body: null, json(b) { this.body = b; return this; } };
}

beforeEach(() => vi.restoreAllMocks());

describe('ghlDashboard controller', () => {
  it('passes org + parsed query to the service and returns its result', async () => {
    const spy = vi.spyOn(ghlDashboardService, 'getDashboard').mockResolvedValue({ totals: {}, perAccount: [] });
    const req = {
      user: { organisation_id: 'org-1' },
      query: { since: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z', accountId: '11111111-1111-1111-1111-111111111111' },
    };
    const res = mockRes();
    await integrationController.ghlDashboard(req, res);
    expect(spy).toHaveBeenCalledWith('org-1', expect.objectContaining({
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-02-01T00:00:00.000Z',
      accountId: '11111111-1111-1111-1111-111111111111',
    }));
    expect(res.body).toEqual({ totals: {}, perAccount: [] });
  });

  it('defaults to a 30-day window when since/until are omitted', async () => {
    const spy = vi.spyOn(ghlDashboardService, 'getDashboard').mockResolvedValue({ totals: {}, perAccount: [] });
    const req = { user: { organisation_id: 'org-1' }, query: {} };
    await integrationController.ghlDashboard(req, mockRes());
    const arg = spy.mock.calls[0][1];
    expect(typeof arg.since).toBe('string');
    expect(typeof arg.until).toBe('string');
    expect(new Date(arg.until) > new Date(arg.since)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/ghl-dashboard.controller.test.mjs`
Expected: FAIL — `integrationController.ghlDashboard is not a function`.

- [ ] **Step 3: Add the controller method**

In `backend/src/controllers/integration.controller.js`, add the import near the other service imports at the top:

```javascript
import { ghlDashboardService } from "../services/ghl-dashboard.service.js";
import { ghlDashboardQuerySchema } from "../models/integration.model.js";
```

Then add this method inside the `integrationController` object (place it next to the other `ghlAccount*` methods):

```javascript
    async ghlDashboard(req, res) {
        const q = ghlDashboardQuerySchema.parse(req.query);
        // Default to the trailing 30 days (day-granular, UTC) when no window given.
        const now = new Date();
        const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        const since = q.since ?? new Date(todayMs - 29 * 86_400_000).toISOString();
        const until = q.until ?? new Date(todayMs + 86_400_000).toISOString();
        res.json(await ghlDashboardService.getDashboard(req.user.organisation_id, {
            since, until,
            accountId: q.accountId ?? null,
            practiceId: q.practiceId ?? null,
        }));
    },
```

- [ ] **Step 4: Add the route**

In `backend/src/routes/integrations.routes.js`, add this line immediately AFTER line 13 (`/gohighlevel/accounts` GET) and BEFORE the `/:provider/...` param routes, so the static path matches first:

```javascript
router.get('/gohighlevel/dashboard', (0, auth_1.requireRole)('owner', 'manager'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.ghlDashboard));
```

> RBAC: dashboard is a read surface. `requireRole('owner', 'manager')` matches CRM-read intent while keeping it off Reception. Verify `requireRole` accepts multiple roles (it does — `requireRole(...roles)`). If a `manager` role label differs in this codebase, use the actual finance/manager role name; confirm via `grep -n "requireRole(" backend/src/routes/*.js`.

- [ ] **Step 5: Run controller test + full backend suite**

Run: `cd backend && npx vitest run test/ghl-dashboard.controller.test.mjs && npm test`
Expected: controller test PASS (2); full suite stays green (no regressions).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/integration.controller.js backend/src/routes/integrations.routes.js backend/test/ghl-dashboard.controller.test.mjs
git commit -m "feat(ghl): dashboard endpoint GET /api/integrations/gohighlevel/dashboard"
```

---

## Task 6: Frontend API client

**Files:**
- Create: `frontend/features/ghl/api.ts`

- [ ] **Step 1: Write the API client**

```typescript
// frontend/features/ghl/api.ts
// GHL consolidated dashboard — live aggregate across all subaccounts (or one).
import { api } from '@/lib/api';

export interface CountEntry { source?: string; stage?: string; count: number }

export interface GhlTotals {
  contacts: { total: number; new: number; bySource: CountEntry[] };
  leads: {
    total: number; new: number; open: number; won: number; lost: number;
    pipelineValuePence: number; conversionPct: number; byStage: CountEntry[];
  };
  conversations: { total: number; inbound: number; outbound: number; last7d: number };
  sync: { accounts: number; active: number; failed: number; lastSyncAt: string | null };
}

export interface GhlPerAccount {
  accountId: string | null;
  label: string;
  practiceId: string | null;
  status: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  contacts: number;
  leads: number;
  pipelineValuePence: number;
  conversionPct: number;
  conversations: number;
}

export interface GhlDashboardResponse {
  period: { since: string; until: string };
  totals: GhlTotals;
  perAccount: GhlPerAccount[];
}

export interface GhlDashboardParams {
  accountId?: string | null;
  since?: string;
  until?: string;
}

export function fetchGhlDashboard(params: GhlDashboardParams = {}) {
  const sp = new URLSearchParams();
  if (params.accountId) sp.set('accountId', params.accountId);
  if (params.since) sp.set('since', params.since);
  if (params.until) sp.set('until', params.until);
  const qs = sp.toString();
  return api<GhlDashboardResponse>(`/api/integrations/gohighlevel/dashboard${qs ? `?${qs}` : ''}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/features/ghl/api.ts
git commit -m "feat(ghl): frontend dashboard api client"
```

---

## Task 7: Frontend hook

**Files:**
- Create: `frontend/features/ghl/hooks.ts`

- [ ] **Step 1: Write the hook**

```typescript
// frontend/features/ghl/hooks.ts
import { useQuery } from '@tanstack/react-query';
import { fetchGhlDashboard, type GhlDashboardParams } from './api';

// Consolidated GHL dashboard. Pass accountId to scope to one subaccount, and a
// since/until window (from the shared ScopePeriod state). Key includes all three
// so it refetches on filter/period change.
export function useGhlDashboard(params: GhlDashboardParams = {}) {
  return useQuery({
    queryKey: ['ghl-dashboard', params.accountId ?? 'all', params.since ?? '', params.until ?? ''],
    queryFn: () => fetchGhlDashboard(params),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/features/ghl/hooks.ts
git commit -m "feat(ghl): useGhlDashboard hook"
```

---

## Task 8: KPI cards + breakdown sub-components

**Files:**
- Create: `frontend/features/ghl/components/GhlKpiCards.tsx`
- Create: `frontend/features/ghl/components/PipelineByStage.tsx`
- Create: `frontend/features/ghl/components/SourceBreakdown.tsx`
- Create: `frontend/features/ghl/components/ConversationActivity.tsx`
- Create: `frontend/features/ghl/components/SyncHealthTable.tsx`

All presentational: take typed props, render light-theme Tailwind. Money via `formatPence` from `@/lib/format` (verify its export name — `formatPence` per `frontend/lib/format.ts`).

- [ ] **Step 1: Write GhlKpiCards.tsx**

```tsx
// frontend/features/ghl/components/GhlKpiCards.tsx
import { formatPence, formatNumber } from '@/lib/format';
import type { GhlTotals } from '../api';

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-[12px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

export function GhlKpiCards({ totals }: { totals: GhlTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Card label="Contacts" value={formatNumber(totals.contacts.total)} sub={`${formatNumber(totals.contacts.new)} new`} />
      <Card label="Leads" value={formatNumber(totals.leads.total)} sub={`${formatNumber(totals.leads.open)} open`} />
      <Card label="Pipeline value" value={formatPence(totals.leads.pipelineValuePence)} />
      <Card label="Conversion" value={`${totals.leads.conversionPct}%`} sub={`${formatNumber(totals.leads.won)} won / ${formatNumber(totals.leads.lost)} lost`} />
      <Card label="Conversations" value={formatNumber(totals.conversations.total)} sub={`${formatNumber(totals.conversations.inbound)} in / ${formatNumber(totals.conversations.outbound)} out`} />
      <Card label="Sync health" value={`${totals.sync.active}/${totals.sync.accounts}`} sub="active subaccounts" />
    </div>
  );
}
```

- [ ] **Step 2: Write PipelineByStage.tsx**

```tsx
// frontend/features/ghl/components/PipelineByStage.tsx
import { formatNumber } from '@/lib/format';
import type { CountEntry } from '../api';

export function PipelineByStage({ stages }: { stages: CountEntry[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Leads by stage</h3>
      {stages.length === 0 ? (
        <p className="mt-3 text-[13px] text-slate-500">No leads in this period.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {stages.map((s) => (
            <li key={s.stage} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-[13px] text-slate-700">{s.stage}</span>
              <span className="h-2 flex-1 rounded-full bg-slate-100">
                <span className="block h-2 rounded-full bg-brand" style={{ width: `${(s.count / max) * 100}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right text-[13px] font-medium text-slate-900">{formatNumber(s.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

> Verify `bg-brand` exists in the Tailwind config (used elsewhere e.g. scope-context callers). If not present, use `bg-slate-900`. Run `grep -rn "bg-brand" frontend/features | head` to confirm.

- [ ] **Step 3: Write SourceBreakdown.tsx**

```tsx
// frontend/features/ghl/components/SourceBreakdown.tsx
import { formatNumber } from '@/lib/format';
import type { CountEntry } from '../api';

export function SourceBreakdown({ sources }: { sources: CountEntry[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Contacts by source</h3>
      {sources.length === 0 ? (
        <p className="mt-3 text-[13px] text-slate-500">No contacts in this period.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {sources.map((s) => (
            <li key={s.source} className="flex items-center justify-between text-[13px]">
              <span className="truncate text-slate-700">{s.source}</span>
              <span className="font-medium text-slate-900">{formatNumber(s.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write ConversationActivity.tsx**

```tsx
// frontend/features/ghl/components/ConversationActivity.tsx
import { formatNumber } from '@/lib/format';
import type { GhlTotals } from '../api';

export function ConversationActivity({ conversations }: { conversations: GhlTotals['conversations'] }) {
  const { total, inbound, outbound, last7d } = conversations;
  const inPct = total > 0 ? Math.round((inbound / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Conversations</h3>
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div><div className="text-xl font-semibold text-slate-900">{formatNumber(inbound)}</div><div className="text-[12px] text-slate-500">Inbound</div></div>
        <div><div className="text-xl font-semibold text-slate-900">{formatNumber(outbound)}</div><div className="text-[12px] text-slate-500">Outbound</div></div>
        <div><div className="text-xl font-semibold text-slate-900">{formatNumber(last7d)}</div><div className="text-[12px] text-slate-500">Last 7 days</div></div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <span className="block h-2 bg-brand" style={{ width: `${inPct}%` }} />
      </div>
      <div className="mt-1 text-[12px] text-slate-500">{inPct}% inbound</div>
    </div>
  );
}
```

- [ ] **Step 5: Write SyncHealthTable.tsx**

```tsx
// frontend/features/ghl/components/SyncHealthTable.tsx
import { formatNumber, formatDate } from '@/lib/format';
import type { GhlPerAccount } from '../api';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-rose-50 text-rose-700',
  revoked: 'bg-slate-100 text-slate-500',
};

export function SyncHealthTable({
  accounts,
  onRowClick,
}: {
  accounts: GhlPerAccount[];
  onRowClick?: (a: GhlPerAccount) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-slate-200 bg-slate-50 text-[12px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Subaccount</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 text-right font-medium">Contacts</th>
            <th className="px-4 py-2 text-right font-medium">Leads</th>
            <th className="px-4 py-2 text-right font-medium">Conversations</th>
            <th className="px-4 py-2 font-medium">Last sync</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr
              key={a.accountId ?? 'unmapped'}
              className={`border-b border-slate-100 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
              onClick={onRowClick ? () => onRowClick(a) : undefined}
            >
              <td className="px-4 py-2 text-slate-900">{a.label}</td>
              <td className="px-4 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[12px] ${STATUS_STYLE[a.status ?? ''] ?? 'bg-slate-100 text-slate-500'}`}>
                  {a.status ?? '—'}
                </span>
                {a.lastError ? <span className="ml-2 text-[12px] text-rose-600" title={a.lastError}>error</span> : null}
              </td>
              <td className="px-4 py-2 text-right text-slate-900">{formatNumber(a.contacts)}</td>
              <td className="px-4 py-2 text-right text-slate-900">{formatNumber(a.leads)}</td>
              <td className="px-4 py-2 text-right text-slate-900">{formatNumber(a.conversations)}</td>
              <td className="px-4 py-2 text-slate-500">{a.lastSyncAt ? formatDate(a.lastSyncAt) : 'never'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors. (If `bg-brand` is unknown to Tailwind it does NOT fail typecheck — it's a CSS class. Confirm visually later.)

- [ ] **Step 7: Commit**

```bash
git add frontend/features/ghl/components/GhlKpiCards.tsx frontend/features/ghl/components/PipelineByStage.tsx frontend/features/ghl/components/SourceBreakdown.tsx frontend/features/ghl/components/ConversationActivity.tsx frontend/features/ghl/components/SyncHealthTable.tsx
git commit -m "feat(ghl): dashboard presentational components"
```

---

## Task 9: Subaccount filter bar + dashboard screen

**Files:**
- Create: `frontend/features/ghl/components/SubaccountFilterBar.tsx`
- Create: `frontend/features/ghl/components/GhlDashboardScreen.tsx`

The screen wires the shared ScopePeriod window + a local subaccount selection, fetches via `useGhlDashboard`, and composes the cards + sections. It reuses `ScopePeriodBar` for the period control (verify its props/usage in an existing screen, e.g. `grep -rn "ScopePeriodBar" frontend/features | head`).

- [ ] **Step 1: Write SubaccountFilterBar.tsx**

```tsx
// frontend/features/ghl/components/SubaccountFilterBar.tsx
import type { GhlPerAccount } from '../api';

export function SubaccountFilterBar({
  accounts,
  selected,
  onSelect,
}: {
  accounts: GhlPerAccount[];
  selected: string | null; // accountId | null = All
  onSelect: (accountId: string | null) => void;
}) {
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-[13px] transition ${
      active ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
    }`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={chip(selected === null)} onClick={() => onSelect(null)}>All subaccounts</button>
      {accounts
        .filter((a) => a.accountId) // skip the Unmapped pseudo-row
        .map((a) => (
          <button key={a.accountId} className={chip(selected === a.accountId)} onClick={() => onSelect(a.accountId)}>
            {a.label}
          </button>
        ))}
    </div>
  );
}
```

- [ ] **Step 2: Write GhlDashboardScreen.tsx**

```tsx
// frontend/features/ghl/components/GhlDashboardScreen.tsx
'use client';
import { useState } from 'react';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useGhlDashboard } from '../hooks';
import { GhlKpiCards } from './GhlKpiCards';
import { PipelineByStage } from './PipelineByStage';
import { SourceBreakdown } from './SourceBreakdown';
import { ConversationActivity } from './ConversationActivity';
import { SyncHealthTable } from './SyncHealthTable';
import { SubaccountFilterBar } from './SubaccountFilterBar';

export default function GhlDashboardScreen() {
  const { win } = useScopePeriod();
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data, isLoading, isError } = useGhlDashboard({
    accountId,
    since: win.since,
    until: win.until,
  });

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">GoHighLevel Dashboard</h1>
          <p className="text-[13px] text-slate-500">Consolidated across all connected subaccounts.</p>
        </div>
        <ScopePeriodBar />
      </div>

      {data && data.perAccount.length > 0 ? (
        <SubaccountFilterBar
          accounts={data.perAccount}
          selected={accountId}
          onSelect={setAccountId}
        />
      ) : null}

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">Loading…</div>
      ) : isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700">Could not load GHL data. Retry shortly.</div>
      ) : !data || data.totals.sync.accounts === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          No GoHighLevel subaccounts connected. Connect one under System → Integrations.
        </div>
      ) : (
        <>
          <GhlKpiCards totals={data.totals} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PipelineByStage stages={data.totals.leads.byStage} />
            <SourceBreakdown sources={data.totals.contacts.bySource} />
          </div>
          <ConversationActivity conversations={data.totals.conversations} />
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Subaccount breakdown</h2>
            <SyncHealthTable accounts={data.perAccount} />
          </div>
        </>
      )}
    </div>
  );
}
```

> Verify `ScopePeriodBar` is a default or named export and takes no required props in this usage — check `frontend/features/_shared/ScopePeriodBar.tsx` and an existing caller. Adjust the import (`import { ScopePeriodBar }` vs `import ScopePeriodBar`) to match. If it needs props (e.g. scope pills data), pass what existing screens pass.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/ghl/components/SubaccountFilterBar.tsx frontend/features/ghl/components/GhlDashboardScreen.tsx
git commit -m "feat(ghl): subaccount filter + dashboard screen"
```

---

## Task 10: Route page + nav + permission

**Files:**
- Create: `frontend/app/(dashboard)/ghl-dashboard/page.tsx`
- Modify: `frontend/lib/nav.ts`
- Modify: `frontend/lib/permissions.ts`

- [ ] **Step 1: Create the page route**

```tsx
// frontend/app/(dashboard)/ghl-dashboard/page.tsx
export { default } from '@/features/ghl/components/GhlDashboardScreen';
```

- [ ] **Step 2: Add the nav item**

In `frontend/lib/nav.ts`, inside the `'Elevate CRM'` section's `items` array, add after the `crm-reports` entry:

```javascript
    { id: 'ghl-dashboard', label: 'GHL Dashboard', isNew: true },
```

- [ ] **Step 3: Add the permission mapping**

In `frontend/lib/permissions.ts`, in the `ROUTE_PERMISSION` map, add alongside the other CRM routes:

```javascript
  'ghl-dashboard': 'crm.view',
```

- [ ] **Step 4: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: typecheck clean; build succeeds and lists the `/ghl-dashboard` route.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(dashboard)/ghl-dashboard/page.tsx" frontend/lib/nav.ts frontend/lib/permissions.ts
git commit -m "feat(ghl): /ghl-dashboard route + CRM nav entry + permission"
```

---

## Task 11: Group Overview summary cards + drill-down

**Files:**
- Create: `frontend/features/ghl/components/GhlSummaryCards.tsx`
- Modify: `frontend/features/overview/GroupOverviewScreen.tsx`

`GhlSummaryCards` renders a compact 4-card cluster (contacts, leads, pipeline value, conversion) summed across all subaccounts; clicking any card opens a drill-down panel listing `perAccount` rows. It fetches with `useGhlDashboard()` (no account filter, default window — or the screen's window if Group Overview already uses ScopePeriod; check and thread `since/until` if so).

- [ ] **Step 1: Write GhlSummaryCards.tsx**

```tsx
// frontend/features/ghl/components/GhlSummaryCards.tsx
'use client';
import { useState } from 'react';
import { formatPence, formatNumber } from '@/lib/format';
import { useGhlDashboard } from '../hooks';
import { SyncHealthTable } from './SyncHealthTable';

export function GhlSummaryCards({ since, until }: { since?: string; until?: string }) {
  const { data } = useGhlDashboard({ since, until });
  const [open, setOpen] = useState(false);

  if (!data || data.totals.sync.accounts === 0) return null;
  const t = data.totals;

  const cards = [
    { label: 'GHL Contacts', value: formatNumber(t.contacts.total) },
    { label: 'GHL Leads', value: formatNumber(t.leads.total) },
    { label: 'GHL Pipeline', value: formatPence(t.leads.pipelineValuePence) },
    { label: 'GHL Conversion', value: `${t.leads.conversionPct}%` },
  ];

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={() => setOpen((v) => !v)}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow"
          >
            <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{c.label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{c.value}</div>
            <div className="mt-0.5 text-[12px] text-slate-400">Click for breakdown</div>
          </button>
        ))}
      </div>
      {open ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">GHL by subaccount</h3>
          <SyncHealthTable accounts={data.perAccount} />
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: Mount it on Group Overview**

In `frontend/features/overview/GroupOverviewScreen.tsx`:
1. Add the import at the top with the other feature imports:
```tsx
import { GhlSummaryCards } from '@/features/ghl/components/GhlSummaryCards';
```
2. If the screen already reads `useScopePeriod()` for a window, pass it; otherwise call with no props. Render the component in the screen body where a new section fits (e.g. after the existing KPI/summary block):
```tsx
<GhlSummaryCards />
```

> Read `GroupOverviewScreen.tsx` first to find the right insertion point and whether a ScopePeriod window is already in scope (thread `since={win.since} until={win.until}` if so). Keep British English headings and light theme.

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/ghl/components/GhlSummaryCards.tsx frontend/features/overview/GroupOverviewScreen.tsx
git commit -m "feat(ghl): GHL summary cards + drill-down on Group Overview"
```

---

## Task 12: Apply migration to hosted + docs

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Document the endpoint in docs/API.md**

Add under the Integrations section (match the existing entry format in the file):

```markdown
### GET /api/integrations/gohighlevel/dashboard

Owner/Manager. Consolidated GoHighLevel metrics aggregated across all connected
subaccounts (or one, via `accountId`).

Query: `accountId` (uuid, optional — scope to one subaccount), `since` / `until`
(ISO datetimes, optional — default trailing 30 days).

Returns `{ period, totals, perAccount }`:
- `totals` — `contacts {total,new,bySource[]}`, `leads {total,new,open,won,lost,pipelineValuePence,conversionPct,byStage[]}`, `conversations {total,inbound,outbound,last7d}`, `sync {accounts,active,failed,lastSyncAt}`.
- `perAccount[]` — `{accountId,label,practiceId,status,lastSyncAt,lastError,contacts,leads,pipelineValuePence,conversionPct,conversations}` (includes an `accountId:null` "Unmapped" row when GHL rows have no practice mapping).

Money fields are integer pence.
```

- [ ] **Step 2: Commit docs**

```bash
git add docs/API.md
git commit -m "docs(ghl): document GHL dashboard endpoint"
```

- [ ] **Step 3: Apply the RPC to hosted Supabase**

The RPC must exist on hosted before the endpoint works in production. Apply via the Supabase MCP (`apply_migration` on project `Dental Os` / `mkfhpzjbijbachoonytt`) using the SQL from Task 1, OR via the SQL editor. This depends on `000085_integration_accounts` being applied first (per memory `ghl-multi-subaccount`, it was NOT yet applied on hosted — coordinate / confirm before applying this one).

After applying:
```sql
NOTIFY pgrst, 'reload schema';
```

Then smoke-test the endpoint against the hosted DB (login as an owner on a GHL-connected org, open `/ghl-dashboard`).

> This step is a human/coordination gate — do not assume it succeeded. Confirm `000085` status first.

---

## Task 13: Final verification

- [ ] **Step 1: Full backend test suite**

Run: `cd backend && npm test`
Expected: all green, including the 3 new test files (repository 3, service 4, controller 2).

- [ ] **Step 2: Backend lint + syntax**

Run: `cd backend && npm run lint && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Frontend typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: clean; `/ghl-dashboard` in the route list.

- [ ] **Step 4: Manual dogfood (local)**

Start backend (`cd backend && npm run dev`) + frontend (`cd frontend && npm run dev`). Log in as an owner on a GHL-connected org. Verify:
- `/ghl-dashboard` appears under Elevate CRM in the sidebar.
- KPI cards show non-zero totals; subaccount filter switches the figures; period bar changes the window.
- Empty-state shows for an org with no GHL.
- Group Overview shows GHL cards; clicking one reveals the per-subaccount table.

- [ ] **Step 5: Update CLAUDE.md "Current state" log + commit**

Add a bullet under "Current state" noting the GHL dashboard feature, endpoint, migration `000086`, and that hosted apply depends on `000085`. Commit.

---

## Self-Review Notes

- **Spec coverage:** dedicated CRM page (Tasks 9–10), KPI cards summing all subaccounts (Tasks 3,8), per-subaccount filter (Task 9), enhanced display — pipeline/stages, sources, conversations, sync health (Task 8), live aggregate (Tasks 1–3), Group Overview cards + drill-down (Task 11). Calendars explicitly deferred (spec non-goal).
- **Type consistency:** `getDashboard(orgId, { since, until, accountId, practiceId })` used identically in service, controller test, and controller. Response `{ period, totals, perAccount }` matches the frontend `GhlDashboardResponse`. `conversionPct`, `pipelineValuePence`, `byStage`/`bySource` (`CountEntry`) names consistent across SQL → service → api.ts → components.
- **Assumptions to verify during execution (flagged inline):** `communications.practice_id` + `direction` columns (Task 1 Step 2); `requireRole` multi-role + the manager role label (Task 5 Step 4); `bg-brand` Tailwind class (Task 8); `ScopePeriodBar` export shape/props (Task 9); Group Overview window threading (Task 11).
