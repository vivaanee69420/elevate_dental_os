# Agency Phase A2 — Menu, Sub-account Lifecycle & Org Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agency owners can list/create sub-accounts, toggle their features, and switch into a sub-account (signed httpOnly cookie) acting as its owner — with mapping controls becoming agency-actor-only powers.

**Architecture:** A signed switch token (HMAC, 12h) is minted by `POST /api/agency/switch`, stored as an httpOnly cookie on the *frontend* origin by a dedicated Next route, and re-injected on every proxied request as an `x-agency-switch` header; `authenticate` re-validates it per request (cached org-meta lookup) and swaps the acting org. New `/api/agency/*` routes reuse `provisionOrgOwner` for sub-account creation. Mapping mutations move behind a `requireAgencyActor` gate.

**Tech Stack:** Express (native ESM), Zod, Supabase serviceClient (manual org filters), Next.js 14 App Router, React Query, vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-saas-feature-gating-and-isolation-design.md` (sections "Agency menu & sub-account lifecycle (A2)", "Org switching (A2)", "Frontend gating")

## Global Constraints

- Backend is native ESM: `import`/`export`, relative imports carry `.js`. No `require`/`module.exports`.
- Repositories: serviceClient + explicit `.eq('organisation_id', …)`. Repos are "queries in, rows out" — no logic.
- Every new endpoint documented in `docs/API.md`. Money in integer pence (not relevant here). British English in UI copy ("organisation").
- No dark mode; no emojis in UI.
- Audit every mutation (audit middleware covers `/api`; agency context must be visible in the log rows).
- The two JWT systems (tenant Supabase vs platform) stay isolated — the switch cookie is a THIRD, narrow credential that only ever *narrows within* the tenant system (agency → child org), set/cleared only by the Next layer.
- TDD throughout; suite must stay green (`cd backend && npm test`), lint 0 errors, frontend typecheck/lint/build clean.

---

### Task 1: Switch-token signing — `lib/agency-switch.js`

**Files:**
- Create: `backend/src/lib/agency-switch.js`
- Test: `backend/test/agency-switch.test.mjs`

**Interfaces:**
- Produces: `signSwitchToken(userId, orgId, ttlMs?) -> string`, `verifySwitchToken(token) -> { userId, orgId }` (throws `Error('invalid_switch_token')` / `Error('switch_token_expired')`), `SWITCH_TTL_MS` (12h default).
- Consumed by: Task 4 (`authenticate`), Task 7 (`agency.service.switch`).

- [ ] **Step 1: Write the failing test**

```js
// backend/test/agency-switch.test.mjs
// Signed agency-switch token: HMAC over base64url JSON {u, o, exp}.
// Secret: AGENCY_SWITCH_SECRET, falling back to OAUTH_STATE_SECRET (already
// required at runtime) — same idiom as webhook-token.js.
import { describe, it, expect } from 'vitest';
import { signSwitchToken, verifySwitchToken, SWITCH_TTL_MS } from '../src/lib/agency-switch.js';

const U = '11111111-1111-1111-1111-111111111111';
const O = '22222222-2222-2222-2222-222222222222';

describe('agency switch token', () => {
  it('round-trips user + org', () => {
    const t = signSwitchToken(U, O);
    expect(verifySwitchToken(t)).toEqual({ userId: U, orgId: O });
  });

  it('defaults to a ~12h expiry', () => {
    expect(SWITCH_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('rejects a tampered payload', () => {
    const t = signSwitchToken(U, O);
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ u: U, o: '33333333-3333-3333-3333-333333333333', exp: Date.now() + 60000 })).toString('base64url');
    expect(() => verifySwitchToken(`${forged}.${sig}`)).toThrow(/invalid_switch_token/);
  });

  it('rejects an expired token', () => {
    const t = signSwitchToken(U, O, -1000);
    expect(() => verifySwitchToken(t)).toThrow(/switch_token_expired/);
  });

  it('rejects garbage', () => {
    expect(() => verifySwitchToken('not-a-token')).toThrow(/invalid_switch_token/);
    expect(() => verifySwitchToken('')).toThrow(/invalid_switch_token/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/agency-switch.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/lib/agency-switch.js
// Agency → sub-account switch token. Layout: base64url(JSON {u,o,exp}) "."
// base64url(HMAC-SHA256(payload)). Unlike webhook-token (stable, no expiry)
// this token expires (~12h) and binds the ACTING USER, so a leaked cookie
// can't be replayed by another account. Secret: AGENCY_SWITCH_SECRET, falling
// back to OAUTH_STATE_SECRET so no new env var is required to boot.
import crypto from 'node:crypto';

export const SWITCH_TTL_MS = 12 * 60 * 60 * 1000;

function getKey() {
  const secret = process.env.AGENCY_SWITCH_SECRET || process.env.OAUTH_STATE_SECRET;
  if (!secret) throw new Error('AGENCY_SWITCH_SECRET/OAUTH_STATE_SECRET missing');
  return crypto.createHash('sha256').update(secret).digest();
}

function sign_(payloadB64) {
  return crypto.createHmac('sha256', getKey()).update(payloadB64).digest('base64url');
}

export function signSwitchToken(userId, orgId, ttlMs = SWITCH_TTL_MS) {
  if (!userId || !orgId) throw new Error('signSwitchToken requires userId and orgId');
  const payloadB64 = Buffer.from(
    JSON.stringify({ u: String(userId), o: String(orgId), exp: Date.now() + ttlMs }),
  ).toString('base64url');
  return `${payloadB64}.${sign_(payloadB64)}`;
}

// Returns { userId, orgId }; throws on tamper or expiry.
export function verifySwitchToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    throw new Error('invalid_switch_token');
  }
  const [payloadB64, sig] = token.split('.');
  const expected = sign_(payloadB64);
  const sigBuf = Buffer.from(sig ?? '', 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('invalid_switch_token');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid_switch_token');
  }
  if (!payload?.u || !payload?.o || typeof payload.exp !== 'number') {
    throw new Error('invalid_switch_token');
  }
  if (Date.now() > payload.exp) throw new Error('switch_token_expired');
  return { userId: payload.u, orgId: payload.o };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/agency-switch.test.mjs`
Expected: PASS (5 tests). Note: `test/setup.js` sets `OAUTH_STATE_SECRET`; if it doesn't, add `process.env.OAUTH_STATE_SECRET ||= 'test-secret'` to the test file's top instead of touching setup.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/agency-switch.js backend/test/agency-switch.test.mjs
ggshield secret scan pre-commit && git commit -m "feat(agency): signed switch token lib (HMAC, 12h, user-bound)"
```

---

### Task 2: Cached org meta — `services/org-meta.service.js`

**Files:**
- Create: `backend/src/services/org-meta.service.js`
- Test: `backend/test/org-meta.service.test.mjs`

**Interfaces:**
- Produces: `orgMetaService.getOrgMeta(orgId) -> Promise<{ id, name, parent_organisation_id, is_agency } | null>` (60s cache; null on error/absent), `orgMetaService.invalidate(orgId?)`.
- Consumed by: Tasks 3, 4, 8 (`/auth/me`).

- [ ] **Step 1: Write the failing test**

```js
// backend/test/org-meta.service.test.mjs
// Cached organisations lookups for agency checks — one query per org per 60s.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

const { orgMetaService } = await import('../src/services/org-meta.service.js');

const ROW = { id: 'org-1', name: 'Agency', parent_organisation_id: null, is_agency: true };

describe('orgMetaService', () => {
  beforeEach(() => {
    orgMetaService.invalidate();
    supaRec.resultProvider = () => ({ data: ROW, error: null });
  });

  it('queries organisations by id and returns the meta row', async () => {
    const meta = await orgMetaService.getOrgMeta('org-1');
    expect(meta).toEqual(ROW);
    expect(supaRec.last.table).toBe('organisations');
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'id', val: 'org-1' }]));
  });

  it('caches per org inside the TTL', async () => {
    const provider = vi.fn(() => ({ data: ROW, error: null }));
    supaRec.resultProvider = provider;
    await orgMetaService.getOrgMeta('org-1');
    await orgMetaService.getOrgMeta('org-1');
    expect(provider).toHaveBeenCalledTimes(1);
    await orgMetaService.getOrgMeta('org-2');
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('returns null (uncached) on error so auth fails safe to home context', async () => {
    supaRec.resultProvider = () => ({ data: null, error: { message: 'boom' } });
    expect(await orgMetaService.getOrgMeta('org-1')).toBeNull();
    // a later good read is not poisoned by a cached null
    supaRec.resultProvider = () => ({ data: ROW, error: null });
    expect(await orgMetaService.getOrgMeta('org-1')).toEqual(ROW);
  });

  it('invalidate(orgId) drops one entry', async () => {
    const provider = vi.fn(() => ({ data: ROW, error: null }));
    supaRec.resultProvider = provider;
    await orgMetaService.getOrgMeta('org-1');
    orgMetaService.invalidate('org-1');
    await orgMetaService.getOrgMeta('org-1');
    expect(provider).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/org-meta.service.test.mjs` — Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```js
// backend/src/services/org-meta.service.js
// Small cached lookup of organisations hierarchy fields, used on the auth hot
// path for agency-switch validation. Mirrors features.service.js's cache
// shape (60s TTL). Errors return null and are NOT cached, so a transient DB
// blip only costs a retry, never a stuck wrong answer.
import { serviceClient } from '../lib/supabase.js';

const TTL_MS = 60_000;
const cache = new Map(); // orgId -> { at, meta }

export const orgMetaService = {
  async getOrgMeta(orgId) {
    if (!orgId) return null;
    const hit = cache.get(orgId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.meta;
    const { data, error } = await serviceClient
      .from('organisations')
      .select('id, name, parent_organisation_id, is_agency')
      .eq('id', orgId)
      .maybeSingle();
    if (error || !data) return null;
    cache.set(orgId, { at: Date.now(), meta: data });
    return data;
  },

  invalidate(orgId) {
    if (orgId) cache.delete(orgId);
    else cache.clear();
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/org-meta.service.test.mjs` — Expected: PASS. (If `supaRec`'s query recorder lacks `.maybeSingle()`, extend `test/setup.js`'s builder the same way `.single()` is recorded — check before assuming.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/org-meta.service.js backend/test/org-meta.service.test.mjs
ggshield secret scan pre-commit && git commit -m "feat(agency): cached org-meta lookup service"
```

---

### Task 3: Agency gates — `middleware/agency.js`

**Files:**
- Create: `backend/src/middleware/agency.js`
- Test: `backend/test/agency.middleware.test.mjs`

**Interfaces:**
- Consumes: `orgMetaService.getOrgMeta` (Task 2); `req.agencyContext` (set by Task 4).
- Produces: `isAgencyActor(req) -> Promise<boolean>`; `requireAgencyActor(req,res,next)`; `requireAgencyOwner(req,res,next)` (both 403 `{ error:'Agency access required', code:'AGENCY_ONLY' }`); `agencyHomeOrgId(req) -> string` (the caller's agency org id whether or not switched).

- [ ] **Step 1: Write the failing test**

```js
// backend/test/agency.middleware.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn() },
}));
const { orgMetaService } = await import('../src/services/org-meta.service.js');
const { isAgencyActor, requireAgencyActor, requireAgencyOwner, agencyHomeOrgId } =
  await import('../src/middleware/agency.js');

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('agency middleware', () => {
  beforeEach(() => orgMetaService.getOrgMeta.mockReset());

  it('switched context is an agency actor without any lookup', async () => {
    const req = { user: { role: 'owner', organisation_id: 'sub-1' }, agencyContext: { actorUserId: 'u1', homeOrgId: 'agency-1' } };
    expect(await isAgencyActor(req)).toBe(true);
    expect(orgMetaService.getOrgMeta).not.toHaveBeenCalled();
    expect(agencyHomeOrgId(req)).toBe('agency-1');
  });

  it('unswitched owner of an agency org is an actor (cached lookup)', async () => {
    orgMetaService.getOrgMeta.mockResolvedValue({ id: 'org-1', is_agency: true, parent_organisation_id: null, name: 'A' });
    const req = { user: { role: 'owner', organisation_id: 'org-1' } };
    expect(await isAgencyActor(req)).toBe(true);
    expect(agencyHomeOrgId(req)).toBe('org-1');
  });

  it('owner of a non-agency org is NOT an actor', async () => {
    orgMetaService.getOrgMeta.mockResolvedValue({ id: 'sub-1', is_agency: false, parent_organisation_id: 'org-1', name: 'S' });
    expect(await isAgencyActor({ user: { role: 'owner', organisation_id: 'sub-1' } })).toBe(false);
  });

  it('non-owner of an agency org is NOT an actor', async () => {
    orgMetaService.getOrgMeta.mockResolvedValue({ id: 'org-1', is_agency: true, parent_organisation_id: null, name: 'A' });
    expect(await isAgencyActor({ user: { role: 'practice_manager', organisation_id: 'org-1' } })).toBe(false);
  });

  it('requireAgencyActor 403s AGENCY_ONLY for non-actors and passes actors', async () => {
    orgMetaService.getOrgMeta.mockResolvedValue({ id: 'sub-1', is_agency: false, parent_organisation_id: 'org-1', name: 'S' });
    const res = mockRes(); const next = vi.fn();
    await requireAgencyActor({ user: { role: 'owner', organisation_id: 'sub-1' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Agency access required', code: 'AGENCY_ONLY' });
    expect(next).not.toHaveBeenCalled();

    const res2 = mockRes(); const next2 = vi.fn();
    await requireAgencyOwner({ user: { role: 'owner', organisation_id: 'x' }, agencyContext: { actorUserId: 'u', homeOrgId: 'org-1' } }, res2, next2);
    expect(next2).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/agency.middleware.test.mjs` — Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```js
// backend/src/middleware/agency.js
// Agency-actor gates. An "agency actor" is the real user being an OWNER of an
// org with is_agency=true — whether acting at home or switched into a child
// (authenticate stamps req.agencyContext only after validating exactly that,
// so a switched context short-circuits true). requireAgencyOwner is the gate
// for /api/agency/* (handlers act on the HOME org via agencyHomeOrgId);
// requireAgencyActor gates mapping mutations (handlers act on the acting org).
// The predicate is identical today; two names keep intent readable and let
// the definitions diverge later without a route sweep.
import { orgMetaService } from '../services/org-meta.service.js';

export async function isAgencyActor(req) {
  if (req.agencyContext) return true;
  if (!req.user || req.user.role !== 'owner') return false;
  const meta = await orgMetaService.getOrgMeta(req.user.organisation_id);
  return meta?.is_agency === true;
}

// The caller's agency (home) org id — where /api/agency/* operations act.
export function agencyHomeOrgId(req) {
  return req.agencyContext?.homeOrgId ?? req.user.organisation_id;
}

function gate() {
  return async (req, res, next) => {
    try {
      if (await isAgencyActor(req)) return next();
    } catch (err) {
      req.log?.warn({ err }, 'agency gate lookup failed');
    }
    return res.status(403).json({ error: 'Agency access required', code: 'AGENCY_ONLY' });
  };
}

export const requireAgencyActor = gate();
export const requireAgencyOwner = gate();
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run test/agency.middleware.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/agency.js backend/test/agency.middleware.test.mjs
ggshield secret scan pre-commit && git commit -m "feat(agency): requireAgencyActor/requireAgencyOwner gates"
```

---

### Task 4: `authenticate` honours the switch header

**Files:**
- Modify: `backend/src/middleware/auth.js` (after the status gate, before `req.user` is finalised)
- Test: `backend/test/auth.agency-switch.test.mjs`

**Interfaces:**
- Consumes: `verifySwitchToken` (Task 1), `orgMetaService.getOrgMeta` (Task 2).
- Produces: on a valid switch — `req.user.organisation_id = <target>`, `req.user.role = 'owner'`, `req.user.permissions = defaultPermissionsForRole('owner')`, `req.agencyContext = { actorUserId, homeOrgId }`. Invalid/absent → untouched home context, `req.agencyContext` undefined.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/auth.agency-switch.test.mjs
// authenticate + x-agency-switch: only a valid, user-bound token whose target
// is a child of the caller's agency org swaps the acting context. Every
// failure mode silently falls back to home context (never a 401/403 — the
// cookie may simply be stale).
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.OAUTH_STATE_SECRET ||= 'test-secret';

const AUTH_UID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const HOME = 'a0000000-0000-0000-0000-000000000001';
const SUB = 'a0000000-0000-0000-0000-000000000002';

vi.mock('../src/lib/supabase.js', async (orig) => {
  const mod = await orig();
  return {
    ...mod,
    verifyToken: vi.fn(async () => ({ id: AUTH_UID })),
    serviceClient: {
      ...mod.serviceClient,
      rpc: vi.fn(async () => ({
        data: {
          user: { id: AUTH_UID, email: 'o@a.dev', organisation_id: HOME, role: 'owner', permissions: {}, status: 'active' },
          role_permissions: [],
        },
        error: null,
      })),
      from: vi.fn(() => ({ update: () => ({ eq: () => ({ then: (r) => r() }) }) })),
    },
  };
});
vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn() },
}));

const { orgMetaService } = await import('../src/services/org-meta.service.js');
const { authenticate } = await import('../src/middleware/auth.js');
const { signSwitchToken } = await import('../src/lib/agency-switch.js');

function run(headers = {}) {
  const req = { headers: { authorization: 'Bearer t', ...headers }, log: { warn: vi.fn() } };
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  return new Promise((resolve) => authenticate(req, res, () => resolve({ req, res })));
}

const metaFor = (rows) => (id) => Promise.resolve(rows[id] ?? null);

describe('authenticate agency switch', () => {
  beforeEach(() => orgMetaService.getOrgMeta.mockReset());

  it('valid token + agency home + child target -> acts as sub-account owner', async () => {
    orgMetaService.getOrgMeta.mockImplementation(metaFor({
      [HOME]: { id: HOME, name: 'Agency', is_agency: true, parent_organisation_id: null },
      [SUB]: { id: SUB, name: 'Sub', is_agency: false, parent_organisation_id: HOME },
    }));
    const { req } = await run({ 'x-agency-switch': signSwitchToken(AUTH_UID, SUB) });
    expect(req.user.organisation_id).toBe(SUB);
    expect(req.user.role).toBe('owner');
    expect(req.agencyContext).toEqual({ actorUserId: AUTH_UID, homeOrgId: HOME });
  });

  it('token bound to a DIFFERENT user is ignored', async () => {
    const { req } = await run({ 'x-agency-switch': signSwitchToken('someone-else', SUB) });
    expect(req.user.organisation_id).toBe(HOME);
    expect(req.agencyContext).toBeUndefined();
  });

  it('target that is not a child of home is ignored', async () => {
    orgMetaService.getOrgMeta.mockImplementation(metaFor({
      [HOME]: { id: HOME, name: 'Agency', is_agency: true, parent_organisation_id: null },
      [SUB]: { id: SUB, name: 'Other', is_agency: false, parent_organisation_id: 'a0000000-0000-0000-0000-00000000000f' },
    }));
    const { req } = await run({ 'x-agency-switch': signSwitchToken(AUTH_UID, SUB) });
    expect(req.user.organisation_id).toBe(HOME);
    expect(req.agencyContext).toBeUndefined();
  });

  it('home org not an agency -> ignored', async () => {
    orgMetaService.getOrgMeta.mockImplementation(metaFor({
      [HOME]: { id: HOME, name: 'Org', is_agency: false, parent_organisation_id: null },
      [SUB]: { id: SUB, name: 'Sub', is_agency: false, parent_organisation_id: HOME },
    }));
    const { req } = await run({ 'x-agency-switch': signSwitchToken(AUTH_UID, SUB) });
    expect(req.agencyContext).toBeUndefined();
  });

  it('forged/garbage token -> ignored', async () => {
    const { req } = await run({ 'x-agency-switch': 'garbage.token' });
    expect(req.user.organisation_id).toBe(HOME);
    expect(req.agencyContext).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/auth.agency-switch.test.mjs` — Expected: the "valid token" test FAILS (org not swapped); ignore-path tests may already pass. NOTE: if the `vi.mock` of `lib/supabase.js` fights `test/setup.js`'s harness, prefer the harness (`supaRec`) for the users query and only mock `verifyToken` — adapt mechanically, keep the assertions identical.

- [ ] **Step 3: Implement in `middleware/auth.js`**

Add imports at the top:

```js
import { verifySwitchToken } from '../lib/agency-switch.js';
import { orgMetaService } from '../services/org-meta.service.js';
```

Insert AFTER the pending/rejected status gate and BEFORE `req.user = {…}` is built (i.e. right above line ~105), replacing the plain assignment with a computed context:

```js
    // Agency switch (phase A2): a signed httpOnly cookie, forwarded by the
    // Next proxy as x-agency-switch, lets an agency OWNER act as the owner of
    // a CHILD org. Re-validated per request against the DB (cached 60s):
    // token user must be THIS user, home org must be an agency, target's
    // parent must be home. Any failure -> silently act at home (stale cookie
    // is a UX non-event, never an error).
    let actingOrgId = user.organisation_id;
    let actingRole = user.role;
    let actingPermissions = permissions;
    let agencyContext;
    const switchHeader = req.headers['x-agency-switch'];
    if (switchHeader && user.role === 'owner') {
      try {
        const { userId: tokenUser, orgId: targetOrg } = verifySwitchToken(switchHeader);
        if (tokenUser === user.id && targetOrg !== user.organisation_id) {
          const [home, target] = await Promise.all([
            orgMetaService.getOrgMeta(user.organisation_id),
            orgMetaService.getOrgMeta(targetOrg),
          ]);
          if (home?.is_agency === true && target?.parent_organisation_id === user.organisation_id) {
            actingOrgId = targetOrg;
            actingRole = 'owner';
            actingPermissions = defaultPermissionsForRole('owner');
            agencyContext = { actorUserId: user.id, homeOrgId: user.organisation_id };
          }
        }
      } catch (switchErr) {
        req.log?.debug?.({ err: switchErr }, 'agency switch token ignored');
      }
    }

    req.user = {
      id: user.id,
      email: user.email,
      organisation_id: actingOrgId,
      role: actingRole,
      permissions: actingPermissions,
      access_token: token,
    };
    if (agencyContext) req.agencyContext = agencyContext;
```

(`defaultPermissionsForRole` is already imported in this file.)

- [ ] **Step 4: Run tests** — `npx vitest run test/auth.agency-switch.test.mjs` then the neighbouring auth suites: `npx vitest run test/auth.grantceiling.test.mjs test/auth.me-features.test.mjs` and finally `npm test`. Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/auth.js backend/test/auth.agency-switch.test.mjs
ggshield secret scan pre-commit && git commit -m "feat(agency): authenticate honours validated x-agency-switch context"
```

---

### Task 5: Audit rows carry the agency context

**Files:**
- Modify: `backend/src/middleware/audit.js`
- Test: `backend/test/audit.agency.test.mjs`

**Interfaces:**
- Consumes: `req.agencyContext` (Task 4). audit_log already has a `diff JSONB` column (db/01_schema.sql:601) — no migration.
- Produces: switched mutations insert `diff: { via_agency: { home_organisation_id, actor_user_id } }`; unswitched rows keep `diff` absent.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/audit.agency.test.mjs
// Switched mutations are audited with the ACTING org (organisation_id),
// the REAL actor (user_id) and a via_agency marker in diff.
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const insert = vi.hoisted(() => vi.fn(() => ({ then: (ok) => ok({ error: null }) })));
vi.mock('../src/lib/supabase.js', () => ({
  serviceClient: { from: vi.fn(() => ({ insert })) },
}));
const { audit } = await import('../src/middleware/audit.js');

function fire(reqExtra = {}) {
  const res = new EventEmitter();
  res.statusCode = 200;
  const req = {
    method: 'POST',
    originalUrl: '/api/practices/11111111-1111-1111-1111-111111111111',
    ip: '1.2.3.4',
    headers: {},
    user: { id: 'actor-1', organisation_id: 'sub-1' },
    ...reqExtra,
  };
  audit(req, res, () => {});
  res.emit('finish');
  return insert.mock.calls.at(-1)[0];
}

describe('audit agency context', () => {
  it('stamps via_agency when switched', () => {
    const row = fire({ agencyContext: { actorUserId: 'actor-1', homeOrgId: 'agency-1' } });
    expect(row.organisation_id).toBe('sub-1');
    expect(row.user_id).toBe('actor-1');
    expect(row.diff).toEqual({ via_agency: { home_organisation_id: 'agency-1', actor_user_id: 'actor-1' } });
  });

  it('leaves diff absent when not switched', () => {
    const row = fire();
    expect(row.diff).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/audit.agency.test.mjs` (first test fails: no diff).

- [ ] **Step 3: Implement** — in `audit.js`, extend the insert object:

```js
            organisation_id: req.user.organisation_id,
            user_id: req.user.id,
            action,
            entity_type: entityType,
            entity_id: entityId,
            // Agency switch (A2): keep the acting org as organisation_id and
            // the real human as user_id, and mark the row so "who did this"
            // is answerable from the log alone.
            diff: req.agencyContext
                ? { via_agency: { home_organisation_id: req.agencyContext.homeOrgId, actor_user_id: req.agencyContext.actorUserId } }
                : undefined,
            ip_address: req.ip,
            user_agent: req.headers['user-agent'],
```

- [ ] **Step 4: Run** — `npx vitest run test/audit.agency.test.mjs` → PASS; then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/audit.js backend/test/audit.agency.test.mjs
ggshield secret scan pre-commit && git commit -m "feat(agency): audit rows carry via_agency context"
```

---

### Task 6: Agency data layer — model + repository

**Files:**
- Create: `backend/src/models/agency.model.js`, `backend/src/repositories/agency.repository.js`
- Test: `backend/test/agency.repository.test.mjs`

**Interfaces:**
- Produces (model): `createSubaccountSchema` (`{ organisation_name, owner_email, owner_name }`), `switchSchema` (`{ orgId: uuid }`), `featureToggleSchema` (`{ feature: <FEATURE_KEYS enum>, enabled: boolean }`).
- Produces (repository): `agencyRepository.childOrgs(agencyOrgId)`, `.orgIntegrations(orgIds)`, `.featureRows(orgId)`, `.upsertFeature(orgId, feature, enabled)`, `.setParent(orgId, parentOrgId)`.
- Consumed by: Task 7.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/agency.repository.test.mjs
// Org-scoped queries only — the AGENCY org id scopes children; feature writes
// target one explicit child org id (validated by the service, not here).
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

const { agencyRepository } = await import('../src/repositories/agency.repository.js');

describe('agencyRepository', () => {
  beforeEach(() => { supaRec.resultProvider = () => ({ data: [], error: null }); });

  it('childOrgs filters organisations by parent_organisation_id', async () => {
    await agencyRepository.childOrgs('agency-1');
    expect(supaRec.last.table).toBe('organisations');
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'parent_organisation_id', val: 'agency-1' }]));
  });

  it('featureRows scopes org_features to one org', async () => {
    await agencyRepository.featureRows('sub-1');
    expect(supaRec.last.table).toBe('org_features');
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'organisation_id', val: 'sub-1' }]));
  });

  it('upsertFeature writes an org-scoped override row', async () => {
    await agencyRepository.upsertFeature('sub-1', 'crm', false);
    expect(supaRec.last.table).toBe('org_features');
  });

  it('setParent stamps parent_organisation_id on exactly one org', async () => {
    await agencyRepository.setParent('sub-1', 'agency-1');
    expect(supaRec.last.table).toBe('organisations');
    expect(supaRec.last.eqs).toEqual(expect.arrayContaining([{ col: 'id', val: 'sub-1' }]));
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/agency.repository.test.mjs`.

- [ ] **Step 3: Implement**

```js
// backend/src/models/agency.model.js
import * as zod_1 from "zod";
import { FEATURE_KEYS } from "../lib/features.js";

export const createSubaccountSchema = zod_1.z.object({
    organisation_name: zod_1.z.string().trim().min(2).max(120),
    owner_email: zod_1.z.string().trim().email(),
    owner_name: zod_1.z.string().trim().min(1).max(120),
});

export const switchSchema = zod_1.z.object({
    orgId: zod_1.z.string().uuid(),
});

export const featureToggleSchema = zod_1.z.object({
    feature: zod_1.z.enum(FEATURE_KEYS),
    enabled: zod_1.z.boolean(),
});
```

```js
// backend/src/repositories/agency.repository.js
// Agency hierarchy data access. Children are scoped by parent_organisation_id
// = the AGENCY org id; feature/parent writes take one explicit child org id —
// the SERVICE validates child-of-agency before calling in.
import { serviceClient } from "../lib/supabase.js";

export const agencyRepository = {
    async childOrgs(agencyOrgId) {
        const { data, error } = await serviceClient
            .from('organisations')
            .select('id, name, created_at')
            .eq('parent_organisation_id', agencyOrgId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data ?? [];
    },

    // Connected-integration summary for the sub-account list. One IN query.
    async orgIntegrations(orgIds) {
        if (!orgIds.length) return [];
        const { data, error } = await serviceClient
            .from('integrations')
            .select('organisation_id, provider, status')
            .in('organisation_id', orgIds);
        if (error) throw error;
        return data ?? [];
    },

    async featureRows(orgId) {
        const { data, error } = await serviceClient
            .from('org_features')
            .select('feature, enabled')
            .eq('organisation_id', orgId);
        if (error) throw error;
        return data ?? [];
    },

    async upsertFeature(orgId, feature, enabled) {
        const { error } = await serviceClient
            .from('org_features')
            .upsert(
                { organisation_id: orgId, feature, enabled, updated_at: new Date().toISOString() },
                { onConflict: 'organisation_id,feature' },
            );
        if (error) throw error;
    },

    async setParent(orgId, parentOrgId) {
        const { error } = await serviceClient
            .from('organisations')
            .update({ parent_organisation_id: parentOrgId })
            .eq('id', orgId);
        if (error) throw error;
    },
};
```

- [ ] **Step 4: Run** — `npx vitest run test/agency.repository.test.mjs` → PASS. (If `supaRec` doesn't record `.upsert`/`.in`/`.order`, extend `test/setup.js`'s recorder minimally — look at how `.update` is recorded first.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/agency.model.js backend/src/repositories/agency.repository.js backend/test/agency.repository.test.mjs
ggshield secret scan pre-commit && git commit -m "feat(agency): model + repository for sub-account hierarchy"
```

---

### Task 7: Agency service — list / create / features / switch

**Files:**
- Create: `backend/src/services/agency.service.js`
- Test: `backend/test/agency.service.test.mjs`

**Interfaces:**
- Consumes: `agencyRepository` (Task 6), `provisionOrgOwner(body, 'active')` from `services/auth.service.js` (body `{email, password, full_name, organisation_name}` → `{organisation_id, owner_id}`), `signSwitchToken` (Task 1), `orgMetaService` (Task 2), `featuresService.{getEffectiveFeatures, invalidate}` + `FEATURE_CATALOG` from A1, `AppError`.
- Produces:
  - `agencyService.listSubaccounts(agencyOrgId) -> { subaccounts: [{ id, name, created_at, integrations: [{provider, status}], features: {key: bool} }] }`
  - `agencyService.createSubaccount(agencyOrgId, body) -> { organisation_id, owner_id, owner_email, temp_password }`
  - `agencyService.subaccountFeatures(agencyOrgId, subOrgId) -> { features, overrides }`
  - `agencyService.setSubaccountFeature(agencyOrgId, subOrgId, { feature, enabled }) -> { features }`
  - `agencyService.switch(agencyOrgId, userId, targetOrgId) -> { token, expires_at, organisation: { id, name } }`
  - all child-validating calls throw `AppError('Not a sub-account of your organisation', 404)` for a non-child target.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/agency.service.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.OAUTH_STATE_SECRET ||= 'test-secret';

vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: {
    childOrgs: vi.fn(), orgIntegrations: vi.fn(), featureRows: vi.fn(),
    upsertFeature: vi.fn(), setParent: vi.fn(),
  },
}));
vi.mock('../src/services/auth.service.js', () => ({
  provisionOrgOwner: vi.fn(async () => ({ organisation_id: 'sub-new', owner_id: 'owner-new' })),
}));
vi.mock('../src/services/features.service.js', () => ({
  featuresService: {
    getEffectiveFeatures: vi.fn(async () => ({ data_room: false, crm: true })),
    invalidate: vi.fn(),
  },
}));
vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn(), invalidate: vi.fn() },
}));

const { agencyRepository } = await import('../src/repositories/agency.repository.js');
const { provisionOrgOwner } = await import('../src/services/auth.service.js');
const { featuresService } = await import('../src/services/features.service.js');
const { orgMetaService } = await import('../src/services/org-meta.service.js');
const { agencyService } = await import('../src/services/agency.service.js');
const { verifySwitchToken } = await import('../src/lib/agency-switch.js');

const AGENCY = 'agency-1';
const SUB = 'sub-1';

beforeEach(() => {
  vi.clearAllMocks();
  agencyRepository.childOrgs.mockResolvedValue([{ id: SUB, name: 'Bexley Dental', created_at: '2026-08-31' }]);
  agencyRepository.orgIntegrations.mockResolvedValue([{ organisation_id: SUB, provider: 'dentally', status: 'active' }]);
  agencyRepository.featureRows.mockResolvedValue([]);
});

describe('listSubaccounts', () => {
  it('joins children with integration summary and effective features', async () => {
    const { subaccounts } = await agencyService.listSubaccounts(AGENCY);
    expect(subaccounts).toEqual([expect.objectContaining({
      id: SUB, name: 'Bexley Dental',
      integrations: [{ provider: 'dentally', status: 'active' }],
      features: { data_room: false, crm: true },
    })]);
  });
});

describe('createSubaccount', () => {
  it('provisions an ACTIVE owner, stamps the parent, returns the one-time temp password', async () => {
    const out = await agencyService.createSubaccount(AGENCY, {
      organisation_name: 'New Practice', owner_email: 'o@np.dev', owner_name: 'Own Er',
    });
    expect(provisionOrgOwner).toHaveBeenCalledWith(
      expect.objectContaining({ organisation_name: 'New Practice', email: 'o@np.dev', full_name: 'Own Er', password: expect.any(String) }),
      'active',
    );
    expect(agencyRepository.setParent).toHaveBeenCalledWith('sub-new', AGENCY);
    expect(orgMetaService.invalidate).toHaveBeenCalledWith('sub-new');
    expect(out.temp_password.length).toBeGreaterThanOrEqual(12);
    expect(out.organisation_id).toBe('sub-new');
  });
});

describe('setSubaccountFeature', () => {
  it('rejects a non-child target with 404', async () => {
    agencyRepository.childOrgs.mockResolvedValue([]);
    await expect(agencyService.setSubaccountFeature(AGENCY, SUB, { feature: 'crm', enabled: false }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(agencyRepository.upsertFeature).not.toHaveBeenCalled();
  });

  it('upserts and invalidates the features cache for the child', async () => {
    await agencyService.setSubaccountFeature(AGENCY, SUB, { feature: 'crm', enabled: false });
    expect(agencyRepository.upsertFeature).toHaveBeenCalledWith(SUB, 'crm', false);
    expect(featuresService.invalidate).toHaveBeenCalledWith(SUB);
  });
});

describe('switch', () => {
  it('mints a user-bound token for a child org', async () => {
    const out = await agencyService.switch(AGENCY, 'user-1', SUB);
    expect(verifySwitchToken(out.token)).toEqual({ userId: 'user-1', orgId: SUB });
    expect(out.organisation).toEqual({ id: SUB, name: 'Bexley Dental' });
    expect(typeof out.expires_at).toBe('string');
  });

  it('refuses a non-child org', async () => {
    agencyRepository.childOrgs.mockResolvedValue([]);
    await expect(agencyService.switch(AGENCY, 'user-1', SUB)).rejects.toMatchObject({ statusCode: 404 });
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/agency.service.test.mjs`.

- [ ] **Step 3: Implement**

```js
// backend/src/services/agency.service.js
// Agency → sub-account lifecycle. Every child-targeting call re-validates
// child-of-agency via childOrgs (no trust in caller-supplied ids). Owner
// provisioning REUSES provisionOrgOwner — one implementation for platform
// create-org, self-signup and agency create (same temp-password contract as
// the platform path: surfaced once, never persisted).
import crypto from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import { agencyRepository } from '../repositories/agency.repository.js';
import { provisionOrgOwner } from './auth.service.js';
import { featuresService } from './features.service.js';
import { orgMetaService } from './org-meta.service.js';
import { signSwitchToken, SWITCH_TTL_MS } from '../lib/agency-switch.js';

function generateTempPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

async function assertChild(agencyOrgId, subOrgId) {
  const children = await agencyRepository.childOrgs(agencyOrgId);
  const child = children.find((c) => c.id === subOrgId);
  if (!child) throw new AppError('Not a sub-account of your organisation', 404);
  return child;
}

export const agencyService = {
  async listSubaccounts(agencyOrgId) {
    const children = await agencyRepository.childOrgs(agencyOrgId);
    const integrations = await agencyRepository.orgIntegrations(children.map((c) => c.id));
    const subaccounts = await Promise.all(children.map(async (c) => ({
      ...c,
      integrations: integrations
        .filter((i) => i.organisation_id === c.id)
        .map(({ provider, status }) => ({ provider, status })),
      features: await featuresService.getEffectiveFeatures(c.id),
    })));
    return { subaccounts };
  },

  async createSubaccount(agencyOrgId, body) {
    const password = generateTempPassword();
    const { organisation_id, owner_id } = await provisionOrgOwner(
      {
        organisation_name: body.organisation_name,
        email: body.owner_email,
        full_name: body.owner_name,
        password,
      },
      'active',
    );
    await agencyRepository.setParent(organisation_id, agencyOrgId);
    orgMetaService.invalidate(organisation_id);
    return { organisation_id, owner_id, owner_email: body.owner_email, temp_password: password };
  },

  async subaccountFeatures(agencyOrgId, subOrgId) {
    await assertChild(agencyOrgId, subOrgId);
    const [features, overrides] = await Promise.all([
      featuresService.getEffectiveFeatures(subOrgId),
      agencyRepository.featureRows(subOrgId),
    ]);
    return { features, overrides };
  },

  async setSubaccountFeature(agencyOrgId, subOrgId, { feature, enabled }) {
    await assertChild(agencyOrgId, subOrgId);
    await agencyRepository.upsertFeature(subOrgId, feature, enabled);
    featuresService.invalidate(subOrgId);
    return { features: await featuresService.getEffectiveFeatures(subOrgId) };
  },

  async switch(agencyOrgId, userId, targetOrgId) {
    const child = await assertChild(agencyOrgId, targetOrgId);
    const token = signSwitchToken(userId, targetOrgId);
    return {
      token,
      expires_at: new Date(Date.now() + SWITCH_TTL_MS).toISOString(),
      organisation: { id: child.id, name: child.name },
    };
  },
};
```

- [ ] **Step 4: Run** — `npx vitest run test/agency.service.test.mjs` → PASS; `npm test` stays green (watch for an import cycle: auth.service must NOT import agency.service — it doesn't today).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/agency.service.js backend/test/agency.service.test.mjs
ggshield secret scan pre-commit && git commit -m "feat(agency): sub-account list/create/features/switch service"
```

---

### Task 8: Routes + controller + `/auth/me` agency shape

**Files:**
- Create: `backend/src/controllers/agency.controller.js`, `backend/src/routes/agency.routes.js`
- Modify: `backend/src/app.js` (mount `api.use('/agency', …)` beside the other `api.use` lines), `backend/src/controllers/auth.controller.js` (`me`)
- Test: `backend/test/agency.routes.test.mjs`, extend `backend/test/auth.me-features.test.mjs`

**Interfaces:**
- Consumes: `agencyService` (Task 7), `requireAgencyOwner`/`agencyHomeOrgId`/`isAgencyActor` (Task 3), Zod schemas (Task 6).
- Produces endpoints (all behind `requireAgencyOwner`): `GET /api/agency/subaccounts`, `POST /api/agency/subaccounts`, `GET /api/agency/subaccounts/:id/features`, `PATCH /api/agency/subaccounts/:id/features`, `POST /api/agency/switch`.
- Produces `/auth/me` addition: `agency: { is_agency_actor: boolean, switched: boolean, home_org: { id, name } | null }`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/agency.routes.test.mjs
// Structural: every /api/agency route sits behind requireAgencyOwner, and the
// controller passes the HOME org (agencyHomeOrgId) — so the menu still works
// while switched into a child.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/agency.service.js', () => ({
  agencyService: {
    listSubaccounts: vi.fn(async () => ({ subaccounts: [] })),
    createSubaccount: vi.fn(async () => ({ organisation_id: 's', owner_id: 'o', owner_email: 'e@x.dev', temp_password: 'p' })),
    subaccountFeatures: vi.fn(async () => ({ features: {}, overrides: [] })),
    setSubaccountFeature: vi.fn(async () => ({ features: {} })),
    switch: vi.fn(async () => ({ token: 't', expires_at: 'x', organisation: { id: 's', name: 'S' } })),
  },
}));
const { agencyService } = await import('../src/services/agency.service.js');
const { agencyController } = await import('../src/controllers/agency.controller.js');
const router = (await import('../src/routes/agency.routes.js')).default;
const { requireAgencyOwner } = await import('../src/middleware/agency.js');

describe('agency routes', () => {
  it('every route is behind requireAgencyOwner', () => {
    for (const layer of router.stack) {
      const handlers = layer.route?.stack?.map((s) => s.handle) ?? [];
      expect(handlers).toContain(requireAgencyOwner);
    }
    expect(router.stack.length).toBeGreaterThanOrEqual(5);
  });

  it('listSubaccounts acts on the HOME org while switched', async () => {
    const req = {
      user: { id: 'u1', organisation_id: 'sub-1' },
      agencyContext: { actorUserId: 'u1', homeOrgId: 'agency-1' },
    };
    const res = { json: vi.fn() };
    await agencyController.list(req, res);
    expect(agencyService.listSubaccounts).toHaveBeenCalledWith('agency-1');
  });

  it('switch mints for the real user against the home org', async () => {
    const req = { user: { id: 'u1', organisation_id: 'agency-1' }, body: { orgId: '22222222-2222-2222-2222-222222222222' } };
    const res = { json: vi.fn() };
    await agencyController.switch(req, res);
    expect(agencyService.switch).toHaveBeenCalledWith('agency-1', 'u1', '22222222-2222-2222-2222-222222222222');
  });
});
```

Extend `backend/test/auth.me-features.test.mjs`: the existing `vi.mock` of features.service gains nothing; add a mock for org-meta + assert the new field. Append inside the existing describe:

```js
  it('includes the agency shape', async () => {
    const req = { user: { id: 'u1', email: 'o@t.dev', role: 'owner', organisation_id: 'org-1', permissions: {} } };
    const res = { json: vi.fn() };
    await authController.me(req, res);
    expect(res.json.mock.calls[0][0].agency).toEqual({
      is_agency_actor: expect.any(Boolean), switched: false, home_org: null,
    });
  });
```

(`auth.controller.js` will import `isAgencyActor` from middleware/agency.js, which imports the real org-meta service; add `vi.mock('../src/services/org-meta.service.js', () => ({ orgMetaService: { getOrgMeta: vi.fn(async () => ({ id: 'org-1', name: 'T', is_agency: true, parent_organisation_id: null })) } }))` at the top of that test file.)

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/agency.routes.test.mjs test/auth.me-features.test.mjs`.

- [ ] **Step 3: Implement**

```js
// backend/src/controllers/agency.controller.js
import { agencyService } from "../services/agency.service.js";
import { createSubaccountSchema, switchSchema, featureToggleSchema } from "../models/agency.model.js";
import { agencyHomeOrgId } from "../middleware/agency.js";
import * as zod_1 from "zod";

const idParam = zod_1.z.object({ id: zod_1.z.string().uuid() });

export const agencyController = {
    async list(req, res) {
        res.json(await agencyService.listSubaccounts(agencyHomeOrgId(req)));
    },
    async create(req, res) {
        const body = createSubaccountSchema.parse(req.body);
        res.status(201).json(await agencyService.createSubaccount(agencyHomeOrgId(req), body));
    },
    async features(req, res) {
        const { id } = idParam.parse(req.params);
        res.json(await agencyService.subaccountFeatures(agencyHomeOrgId(req), id));
    },
    async setFeature(req, res) {
        const { id } = idParam.parse(req.params);
        const body = featureToggleSchema.parse(req.body);
        res.json(await agencyService.setSubaccountFeature(agencyHomeOrgId(req), id, body));
    },
    async switch(req, res) {
        const { orgId } = switchSchema.parse(req.body);
        res.json(await agencyService.switch(agencyHomeOrgId(req), req.user.id, orgId));
    },
};
```

```js
// backend/src/routes/agency.routes.js
// Agency menu routes — Express Router. Mounted at /api/agency (auth + audit
// applied upstream). ALL routes require an agency owner; handlers act on the
// caller's HOME org, so the menu keeps working while switched into a child.
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import { requireAgencyOwner } from "../middleware/agency.js";
import { agencyController } from "../controllers/agency.controller.js";

const router = (0, express_1.Router)();

router.get('/subaccounts', requireAgencyOwner, (0, async_handler_1.asyncHandler)(agencyController.list));
router.post('/subaccounts', requireAgencyOwner, (0, async_handler_1.asyncHandler)(agencyController.create));
router.get('/subaccounts/:id/features', requireAgencyOwner, (0, async_handler_1.asyncHandler)(agencyController.features));
router.patch('/subaccounts/:id/features', requireAgencyOwner, (0, async_handler_1.asyncHandler)(agencyController.setFeature));
router.post('/switch', requireAgencyOwner, (0, async_handler_1.asyncHandler)(agencyController.switch));

export default router;
```

In `app.js`: import `agency_routes_1` like its neighbours and add (near line 268, with the other mounts):

```js
    api.use('/agency', agency_routes_1.default);
```

In `auth.controller.js` `me` — add import `import { isAgencyActor } from "../middleware/agency.js";` and `import { orgMetaService } from "../services/org-meta.service.js";`, then extend the response object:

```js
            // Agency shape (A2): drives the topbar switcher + mapping-control
            // visibility. home_org only while switched.
            agency: {
                is_agency_actor: await isAgencyActor(req),
                switched: Boolean(req.agencyContext),
                home_org: req.agencyContext
                    ? { id: req.agencyContext.homeOrgId, name: (await orgMetaService.getOrgMeta(req.agencyContext.homeOrgId))?.name ?? '' }
                    : null,
            },
```

- [ ] **Step 4: Run** — `npx vitest run test/agency.routes.test.mjs test/auth.me-features.test.mjs`, then `npm test` + `npm run lint` + `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/agency.controller.js backend/src/routes/agency.routes.js backend/src/app.js backend/src/controllers/auth.controller.js backend/test/agency.routes.test.mjs backend/test/auth.me-features.test.mjs
ggshield secret scan pre-commit && git commit -m "feat(agency): /api/agency routes + /auth/me agency shape"
```

---

### Task 9: Mapping mutations become agency-actor powers

**Files:**
- Modify: `backend/src/routes/ad-attribution.routes.js` (3 mutation routes), `backend/src/routes/practices.routes.js` (`PATCH /:id/pms-site-id`), `backend/src/routes/integrations.routes.js` (`POST /emergent/practices`), `backend/src/controllers/integration.controller.js` (`ghlAccountUpdate` field-level guard)
- Test: `backend/test/agency.mapping-gates.test.mjs`

**Interfaces:**
- Consumes: `requireAgencyActor`, `isAgencyActor` (Task 3).
- Produces: listed mutations 403 `AGENCY_ONLY` for non-agency actors; reads unchanged. `ghlAccountUpdate` keeps working for sub-account owners EXCEPT when the body contains `practice_id` (the mapping field).

- [ ] **Step 1: Write the failing tests**

```js
// backend/test/agency.mapping-gates.test.mjs
// Structural: mapping MUTATIONS carry requireAgencyActor; the corresponding
// reads don't (marketing dashboards consume them). Field-level: GHL account
// PATCH rejects practice_id changes from non-agency actors.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn(async () => ({ is_agency: false })) },
}));

const { requireAgencyActor } = await import('../src/middleware/agency.js');
const adAttribution = (await import('../src/routes/ad-attribution.routes.js')).default;
const practices = (await import('../src/routes/practices.routes.js')).default;
const integrations = (await import('../src/routes/integrations.routes.js')).default;

function routesOf(router) {
  return router.stack
    .filter((l) => l.route)
    .map((l) => ({
      path: l.route.path,
      methods: Object.keys(l.route.methods),
      handlers: l.route.stack.map((s) => s.handle),
    }));
}

const gated = (routes, method, path) =>
  routes.some((r) => r.path === path && r.methods.includes(method) && r.handlers.includes(requireAgencyActor));

describe('mapping mutation gates', () => {
  it('ad-attribution mutations require an agency actor; reads do not', () => {
    const r = routesOf(adAttribution);
    expect(gated(r, 'put', '/pipelines/:accountId/:pipelineId')).toBe(true);
    expect(gated(r, 'patch', '/subaccounts/:id')).toBe(true);
    expect(gated(r, 'patch', '/ad-accounts/:id')).toBe(true);
    expect(gated(r, 'get', '/performance')).toBe(false);
  });

  it('practices pms-site-id mapping requires an agency actor', () => {
    expect(gated(routesOf(practices), 'patch', '/:id/pms-site-id')).toBe(true);
  });

  it('emergent practice mapping requires an agency actor', () => {
    expect(gated(routesOf(integrations), 'post', '/emergent/practices')).toBe(true);
  });
});

describe('ghlAccountUpdate practice_id field guard', () => {
  it('403s AGENCY_ONLY when a non-actor sends practice_id', async () => {
    const { integrationController } = await import('../src/controllers/integration.controller.js');
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await integrationController.ghlAccountUpdate(
      { params: { id: '33333333-3333-3333-3333-333333333333' },
        body: { practice_id: '44444444-4444-4444-4444-444444444444' },
        user: { role: 'owner', organisation_id: 'sub-1' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Agency access required', code: 'AGENCY_ONLY' });
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/agency.mapping-gates.test.mjs`.

- [ ] **Step 3: Implement**

In `ad-attribution.routes.js` — import `import { requireAgencyActor } from "../middleware/agency.js";` and add the gate AFTER the role gate on exactly the three mutation routes:

```js
router.put('/pipelines/:accountId/:pipelineId', gate, requireAgencyActor, (0, async_handler_1.asyncHandler)(adAttributionController.setPipelineChannel));
router.patch('/subaccounts/:id', gate, requireAgencyActor, (0, async_handler_1.asyncHandler)(adAttributionController.setSubaccountPractice));
router.patch('/ad-accounts/:id', gate, requireAgencyActor, (0, async_handler_1.asyncHandler)(adAttributionController.setAdAccountPractice));
```

In `practices.routes.js` — same import, add `requireAgencyActor` after the existing owner gate on `PATCH /:id/pms-site-id` only.

In `integrations.routes.js` — same import, on the emergent practice-mapping route:

```js
router.post('/emergent/practices', emergentFeature, (0, auth_1.requireRole)('owner'), requireAgencyActor, (0, async_handler_1.asyncHandler)(integration_controller_1.integrationController.emergentSetPractice));
```

In `integration.controller.js` `ghlAccountUpdate` — import `import { isAgencyActor } from "../middleware/agency.js";` and add at the top of the handler (before the service call):

```js
        // practice_id is the agency-controlled mapping field; the rest of the
        // PATCH (PIT rotation, config) stays a normal owner power.
        if (req.body?.practice_id !== undefined && !(await isAgencyActor(req))) {
            return res.status(403).json({ error: 'Agency access required', code: 'AGENCY_ONLY' });
        }
```

- [ ] **Step 4: Run** — `npx vitest run test/agency.mapping-gates.test.mjs`, then `npm test` (the A1 structural route tests in `features.route-gates.test.mjs` must still pass — they assert gate PRESENCE, extra middleware is fine).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/ad-attribution.routes.js backend/src/routes/practices.routes.js backend/src/routes/integrations.routes.js backend/src/controllers/integration.controller.js backend/test/agency.mapping-gates.test.mjs
ggshield secret scan pre-commit && git commit -m "feat(agency): mapping mutations gated on agency actor"
```

---

### Task 10: Frontend plumbing — cookie route, proxy header, `useMe` type

**Files:**
- Create: `frontend/app/api/agency-switch/route.ts`
- Modify: `frontend/app/api/backend/[...path]/route.ts` (forward the cookie as a header), `frontend/hooks/useMe.ts` (type)

**Interfaces:**
- Consumes: backend `POST /api/agency/switch` → `{ token, expires_at, organisation }`.
- Produces: cookie `agency_switch` (httpOnly, SameSite=Lax, Secure in prod, 12h) on the frontend origin; header `x-agency-switch` on every proxied backend request; `Me['agency']` type.
- Frontend calls: `POST /api/agency-switch { orgId }` to switch, `DELETE /api/agency-switch` to exit.

- [ ] **Step 1: Implement the Next cookie route**

```ts
// frontend/app/api/agency-switch/route.ts
// Sets/clears the agency-switch cookie. The signed token comes from the
// backend (which validates child-of-agency); this route only moves it into
// an httpOnly cookie on OUR origin so client JS never sees it — mirroring
// the login route's cookie handling. The generic backend proxy re-injects it
// as x-agency-switch on every request.
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseRoute } from '@/lib/supabase-server';

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
export const dynamic = 'force-dynamic';

const COOKIE = 'agency_switch';
const MAX_AGE = 12 * 60 * 60; // seconds — matches the token TTL

export async function POST(req: NextRequest) {
  const supabase = getSupabaseRoute();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.text();
  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND_URL}/api/agency/switch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch {
    return NextResponse.json({ error: 'Backend unreachable.' }, { status: 502 });
  }
  const text = await backendRes.text();
  const res = new NextResponse(text, {
    status: backendRes.status,
    headers: { 'Content-Type': backendRes.headers.get('content-type') || 'application/json' },
  });
  if (backendRes.ok) {
    try {
      const { token } = JSON.parse(text) as { token: string };
      res.cookies.set(COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: MAX_AGE,
      });
    } catch {
      // malformed backend body — return it as-is without a cookie
    }
  }
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
```

- [ ] **Step 2: Forward the cookie in the generic proxy**

In `frontend/app/api/backend/[...path]/route.ts`, inside `proxy()` where `headers` is built (after the Authorization line):

```ts
  // Agency switch (A2): re-inject the httpOnly switch cookie as a header the
  // backend validates per request. Absent cookie -> header absent -> home org.
  const agencySwitch = req.cookies.get('agency_switch')?.value;
  if (agencySwitch) headers['x-agency-switch'] = agencySwitch;
```

- [ ] **Step 3: Extend the `Me` type** in `frontend/hooks/useMe.ts`:

```ts
  /** Agency shape (A2). Absent on older backends. */
  agency?: {
    is_agency_actor: boolean;
    switched: boolean;
    home_org: { id: string; name: string } | null;
  };
```

- [ ] **Step 4: Verify** — `cd frontend && npm run typecheck && npm run lint`. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/api/agency-switch/route.ts "frontend/app/api/backend/[...path]/route.ts" frontend/hooks/useMe.ts
ggshield secret scan pre-commit && git commit -m "feat(frontend): agency-switch cookie route + proxy header + Me.agency type"
```

---

### Task 11: Frontend — topbar switcher, banner, agency page

**Files:**
- Create: `frontend/features/agency/api.ts`, `frontend/features/agency/components/AgencySwitcher.tsx`, `frontend/app/(dashboard)/agency/page.tsx`, `frontend/features/agency/components/AgencyScreen.tsx`
- Modify: `frontend/components/layout/topbar.tsx` (mount switcher + switched banner), `frontend/components/layout/sidebar.tsx` (nav entry "Agency" visible only to agency actors)

**Interfaces:**
- Consumes: `useMe().data.agency`, `GET /api/backend/agency/subaccounts`, `POST /api/agency-switch`, `DELETE /api/agency-switch`, `PATCH /api/backend/agency/subaccounts/:id/features`, `POST /api/backend/agency/subaccounts`.
- Produces: `useSubaccounts()` hook; `switchInto(orgId)` / `exitSwitch()` helpers that hard-navigate (`window.location.assign('/dashboard')`) so every cache resets.

- [ ] **Step 1: API slice**

```ts
// frontend/features/agency/api.ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Subaccount {
  id: string;
  name: string;
  created_at: string;
  integrations: { provider: string; status: string }[];
  features: Record<string, boolean>;
}

export function useSubaccounts(enabled: boolean) {
  return useQuery<{ subaccounts: Subaccount[] }>({
    queryKey: ['agency', 'subaccounts'],
    queryFn: () => api('/agency/subaccounts'),
    enabled,
    staleTime: 60_000,
  });
}

export async function switchInto(orgId: string) {
  const res = await fetch('/api/agency-switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId }),
  });
  if (!res.ok) throw new Error('Switch failed');
  // Hard navigation: resets React Query caches + any per-org module state.
  window.location.assign('/dashboard');
}

export async function exitSwitch() {
  await fetch('/api/agency-switch', { method: 'DELETE' });
  window.location.assign('/dashboard');
}

export async function createSubaccount(body: { organisation_name: string; owner_email: string; owner_name: string }) {
  return api<{ organisation_id: string; owner_email: string; temp_password: string }>(
    '/agency/subaccounts',
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function setSubaccountFeature(orgId: string, feature: string, enabled: boolean) {
  return api<{ features: Record<string, boolean> }>(
    `/agency/subaccounts/${orgId}/features`,
    { method: 'PATCH', body: JSON.stringify({ feature, enabled }) },
  );
}
```

(Check `frontend/lib/api.ts`'s actual signature first — if `api(path, opts)` differs (e.g. `api(path, { method, body })` with auto-JSON), match it exactly; every other feature slice is the reference.)

- [ ] **Step 2: Switcher + banner in the topbar**

`AgencySwitcher.tsx` — compact dropdown, only rendered for agency actors:

```tsx
// frontend/features/agency/components/AgencySwitcher.tsx
'use client';
import { useState } from 'react';
import { useMe } from '@/hooks/useMe';
import { useSubaccounts, switchInto, exitSwitch } from '../api';

export function AgencySwitcher() {
  const { data: me } = useMe();
  const actor = me?.agency?.is_agency_actor === true;
  const switched = me?.agency?.switched === true;
  const [open, setOpen] = useState(false);
  const { data } = useSubaccounts(actor && open);
  if (!actor) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-paper-hover"
      >
        {switched ? `Viewing: ${me?.organisation_name ?? ''}` : 'Switch account'}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-md border border-line bg-white p-1 shadow-lg">
          {switched && (
            <button type="button" onClick={() => exitSwitch()}
              className="block w-full rounded px-2.5 py-1.5 text-left text-xs font-medium text-ink hover:bg-paper-hover">
              Exit — back to {me?.agency?.home_org?.name ?? 'agency'}
            </button>
          )}
          {(data?.subaccounts ?? []).map((s) => (
            <button key={s.id} type="button" onClick={() => switchInto(s.id)}
              className="block w-full rounded px-2.5 py-1.5 text-left text-xs text-ink hover:bg-paper-hover">
              {s.name}
            </button>
          ))}
          {data && data.subaccounts.length === 0 && (
            <div className="px-2.5 py-1.5 text-xs text-ink-muted">No sub-accounts yet</div>
          )}
        </div>
      )}
    </div>
  );
}
```

In `topbar.tsx`: render `<AgencySwitcher />` next to the organisation name, and when `me?.agency?.switched` render a full-width banner strip above/inside the topbar:

```tsx
{me?.agency?.switched && (
  <div className="flex items-center justify-center gap-3 bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-900">
    <span>Viewing {me.organisation_name} as {me.agency.home_org?.name ?? 'agency'}</span>
    <button type="button" onClick={() => exitSwitch()} className="font-semibold underline">Exit</button>
  </div>
)}
```

(Adapt class names to the topbar's existing idiom — read the file first; keep light-mode only.)

- [ ] **Step 3: Agency page**

`frontend/app/(dashboard)/agency/page.tsx`:

```tsx
import { AgencyScreen } from '@/features/agency/components/AgencyScreen';
export default function AgencyPage() { return <AgencyScreen />; }
```

`AgencyScreen.tsx` — sub-account table + create form + feature toggles. Complete component:

```tsx
// frontend/features/agency/components/AgencyScreen.tsx
'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '@/hooks/useMe';
import { useSubaccounts, createSubaccount, setSubaccountFeature, switchInto, type Subaccount } from '../api';

const FEATURE_LABELS: Record<string, string> = {
  data_room: 'Data Room', emergent: 'Emergent', call_reporting: 'Call Reporting', sheet_export: 'Sheet Export',
};

function FeatureToggles({ sub }: { sub: Subaccount }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const keys = Object.keys(sub.features);
  return (
    <div className="flex flex-wrap gap-2">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          disabled={busy === k}
          onClick={async () => {
            setBusy(k);
            try {
              await setSubaccountFeature(sub.id, k, !sub.features[k]);
              await qc.invalidateQueries({ queryKey: ['agency', 'subaccounts'] });
            } finally { setBusy(null); }
          }}
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            sub.features[k] ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-line bg-paper text-ink-muted'
          }`}
        >
          {FEATURE_LABELS[k] ?? k}
        </button>
      ))}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ organisation_name: '', owner_email: '', owner_name: '' });
  const [result, setResult] = useState<{ owner_email: string; temp_password: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  if (result) {
    return (
      <div className="card-padded">
        <h3 className="display text-base">Sub-account created</h3>
        <p className="mt-2 text-sm text-ink">One-time login for {result.owner_email} — copy it now, it is not stored:</p>
        <code className="mt-2 block rounded bg-paper px-3 py-2 text-sm">{result.temp_password}</code>
        <button type="button" className="mt-3 text-sm font-medium underline" onClick={onDone}>Done</button>
      </div>
    );
  }
  return (
    <form
      className="card-padded flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true); setError('');
        try { setResult(await createSubaccount(form)); }
        catch { setError('Could not create the sub-account. Check the email is not already in use.'); }
        finally { setSaving(false); }
      }}
    >
      <h3 className="display text-base">New sub-account</h3>
      <input className="input" placeholder="Organisation name" required minLength={2}
        value={form.organisation_name} onChange={(e) => setForm({ ...form, organisation_name: e.target.value })} />
      <input className="input" placeholder="Owner name" required
        value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} />
      <input className="input" type="email" placeholder="Owner email" required
        value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={saving} className="btn-primary self-start">
        {saving ? 'Creating…' : 'Create sub-account'}
      </button>
    </form>
  );
}

export function AgencyScreen() {
  const { data: me, isLoading } = useMe();
  const actor = me?.agency?.is_agency_actor === true;
  const { data, refetch } = useSubaccounts(actor);
  const [creating, setCreating] = useState(false);
  if (isLoading) return null;
  if (!actor) {
    return (
      <div className="card-padded" style={{ margin: 24 }}>
        <h2 className="display" style={{ fontSize: 18 }}>Not available</h2>
        <p className="text-ink-muted text-sm">Agency tools are only available to agency owners.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="display text-xl">Agency</h1>
        <button type="button" className="btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : 'New sub-account'}
        </button>
      </div>
      {creating && <CreateForm onDone={() => { setCreating(false); refetch(); }} />}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-muted">
              <th className="px-4 py-2">Organisation</th>
              <th className="px-4 py-2">Integrations</th>
              <th className="px-4 py-2">Features</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {(data?.subaccounts ?? []).map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
                <td className="px-4 py-3 text-ink-muted">
                  {s.integrations.length ? s.integrations.map((i) => i.provider).join(', ') : '—'}
                </td>
                <td className="px-4 py-3"><FeatureToggles sub={s} /></td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="text-sm font-medium underline" onClick={() => switchInto(s.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
            {data && data.subaccounts.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-muted">No sub-accounts yet — create the first one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

(Class names `card`, `card-padded`, `input`, `btn-primary`, `text-ink*`, `border-line` — verify against `components/ui` / existing screens and substitute the project's actual primitives where they exist. Feature toggle list: show only INTERNAL + module keys as returned; labels fall back to the raw key.)

Sidebar: add an "Agency" nav item (route `/agency`) rendered only when `me?.agency?.is_agency_actor` — follow the exact pattern A1 used to hide feature-gated entries in `sidebar.tsx`.

- [ ] **Step 4: Verify** — `cd frontend && npm run typecheck && npm run lint && npm run build`. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/features/agency frontend/app/\(dashboard\)/agency frontend/components/layout/topbar.tsx frontend/components/layout/sidebar.tsx
ggshield secret scan pre-commit && git commit -m "feat(frontend): agency menu, sub-account switcher + switched banner"
```

---

### Task 12: Frontend — mapping controls agency-only

**Files:**
- Modify: `frontend/features/integrations/components/DentallyPracticeMapping.tsx`, `frontend/features/integrations/components/EmergentPracticeMapping.tsx`, `frontend/features/integrations/components/AdAccountSelector.tsx` (practice dropdown), `frontend/features/integrations/components/GoHighLevelPanel.tsx` (practice dropdown), `frontend/app/(dashboard)/settings/ad-attribution/page.tsx`

**Interfaces:**
- Consumes: `useMe().data.agency`. Rule: `agency === undefined` (older backend) → treat an owner as an actor (transition tolerance, mirrors FeatureGate's undefined-allows); `agency.is_agency_actor === false` → hide/disable the mapping control.

- [ ] **Step 1: Add a tiny helper** to `frontend/hooks/useMe.ts` (exported alongside `useMe`):

```ts
/** Agency-actor check with undefined-allows for older backends. */
export function isAgencyActor(me: Me | undefined): boolean {
  if (!me) return false;
  if (me.agency === undefined) return me.role === 'owner';
  return me.agency.is_agency_actor;
}
```

- [ ] **Step 2: Gate each control.** In each of the four components, pull `const { data: me } = useMe();` and wrap ONLY the mapping control (the practice `<select>` / mapping section) in `isAgencyActor(me) && (…)` — read-only status displays stay for everyone. For `settings/ad-attribution/page.tsx`, wrap the whole page body: non-actors get the standard "Not available" card (copy the JSX pattern from `FeatureGate`'s fallback, text: "Practice mapping is managed by your agency.").

- [ ] **Step 3: Verify** — `cd frontend && npm run typecheck && npm run lint && npm run build`.

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useMe.ts frontend/features/integrations/components frontend/app/\(dashboard\)/settings/ad-attribution
ggshield secret scan pre-commit && git commit -m "feat(frontend): practice-mapping controls are agency-actor-only"
```

---

### Task 13: Docs, full verification, rollout

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Document** — in `docs/API.md` add an "Agency" section: the five `/api/agency/*` endpoints (shapes from Task 8), the `x-agency-switch` header semantics (set via the frontend `agency_switch` cookie; invalid/stale silently ignored), the `/auth/me` `agency` field, the `AGENCY_ONLY` 403 body, and the mapping-mutation gate list (Task 9). Note `AGENCY_SWITCH_SECRET` (optional; falls back to `OAUTH_STATE_SECRET`).

- [ ] **Step 2: Full verification**

```bash
cd backend && npm test && npm run lint && npm run typecheck
cd ../frontend && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add docs/API.md
ggshield secret scan pre-commit && git commit -m "docs(api): agency menu, switch header + AGENCY_ONLY semantics"
```

- [ ] **Step 4: Rollout (operator steps)**

1. No new migration. Push `main` → Railway deploys backend + frontend together.
2. Smoke (owner login): topbar shows "Switch account"; `/agency` lists no sub-accounts; create a scratch sub-account → temp password shown once; switch into it → banner appears, sidebar shows only default modules (no Data Room/Call Reporting), Integrations page hides Emergent/Sheets panels and mapping dropdowns are agency-visible; exit returns home. Scratch sub-account owner login: no switcher, no `/agency`, mapping controls hidden, `PATCH /api/ad-attribution/ad-accounts/:id` → 403 `AGENCY_ONLY`.
3. Keep the scratch sub-account for Phase A3's module-enforcement testing.

---

## Self-review notes

- **Spec coverage:** agency routes/lifecycle → Tasks 6–8; switching (token, cookie, authenticate, audit, /auth/me) → Tasks 1, 4, 5, 8, 10; mapping gates (`requireAgencyActor` on the spec's exact route list incl. field-level GHL guard) → Task 9; frontend switcher/banner/menu/mapping-visibility → Tasks 10–12; docs+rollout → Task 13. Module-key ENFORCEMENT and the isolation audit are A3/A4 by design.
- **Transport decision recorded:** the spec's "signed httpOnly cookie" is implemented as cookie-on-frontend-origin + `x-agency-switch` header injected by the existing generic proxy — the proxy does not forward cookies today, and this keeps Express cookie-parser-free and matches the codebase's existing httpOnly-cookie-plus-injected-header auth idiom.
- **Type consistency:** `req.agencyContext = { actorUserId, homeOrgId }` (Tasks 4, 5, 8); `signSwitchToken(userId, orgId, ttlMs?)`/`verifySwitchToken → {userId, orgId}` (Tasks 1, 4, 7); `agencyHomeOrgId(req)` (Tasks 3, 8); `featuresService.invalidate(orgId)` exists from A1 (used in Task 7); `Me.agency.{is_agency_actor, switched, home_org}` (Tasks 8, 10–12).
- **Known simplifications:** switch-exit needs no backend call (clearing the cookie is sufficient; token expiry bounds staleness at 12h); `requireAgencyActor`/`requireAgencyOwner` share one predicate today by design.
