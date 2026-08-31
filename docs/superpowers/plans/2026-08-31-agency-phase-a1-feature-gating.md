# Agency Phase A1 — Feature Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the agency/sub-account schema and org-level feature entitlements, and hide the four internal-only features (Data Room, Emergent, Call Reporting, sheet export) from every org that doesn't hold the flag — at the API layer and in the UI.

**Architecture:** A pure code catalog (`lib/features.js`, mirroring `lib/permissions.js`) defines feature keys with defaults; `org_features` DB rows are overrides only. A cached service resolves effective features per org; `requireFeature(key)` middleware gates route families; workers skip disabled orgs; `/auth/me` carries `features` so the frontend hides nav/pages/panels. Phases A2–A4 (agency menu, module-toggle enforcement, isolation audit) build on this and get their own plans.

**Tech Stack:** Express (native ESM, converted-file idiom in existing files), Supabase JS (serviceClient + explicit org filters), vitest + the `supaRec` recording fake (`backend/test/setup.js`), Next.js 14 App Router + React Query.

**Spec:** `docs/superpowers/specs/2026-08-31-saas-feature-gating-and-isolation-design.md`

## Global Constraints

- Backend is native ESM. New files: idiomatic ESM (`import { x } from '../y.js'`, relative imports carry `.js`). When editing converted files that use `import * as x_1 from "../y.js"`, keep that file's existing idiom. Never `require`/`module.exports`.
- Feature-denied response is exactly: `403` body `{ error: 'Feature not enabled', code: 'FEATURE_DISABLED' }`.
- Internal feature keys (`data_room`, `emergent`, `call_reporting`, `sheet_export`) default **false**; module keys default **true**. On a DB lookup error, fall back to catalog defaults (internal deny, modules stay up).
- Migration file is `supabase/migrations/20260101000133_agency_org_features.sql`; idempotent; RLS enabled with zero policies on `org_features`; ends with `notify pgrst, 'reload schema';`.
- British English in UI copy ("organisation"). No emojis. No dark mode.
- Before every commit run `ggshield secret scan pre-commit`; expected output `No secrets have been found`.
- All backend test commands run from `backend/`; `npm test` is `vitest run`.

---

### Task 1: Migration `000133` — hierarchy + org_features

**Files:**
- Create: `supabase/migrations/20260101000133_agency_org_features.sql`
- Modify: `db/01_schema.sql` (append the same DDL — unmanaged source copy, kept in sync per CLAUDE.md)

**Interfaces:**
- Produces: table `public.org_features (organisation_id UUID, feature TEXT, enabled BOOLEAN, PRIMARY KEY (organisation_id, feature))`; columns `organisations.parent_organisation_id UUID NULL`, `organisations.is_agency BOOLEAN NOT NULL DEFAULT false`. Tasks 3+ read `org_features`; phase A2 reads the two columns.

- [ ] **Step 1: Write the migration**

```sql
-- Agency + sub-accounts (phase A1): organisations hierarchy + org_features
-- entitlement overrides. org_features rows OVERRIDE the code catalog defaults
-- in backend/src/lib/features.js — internal features default off, product
-- modules default on; absent row = catalog default.
-- Spec: docs/superpowers/specs/2026-08-31-saas-feature-gating-and-isolation-design.md

alter table public.organisations
  add column if not exists parent_organisation_id UUID references public.organisations(id),
  add column if not exists is_agency BOOLEAN not null default false;

create index if not exists idx_organisations_parent
  on public.organisations(parent_organisation_id);

create table if not exists public.org_features (
  organisation_id UUID not null references public.organisations(id) on delete cascade,
  feature TEXT not null,
  enabled BOOLEAN not null,
  created_at TIMESTAMPTZ not null default NOW(),
  updated_at TIMESTAMPTZ not null default NOW(),
  primary key (organisation_id, feature)
);

alter table public.org_features enable row level security;
-- Service-role-only table: RLS enabled with NO policies (same idiom as the
-- platform_admins hardening in 000104). anon/authenticated are default-denied;
-- the app path is serviceClient + explicit .eq('organisation_id', ...).

-- Seed: every parentless org existing at migration time is ours -> mark as
-- agency and switch the four internal features on. Sub-accounts created later
-- carry parent_organisation_id, so a re-apply never touches them, and the
-- ON CONFLICT keeps any later manual toggle.
update public.organisations set is_agency = true where parent_organisation_id is null;

insert into public.org_features (organisation_id, feature, enabled)
select o.id, f.feature, true
from public.organisations o
cross join (values ('data_room'), ('emergent'), ('call_reporting'), ('sheet_export')) as f(feature)
where o.parent_organisation_id is null
on conflict (organisation_id, feature) do nothing;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Idempotency check**

Re-read the file and confirm every statement is re-runnable (`if not exists`, `on conflict do nothing`, the `update` and `insert` filtered on `parent_organisation_id is null`). If a local Supabase stack is running, run from the repo root: `supabase db reset` — expected: all migrations `000001`→`000133` apply without error. If no local stack, skip (hosted apply happens in Task 10's rollout checklist).

- [ ] **Step 3: Sync `db/01_schema.sql`**

Append the `alter table public.organisations …`, the index, and the `create table public.org_features …` + `enable row level security` statements (not the seeds — `01_schema.sql` is schema-only) to the end of `db/01_schema.sql`, with a `-- 000133 agency + org_features` comment line above them.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260101000133_agency_org_features.sql db/01_schema.sql
ggshield secret scan pre-commit
git commit -m "feat(db): 000133 agency hierarchy + org_features entitlement overrides"
```

---

### Task 2: Feature catalog — `lib/features.js`

**Files:**
- Create: `backend/src/lib/features.js`
- Test: `backend/test/features.catalog.test.mjs`

**Interfaces:**
- Produces: `FEATURE_CATALOG` (`{ [key]: { label, kind: 'internal'|'module', default: boolean, navSection? } }`), `FEATURE_KEYS: string[]`, `defaultFeatures(): { [key]: boolean }`, `resolveEffectiveFeatures(rows: {feature, enabled}[]): { [key]: boolean }` — pure, no I/O. Consumed by Tasks 3, 4 and (frontend key names) Tasks 8–9.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/features.catalog.test.mjs
// Pure feature catalog + resolution. org_features rows only OVERRIDE the code
// defaults; unknown DB keys must never grant anything (DB can't invent keys).
import { describe, it, expect } from 'vitest';
import {
  FEATURE_CATALOG, FEATURE_KEYS, defaultFeatures, resolveEffectiveFeatures,
} from '../src/lib/features.js';

describe('FEATURE_CATALOG', () => {
  it('has the four internal keys defaulting off and only module keys defaulting on', () => {
    for (const k of ['data_room', 'emergent', 'call_reporting', 'sheet_export']) {
      expect(FEATURE_CATALOG[k]).toMatchObject({ kind: 'internal', default: false });
    }
    for (const [k, v] of Object.entries(FEATURE_CATALOG)) {
      if (v.kind === 'module') expect(v.default).toBe(true);
      else expect(v.default).toBe(false);
      expect(FEATURE_KEYS).toContain(k);
    }
  });
  it('every module key names its sidebar section', () => {
    for (const v of Object.values(FEATURE_CATALOG)) {
      if (v.kind === 'module') expect(typeof v.navSection).toBe('string');
    }
  });
});

describe('resolveEffectiveFeatures', () => {
  it('returns catalog defaults for no rows / null', () => {
    expect(resolveEffectiveFeatures([])).toEqual(defaultFeatures());
    expect(resolveEffectiveFeatures(null)).toEqual(defaultFeatures());
    expect(defaultFeatures().data_room).toBe(false);
    expect(defaultFeatures().finance).toBe(true);
  });
  it('applies enable and disable overrides', () => {
    const f = resolveEffectiveFeatures([
      { feature: 'data_room', enabled: true },
      { feature: 'finance', enabled: false },
    ]);
    expect(f.data_room).toBe(true);
    expect(f.finance).toBe(false);
  });
  it('ignores unknown keys and non-boolean enabled', () => {
    const f = resolveEffectiveFeatures([
      { feature: 'made_up_key', enabled: true },
      { feature: 'emergent', enabled: 'yes' },
    ]);
    expect(f).not.toHaveProperty('made_up_key');
    expect(f.emergent).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/features.catalog.test.mjs`
Expected: FAIL — cannot resolve `../src/lib/features.js`.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/lib/features.js
// ============================================================================
// Feature catalog + pure resolution (agency / sub-account entitlements).
//
// The catalog is the single source of truth for WHICH org-level features
// exist. org_features DB rows only OVERRIDE these code defaults — a key the
// code never checks grants nothing, so the DB can't invent features.
//
//   internal (default OFF)  bespoke agency-only features; seeded ON for orgs
//                           existing at migration 000133 time
//   module   (default ON)   one per top-level sidebar group; per-sub-account
//                           toggles + route enforcement land in phase A3
//                           (navSection ties the key to frontend/lib/nav.ts)
//
// resolveEffectiveFeatures() is pure: same inputs -> same output, no I/O.
// Spec: docs/superpowers/specs/2026-08-31-saas-feature-gating-and-isolation-design.md
// ============================================================================

export const FEATURE_CATALOG = {
  data_room:      { label: 'Data Room (raw source data & exports)', kind: 'internal', default: false },
  emergent:       { label: 'Emergent (Treatments Accepted) integration', kind: 'internal', default: false },
  call_reporting: { label: 'Call Reporting (lead response dashboard)', kind: 'internal', default: false },
  sheet_export:   { label: 'GHL to Dentally conversion sheet export', kind: 'internal', default: false },

  finance:         { label: 'Finance', kind: 'module', default: true, navSection: 'Finance' },
  business_health: { label: 'Business Health', kind: 'module', default: true, navSection: 'Business Health' },
  operations:      { label: 'Operations', kind: 'module', default: true, navSection: 'Operations' },
  growth:          { label: 'Growth', kind: 'module', default: true, navSection: 'Growth' },
  crm:             { label: 'Elevate CRM', kind: 'module', default: true, navSection: 'Elevate CRM' },
  wealth:          { label: 'Wealth', kind: 'module', default: true, navSection: 'Wealth' },
  training:        { label: 'Training', kind: 'module', default: true, navSection: 'Training' },
  system:          { label: 'System (settings & integrations)', kind: 'module', default: true, navSection: 'System' },
};

export const FEATURE_KEYS = Object.keys(FEATURE_CATALOG);

export function defaultFeatures() {
  const out = {};
  for (const [k, v] of Object.entries(FEATURE_CATALOG)) out[k] = v.default;
  return out;
}

// rows: [{ feature, enabled }] from org_features (or null). Unknown keys are
// ignored; enabled must be literally true to grant.
export function resolveEffectiveFeatures(rows) {
  const out = defaultFeatures();
  for (const r of rows || []) {
    if (r && Object.prototype.hasOwnProperty.call(FEATURE_CATALOG, r.feature)) {
      out[r.feature] = r.enabled === true;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/features.catalog.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/features.js backend/test/features.catalog.test.mjs
ggshield secret scan pre-commit
git commit -m "feat(features): org-level feature catalog + pure resolution"
```

---

### Task 3: Resolution service — `services/features.service.js`

**Files:**
- Create: `backend/src/services/features.service.js`
- Test: `backend/test/features.service.test.mjs`

**Interfaces:**
- Consumes: `resolveEffectiveFeatures`/`defaultFeatures` (Task 2), `serviceClient` from `lib/supabase.js`.
- Produces: `featuresService` with `getEffectiveFeatures(orgId): Promise<{[key]:boolean}>`, `orgHasFeature(orgId, key): Promise<boolean>`, `enabledKeys(orgId): Promise<string[]>`, `invalidate(orgId?)`. Consumed by Tasks 4, 6, 7 (and A2's toggle endpoint calls `invalidate`).

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/features.service.test.mjs
// Effective-feature resolution: org-scoped query, 60s cache, defaults on error.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

const { featuresService } = await import('../src/services/features.service.js');
const { defaultFeatures } = await import('../src/lib/features.js');

describe('featuresService', () => {
  beforeEach(() => {
    featuresService.invalidate();
    supaRec.resultProvider = () => ({ data: [], error: null });
  });

  it('queries org_features scoped to the org and applies overrides', async () => {
    supaRec.resultProvider = (q) =>
      q.table === 'org_features'
        ? { data: [{ feature: 'data_room', enabled: true }], error: null }
        : { data: [], error: null };
    const f = await featuresService.getEffectiveFeatures('org-1');
    expect(f.data_room).toBe(true);
    expect(f.emergent).toBe(false);
    expect(supaRec.last.table).toBe('org_features');
    expect(supaRec.last.eqs).toEqual(
      expect.arrayContaining([{ col: 'organisation_id', val: 'org-1' }]),
    );
  });

  it('caches per org inside the TTL (one query for two calls)', async () => {
    const provider = vi.fn(() => ({ data: [], error: null }));
    supaRec.resultProvider = provider;
    await featuresService.getEffectiveFeatures('org-1');
    await featuresService.getEffectiveFeatures('org-1');
    expect(provider).toHaveBeenCalledTimes(1);
    await featuresService.getEffectiveFeatures('org-2');
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('falls back to catalog defaults on a lookup error', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    const f = await featuresService.getEffectiveFeatures('org-1');
    expect(f).toEqual(defaultFeatures());
  });

  it('orgHasFeature and enabledKeys derive from the effective map', async () => {
    supaRec.resultProvider = () => ({
      data: [{ feature: 'emergent', enabled: true }, { feature: 'finance', enabled: false }],
      error: null,
    });
    expect(await featuresService.orgHasFeature('org-1', 'emergent')).toBe(true);
    expect(await featuresService.orgHasFeature('org-1', 'finance')).toBe(false);
    const keys = await featuresService.enabledKeys('org-1');
    expect(keys).toContain('emergent');
    expect(keys).not.toContain('finance');
    expect(keys).not.toContain('data_room');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/features.service.test.mjs`
Expected: FAIL — cannot resolve `../src/services/features.service.js`.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/services/features.service.js
// ============================================================================
// Org feature resolution — org_features DB overrides over the code catalog,
// behind a 60s in-process cache so requireFeature stays off the hot path.
// Fail-safe: any lookup error falls back to catalog defaults — internal
// features deny (default off), product modules stay up (default on) — so a
// DB blip can hide the Data Room for a minute but never blank the product.
// The error fallback is cached like a normal result (60s ceiling).
// ============================================================================
import { serviceClient } from '../lib/supabase.js';
import { defaultFeatures, resolveEffectiveFeatures } from '../lib/features.js';

const TTL_MS = 60_000;
const cache = new Map(); // orgId -> { at, features }

export const featuresService = {
  async getEffectiveFeatures(orgId) {
    const hit = cache.get(orgId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.features;
    let features;
    try {
      const { data, error } = await serviceClient
        .from('org_features')
        .select('feature, enabled')
        .eq('organisation_id', orgId);
      if (error) throw error;
      features = resolveEffectiveFeatures(data);
    } catch (err) {
      console.error('[features] lookup failed; using catalog defaults', orgId, err?.message || err);
      features = defaultFeatures();
    }
    cache.set(orgId, { at: Date.now(), features });
    return features;
  },

  async orgHasFeature(orgId, key) {
    const f = await featuresService.getEffectiveFeatures(orgId);
    return f[key] === true;
  },

  async enabledKeys(orgId) {
    const f = await featuresService.getEffectiveFeatures(orgId);
    return Object.keys(f).filter((k) => f[k] === true);
  },

  // A2's toggle endpoint calls this after a PATCH; tests use it as a reset.
  invalidate(orgId) {
    if (orgId) cache.delete(orgId);
    else cache.clear();
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/features.service.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/features.service.js backend/test/features.service.test.mjs
ggshield secret scan pre-commit
git commit -m "feat(features): cached per-org effective-feature resolution service"
```

---

### Task 4: Gate middleware — `middleware/features.js`

**Files:**
- Create: `backend/src/middleware/features.js`
- Test: `backend/test/features.middleware.test.mjs`

**Interfaces:**
- Consumes: `FEATURE_CATALOG` (Task 2), `featuresService.orgHasFeature` (Task 3), `req.user.organisation_id` set by `authenticate`.
- Produces: `requireFeature(key)` returning an async Express middleware; the returned function carries `.featureKey = key` (structural-test hook used by Task 5's wiring tests, and by A3's). Throws at wire-time on an unknown key.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/features.middleware.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/services/features.service.js', () => ({
  featuresService: { orgHasFeature: vi.fn() },
}));
const { featuresService } = await import('../src/services/features.service.js');
const { requireFeature } = await import('../src/middleware/features.js');

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('requireFeature', () => {
  let res; let next;
  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
    featuresService.orgHasFeature.mockReset();
  });

  it('throws at wire-time for a key not in the catalog', () => {
    expect(() => requireFeature('nope')).toThrow(/unknown feature key/);
  });

  it('exposes the key for structural route tests', () => {
    expect(requireFeature('data_room').featureKey).toBe('data_room');
  });

  it('passes when the org has the feature', async () => {
    featuresService.orgHasFeature.mockResolvedValue(true);
    await requireFeature('data_room')({ user: { organisation_id: 'org-1' } }, res, next);
    expect(featuresService.orgHasFeature).toHaveBeenCalledWith('org-1', 'data_room');
    expect(next).toHaveBeenCalledOnce();
  });

  it('403s FEATURE_DISABLED when the org lacks it', async () => {
    featuresService.orgHasFeature.mockResolvedValue(false);
    await requireFeature('emergent')({ user: { organisation_id: 'org-2' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Feature not enabled', code: 'FEATURE_DISABLED' });
  });

  it('403s when there is no req.user', async () => {
    await requireFeature('data_room')({}, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/features.middleware.test.mjs`
Expected: FAIL — cannot resolve `../src/middleware/features.js`.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/middleware/features.js
// ============================================================================
// Org-level feature gate (agency / sub-account entitlements).
//
//   requireFeature(key)  403 FEATURE_DISABLED unless the acting org's
//                        effective features enable `key`. Runs AFTER
//                        authenticate (needs req.user.organisation_id) and
//                        after any role/permission gate on the route.
//
// Resolution = code catalog defaults <- org_features rows (features.service,
// 60s cache), so this adds at most one cached lookup per org per minute.
// Unknown keys throw at wire-time — same "the code defines the keys"
// discipline as lib/permissions.js.
// ============================================================================
import { FEATURE_CATALOG } from '../lib/features.js';
import { featuresService } from '../services/features.service.js';

export function requireFeature(key) {
  if (!Object.prototype.hasOwnProperty.call(FEATURE_CATALOG, key)) {
    throw new Error(`requireFeature: unknown feature key "${key}"`);
  }
  const featureGate = async (req, res, next) => {
    if (!req.user) return res.status(403).json({ error: 'Insufficient permissions' });
    const on = await featuresService.orgHasFeature(req.user.organisation_id, key);
    if (!on) return res.status(403).json({ error: 'Feature not enabled', code: 'FEATURE_DISABLED' });
    next();
  };
  featureGate.featureKey = key; // structural-test hook (route wiring tests)
  return featureGate;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/features.middleware.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/features.js backend/test/features.middleware.test.mjs
ggshield secret scan pre-commit
git commit -m "feat(features): requireFeature org-entitlement middleware"
```

---

### Task 5: Gate the internal route families

**Files:**
- Modify: `backend/src/routes/data-room.routes.js` (router-level gate)
- Modify: `backend/src/routes/call-reporting.routes.js` (router-level gate)
- Modify: `backend/src/routes/integrations.routes.js` (per-route gates on `/emergent*`, `/google-sheets/*`, `/google-sheets-writer/*`)
- Test: `backend/test/features.route-gates.test.mjs`

**Interfaces:**
- Consumes: `requireFeature` (Task 4) with `.featureKey` on the returned gate.
- Produces: every internal route family 403s `FEATURE_DISABLED` for orgs without the flag. Route order/behaviour otherwise unchanged.

- [ ] **Step 1: Write the failing structural tests**

These walk the real Express router stacks so any future route added to a gated family without its gate fails the suite.

```js
// backend/test/features.route-gates.test.mjs
// Structural wiring tests: the internal route families must carry their
// requireFeature gate (featureKey hook). Walks the live router stacks.
import { describe, it, expect } from 'vitest';

const dataRoomRouter = (await import('../src/routes/data-room.routes.js')).default;
const callReportingRouter = (await import('../src/routes/call-reporting.routes.js')).default;
const integrationsRouter = (await import('../src/routes/integrations.routes.js')).default;

// Router-level gate: a .use() layer (no route) whose handle carries featureKey,
// registered before the first route layer.
function routerLevelGate(router) {
  for (const layer of router.stack) {
    if (layer.route) return null; // hit a route before any gate
    if (layer.handle?.featureKey) return layer.handle.featureKey;
  }
  return null;
}

// Per-route gates: for every route whose path matches `test`, every method
// handler chain must include a handle with the expected featureKey.
function ungatedRoutes(router, test, expectedKey) {
  const bad = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    if (!test(path)) continue;
    const keys = layer.route.stack.map((l) => l.handle?.featureKey).filter(Boolean);
    if (!keys.includes(expectedKey)) bad.push(path);
  }
  return bad;
}

describe('internal route families carry their feature gates', () => {
  it('data-room router is gated on data_room', () => {
    expect(routerLevelGate(dataRoomRouter)).toBe('data_room');
  });
  it('call-reporting router is gated on call_reporting', () => {
    expect(routerLevelGate(callReportingRouter)).toBe('call_reporting');
  });
  it('every /emergent* integrations route is gated on emergent', () => {
    expect(ungatedRoutes(integrationsRouter, (p) => p === '/emergent' || p.startsWith('/emergent/'), 'emergent')).toEqual([]);
  });
  it('every /google-sheets/* route is gated on call_reporting', () => {
    const routes = integrationsRouter.stack.filter((l) => l.route?.path.startsWith('/google-sheets/'));
    expect(routes.length).toBeGreaterThan(0);
    expect(ungatedRoutes(integrationsRouter, (p) => p.startsWith('/google-sheets/'), 'call_reporting')).toEqual([]);
  });
  it('every /google-sheets-writer/* route is gated on sheet_export', () => {
    const routes = integrationsRouter.stack.filter((l) => l.route?.path.startsWith('/google-sheets-writer/'));
    expect(routes.length).toBeGreaterThan(0);
    expect(ungatedRoutes(integrationsRouter, (p) => p.startsWith('/google-sheets-writer/'), 'sheet_export')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/features.route-gates.test.mjs`
Expected: FAIL — `routerLevelGate` returns null and `ungatedRoutes` lists every emergent/sheets path.

- [ ] **Step 3: Gate data-room and call-reporting routers**

Both files use the converted idiom. In `backend/src/routes/data-room.routes.js`, after the existing imports add:

```js
import * as features_1 from "../middleware/features.js";
```

and immediately after `const gate = (0, auth_1.requirePermission)('data.export');` add:

```js
// Org entitlement first (agency model): the whole Data Room is an internal
// feature — org_features 'data_room', on only for agency orgs by default.
router.use((0, features_1.requireFeature)('data_room'));
```

(The `router.use` line must come BEFORE the first `router.get(...)`.) In `backend/src/routes/call-reporting.routes.js` add the same import and, directly after `const router = (0, express_1.Router)();`:

```js
router.use((0, features_1.requireFeature)('call_reporting'));
```

- [ ] **Step 4: Gate the integrations routes**

In `backend/src/routes/integrations.routes.js` add the import (same as above) and, after the router is created:

```js
const emergentFeature = (0, features_1.requireFeature)('emergent');
const callReportingFeature = (0, features_1.requireFeature)('call_reporting');
const sheetExportFeature = (0, features_1.requireFeature)('sheet_export');
```

Then list every affected route line:

```bash
grep -n "'/emergent\|'/google-sheets" backend/src/routes/integrations.routes.js
```

For EACH listed route, insert the matching feature const as an extra middleware argument immediately after the path string (before the `requireRole` gate). Example — line 28 becomes:

```js
router.get('/emergent', emergentFeature, (0, auth_1.requireRole)('owner', 'practice_manager'), (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.emergentGet));
```

Apply `emergentFeature` to all six `/emergent*` routes, `callReportingFeature` to every `/google-sheets/...` route, `sheetExportFeature` to every `/google-sheets-writer/...` route. Touch no other routes (`/gohighlevel/*`, `/:provider/*` etc. stay as they are).

- [ ] **Step 5: Run the structural tests + the full suite**

Run: `cd backend && npx vitest run test/features.route-gates.test.mjs`
Expected: PASS (5 tests).
Run: `cd backend && npm test`
Expected: all green — if any existing route test now fails with `FEATURE_DISABLED`, that test exercises a gated route without seeding features; fix by adding to that test file's setup: `supaRec` rows for `org_features` returning `[{ feature: '<key>', enabled: true }]` when `q.table === 'org_features'`, or mock `featuresService` as in Task 4's test.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/data-room.routes.js backend/src/routes/call-reporting.routes.js backend/src/routes/integrations.routes.js backend/test/features.route-gates.test.mjs
ggshield secret scan pre-commit
git commit -m "feat(features): gate Data Room, Emergent, Call Reporting and sheet-export routes on org entitlements"
```

---

### Task 6: Workers skip disabled orgs

**Files:**
- Modify: `backend/src/lib/integrations/emergent-sync.js` (`syncAllOrgs`, line ~458)
- Modify: `backend/src/lib/integrations/google-sheets-sync.js` (`syncAllOrgs`, line ~339)
- Modify: `backend/src/services/sheet-export.service.js` (`refreshAllOrgs` ~line 332, `drainAllOrgs` ~line 346)
- Test: `backend/test/features.worker-skip.test.mjs`

**Interfaces:**
- Consumes: `featuresService.orgHasFeature` (Task 3).
- Produces: nightly/cron fan-outs push `{ orgId, skipped: 'feature_disabled' }` and do no work for orgs without the flag. Belt-and-braces — only feature-enabled orgs can connect these integrations, but a later flag flip must stop the workers too.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/features.worker-skip.test.mjs
// Worker fan-outs must skip orgs whose feature flag is off.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/services/features.service.js', () => ({
  featuresService: { orgHasFeature: vi.fn() },
}));
vi.mock('../src/repositories/sheet.repository.js', () => ({
  sheetRepository: { listConfiguredSources: vi.fn() },
}));

const { featuresService } = await import('../src/services/features.service.js');
const { sheetRepository } = await import('../src/repositories/sheet.repository.js');
const emergentSync = await import('../src/lib/integrations/emergent-sync.js');
const sheetsSync = await import('../src/lib/integrations/google-sheets-sync.js');
const { sheetExportService } = await import('../src/services/sheet-export.service.js');
const { sheetExportRepository } = await import('../src/repositories/sheet-export.repository.js');

describe('worker feature skips', () => {
  beforeEach(() => {
    featuresService.orgHasFeature.mockReset();
    featuresService.orgHasFeature.mockResolvedValue(false);
    supaRec.resultProvider = (q) =>
      q.table === 'integrations'
        ? { data: [{ organisation_id: 'org-a' }], error: null }
        : { data: [], error: null };
  });

  it('emergent syncAllOrgs skips a disabled org without syncing', async () => {
    const results = await emergentSync.syncAllOrgs();
    expect(results).toEqual([{ orgId: 'org-a', skipped: 'feature_disabled' }]);
    expect(featuresService.orgHasFeature).toHaveBeenCalledWith('org-a', 'emergent');
  });

  it('google-sheets syncAllOrgs skips a disabled org', async () => {
    sheetRepository.listConfiguredSources.mockResolvedValue([{ organisation_id: 'org-a', id: 's1' }]);
    const results = await sheetsSync.syncAllOrgs();
    expect(results).toEqual([{ orgId: 'org-a', sourceId: 's1', skipped: 'feature_disabled' }]);
    expect(featuresService.orgHasFeature).toHaveBeenCalledWith('org-a', 'call_reporting');
  });

  it('sheet-export refresh/drain skip a disabled org', async () => {
    vi.spyOn(sheetExportRepository, 'orgsWithWriter').mockResolvedValue(['org-a']);
    const refreshSpy = vi.spyOn(sheetExportService, 'refreshOrg');
    const drainSpy = vi.spyOn(sheetExportService, 'drainOrg');
    expect(await sheetExportService.refreshAllOrgs()).toEqual([{ orgId: 'org-a', skipped: 'feature_disabled' }]);
    expect(await sheetExportService.drainAllOrgs()).toEqual([{ orgId: 'org-a', skipped: 'feature_disabled' }]);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(drainSpy).not.toHaveBeenCalled();
    expect(featuresService.orgHasFeature).toHaveBeenCalledWith('org-a', 'sheet_export');
  });
});
```

Note: if `sheet.repository.js` / `sheet-export.repository.js` export names differ, check the imports at the top of `google-sheets-sync.js` / `sheet-export.service.js` and mirror them exactly in the `vi.mock` factories.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/features.worker-skip.test.mjs`
Expected: FAIL — results lack `skipped` entries (real sync paths run or crash on the mocked repos).

- [ ] **Step 3: Add the guards**

In `emergent-sync.js`, add near the other imports (this file uses the converted idiom):

```js
import * as features_service_1 from "../../services/features.service.js";
```

In `syncAllOrgs`'s loop, before the `try`:

```js
    for (const { organisation_id: orgId } of data ?? []) {
        if (!(await features_service_1.featuresService.orgHasFeature(orgId, 'emergent'))) {
            results.push({ orgId, skipped: 'feature_disabled' });
            continue;
        }
        try {
```

In `google-sheets-sync.js` (same import line), inside `syncAllOrgs`'s `for (const s of sources)` before the `try`:

```js
        if (!(await features_service_1.featuresService.orgHasFeature(s.organisation_id, 'call_reporting'))) {
            results.push({ orgId: s.organisation_id, sourceId: s.id, skipped: 'feature_disabled' });
            continue;
        }
```

In `sheet-export.service.js` add `import { featuresService } from './features.service.js';` (match the file's existing import idiom) and in BOTH `refreshAllOrgs` and `drainAllOrgs` loops before the `try`:

```js
            if (!(await featuresService.orgHasFeature(orgId, 'sheet_export'))) {
                results.push({ orgId, skipped: 'feature_disabled' });
                continue;
            }
```

- [ ] **Step 4: Run the new tests + the existing sync suites**

Run: `cd backend && npx vitest run test/features.worker-skip.test.mjs`
Expected: PASS (3 tests).
Run: `cd backend && npx vitest run test/ -t sheet` and `npx vitest run` (full)
Expected: all green — existing emergent/sheets/sheet-export tests exercise `syncOrg`/`fullSync`/`refreshOrg` directly (not the fan-outs), so they should be untouched; any fan-out test that fails needs `featuresService` mocked true, same shape as this task's test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/emergent-sync.js backend/src/lib/integrations/google-sheets-sync.js backend/src/services/sheet-export.service.js backend/test/features.worker-skip.test.mjs
ggshield secret scan pre-commit
git commit -m "feat(features): nightly fan-outs skip orgs without the feature flag"
```

---

### Task 7: `/auth/me` returns `features`

**Files:**
- Modify: `backend/src/controllers/auth.controller.js` (the `me` handler)
- Test: `backend/test/auth.me-features.test.mjs`

**Interfaces:**
- Consumes: `featuresService.enabledKeys` (Task 3).
- Produces: `GET /auth/me` response gains `features: string[]` (enabled keys for the caller's org). Consumed by Tasks 8–9 via `useMe()`.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/auth.me-features.test.mjs
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/features.service.js', () => ({
  featuresService: { enabledKeys: vi.fn().mockResolvedValue(['finance', 'crm', 'data_room']) },
}));
vi.mock('../src/services/auth.service.js', () => ({
  authService: { organisationName: vi.fn().mockResolvedValue('Test Org') },
}));

const { authController } = await import('../src/controllers/auth.controller.js');
const { featuresService } = await import('../src/services/features.service.js');

describe('GET /auth/me', () => {
  it('includes the enabled feature keys for the caller org', async () => {
    const req = {
      user: {
        id: 'u1', email: 'o@t.dev', role: 'owner',
        organisation_id: 'org-1', permissions: { 'crm.view': true },
      },
    };
    const res = { json: vi.fn() };
    await authController.me(req, res);
    expect(featuresService.enabledKeys).toHaveBeenCalledWith('org-1');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ features: ['finance', 'crm', 'data_room'] }),
    );
  });
});
```

Note: `auth.controller.js` may import more services than `auth.service.js`; if the import fails on unmocked side effects, add `vi.mock` stubs for whatever it pulls in, following `test/setup.js`'s dummy-creds pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/auth.me-features.test.mjs`
Expected: FAIL — `res.json` called without a `features` property.

- [ ] **Step 3: Implement**

In `auth.controller.js` add the converted-idiom import:

```js
import * as features_service_1 from "../services/features.service.js";
```

and in the `me` handler's `res.json({ ... })` object, after the `permissions:` line, add:

```js
            // Org-level entitlements (agency model) — drives nav/page gating.
            features: await features_service_1.featuresService.enabledKeys(req.user.organisation_id),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/auth.me-features.test.mjs`
Expected: PASS. Then `npm test` — full suite green (any existing `/auth/me` shape test needs the new key added to its expectation).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/auth.controller.js backend/test/auth.me-features.test.mjs
ggshield secret scan pre-commit
git commit -m "feat(auth): /auth/me returns org feature entitlements"
```

---

### Task 8: Frontend nav gating

**Files:**
- Modify: `frontend/hooks/useMe.ts` (Me type)
- Modify: `frontend/lib/permissions.ts` (`ROUTE_FEATURE`, `featureAllowsRoute`, `visibleNavSections`)
- Modify: every caller of `visibleNavSections(` (find with `grep -rn "visibleNavSections(" frontend --include="*.tsx" --include="*.ts"` — at minimum `frontend/components/layout/sidebar.tsx`)

**Interfaces:**
- Consumes: `Me.features?: string[]` from `/auth/me` (Task 7).
- Produces: `featureAllowsRoute(routeId, features)`; `visibleNavSections(role, permissions, features?)` — third arg optional; `undefined` features (backend predating the field) allows everything, `[]` hides feature-bound routes. Task 9 reuses the same undefined-allows convention.

- [ ] **Step 1: Add `features` to the Me type**

In `frontend/hooks/useMe.ts`, inside `export interface Me { ... }` after `permissions?`:

```ts
  /** Enabled org-level feature keys (agency model). Absent on older backends. */
  features?: string[];
```

- [ ] **Step 2: Add the route→feature map and filter**

In `frontend/lib/permissions.ts`, below `ROUTE_PERMISSION`:

```ts
/**
 * Route ids that additionally require an org-level feature (agency model).
 * Enforcement lives in the backend (requireFeature); this only mirrors it in
 * nav. `features === undefined` (backend without the field yet) allows —
 * the API stays the boundary.
 */
export const ROUTE_FEATURE: Record<string, string> = {
  'call-reporting': 'call_reporting',
  'data-summaries': 'data_room',
  'data-dentally': 'data_room',
  'data-google-ads': 'data_room',
  'data-meta-ads': 'data_room',
  'data-gohighlevel': 'data_room',
  'data-emergent': 'data_room',
};

export function featureAllowsRoute(
  routeId: string,
  features: string[] | undefined | null,
): boolean {
  const key = ROUTE_FEATURE[routeId];
  if (!key) return true;
  if (features === undefined || features === null) return true;
  return features.includes(key);
}
```

Then change `visibleNavSections` to accept and apply the third argument:

```ts
export function visibleNavSections(
  role: string | undefined,
  permissions: Permissions | null | undefined,
  features?: string[] | null,
): NavSection[] {
  const out: NavSection[] = [];
  for (const section of NAV) {
    const items = section.items.filter((i) =>
      (role === 'analyst'
        ? isDataRoomRoute(i.id) && canAccessRoute(i.id, permissions)
        : canAccessRoute(i.id, permissions)) && featureAllowsRoute(i.id, features),
    );
    if (items.length > 0) out.push({ ...section, items });
  }
  return out;
}
```

- [ ] **Step 3: Pass features at every call site**

Run: `grep -rn "visibleNavSections(" frontend --include="*.tsx" --include="*.ts"` (excluding the definition). For each caller that has `me` from `useMe()` in scope (sidebar.tsx does), append the third argument, e.g.:

```ts
visibleNavSections(me?.role, me?.permissions, me?.features)
```

If a caller has no `me` in scope, add `const { data: me } = useMe();` following sidebar.tsx's existing usage.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both clean. (No frontend test framework — unchanged.)

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/useMe.ts frontend/lib/permissions.ts frontend/components/layout/sidebar.tsx
# plus any other callers changed in Step 3
ggshield secret scan pre-commit
git commit -m "feat(frontend): nav hides feature-gated routes per org entitlements"
```

---

### Task 9: FeatureGate pages + Integrations panels

**Files:**
- Create: `frontend/components/FeatureGate.tsx`
- Modify: `frontend/app/(dashboard)/data-summaries/page.tsx`, `data-dentally/page.tsx`, `data-google-ads/page.tsx`, `data-meta-ads/page.tsx`, `data-gohighlevel/page.tsx`, `data-emergent/page.tsx` (feature `data_room`), `frontend/app/(dashboard)/call-reporting/page.tsx` (feature `call_reporting`)
- Modify: `frontend/features/system/components/IntegrationsScreen.tsx` (lines ~213–219)

**Interfaces:**
- Consumes: `Me.features` (Task 8's undefined-allows convention).
- Produces: `<FeatureGate feature="...">{children}</FeatureGate>` — renders children when allowed, else a not-available card.

- [ ] **Step 1: Create FeatureGate**

```tsx
// frontend/components/FeatureGate.tsx
'use client';
import { useMe } from '@/hooks/useMe';

/**
 * Org-level feature gate (agency model). Renders children only when the org's
 * effective features include `feature`. `features === undefined` (backend
 * without the field yet) renders children — the API is the real boundary,
 * this is presentation. Loading renders nothing to avoid a flash.
 */
export function FeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  if (isLoading) return null;
  const features = me?.features;
  if (features !== undefined && !features.includes(feature)) {
    return (
      <div className="card-padded" style={{ margin: 24 }}>
        <h2 className="display" style={{ fontSize: 18, marginBottom: 6 }}>Not available</h2>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          This feature is not enabled for your organisation.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 2: Wrap the seven pages**

Each page under `app/(dashboard)/` is a thin wrapper returning its screen component. Read each of the seven files first, then wrap the returned screen. Example for `data-dentally/page.tsx` — from:

```tsx
export default function Page() {
  return <ScreenComponent />;
}
```

to:

```tsx
import { FeatureGate } from '@/components/FeatureGate';

export default function Page() {
  return (
    <FeatureGate feature="data_room">
      <ScreenComponent />
    </FeatureGate>
  );
}
```

(`ScreenComponent` = whatever each page already returns — do not rename it.) Use `feature="data_room"` for the six `data-*` pages and `feature="call_reporting"` for `call-reporting/page.tsx`. If a page exports metadata or is a server component wrapper, keep those parts untouched and wrap only the rendered screen.

- [ ] **Step 3: Gate the Integrations panels**

In `frontend/features/system/components/IntegrationsScreen.tsx`: add `import { useMe } from '@/hooks/useMe';` (if not already imported) and inside the component body:

```tsx
  const { data: me } = useMe();
  // undefined = backend predates features (allow); [] = nothing enabled.
  const hasFeature = (k: string) => !me?.features || me.features.includes(k);
```

Then change the panel block (currently lines ~213–219) to:

```tsx
      {dentallyConnected && <DentallyPracticeMapping />}
      {dentallyConnected && <DentallyWebhookPanel />}
      {ghlPanelVisible && <GoHighLevelPanel />}
      <QuickBooksPanel />
      {hasFeature('emergent') && <EmergentPracticeMapping />}
      {hasFeature('emergent') && <EmergentPanel />}
      {hasFeature('call_reporting') && <GoogleSheetsPanel />}
      {hasFeature('sheet_export') && <GoogleSheetsWriterPanel />}
      {googleAdsConnected && <AdAccountSelector provider="google_ads" label="Google Ads" />}
      {metaAdsConnected && <AdAccountSelector provider="meta_ads" label="Meta Ads" />}
```

(The mapping components — `DentallyPracticeMapping`, `AdAccountSelector`, the GHL practice dropdown — become agency-actor-gated in phase A2, per the spec. Do not touch them in A1.)

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: all clean. (Stop any running `npm run dev` first — shared `.next`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/FeatureGate.tsx "frontend/app/(dashboard)/data-summaries/page.tsx" "frontend/app/(dashboard)/data-dentally/page.tsx" "frontend/app/(dashboard)/data-google-ads/page.tsx" "frontend/app/(dashboard)/data-meta-ads/page.tsx" "frontend/app/(dashboard)/data-gohighlevel/page.tsx" "frontend/app/(dashboard)/data-emergent/page.tsx" "frontend/app/(dashboard)/call-reporting/page.tsx" frontend/features/system/components/IntegrationsScreen.tsx
ggshield secret scan pre-commit
git commit -m "feat(frontend): FeatureGate pages + entitlement-gated Integrations panels"
```

---

### Task 10: Docs, full verification, rollout checklist

**Files:**
- Modify: `docs/API.md` (features field + FEATURE_DISABLED semantics)

**Interfaces:**
- Consumes: everything above. Produces: shippable A1.

- [ ] **Step 1: Document the API changes**

In `docs/API.md`: add `features: string[]` to the documented `GET /auth/me` response (description: "enabled org-level feature keys — catalog in `backend/src/lib/features.js`; internal features default off, product modules default on"), and a short section "Feature-gated endpoints" listing the four families (`/api/data-room/*`, `/api/integrations/emergent*`, `/api/call-reporting/*` + `/api/integrations/google-sheets/*`, `/api/integrations/google-sheets-writer/*`) with the shared 403 body `{ error: 'Feature not enabled', code: 'FEATURE_DISABLED' }`.

- [ ] **Step 2: Full verification**

```bash
cd backend && npm test && npm run lint && npm run typecheck
cd ../frontend && npm run typecheck && npm run lint && npm run build
```

Expected: backend suite fully green (1500+ tests incl. the ~18 new ones), lint 0 errors, frontend clean.

- [ ] **Step 3: Commit**

```bash
git add docs/API.md
ggshield secret scan pre-commit
git commit -m "docs(api): feature entitlements on /auth/me + FEATURE_DISABLED families"
```

- [ ] **Step 4: Rollout (operator steps — session owner, not CI)**

1. Apply `20260101000133_agency_org_features.sql` on hosted project `mkfhpzjbijbachoonytt` (Supabase MCP `apply_migration`; the file ends with `NOTIFY pgrst`).
2. Verify seeds: `select count(*) from org_features;` (expect 4 × number of orgs) and `select id, name, is_agency from organisations;` (all true).
3. Push `main` → Railway auto-deploys backend + frontend together.
4. Smoke: log in as the owner — Data Room, Call Reporting, Emergent and Sheets panels all still visible (org seeded); `GET /api/data-room/datasets` 200. Phase A2's scratch sub-account will exercise the disabled path end-to-end.

---

## Self-review notes

- **Spec coverage (A1 scope):** migration/seeds → Task 1; catalog incl. module keys + navSection → Task 2; cached resolution + error policy → Task 3; `requireFeature` + 403 shape → Task 4; the four gated families → Task 5; worker skips (incl. emergent nightly, which the spec's webhook note implies) → Task 6; `/auth/me` → Task 7; nav + page + panel hiding → Tasks 8–9; docs + rollout → Task 10. Mapping-control gating, `invalidate` wiring to a toggle endpoint, agency menu, module-key ENFORCEMENT, and the isolation audit are phases A2–A4 by design.
- **Deliberate A1 behaviour:** module keys exist in the catalog and in `/auth/me` but are not yet enforced on routes (A3) — `enabledKeys` therefore includes all modules for every org, which is correct until A3.
- **Type consistency:** `featureGate.featureKey` (Tasks 4/5), `featuresService.{getEffectiveFeatures,orgHasFeature,enabledKeys,invalidate}` (Tasks 3/4/6/7), `Me.features?: string[]` + undefined-allows (Tasks 8/9) — names match across tasks.
