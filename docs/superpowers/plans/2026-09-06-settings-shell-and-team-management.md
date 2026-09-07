# Settings Shell and Team Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Settings into its own full-page shell and replace the combined Team Permissions page with a GHL-shaped Team list plus a per-user editor that an agency admin can use across every sub-account and a sub-account owner can use inside their own.

**Architecture:** A new Next route group `app/(settings)/` holds the settings screens, so the dashboard sidebar/topbar/tab-strip simply never wrap them — URLs are unchanged, no redirects. On the backend a new `team.service.js` owns one scope rule (own org; or the agency org plus its children for an agency admin acting at home) and three endpoints under the existing `/api/admin/team` mount. Per-user permission overrides finally get a UI, and are written to every account a person is assigned to.

**Tech Stack:** Node 20 native ESM · Express · Supabase (`serviceClient`, manual `organisation_id` filters) · vitest · Next 14 App Router · React Query · Tailwind

**Spec:** `docs/superpowers/specs/2026-09-06-settings-shell-and-team-management-design.md`

## Global Constraints

- **DO NOT COMMIT.** The owner has explicitly asked that nothing be committed in this branch of work. Every task ends with `git add` + `git status` so the change is staged and visible; the commit is held until the owner says otherwise. Task step 5 in each task says exactly this — follow it literally.
- **No migration.** `user_organisations` (migration `20260101000136`) is already applied on hosted. No DDL, no `NOTIFY pgrst`.
- **Backend is native ESM.** `import`/`export`, relative imports carry `.js`. Never `require`/`module.exports`.
- **Tenant isolation is manual.** Repositories use `serviceClient`, which bypasses RLS. Every query you add MUST carry an explicit `organisation_id` filter (`.eq` or `.in`). No PostgREST embeds (`users(...)` style joins) — an embed resolves the FK with no org predicate.
- **No organisation id is ever trusted from a request body.** Scope is resolved server-side from `req.user.organisation_id` / `req.agencyOrgId`.
- **PostgREST truncates any read at 1000 rows, silently.** Every multi-row read added here is paged with `.range()`, stopping on an EMPTY page (a short page is not the end).
- **British English in UI copy** (organisation, colour, centre). No emojis. No dark mode — light/white only, so the settings rail is white and not GoHighLevel's navy.
- **Money is not involved in this work.** No pence arithmetic anywhere in it.
- Backend verify: `cd backend && npm test && npm run lint && npm run typecheck`
- Frontend verify: `cd frontend && npm run typecheck && npm run lint && npm run build` (the `/forgot-password` prerender failure is pre-existing and expected — no Supabase env at build time).

---

### Task 1: Team list — widen it for an agency admin

The list endpoint exists and returns the caller's own org. An agency admin acting at home should get the agency org plus its children, each member carrying the accounts they reach. Everyone else's response must stay byte-identical to today's.

**Files:**
- Create: `backend/src/services/team.service.js`
- Modify: `backend/src/repositories/auth.repository.js` (add `listMembersForOrgs`, after `listOrgMembers` at line 108)
- Modify: `backend/src/repositories/membership.repository.js` (add `listForUsers`, after `listForOrg`)
- Modify: `backend/src/repositories/agency.repository.js` (add `orgNames`, after `childOrgs` at line 9)
- Modify: `backend/src/controllers/members.controller.js` (`list`)
- Test: `backend/test/team.list.test.mjs`

**Interfaces:**
- Consumes: `agencyRepository.childOrgs(agencyOrgId) -> [{id,name,created_at}]`; `req.user.is_agency_admin`, `req.agencyOrgId`, `req.agencyContext` (all stamped by `middleware/auth.js`).
- Produces:
  - `adminScope(req) -> Promise<{ orgIds: string[], agencyWide: boolean, agencyOrgId: string|null }>`
  - `teamService.list(scope) -> Promise<{ members: Member[], agency_wide: boolean }>` where `Member = { id, organisation_id, email, full_name, phone, role, status, is_agency_admin, last_active_at, accounts?: {id,name,role}[] }`
  - `authRepository.listMembersForOrgs(orgIds: string[]) -> Promise<Row[]>`
  - `membershipRepository.listForUsers(userIds: string[], orgIds: string[]) -> Promise<Map<string, {user_id,organisation_id,role}[]>>`
  - `agencyRepository.orgNames(orgIds: string[]) -> Promise<Map<string,string>>`

- [ ] **Step 1: Write the failing test**

Create `backend/test/team.list.test.mjs`:

```js
// The scope rule, in one file: a plain owner sees their own org; an agency
// admin at home sees the agency org plus its children; the SAME admin
// switched into a child sees only that child.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: {
    childOrgs: vi.fn(async () => [
      { id: 'child-1', name: 'Rye Dental', created_at: '2026-01-01' },
      { id: 'child-2', name: 'Barnet', created_at: '2026-01-02' },
    ]),
    orgNames: vi.fn(async () => new Map([
      ['agency-1', 'Plan4growth'], ['child-1', 'Rye Dental'], ['child-2', 'Barnet'],
    ])),
  },
}));
vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { listMembersForOrgs: vi.fn(async () => []) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: { listForUsers: vi.fn(async () => new Map()) },
}));

const { authRepository } = await import('../src/repositories/auth.repository.js');
const { membershipRepository } = await import('../src/repositories/membership.repository.js');
const { adminScope, teamService } = await import('../src/services/team.service.js');

beforeEach(() => vi.clearAllMocks());

describe('adminScope', () => {
  it('a plain owner administers their own org only', async () => {
    const scope = await adminScope({ user: { organisation_id: 'org-1', is_agency_admin: false } });
    expect(scope).toEqual({ orgIds: ['org-1'], agencyWide: false, agencyOrgId: null });
  });

  it('an agency admin at home administers the agency org and its children', async () => {
    const scope = await adminScope({
      user: { organisation_id: 'agency-1', is_agency_admin: true },
      agencyOrgId: 'agency-1',
    });
    expect(scope.agencyWide).toBe(true);
    expect(scope.orgIds).toEqual(['agency-1', 'child-1', 'child-2']);
  });

  it('an agency admin SWITCHED into a child administers that child alone', async () => {
    const scope = await adminScope({
      user: { organisation_id: 'child-1', is_agency_admin: true },
      agencyOrgId: 'agency-1',
      agencyContext: { actorUserId: 'u1', homeOrgId: 'agency-1' },
    });
    expect(scope).toEqual({ orgIds: ['child-1'], agencyWide: false, agencyOrgId: null });
  });
});

describe('teamService.list', () => {
  it('a plain owner gets no accounts column and no cross-org read', async () => {
    authRepository.listMembersForOrgs.mockResolvedValueOnce([
      { id: 'u1', organisation_id: 'org-1', email: 'a@x.dev', full_name: 'A', phone: null,
        role: 'owner', status: 'active', is_agency_admin: false, last_active_at: null },
    ]);
    const out = await teamService.list({ orgIds: ['org-1'], agencyWide: false, agencyOrgId: null });
    expect(out.agency_wide).toBe(false);
    expect(out.members[0].accounts).toBeUndefined();
    expect(membershipRepository.listForUsers).not.toHaveBeenCalled();
    expect(authRepository.listMembersForOrgs).toHaveBeenCalledWith(['org-1']);
  });

  it('an agency admin gets each member stamped with the accounts they reach', async () => {
    authRepository.listMembersForOrgs.mockResolvedValueOnce([
      { id: 'u1', organisation_id: 'agency-1', email: 'a@x.dev', full_name: 'A', phone: '+44 1',
        role: 'owner', status: 'active', is_agency_admin: true, last_active_at: null },
    ]);
    membershipRepository.listForUsers.mockResolvedValueOnce(new Map([
      ['u1', [
        { user_id: 'u1', organisation_id: 'agency-1', role: 'owner' },
        { user_id: 'u1', organisation_id: 'child-2', role: 'practice_manager' },
      ]],
    ]));
    const out = await teamService.list({
      orgIds: ['agency-1', 'child-1', 'child-2'], agencyWide: true, agencyOrgId: 'agency-1',
    });
    expect(out.agency_wide).toBe(true);
    expect(out.members[0].accounts).toEqual([
      { id: 'agency-1', name: 'Plan4growth', role: 'owner' },
      { id: 'child-2', name: 'Barnet', role: 'practice_manager' },
    ]);
  });

  it('memberships are read scoped to the administered orgs, never all of them', async () => {
    authRepository.listMembersForOrgs.mockResolvedValueOnce([
      { id: 'u1', organisation_id: 'agency-1', email: 'a@x.dev', full_name: 'A', phone: null,
        role: 'owner', status: 'active', is_agency_admin: true, last_active_at: null },
    ]);
    await teamService.list({ orgIds: ['agency-1', 'child-1'], agencyWide: true, agencyOrgId: 'agency-1' });
    expect(membershipRepository.listForUsers).toHaveBeenCalledWith(['u1'], ['agency-1', 'child-1']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/team.list.test.mjs`
Expected: FAIL — `Failed to resolve import "../src/services/team.service.js"`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/team.service.js`:

```js
// ============================================================================
// Team administration — the people surface behind Settings → Team.
//
// The scope rule lives here and nowhere else:
//   plain owner            -> their OWN org
//   agency admin at home   -> the agency org AND its children
//   agency admin SWITCHED  -> only the child they are switched into
//
// The switched case matters: authenticate() stamps req.agencyContext only
// after validating the switch, and while switched the admin is acting AS that
// child's owner. Handing them the whole agency's people in that state would
// contradict the account they are standing in.
//
// No organisation id is ever taken from a request body.
// ============================================================================
import { agencyRepository } from '../repositories/agency.repository.js';
import { authRepository } from '../repositories/auth.repository.js';
import { membershipRepository } from '../repositories/membership.repository.js';

/** The orgs this request administers. See the header for the rule. */
export async function adminScope(req) {
  const orgId = req.user.organisation_id;
  const agencyWide =
    req.user.is_agency_admin === true && !!req.agencyOrgId && !req.agencyContext;
  if (!agencyWide) return { orgIds: [orgId], agencyWide: false, agencyOrgId: null };
  const children = await agencyRepository.childOrgs(req.agencyOrgId);
  return {
    orgIds: [req.agencyOrgId, ...children.map((c) => c.id)],
    agencyWide: true,
    agencyOrgId: req.agencyOrgId,
  };
}

export const teamService = {
  async list(scope) {
    const members = await authRepository.listMembersForOrgs(scope.orgIds);
    if (!scope.agencyWide) return { members, agency_wide: false };

    // Which accounts each person reaches. Filtered to the administered orgs:
    // a membership of some unrelated org is none of this caller's business,
    // and naming it here would leak that org's existence.
    const byUser = await membershipRepository.listForUsers(
      members.map((m) => m.id),
      scope.orgIds,
    );
    const names = await agencyRepository.orgNames(scope.orgIds);
    return {
      agency_wide: true,
      members: members.map((m) => ({
        ...m,
        accounts: (byUser.get(m.id) ?? []).map((r) => ({
          id: r.organisation_id,
          name: names.get(r.organisation_id) ?? null,
          role: r.role,
        })),
      })),
    };
  },
};
```

Add to `backend/src/repositories/auth.repository.js`, immediately after `listOrgMembers` (line 108-114):

```js
    // Members of SEVERAL orgs (the agency-wide team list). Paged: PostgREST
    // truncates at 1000 rows without saying so, and an agency with many
    // sub-accounts passes that quietly. Stop on an EMPTY page — a short page
    // is not the end.
    async listMembersForOrgs(orgIds) {
        if (!orgIds?.length) return [];
        const PAGE = 500;
        const out = [];
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase_1.serviceClient
                .from('users')
                .select('id, organisation_id, email, full_name, phone, role, status, is_agency_admin, last_active_at')
                .in('organisation_id', orgIds)
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            out.push(...data);
        }
        return out;
    },
```

Add to `backend/src/repositories/membership.repository.js`, after `listForOrg`:

```js
    // Memberships for many users at once, scoped to the orgs the caller
    // administers. Paged for the same reason as listMembersForOrgs.
    async listForUsers(userIds, orgIds) {
        const out = new Map();
        if (!userIds?.length || !orgIds?.length) return out;
        const PAGE = 500;
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await serviceClient
                .from('user_organisations')
                .select('user_id, organisation_id, role')
                .in('user_id', userIds)
                .in('organisation_id', orgIds)
                .order('user_id', { ascending: true })
                .order('organisation_id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            for (const row of data) {
                if (!out.has(row.user_id)) out.set(row.user_id, []);
                out.get(row.user_id).push(row);
            }
        }
        return out;
    },
```

Add to `backend/src/repositories/agency.repository.js`, after `childOrgs`:

```js
    // id -> name, for the accounts chips on the team list.
    async orgNames(orgIds) {
        if (!orgIds?.length) return new Map();
        const { data, error } = await serviceClient
            .from('organisations')
            .select('id, name')
            .in('id', orgIds);
        if (error) throw error;
        return new Map((data ?? []).map((o) => [o.id, o.name]));
    },
```

Replace `list` in `backend/src/controllers/members.controller.js`:

```js
  // GET /api/admin/team — the people this caller administers. One org for
  // everyone but an agency admin acting at home.
  async list(req, res) {
    const scope = await adminScope(req);
    res.json(await teamService.list(scope));
  },
```

and add to that file's imports:

```js
import { adminScope, teamService } from "../services/team.service.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/team.list.test.mjs`
Expected: PASS, 6 tests.

Then run the whole suite to prove the existing team tests still hold:
Run: `cd backend && npm test`
Expected: PASS, no new failures.

- [ ] **Step 5: Stage — DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add backend/src/services/team.service.js backend/src/repositories/auth.repository.js \
  backend/src/repositories/membership.repository.js backend/src/repositories/agency.repository.js \
  backend/src/controllers/members.controller.js backend/test/team.list.test.mjs
git status
```

The owner has asked that nothing be committed. Stage and stop.

---

### Task 2: Read one member

The editor needs one person's profile, role, memberships, effective permissions, and which of those permissions are explicit overrides rather than inherited from the role.

**Files:**
- Modify: `backend/src/services/team.service.js`
- Modify: `backend/src/repositories/auth.repository.js` (add `getUserInOrgs`)
- Modify: `backend/src/controllers/members.controller.js` (add `getOne`)
- Modify: `backend/src/routes/members.routes.js`
- Test: `backend/test/team.member.test.mjs`

**Interfaces:**
- Consumes: `adminScope(req)` and `teamService` from Task 1; `permissionsService.getEffectiveForUser(orgId, role, userOverrides) -> Promise<{[key]: boolean}>`.
- Produces:
  - `authRepository.getUserInOrgs(orgIds, userId) -> Promise<Row|null>` (Row includes `permissions`)
  - `teamService.get(scope, userId) -> Promise<{ member, overrides, effective, accounts }>`
  - Route `GET /api/admin/team/:id`, owner-only.

- [ ] **Step 1: Write the failing test**

Create `backend/test/team.member.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { getUserInOrgs: vi.fn(async () => null) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: { listForUser: vi.fn(async () => []) },
}));
vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: { childOrgs: vi.fn(async () => []), orgNames: vi.fn(async () => new Map()) },
}));
vi.mock('../src/services/permissions.service.js', () => ({
  permissionsService: { getEffectiveForUser: vi.fn(async () => ({ 'crm.view': true, 'finance.view': false })) },
}));

const { authRepository } = await import('../src/repositories/auth.repository.js');
const { membershipRepository } = await import('../src/repositories/membership.repository.js');
const { teamService } = await import('../src/services/team.service.js');

const SCOPE = { orgIds: ['org-1'], agencyWide: false, agencyOrgId: null };

beforeEach(() => vi.clearAllMocks());

describe('teamService.get', () => {
  it('404s a user outside the administered orgs', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce(null);
    await expect(teamService.get(SCOPE, 'u-other')).rejects.toThrow(/not found/i);
    expect(authRepository.getUserInOrgs).toHaveBeenCalledWith(['org-1'], 'u-other');
  });

  it('separates explicit overrides from the effective map', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'u1', organisation_id: 'org-1', email: 'a@x.dev', full_name: 'A', phone: null,
      role: 'practice_manager', status: 'active', is_agency_admin: false,
      last_active_at: null, permissions: { 'finance.view': false },
    });
    const out = await teamService.get(SCOPE, 'u1');
    expect(out.overrides).toEqual({ 'finance.view': false });
    expect(out.effective).toEqual({ 'crm.view': true, 'finance.view': false });
    expect(out.member.role).toBe('practice_manager');
    // The raw JSONB must not travel back inside `member` as well — one
    // representation of the overrides, not two that can disagree.
    expect(out.member.permissions).toBeUndefined();
  });

  it('lists only the memberships inside the administered orgs', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({
      id: 'u1', organisation_id: 'org-1', email: 'a@x.dev', full_name: 'A', phone: null,
      role: 'owner', status: 'active', is_agency_admin: false, last_active_at: null, permissions: {},
    });
    membershipRepository.listForUser.mockResolvedValueOnce([
      { organisation_id: 'org-1', name: 'Mine', role: 'owner', permissions: {} },
      { organisation_id: 'org-elsewhere', name: 'Not mine', role: 'reception', permissions: {} },
    ]);
    const out = await teamService.get(SCOPE, 'u1');
    expect(out.accounts).toEqual([{ id: 'org-1', name: 'Mine', role: 'owner' }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/team.member.test.mjs`
Expected: FAIL — `teamService.get is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `backend/src/repositories/auth.repository.js`, after `listMembersForOrgs`:

```js
    // One member, but only if they sit in an org this caller administers.
    // maybeSingle so "not in scope" is null rather than a thrown PGRST116.
    async getUserInOrgs(orgIds, userId) {
        if (!orgIds?.length) return null;
        const { data, error } = await supabase_1.serviceClient
            .from('users')
            .select('id, organisation_id, email, full_name, phone, role, status, is_agency_admin, last_active_at, permissions')
            .in('organisation_id', orgIds)
            .eq('id', userId)
            .maybeSingle();
        if (error) throw error;
        return data ?? null;
    },
```

Add to `backend/src/services/team.service.js` — extend the imports and add `get`:

```js
import { AppError } from '../middleware/errors.js';
import { permissionsService } from './permissions.service.js';
```

```js
  async get(scope, userId) {
    const row = await authRepository.getUserInOrgs(scope.orgIds, userId);
    if (!row) throw new AppError('Member not found', 404);
    const { permissions: overrides, ...member } = row;

    const memberships = await membershipRepository.listForUser(userId);
    const inScope = memberships.filter((m) => scope.orgIds.includes(m.organisation_id));

    // Effective = catalogue <- role_permissions <- this user's overrides,
    // resolved exactly the way a request resolves it, so the editor shows
    // what the person actually gets rather than an approximation of it.
    const effective = await permissionsService.getEffectiveForUser(
      member.organisation_id,
      member.role,
      overrides || {},
    );

    return {
      member,
      overrides: overrides || {},
      effective,
      accounts: inScope.map((m) => ({
        id: m.organisation_id,
        name: m.name,
        role: m.role,
      })),
    };
  },
```

Add to `backend/src/controllers/members.controller.js`:

```js
  // GET /api/admin/team/:id — one member, for the editor.
  async getOne(req, res) {
    const scope = await adminScope(req);
    res.json(await teamService.get(scope, req.params.id));
  },
```

Add to `backend/src/routes/members.routes.js` — extend the auth import and register the route AFTER the static POST routes so `/:id` cannot shadow them:

```js
import { requirePermission, requireRole } from "../middleware/auth.js";
```

```js
// Reading and writing ONE member is owner-only, the same reasoning as
// permissions.routes.js: the editor writes users.permissions, which sits at
// the top of the precedence chain, so delegating it via a permission key
// would let a holder grant themselves the key that guards it.
// Registered after the static POSTs above so `/:id` never shadows them.
router.get("/:id", requireRole('owner'), asyncHandler(membersController.getOne));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/team.member.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Stage — DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add backend/src/services/team.service.js backend/src/repositories/auth.repository.js \
  backend/src/controllers/members.controller.js backend/src/routes/members.routes.js \
  backend/test/team.member.test.mjs
git status
```

---

### Task 3: Save one member — profile, role, permission overrides

`PUT /api/admin/team/:id` writes the profile, the role and the per-user overrides. Account assignment is Task 4; this task rejects `organisation_ids` outright so the endpoint is never briefly permissive.

**Files:**
- Modify: `backend/src/models/auth.model.js` (add `saveMemberSchema`)
- Modify: `backend/src/services/team.service.js` (add `mergeOverrides`, `save`)
- Modify: `backend/src/repositories/auth.repository.js` (add `updateMember`)
- Modify: `backend/src/controllers/members.controller.js` (add `save`)
- Modify: `backend/src/routes/members.routes.js`
- Test: `backend/test/team.save.test.mjs`

**Interfaces:**
- Consumes: `canManageTarget(callerRole, targetRole) -> boolean` and `assertGrantCeiling(caller, permissions)` from `../services/auth.service.js`; `isValidPermission(key) -> boolean` from `../lib/permissions.js`.
- Produces:
  - `mergeOverrides(current, patch) -> object` — `null` in the patch DELETES a key (back to inheriting the role), `true`/`false` set it.
  - `teamService.save(scope, caller, userId, body) -> Promise<{ success: true, permissions, accounts? }>`
  - `authRepository.updateMember(orgId, userId, patch) -> Promise<void>`
  - `saveMemberSchema` accepting `{ full_name?, phone?, role?, permissions?: Record<string, boolean|null>, organisation_ids?: string[] }`
  - Route `PUT /api/admin/team/:id`, owner-only.

- [ ] **Step 1: Write the failing test**

Create `backend/test/team.save.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { getUserInOrgs: vi.fn(), updateMember: vi.fn(async () => {}) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: { listForUser: vi.fn(async () => []), add: vi.fn(), remove: vi.fn() },
}));
vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: { childOrgs: vi.fn(async () => []), orgNames: vi.fn(async () => new Map()) },
}));
vi.mock('../src/services/permissions.service.js', () => ({
  permissionsService: { getEffectiveForUser: vi.fn(async () => ({})) },
}));

const { authRepository } = await import('../src/repositories/auth.repository.js');
const { teamService, mergeOverrides } = await import('../src/services/team.service.js');

const SCOPE = { orgIds: ['org-1'], agencyWide: false, agencyOrgId: null };
const OWNER = { id: 'caller', role: 'owner', permissions: {} };
const TARGET = {
  id: 'u1', organisation_id: 'org-1', email: 'a@x.dev', full_name: 'A', phone: null,
  role: 'reception', status: 'active', is_agency_admin: false, last_active_at: null,
  permissions: { 'crm.view': true, 'finance.view': false },
};

beforeEach(() => {
  vi.clearAllMocks();
  authRepository.getUserInOrgs.mockResolvedValue({ ...TARGET });
});

describe('mergeOverrides', () => {
  it('null removes a key so the row goes back to inheriting the role', () => {
    expect(mergeOverrides({ a: true, b: false }, { a: null })).toEqual({ b: false });
  });
  it('false is an explicit deny, not a removal', () => {
    expect(mergeOverrides({}, { a: false })).toEqual({ a: false });
  });
  it('leaves keys the patch does not mention alone', () => {
    expect(mergeOverrides({ a: true }, { b: true })).toEqual({ a: true, b: true });
  });
});

describe('teamService.save', () => {
  it('404s a user outside the administered orgs', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce(null);
    await expect(teamService.save(SCOPE, OWNER, 'u-other', { full_name: 'X' }))
      .rejects.toThrow(/not found/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('refuses a caller who cannot manage the target role', async () => {
    authRepository.getUserInOrgs.mockResolvedValueOnce({ ...TARGET, role: 'owner' });
    const pm = { id: 'c', role: 'practice_manager', permissions: {} };
    await expect(teamService.save(SCOPE, pm, 'u1', { full_name: 'X' })).rejects.toThrow(/role/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('refuses promoting a target above the caller', async () => {
    const pm = { id: 'c', role: 'practice_manager', permissions: { 'crm.view': true } };
    await expect(teamService.save(SCOPE, pm, 'u1', { role: 'owner' })).rejects.toThrow(/role/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('enforces the grant ceiling — you cannot give what you do not hold', async () => {
    const pm = { id: 'c', role: 'practice_manager', permissions: { 'crm.view': true } };
    await expect(teamService.save(SCOPE, pm, 'u1', { permissions: { 'finance.view': true } }))
      .rejects.toThrow(/cannot grant/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('rejects a permission key that is not in the catalogue', async () => {
    await expect(teamService.save(SCOPE, OWNER, 'u1', { permissions: { 'not.a.key': true } }))
      .rejects.toThrow(/unknown permission/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('writes the merged overrides against the target OWN org', async () => {
    const out = await teamService.save(SCOPE, OWNER, 'u1', {
      full_name: 'Jane Smith', phone: '+44 7700 900001', role: 'practice_manager',
      permissions: { 'finance.view': null, 'growth.view': true },
    });
    expect(authRepository.updateMember).toHaveBeenCalledWith('org-1', 'u1', {
      full_name: 'Jane Smith',
      phone: '+44 7700 900001',
      role: 'practice_manager',
      permissions: { 'crm.view': true, 'growth.view': true },
    });
    expect(out.permissions).toEqual({ 'crm.view': true, 'growth.view': true });
  });

  it('rejects organisation_ids from a caller who is not an agency admin', async () => {
    await expect(teamService.save(SCOPE, OWNER, 'u1', { organisation_ids: ['org-1'] }))
      .rejects.toThrow(/agency/i);
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/team.save.test.mjs`
Expected: FAIL — `mergeOverrides is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `backend/src/models/auth.model.js`:

```js
// Settings → Team, per-user save. `permissions` values are tri-state:
// true grants, false explicitly denies, and null REMOVES the override so the
// row inherits its role again — which is why this is nullable() rather than a
// plain boolean record. `organisation_ids` is accepted only from an agency
// admin; the service, not this schema, is what enforces that.
export const saveMemberSchema = zod_1.z.object({
    full_name: zod_1.z.string().min(1).optional(),
    phone: zod_1.z.string().optional(),
    role: zod_1.z.enum(['owner', 'practice_manager', 'reception', 'analyst']).optional(),
    permissions: zod_1.z.record(zod_1.z.boolean().nullable()).optional(),
    organisation_ids: zod_1.z.array(zod_1.z.string().uuid()).optional(),
});
```

Add to `backend/src/repositories/auth.repository.js`, after `getUserInOrgs`:

```js
    // Org-scoped profile/role/permissions write. The org filter is the tenant
    // boundary on this table — never update by id alone.
    async updateMember(orgId, userId, patch) {
        const { error } = await supabase_1.serviceClient
            .from('users')
            .update(patch)
            .eq('organisation_id', orgId)
            .eq('id', userId);
        if (error) throw error;
    },
```

Add to `backend/src/services/team.service.js` — extend the imports:

```js
import { canManageTarget, assertGrantCeiling } from './auth.service.js';
import { isValidPermission } from '../lib/permissions.js';
```

and add:

```js
/**
 * Apply a tri-state permission patch to a user's stored overrides.
 * `null` DELETES the key — the row goes back to inheriting its role — which
 * is what the editor's reset control sends. `false` is an explicit deny and
 * is kept.
 */
export function mergeOverrides(current, patch) {
  const out = { ...(current || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === null) delete out[key];
    else out[key] = !!value;
  }
  return out;
}
```

and the `save` method on `teamService`:

```js
  async save(scope, caller, userId, body) {
    const target = await authRepository.getUserInOrgs(scope.orgIds, userId);
    if (!target) throw new AppError('Member not found', 404);

    // Two hierarchy checks, not one: you must be able to manage the person as
    // they are now, AND you must not be able to hand them a role above your
    // own. Checking only the first lets a practice manager promote a
    // receptionist to owner and then be outranked by them.
    if (!canManageTarget(caller.role, target.role)) {
      throw new AppError('You cannot manage a member of that role', 403);
    }
    if (body.role && !canManageTarget(caller.role, body.role)) {
      throw new AppError('You cannot assign a role above your own', 403);
    }

    for (const key of Object.keys(body.permissions || {})) {
      if (!isValidPermission(key)) throw new AppError(`Unknown permission: ${key}`, 400);
    }
    assertGrantCeiling(caller, body.permissions);

    if (body.organisation_ids !== undefined && !scope.agencyWide) {
      throw new AppError('Only an agency admin can assign accounts', 403);
    }

    const overrides = mergeOverrides(target.permissions, body.permissions);
    const patch = { permissions: overrides };
    if (body.full_name !== undefined) patch.full_name = body.full_name;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.role !== undefined) patch.role = body.role;

    // Written against the target's OWN org, not the caller's — an agency
    // admin edits people who sit in a sub-account.
    await authRepository.updateMember(target.organisation_id, userId, patch);

    return { success: true, permissions: overrides };
  },
```

Add to `backend/src/controllers/members.controller.js` (and extend its model import to include `saveMemberSchema`):

```js
  // PUT /api/admin/team/:id — profile, role, permission overrides and (agency
  // only) the accounts this person reaches, in one save.
  async save(req, res) {
    const body = saveMemberSchema.parse(req.body);
    const scope = await adminScope(req);
    res.json(await teamService.save(scope, req.user, req.params.id, body));
  },
```

Add to `backend/src/routes/members.routes.js`, after the `GET /:id` line:

```js
router.put("/:id", requireRole('owner'), asyncHandler(membersController.save));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/team.save.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Stage — DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add backend/src/models/auth.model.js backend/src/services/team.service.js \
  backend/src/repositories/auth.repository.js backend/src/controllers/members.controller.js \
  backend/src/routes/members.routes.js backend/test/team.save.test.mjs
git status
```

---

### Task 4: Assign a person to several accounts

The agency-only half of the save: reconcile `user_organisations` rows, writing the same role and permission map to every assigned account. This is what closes the gap named in the spec — until now nothing wrote `user_organisations.permissions`, so a person in five accounts carried their overrides in one and role defaults in the other four.

**Files:**
- Modify: `backend/src/services/team.service.js` (add `applyAccounts`, call it from `save`)
- Test: `backend/test/team.accounts.test.mjs`

**Interfaces:**
- Consumes: `membershipRepository.listForUser(userId) -> Promise<[{organisation_id,name,role,permissions}]>`, `.add(userId, orgId, role, permissions) -> Promise<void>`, `.remove(userId, orgId) -> Promise<void>`; `teamService.save` from Task 3.
- Produces: `teamService.save(...)` resolves with `accounts: string[]` when `organisation_ids` was supplied.

- [ ] **Step 1: Write the failing test**

Create `backend/test/team.accounts.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { getUserInOrgs: vi.fn(), updateMember: vi.fn(async () => {}) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: {
    listForUser: vi.fn(async () => []), add: vi.fn(async () => {}), remove: vi.fn(async () => {}),
  },
}));
vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: { childOrgs: vi.fn(async () => []), orgNames: vi.fn(async () => new Map()) },
}));
vi.mock('../src/services/permissions.service.js', () => ({
  permissionsService: { getEffectiveForUser: vi.fn(async () => ({})) },
}));

const { authRepository } = await import('../src/repositories/auth.repository.js');
const { membershipRepository } = await import('../src/repositories/membership.repository.js');
const { teamService } = await import('../src/services/team.service.js');

const AGENCY_SCOPE = {
  orgIds: ['agency-1', 'child-1', 'child-2'], agencyWide: true, agencyOrgId: 'agency-1',
};
const OWNER = { id: 'caller', role: 'owner', permissions: {} };
const TARGET = {
  id: 'u1', organisation_id: 'child-1', email: 'a@x.dev', full_name: 'A', phone: null,
  role: 'reception', status: 'active', is_agency_admin: false, last_active_at: null,
  permissions: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  authRepository.getUserInOrgs.mockResolvedValue({ ...TARGET });
  membershipRepository.listForUser.mockResolvedValue([
    { organisation_id: 'child-1', name: 'Rye', role: 'reception', permissions: {} },
  ]);
});

describe('teamService.save — account assignment', () => {
  it('404s an organisation that is not one this caller administers', async () => {
    await expect(teamService.save(AGENCY_SCOPE, OWNER, 'u1', {
      organisation_ids: ['child-1', 'someone-elses-org'],
    })).rejects.toThrow(/sub-account/i);
    expect(membershipRepository.add).not.toHaveBeenCalled();
    // Nothing is written at all — the whole save is refused, not half-applied.
    expect(authRepository.updateMember).not.toHaveBeenCalled();
  });

  it('refuses to drop the home account — the person could not sign in', async () => {
    await expect(teamService.save(AGENCY_SCOPE, OWNER, 'u1', {
      organisation_ids: ['child-2'],
    })).rejects.toThrow(/home account/i);
    expect(membershipRepository.remove).not.toHaveBeenCalled();
  });

  it('writes the SAME role and permissions to every assigned account', async () => {
    await teamService.save(AGENCY_SCOPE, OWNER, 'u1', {
      role: 'practice_manager',
      permissions: { 'growth.view': true },
      organisation_ids: ['child-1', 'child-2'],
    });
    expect(membershipRepository.add).toHaveBeenCalledTimes(2);
    expect(membershipRepository.add).toHaveBeenCalledWith(
      'u1', 'child-1', 'practice_manager', { 'growth.view': true });
    expect(membershipRepository.add).toHaveBeenCalledWith(
      'u1', 'child-2', 'practice_manager', { 'growth.view': true });
  });

  it('removes a membership the new list drops', async () => {
    membershipRepository.listForUser.mockResolvedValueOnce([
      { organisation_id: 'child-1', name: 'Rye', role: 'reception', permissions: {} },
      { organisation_id: 'child-2', name: 'Barnet', role: 'reception', permissions: {} },
    ]);
    await teamService.save(AGENCY_SCOPE, OWNER, 'u1', { organisation_ids: ['child-1'] });
    expect(membershipRepository.remove).toHaveBeenCalledWith('u1', 'child-2');
    expect(membershipRepository.remove).toHaveBeenCalledTimes(1);
  });

  it('never removes a membership of an org outside the administered scope', async () => {
    membershipRepository.listForUser.mockResolvedValueOnce([
      { organisation_id: 'child-1', name: 'Rye', role: 'reception', permissions: {} },
      { organisation_id: 'unrelated-org', name: 'Elsewhere', role: 'owner', permissions: {} },
    ]);
    await teamService.save(AGENCY_SCOPE, OWNER, 'u1', { organisation_ids: ['child-1'] });
    expect(membershipRepository.remove).not.toHaveBeenCalled();
  });

  it('falls back to the target existing role when the save does not change it', async () => {
    await teamService.save(AGENCY_SCOPE, OWNER, 'u1', { organisation_ids: ['child-1'] });
    expect(membershipRepository.add).toHaveBeenCalledWith('u1', 'child-1', 'reception', {});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/team.accounts.test.mjs`
Expected: FAIL — the first test fails because nothing validates the org list yet.

- [ ] **Step 3: Write the implementation**

Add to `backend/src/services/team.service.js`, above `teamService`:

```js
/**
 * Reconcile which accounts one person reaches.
 *
 * Every requested id is checked against the orgs THIS caller administers —
 * the ids arrive in the request body, so they are input, never authority.
 * The same role and permission map goes to every row: one screen states the
 * whole truth about a person, and until this existed nothing wrote
 * user_organisations.permissions at all, so a person in five accounts kept
 * their overrides in one and silently fell back to role defaults in the rest.
 *
 * Memberships of orgs OUTSIDE the scope are left completely alone — this
 * caller cannot see them, so it must not delete them either.
 */
async function applyAccounts(scope, target, userId, requestedIds, role, permissions) {
  const allowed = new Set(scope.orgIds);
  for (const id of requestedIds) {
    if (!allowed.has(id)) {
      throw new AppError('Not a sub-account of your organisation', 404);
    }
  }
  if (!requestedIds.includes(target.organisation_id)) {
    throw new AppError(
      'A member\'s home account cannot be removed — it is where they sign in',
      400,
    );
  }

  const current = await membershipRepository.listForUser(userId);
  for (const id of requestedIds) {
    await membershipRepository.add(userId, id, role, permissions);
  }
  for (const m of current) {
    if (allowed.has(m.organisation_id) && !requestedIds.includes(m.organisation_id)) {
      await membershipRepository.remove(userId, m.organisation_id);
    }
  }
  return requestedIds;
}
```

Then in `teamService.save`, move the account validation BEFORE the profile write so a bad org list refuses the whole save rather than half-applying it. Replace the tail of `save` (from `const overrides = ...` onward) with:

```js
    const overrides = mergeOverrides(target.permissions, body.permissions);
    const nextRole = body.role ?? target.role;

    // Validate and reconcile the accounts FIRST: a rejected org id must leave
    // the profile untouched, not half-saved.
    let accounts;
    if (body.organisation_ids !== undefined) {
      accounts = await applyAccounts(
        scope, target, userId, body.organisation_ids, nextRole, overrides,
      );
    }

    const patch = { permissions: overrides };
    if (body.full_name !== undefined) patch.full_name = body.full_name;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.role !== undefined) patch.role = body.role;
    await authRepository.updateMember(target.organisation_id, userId, patch);

    return { success: true, permissions: overrides, accounts };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/team.accounts.test.mjs test/team.save.test.mjs`
Expected: PASS, 16 tests across the two files.

Then the whole backend suite:
Run: `cd backend && npm test && npm run lint && npm run typecheck`
Expected: PASS, lint 0 errors (12 pre-existing warnings are fine).

- [ ] **Step 5: Stage — DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add backend/src/services/team.service.js backend/test/team.accounts.test.mjs
git status
```

---

### Task 5: Create a user in one call

`+ Add User` needs to create the login and apply role, permissions and accounts together. Doing it as two client calls would leave a user created with no accounts when the second call fails.

**Files:**
- Modify: `backend/src/models/auth.model.js` (add `createMemberSchema`)
- Modify: `backend/src/services/team.service.js` (add `create`)
- Modify: `backend/src/controllers/members.controller.js` (add `create`)
- Modify: `backend/src/routes/members.routes.js`
- Test: `backend/test/team.create.test.mjs`

**Interfaces:**
- Consumes: `authService.provisionMember(orgId, caller, body) -> Promise<{success, user_id, status}>`; `authService.invite(orgId, caller, body)`; `applyAccounts` from Task 4.
- Produces: `teamService.create(scope, caller, body) -> Promise<{ success: true, user_id, status, accounts? }>`; route `POST /api/admin/team`, owner-only.

- [ ] **Step 1: Write the failing test**

Create `backend/test/team.create.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';

vi.mock('../src/repositories/auth.repository.js', () => ({
  authRepository: { getUserInOrgs: vi.fn(), updateMember: vi.fn(async () => {}) },
}));
vi.mock('../src/repositories/membership.repository.js', () => ({
  membershipRepository: {
    listForUser: vi.fn(async () => []), add: vi.fn(async () => {}), remove: vi.fn(async () => {}),
  },
}));
vi.mock('../src/repositories/agency.repository.js', () => ({
  agencyRepository: { childOrgs: vi.fn(async () => []), orgNames: vi.fn(async () => new Map()) },
}));
vi.mock('../src/services/permissions.service.js', () => ({
  permissionsService: { getEffectiveForUser: vi.fn(async () => ({})) },
}));
vi.mock('../src/services/auth.service.js', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    authService: {
      provisionMember: vi.fn(async () => ({ success: true, user_id: 'new-1', status: 'active' })),
      invite: vi.fn(async () => ({ success: true, user_id: 'new-2', status: 'invited' })),
    },
  };
});

const { authService } = await import('../src/services/auth.service.js');
const { membershipRepository } = await import('../src/repositories/membership.repository.js');
const { teamService } = await import('../src/services/team.service.js');

const OWN_SCOPE = { orgIds: ['org-1'], agencyWide: false, agencyOrgId: null };
const AGENCY_SCOPE = { orgIds: ['agency-1', 'child-1'], agencyWide: true, agencyOrgId: 'agency-1' };
const OWNER = { id: 'caller', role: 'owner', permissions: {} };

beforeEach(() => vi.clearAllMocks());

describe('teamService.create', () => {
  it('provisions into the caller own org when no account is named', async () => {
    const out = await teamService.create(OWN_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'New Person', role: 'reception', password: 'longenough1',
    });
    expect(authService.provisionMember).toHaveBeenCalledWith('org-1', OWNER, expect.objectContaining({
      email: 'new@x.dev', role: 'reception', password: 'longenough1',
    }));
    expect(out.user_id).toBe('new-1');
  });

  it('an agency admin can create the user inside a sub-account', async () => {
    await teamService.create(AGENCY_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'New Person', role: 'reception', password: 'longenough1',
      home_organisation_id: 'child-1',
    });
    expect(authService.provisionMember).toHaveBeenCalledWith('child-1', OWNER, expect.anything());
  });

  it('refuses a home account outside the administered orgs', async () => {
    await expect(teamService.create(AGENCY_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'N', role: 'reception', password: 'longenough1',
      home_organisation_id: 'not-mine',
    })).rejects.toThrow(/sub-account/i);
    expect(authService.provisionMember).not.toHaveBeenCalled();
  });

  it('refuses a non-agency caller naming any home account but their own', async () => {
    await expect(teamService.create(OWN_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'N', role: 'reception', password: 'longenough1',
      home_organisation_id: 'org-2',
    })).rejects.toThrow(/sub-account/i);
  });

  it('assigns the extra accounts after creating the login', async () => {
    await teamService.create(AGENCY_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'N', role: 'reception', password: 'longenough1',
      home_organisation_id: 'child-1', organisation_ids: ['child-1', 'agency-1'],
    });
    expect(membershipRepository.add).toHaveBeenCalledWith('new-1', 'child-1', 'reception', {});
    expect(membershipRepository.add).toHaveBeenCalledWith('new-1', 'agency-1', 'reception', {});
  });

  it('uses the invite path when no password is given', async () => {
    const out = await teamService.create(OWN_SCOPE, OWNER, {
      email: 'new@x.dev', full_name: 'N', role: 'reception',
    });
    expect(authService.invite).toHaveBeenCalled();
    expect(authService.provisionMember).not.toHaveBeenCalled();
    expect(out.status).toBe('invited');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/team.create.test.mjs`
Expected: FAIL — `teamService.create is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `backend/src/models/auth.model.js`:

```js
// Settings → Team, create. `password` present takes the provision path (the
// member is active at once); absent takes the invite-email path.
// `home_organisation_id` is where the login LIVES — accepted only from an
// agency admin, and validated against the orgs they administer.
export const createMemberSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    full_name: zod_1.z.string().min(1),
    role: zod_1.z.enum(['owner', 'practice_manager', 'reception', 'analyst']),
    password: zod_1.z.string().min(8).optional(),
    phone: zod_1.z.string().optional(),
    permissions: zod_1.z.record(zod_1.z.boolean()).optional(),
    home_organisation_id: zod_1.z.string().uuid().optional(),
    organisation_ids: zod_1.z.array(zod_1.z.string().uuid()).optional(),
});
```

Add to `backend/src/services/team.service.js` — extend the imports with:

```js
import { authService } from './auth.service.js';
```

and add to `teamService`:

```js
  async create(scope, caller, body) {
    // Where the login lives. An agency admin may put it in a sub-account; a
    // plain owner may only ever name their own org, and naming any other is
    // refused rather than quietly redirected home.
    const homeOrg = body.home_organisation_id ?? scope.orgIds[0];
    if (!scope.orgIds.includes(homeOrg)) {
      throw new AppError('Not a sub-account of your organisation', 404);
    }
    if (body.organisation_ids !== undefined && !scope.agencyWide) {
      throw new AppError('Only an agency admin can assign accounts', 403);
    }

    const permissions = body.permissions || {};
    const input = {
      email: body.email,
      full_name: body.full_name,
      role: body.role,
      permissions,
    };
    // provisionMember/invite already enforce the role hierarchy and the grant
    // ceiling against `caller`, so they are not re-checked here.
    const created = body.password
      ? await authService.provisionMember(homeOrg, caller, { ...input, password: body.password })
      : await authService.invite(homeOrg, caller, input);

    if (body.phone) {
      await authRepository.updateMember(homeOrg, created.user_id, { phone: body.phone });
    }

    let accounts;
    if (body.organisation_ids !== undefined) {
      accounts = await applyAccounts(
        scope,
        { organisation_id: homeOrg },
        created.user_id,
        body.organisation_ids,
        body.role,
        permissions,
      );
    }
    return { ...created, accounts };
  },
```

Add to `backend/src/controllers/members.controller.js` (extend the model import with `createMemberSchema`):

```js
  // POST /api/admin/team — create a login and assign its accounts in one call.
  async create(req, res) {
    const body = createMemberSchema.parse(req.body);
    const scope = await adminScope(req);
    res.json(await teamService.create(scope, req.user, body));
  },
```

Add to `backend/src/routes/members.routes.js`, with the other static routes (before `/:id`):

```js
router.post("/", requireRole('owner'), asyncHandler(membersController.create));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/team.create.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Stage — DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add backend/src/models/auth.model.js backend/src/services/team.service.js \
  backend/src/controllers/members.controller.js backend/src/routes/members.routes.js \
  backend/test/team.create.test.mjs
git status
```

---

### Task 6: Route gates, structurally asserted

`requireRole` and `requirePermission` both return anonymous closures, so a name check cannot tell them apart. Assert the gates by RUNNING them — the same technique `test/open-day.routes.test.mjs` uses.

**Files:**
- Test: `backend/test/team.routes.test.mjs`

**Interfaces:**
- Consumes: the router from `backend/src/routes/members.routes.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `backend/test/team.routes.test.mjs`:

```js
// The gates on /api/admin/team, asserted by RUNNING them. requireRole and
// requirePermission both return anonymous closures, so identifying them by
// name is not possible — a non-owner must actually be refused.
import { describe, it, expect, vi } from 'vitest';
import './setup.js';

vi.mock('../src/services/team.service.js', () => ({
  adminScope: vi.fn(async () => ({ orgIds: ['org-1'], agencyWide: false, agencyOrgId: null })),
  teamService: {
    list: vi.fn(async () => ({ members: [], agency_wide: false })),
    get: vi.fn(async () => ({})),
    save: vi.fn(async () => ({ success: true })),
    create: vi.fn(async () => ({ success: true, user_id: 'x' })),
  },
}));

const router = (await import('../src/routes/members.routes.js')).default;

/** Run every middleware on a matched route until one responds. */
async function runRoute(method, path, req) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  expect(layer, `${method.toUpperCase()} ${path} is not registered`).toBeTruthy();
  let status = 200;
  let body;
  const res = {
    status(c) { status = c; return res; },
    json(b) { body = b; return res; },
  };
  for (const s of layer.route.stack) {
    let advanced = false;
    await s.handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return { status, body };
}

const OWNER = { id: 'u1', organisation_id: 'org-1', role: 'owner', permissions: { 'users.manage': true, 'users.invite': true } };
const PM = { id: 'u2', organisation_id: 'org-1', role: 'practice_manager', permissions: { 'users.manage': true, 'users.invite': true } };

describe('/api/admin/team gates', () => {
  it('registers the static POSTs before /:id so they are not shadowed', () => {
    const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
    for (const p of ['/invite', '/provision', '/password', '/remove']) {
      expect(paths.indexOf(p)).toBeLessThan(paths.indexOf('/:id'));
    }
  });

  it('GET /:id refuses a practice manager who holds users.manage', async () => {
    const out = await runRoute('get', '/:id', { user: PM, params: { id: 'u9' } });
    expect(out.status).toBe(403);
  });

  it('PUT /:id refuses a practice manager who holds users.manage', async () => {
    const out = await runRoute('put', '/:id', { user: PM, params: { id: 'u9' }, body: {} });
    expect(out.status).toBe(403);
  });

  it('POST / refuses a practice manager who holds users.manage', async () => {
    const out = await runRoute('post', '/', { user: PM, body: {} });
    expect(out.status).toBe(403);
  });

  it('GET /:id admits an owner', async () => {
    const out = await runRoute('get', '/:id', { user: OWNER, params: { id: 'u9' } });
    expect(out.status).toBe(200);
  });

  it('GET / stays on users.invite, so a practice manager can still read the team', async () => {
    const out = await runRoute('get', '/', { user: PM });
    expect(out.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/team.routes.test.mjs`
Expected: PASS if Tasks 2, 3 and 5 registered the routes correctly. If any test FAILS, the route registration is wrong — fix the route file, not the test.

- [ ] **Step 3: Fix any gate the test rejects**

If `GET /:id`, `PUT /:id` or `POST /` admits the practice manager, the `requireRole('owner')` argument is missing from that registration in `backend/src/routes/members.routes.js`. Add it. If the ordering test fails, move the `/:id` registrations below the static POST routes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/team.routes.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Stage — DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add backend/test/team.routes.test.mjs backend/src/routes/members.routes.js
git status
```

---

### Task 7: The settings shell

Move the settings screens into their own route group so the dashboard chrome stops wrapping them. URLs do not change.

**Files:**
- Create: `frontend/app/(settings)/layout.tsx`
- Create: `frontend/components/layout/SettingsRail.tsx`
- Create: `frontend/components/layout/SettingsTopBar.tsx`
- Create: `frontend/app/(settings)/settings/billing/page.tsx`
- Create: `frontend/features/settings/components/BillingScreen.tsx`
- Create: `frontend/app/(settings)/settings/roles/page.tsx`
- Create: `frontend/features/team/permission-sections.ts`
- Create: `frontend/features/team/components/RolesMatrixScreen.tsx`
- Move: `frontend/app/(dashboard)/{integrations,data-hub,team-permissions,settings}` → `frontend/app/(settings)/…`
- Modify: `frontend/app/(settings)/settings/page.tsx` (becomes a redirect)
- Modify: `frontend/features/system/components/TeamPermissionsScreen.tsx` (matrix half extracted out)

**Interfaces:**
- Consumes: `useMe()`, `canAccessRoute(routeId, permissions)`, `featureAllowsSection('Settings', features)`, `useBillingPortal()`.
- Produces: `SETTINGS_ITEMS: { href, label, routeId }[]` exported from `SettingsRail.tsx`; `KEY_SECTION`, `SECTION_ORDER` exported from `features/team/permission-sections.ts` for Task 9.

- [ ] **Step 1: Move the folders and create the shell**

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend
mkdir -p "app/(settings)"
git mv "app/(dashboard)/integrations" "app/(settings)/integrations"
git mv "app/(dashboard)/data-hub" "app/(settings)/data-hub"
git mv "app/(dashboard)/team-permissions" "app/(settings)/team-permissions"
git mv "app/(dashboard)/settings" "app/(settings)/settings"
```

Create `frontend/app/(settings)/layout.tsx`:

```tsx
import { Suspense } from 'react';
import { SettingsRail } from '@/components/layout/SettingsRail';
import { SettingsTopBar } from '@/components/layout/SettingsTopBar';

// Settings is its own shell. The dashboard sidebar, topbar and section tab
// strip live in app/(dashboard)/layout.tsx, so they simply never wrap these
// routes — "hide the rest of the product" is layout nesting, not a conditional
// inside a shared shell that the two could drift apart on.
//
// Route groups do not appear in the URL: /integrations, /data-hub,
// /team-permissions and /settings are unchanged, so every existing link into
// them keeps working and nothing needs a redirect.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <div className="min-h-screen flex bg-bg">
        <SettingsRail />
        <div className="flex-1 flex flex-col min-w-0">
          <SettingsTopBar />
          <main className="flex-1 p-6 overflow-y-auto">{children}</main>
        </div>
      </div>
    </Suspense>
  );
}
```

Create `frontend/components/layout/SettingsRail.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMe } from '@/hooks/useMe';
import { canAccessRoute, featureAllowsSection } from '@/lib/permissions';

// The Settings menu. Each row names the route id it is gated by, so the rail
// uses exactly the permission the page itself uses — no second list of rules
// to fall out of step with lib/permissions.ts.
export const SETTINGS_ITEMS: { href: string; label: string; routeId: string }[] = [
  { href: '/team-permissions', label: 'Team', routeId: 'team-permissions' },
  { href: '/settings/roles', label: 'Roles & Permissions', routeId: 'team-permissions' },
  { href: '/integrations', label: 'Integrations', routeId: 'integrations' },
  { href: '/data-hub', label: 'Data Hub', routeId: 'data-hub' },
  { href: '/settings/billing', label: 'Billing', routeId: 'settings' },
  { href: '/settings/ad-attribution', label: 'Ad attribution', routeId: 'settings' },
];

export function SettingsRail() {
  const pathname = usePathname();
  const { data: me } = useMe();

  const allowed = featureAllowsSection('Settings', me?.features)
    ? SETTINGS_ITEMS.filter((i) => canAccessRoute(i.routeId, me?.permissions))
    : [];

  return (
    <aside className="w-64 shrink-0 bg-card h-screen sticky top-0 flex flex-col border-r border-border">
      <div className="p-3 border-b border-border">
        <Link
          href="/business-hub"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-ink-muted hover:bg-bg hover:text-ink transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Go Back
        </Link>
      </div>

      <div className="px-6 pt-5 pb-2">
        <h2 className="font-display text-lg font-semibold text-ink">Settings</h2>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {allowed.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`block rounded-lg px-3 py-2 text-[13px] transition-colors duration-150 ${
                active
                  ? 'bg-brand-50 font-semibold text-brand'
                  : 'font-medium text-ink-muted hover:bg-bg hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        {allowed.length === 0 && (
          <p className="px-3 py-2 text-[13px] text-ink-muted">
            You do not have access to any settings.
          </p>
        )}
      </nav>
    </aside>
  );
}
```

Create `frontend/components/layout/SettingsTopBar.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useMe } from '@/hooks/useMe';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';
import { exitSwitch } from '@/features/agency/api';

// The settings shell's header. Deliberately not the dashboard TopBar: that one
// carries a hamburger that toggles a sidebar which does not exist here. What
// must survive is the agency-switch banner — losing it inside Settings would
// let someone administer a sub-account's team believing it was their own.
export function SettingsTopBar() {
  const router = useRouter();
  const { data: me } = useMe();

  async function signOut() {
    await fetch('/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="sticky top-0 z-10">
      {me?.agency?.switched && (
        <div className="flex items-center justify-center gap-3 bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-900">
          <span>
            Viewing <strong>{me.organisation_name}</strong> as{' '}
            {me.agency.home_org?.name || 'agency'}
          </span>
          <button type="button" onClick={() => exitSwitch()} className="font-semibold underline">
            Exit
          </button>
        </div>
      )}
      <header className="h-14 bg-card border-b border-border px-6 flex items-center justify-between">
        <span className="font-display text-[15px] font-semibold text-ink truncate">
          {me?.organisation_name || 'Settings'}
        </span>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <button
            type="button"
            onClick={signOut}
            className="text-[13px] font-medium text-ink-muted hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </header>
    </div>
  );
}
```

- [ ] **Step 2: Split the matrix out of TeamPermissionsScreen**

Create `frontend/features/team/permission-sections.ts` by moving `KEY_SECTION` and `SECTION_ORDER` verbatim out of `features/system/components/TeamPermissionsScreen.tsx` (they currently sit just below the `TeamMembers` component):

```ts
/**
 * Visual grouping of catalogue permission keys into the prototype's coloured
 * sections. Keys absent here fall into "System". Shared by the role matrix and
 * the per-user editor so the two screens group permissions identically — two
 * copies would be two answers to "which section is data.export in".
 */
export const KEY_SECTION: Record<string, string> = {
  'finance.view': 'Finance',
  'valuation.view': 'Finance',
  'businesshealth.manage': 'Business Health',
  'overview.view': 'Overview',
  'operations.view': 'Operations',
  'payrun.manage': 'Operations',
  'intelligence.view': 'Intelligence',
  'growth.view': 'Growth',
  'crm.view': 'Elevate CRM',
  'crm.manage': 'Elevate CRM',
  'wealth.view': 'Wealth',
  'training.view': 'Training',
  'marketing.view': 'Marketing',
  'data.export': 'Data Room',
  'system.manage': 'System',
  'users.invite': 'System',
  'users.manage': 'System',
  'permissions.manage': 'System',
};

export const SECTION_ORDER = [
  'Overview',
  'Finance',
  'Business Health',
  'Operations',
  'Intelligence',
  'Growth',
  'Elevate CRM',
  'Wealth',
  'Training',
  'Marketing',
  'Data Room',
  'System',
];
```

Create `frontend/features/team/components/RolesMatrixScreen.tsx` as a COPY of the current `TeamPermissionsScreen` default export, with four changes:

1. Delete the `<TeamMembers />` call from all three return branches (loading, error, main), and do not copy the `TeamMembers` component or the `STATUS_CHIP_COLOUR` / `ROLE_LABEL` constants it alone uses.
2. Import `KEY_SECTION` / `SECTION_ORDER` from `../permission-sections` instead of declaring them.
3. **Rewrite the relative imports** — the file has moved from `features/system/components/` to `features/team/components/`, so `../hooks`, `../api` and `../data` would now resolve to `features/team/*` and silently pick up the wrong module (or fail to resolve). They become:

```tsx
import { usePermissionsMatrix, useSetRolePermission } from '@/features/system/hooks';
import type { EditableRole } from '@/features/system/api';
import { SECTION_COLOURS } from '@/features/system/data';
import { NAV } from '@/lib/nav';
import { ROUTE_PERMISSION, pageKey, PAGE_ENFORCED } from '@/lib/permissions';
import { SkeletonTable } from '@/components/ui';
import { KEY_SECTION, SECTION_ORDER } from '../permission-sections';
```

4. Keep the `Toggle` component, `PM_BLUE` / `REC_GREEN` / `AN_SLATE`, and every existing behaviour of the matrix itself.

Create `frontend/app/(settings)/settings/roles/page.tsx`:

```tsx
export { default } from '@/features/team/components/RolesMatrixScreen';
```

Leave `features/system/components/TeamPermissionsScreen.tsx` otherwise **untouched and still rendering both halves** — `/team-permissions` keeps working through Tasks 7 and 8, and Task 9 deletes it. The matrix is briefly duplicated on purpose: gutting the live screen here would leave the app in a broken intermediate state for two tasks. The one edit it does need is to import the shared constants rather than declare them, so the two copies cannot disagree about which section a key belongs to:

```tsx
// in features/system/components/TeamPermissionsScreen.tsx — replace the
// KEY_SECTION and SECTION_ORDER declarations with:
import { KEY_SECTION, SECTION_ORDER } from '@/features/team/permission-sections';
```

- [ ] **Step 3: Add the billing page and the settings redirect**

Create `frontend/features/settings/components/BillingScreen.tsx`:

```tsx
'use client';
import { PageHeader, Card } from '@/components/ui';
import { useBillingPortal } from '../hooks';

export default function BillingScreen() {
  const billingPortal = useBillingPortal();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Billing" subtitle="Subscription, payment method, invoices" />
      <Card>
        <p className="text-sm text-ink-muted mb-4">
          Manage your subscription, payment method and invoices in the billing portal.
        </p>
        <button onClick={() => billingPortal.mutate()} className="btn-primary">
          {billingPortal.isPending ? 'Loading…' : 'Open billing portal →'}
        </button>
      </Card>
    </div>
  );
}
```

Create `frontend/app/(settings)/settings/billing/page.tsx`:

```tsx
export { default } from '@/features/settings/components/BillingScreen';
```

Replace `frontend/app/(settings)/settings/page.tsx` entirely:

```tsx
import { redirect } from 'next/navigation';

// /settings is the shell's entry point, not a screen of its own — the cards it
// used to show are now rows in the settings rail. Land on Team, which is what
// people open Settings for.
export default function SettingsIndex() {
  redirect('/team-permissions');
}
```

Delete `frontend/features/settings/components/SettingsScreen.tsx` — the redirect replaces it and `BillingScreen` carries the one thing it did.

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend
git rm features/settings/components/SettingsScreen.tsx
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: typecheck and lint clean; build succeeds except the pre-existing `/forgot-password` prerender failure.

Then check by eye that no route was duplicated:

Run: `cd frontend && find app -name page.tsx | sed -E 's#app/\([a-z]+\)/##' | sort | uniq -d`
Expected: no output. Any line printed is the same URL served from two route groups, which Next refuses to build.

- [ ] **Step 5: Stage — DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add -A frontend/app frontend/components/layout frontend/features/settings frontend/features/team frontend/features/system
git status
```

---

### Task 8: Team API slice

The frontend data layer for the new endpoints, in its own feature slice.

**Files:**
- Create: `frontend/features/team/api.ts`
- Create: `frontend/features/team/hooks.ts`

**Interfaces:**
- Consumes: `api<T>(path, opts)` from `@/lib/api` — the proxy forwards the path VERBATIM, so every path carries the `/api` prefix; dropping it 404s silently into an empty state.
- Produces:
  - Types `TeamRole`, `TeamAccount`, `TeamMemberRow`, `TeamListResponse`, `MemberDetail`, `SaveMemberInput`, `CreateMemberInput`
  - `useTeamList()`, `useMember(id)`, `useSaveMember()`, `useCreateMember()`, `useRemoveMember()`, `useSetMemberPassword()`
  - Query keys `['team','list']` and `['team','member',id]`

- [ ] **Step 1: Write the API module**

Create `frontend/features/team/api.ts`:

```ts
import { api } from '@/lib/api';

export type TeamRole = 'owner' | 'practice_manager' | 'reception' | 'analyst';

export interface TeamAccount {
  id: string;
  name: string | null;
  role: TeamRole;
}

export interface TeamMemberRow {
  id: string;
  organisation_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: TeamRole;
  status: 'invited' | 'active';
  is_agency_admin: boolean;
  last_active_at: string | null;
  /** Present only when the caller administers several accounts. */
  accounts?: TeamAccount[];
}

export interface TeamListResponse {
  members: TeamMemberRow[];
  /** True when this response spans the agency org and its sub-accounts. */
  agency_wide: boolean;
}

export interface MemberDetail {
  member: Omit<TeamMemberRow, 'accounts'>;
  /** Explicit per-user overrides only — a key absent here inherits the role. */
  overrides: Record<string, boolean>;
  /** Fully resolved map, what this person actually gets today. */
  effective: Record<string, boolean>;
  accounts: TeamAccount[];
}

export interface SaveMemberInput {
  full_name?: string;
  phone?: string;
  role?: TeamRole;
  /** null REMOVES an override so the key inherits the role again. */
  permissions?: Record<string, boolean | null>;
  /** Agency actors only. Must include the member's home account. */
  organisation_ids?: string[];
}

export interface CreateMemberInput {
  email: string;
  full_name: string;
  role: TeamRole;
  /** Omit to send an email invite instead of setting a password. */
  password?: string;
  phone?: string;
  permissions?: Record<string, boolean>;
  home_organisation_id?: string;
  organisation_ids?: string[];
}

// NB: api() posts to the same-origin proxy, which forwards the path VERBATIM,
// so every path here carries the /api prefix the Express routers are mounted
// under. Dropping it 404s SILENTLY into an empty state.
export function getTeamList(): Promise<TeamListResponse> {
  return api<TeamListResponse>('/api/admin/team');
}

export function getMember(id: string): Promise<MemberDetail> {
  return api<MemberDetail>(`/api/admin/team/${id}`);
}

export function saveMember(
  id: string,
  body: SaveMemberInput,
): Promise<{ success: boolean; permissions: Record<string, boolean>; accounts?: string[] }> {
  return api(`/api/admin/team/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function createMember(
  body: CreateMemberInput,
): Promise<{ success: boolean; user_id: string; status: string }> {
  return api('/api/admin/team', { method: 'POST', body: JSON.stringify(body) });
}

export function removeMember(user_id: string): Promise<{ success: boolean }> {
  return api('/api/admin/team/remove', { method: 'POST', body: JSON.stringify({ user_id }) });
}

export function setMemberPassword(input: {
  user_id: string;
  password: string;
}): Promise<{ success: boolean }> {
  return api('/api/admin/team/password', { method: 'POST', body: JSON.stringify(input) });
}
```

- [ ] **Step 2: Write the hooks**

Create `frontend/features/team/hooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTeamList, getMember, saveMember, createMember, removeMember, setMemberPassword,
  type SaveMemberInput, type CreateMemberInput, type TeamListResponse,
} from './api';

const LIST_KEY = ['team', 'list'];
const memberKey = (id: string) => ['team', 'member', id];

export function useTeamList() {
  return useQuery({ queryKey: LIST_KEY, queryFn: getTeamList });
}

export function useMember(id: string | undefined) {
  return useQuery({
    queryKey: memberKey(id ?? ''),
    queryFn: () => getMember(id as string),
    enabled: Boolean(id),
  });
}

export function useSaveMember(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveMemberInput) => saveMember(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memberKey(id) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
      // A save can change the CALLER's own permissions, and /auth/me is
      // cached for 5 minutes — without this the nav keeps showing what they
      // could reach before the change.
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMemberInput) => createMember(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeMember,
    onMutate: async (user_id: string) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<TeamListResponse>(LIST_KEY);
      if (prev) {
        qc.setQueryData<TeamListResponse>(LIST_KEY, {
          ...prev,
          members: prev.members.filter((m) => m.id !== user_id),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useSetMemberPassword() {
  return useMutation({ mutationFn: setMemberPassword });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd frontend && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Verify lint**

Run: `cd frontend && npm run lint`
Expected: clean.

- [ ] **Step 5: Stage — DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add frontend/features/team/api.ts frontend/features/team/hooks.ts
git status
```

---

### Task 9: Team list screen

The GHL-shaped list. Columns and filters that have nothing to show are absent, not blank.

**Files:**
- Create: `frontend/features/team/components/TeamListScreen.tsx`
- Modify: `frontend/app/(settings)/team-permissions/page.tsx`
- Delete: `frontend/features/system/components/TeamPermissionsScreen.tsx`

**Interfaces:**
- Consumes: `useTeamList()`, `useRemoveMember()` (Task 8); `useMe()`, `isAgencyActor(me)`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the screen**

Create `frontend/features/team/components/TeamListScreen.tsx`:

```tsx
'use client';
// Settings → Team. One row per person, and — for an agency admin — one list
// across the agency org and every sub-account.
//
// The agency-only columns and filters are driven by the RESPONSE
// (`agency_wide`), not by a client-side role guess: the server decides whose
// people this caller may see, and the screen renders what it was given.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Chip, Skeleton, type ChipColour } from '@/components/ui';
import { useMe } from '@/hooks/useMe';
import { useTeamList, useRemoveMember } from '../hooks';
import type { TeamMemberRow, TeamRole } from '../api';

const ROLE_LABEL: Record<TeamRole, string> = {
  owner: 'Owner',
  practice_manager: 'Practice Manager',
  reception: 'Reception',
  analyst: 'Data Analyst',
};

const STATUS_CHIP: Record<TeamMemberRow['status'], ChipColour> = {
  invited: 'amber',
  active: 'emerald',
};

function initials(name: string): string {
  return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]?.toUpperCase()).join('');
}

export default function TeamListScreen() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data, isLoading, isError } = useTeamList();
  const remove = useRemoveMember();

  const [userType, setUserType] = useState('');
  const [role, setRole] = useState('');
  const [account, setAccount] = useState('');
  const [search, setSearch] = useState('');

  const agencyWide = data?.agency_wide === true;

  // Every account named across the list, for the sub-account filter.
  const accountOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const m of data?.members ?? []) {
      for (const a of m.accounts ?? []) byId.set(a.id, a.name ?? a.id);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.members ?? []).filter((m) => {
      if (role && m.role !== role) return false;
      if (userType === 'agency' && !m.is_agency_admin) return false;
      if (userType === 'account' && m.is_agency_admin) return false;
      if (account && !(m.accounts ?? []).some((a) => a.id === account)) return false;
      if (q && !`${m.full_name ?? ''} ${m.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, role, userType, account, search]);

  function onRemove(m: TeamMemberRow) {
    if (!window.confirm(`Remove ${m.full_name || m.email}?`)) return;
    remove.mutate(m.id);
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <h1 className="display font-bold" style={{ fontSize: 24 }}>Team</h1>
      <p className="text-ink-muted mb-5" style={{ fontSize: 13 }}>
        {agencyWide
          ? 'Everyone across your organisation and its sub-accounts'
          : 'People with access to this organisation'}
      </p>

      {/* Filters. The sub-account filter and the user-type filter appear only
          for an agency admin: in a single-account tenant they would each have
          one value in every row, which is a control with nothing to control. */}
      <div className="flex flex-wrap gap-3 mb-4">
        {agencyWide && (
          <select value={userType} onChange={(e) => setUserType(e.target.value)} className="input">
            <option value="">User Type</option>
            <option value="agency">Agency</option>
            <option value="account">Account</option>
          </select>
        )}
        <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
          <option value="">User Role</option>
          {Object.entries(ROLE_LABEL).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        {agencyWide && (
          <select value={account} onChange={(e) => setAccount(e.target.value)} className="input">
            <option value="">Select sub-account</option>
            {accountOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name or email"
          className="input flex-1 min-w-[200px]"
        />
        <Link href="/team-permissions/new" className="btn-primary" style={{ padding: '8px 16px' }}>
          + Add User
        </Link>
      </div>

      <div className="card overflow-hidden">
        {isLoading && (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
          </div>
        )}

        {isError && (
          <div className="text-ink-muted" style={{ padding: 16, fontSize: 13 }}>
            Could not load the team.
          </div>
        )}

        {data && (
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border">
              <tr>
                <th className="text-left p-3 font-semibold">Name</th>
                <th className="text-left p-3 font-semibold">Phone</th>
                <th className="text-left p-3 font-semibold">Role</th>
                {agencyWide && <th className="text-left p-3 font-semibold">User Type</th>}
                {agencyWide && <th className="text-left p-3 font-semibold">Location</th>}
                <th className="text-left p-3 font-semibold">Status</th>
                <th className="text-right p-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const isSelf = !!me?.id && m.id === me.id;
                const accounts = m.accounts ?? [];
                return (
                  <tr
                    key={m.id}
                    className="border-b border-border hover:bg-bg cursor-pointer"
                    onClick={() => router.push(`/team-permissions/${m.id}`)}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 shrink-0 rounded-full bg-brand-50 text-brand flex items-center justify-center text-xs font-semibold">
                          {initials(m.full_name || m.email) || 'U'}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium truncate">{m.full_name || '—'}</span>
                          <span className="block text-ink-muted truncate" style={{ fontSize: 12 }}>
                            {m.email}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-ink-muted">{m.phone || '—'}</td>
                    <td className="p-3">{ROLE_LABEL[m.role]}</td>
                    {agencyWide && (
                      <td className="p-3 text-ink-muted" style={{ fontSize: 12 }}>
                        {m.is_agency_admin ? 'AGENCY' : 'ACCOUNT'}
                      </td>
                    )}
                    {agencyWide && (
                      <td className="p-3">
                        <span className="inline-flex flex-wrap gap-1.5">
                          {accounts.slice(0, 1).map((a) => (
                            <Chip key={a.id} colour="blue">{a.name ?? 'Unnamed'}</Chip>
                          ))}
                          {accounts.length > 1 && (
                            // Chip takes no `title`, so the tooltip lives on a
                            // wrapper rather than widening a shared primitive
                            // for one caller.
                            <span title={accounts.slice(1).map((a) => a.name).join(', ')}>
                              <Chip colour="blue">+{accounts.length - 1}</Chip>
                            </span>
                          )}
                          {accounts.length === 0 && <span className="text-ink-muted">—</span>}
                        </span>
                      </td>
                    )}
                    <td className="p-3">
                      <Chip colour={STATUS_CHIP[m.status]}>
                        {m.status === 'invited' ? 'Invited' : 'Active'}
                      </Chip>
                    </td>
                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {isSelf ? (
                        <span className="text-ink-muted" style={{ fontSize: 12 }} title="This is you">
                          You
                        </span>
                      ) : (
                        <span className="inline-flex gap-3 justify-end">
                          <Link
                            href={`/team-permissions/${m.id}`}
                            className="text-brand"
                            style={{ fontSize: 13 }}
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => onRemove(m)}
                            disabled={remove.isPending}
                            className="text-danger"
                            style={{ fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }}
                          >
                            Remove
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={agencyWide ? 7 : 5}
                    className="p-3 text-ink-muted"
                    style={{ fontSize: 13 }}
                  >
                    No one matches these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Point the route at it and delete the old screen**

Replace `frontend/app/(settings)/team-permissions/page.tsx`:

```tsx
export { default } from '@/features/team/components/TeamListScreen';
```

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend
git rm features/system/components/TeamPermissionsScreen.tsx
```

- [ ] **Step 3: Confirm nothing still imports the deleted screen**

Run: `cd frontend && grep -rn "TeamPermissionsScreen" app components features lib hooks || echo "no references"`
Expected: `no references`.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: typecheck and lint clean; build succeeds except the pre-existing `/forgot-password` failure.

- [ ] **Step 5: Stage — DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add -A frontend/features/team frontend/features/system frontend/app
git status
```

---

### Task 10: User editor

Two panes: the profile, and the role/accounts/permissions. Handles both an existing user and `new`.

**Files:**
- Create: `frontend/features/team/components/UserEditScreen.tsx`
- Create: `frontend/features/team/components/PermissionEditor.tsx`
- Create: `frontend/app/(settings)/team-permissions/[userId]/page.tsx`

**Interfaces:**
- Consumes: `useMember`, `useSaveMember`, `useCreateMember`, `useSetMemberPassword` (Task 8); `KEY_SECTION`, `SECTION_ORDER` (Task 7); `NAV`, `ROUTE_PERMISSION`, `pageKey`, `PAGE_ENFORCED` from `@/lib/permissions` and `@/lib/nav`; `useTeamList()` for the account options; `isAgencyActor(me)`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the permission editor**

Create `frontend/features/team/components/PermissionEditor.tsx`:

```tsx
'use client';
// Per-user permission overrides. A row shows what the person EFFECTIVELY has;
// a pinned row is one where this person has been singled out, and ↺ unpins it
// so the row follows their role again. Showing pinned and inherited rows
// identically would hide the fact that someone has been given an exception.
import { useMemo, useState } from 'react';
import { NAV } from '@/lib/nav';
import { ROUTE_PERMISSION, pageKey, PAGE_ENFORCED } from '@/lib/permissions';
import { KEY_SECTION, SECTION_ORDER } from '../permission-sections';

export interface PermissionEditorProps {
  /** permission key -> human label (GET /api/admin/permissions .catalog) */
  catalog: Record<string, string>;
  /** Fully resolved map for this person, before any unsaved edits. */
  effective: Record<string, boolean>;
  /** Keys explicitly pinned on this person, before any unsaved edits. */
  overrides: Record<string, boolean>;
  /** Unsaved edits. null means "unpin". */
  patch: Record<string, boolean | null>;
  onChange: (key: string, value: boolean | null) => void;
}

export function PermissionEditor({
  catalog, effective, overrides, patch, onChange,
}: PermissionEditorProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const g: Record<string, { key: string; label: string }[]> = {};
    for (const [key, label] of Object.entries(catalog)) {
      (g[KEY_SECTION[key] || 'System'] ??= []).push({ key, label });
    }
    return g;
  }, [catalog]);

  // Which pages sit under each key, in sidebar order — this is what lets one
  // page be granted instead of a whole section.
  const pagesForKey = useMemo(() => {
    const m: Record<string, { id: string; label: string }[]> = {};
    for (const section of NAV) {
      for (const item of section.items) {
        const key = ROUTE_PERMISSION[item.id];
        if (key) (m[key] ??= []).push({ id: item.id, label: item.label });
      }
    }
    return m;
  }, []);

  /** Current value of a key, unsaved edits first. */
  const valueOf = (key: string): boolean =>
    patch[key] === undefined || patch[key] === null
      ? effective[key] === true
      : patch[key] === true;

  /** True when this person is singled out on this key. */
  const isPinned = (key: string): boolean =>
    patch[key] === undefined ? overrides[key] !== undefined : patch[key] !== null;

  const q = search.trim().toLowerCase();

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search permissions"
        className="input w-full mb-4"
      />

      {SECTION_ORDER.map((sectionName) => {
        const rows = (grouped[sectionName] || []).filter(
          (r) => !q || r.label.toLowerCase().includes(q) || r.key.includes(q),
        );
        if (rows.length === 0) return null;

        return (
          <div key={sectionName} className="mb-4">
            <div className="text-ink-muted mb-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {sectionName}
            </div>

            {rows.map((row) => {
              const pages = pagesForKey[row.key] ?? [];
              const expanded = !!open[row.key];
              return (
                <div key={row.key} className="border-b border-border py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`perm-${row.key}`}
                      checked={valueOf(row.key)}
                      onChange={(e) => onChange(row.key, e.target.checked)}
                    />
                    <label htmlFor={`perm-${row.key}`} style={{ fontSize: 13 }}>
                      {row.label}
                    </label>
                    {isPinned(row.key) && (
                      <button
                        type="button"
                        onClick={() => onChange(row.key, null)}
                        title="Set for this person — reset to follow their role"
                        aria-label={`Reset ${row.label} to follow the role`}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--ink-muted)' }}
                      >
                        ↺ pinned
                      </button>
                    )}
                    {pages.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpen((o) => ({ ...o, [row.key]: !expanded }))}
                        className="ml-auto text-ink-muted"
                        style={{ border: '1px solid var(--border)', borderRadius: 6, background: '#FFFFFF', cursor: 'pointer', fontSize: 10, padding: '3px 5px' }}
                      >
                        {expanded ? '▾' : '▸'} {pages.length}
                      </button>
                    )}
                  </div>

                  {expanded && pages.map((pg) => {
                    const key = pageKey(pg.id);
                    return (
                      <div key={pg.id} className="flex items-center gap-2 pl-6 pt-1.5">
                        <input
                          type="checkbox"
                          id={`perm-${key}`}
                          checked={valueOf(key)}
                          onChange={(e) => onChange(key, e.target.checked)}
                        />
                        <label htmlFor={`perm-${key}`} className="text-ink-muted" style={{ fontSize: 12 }}>
                          {pg.label}
                        </label>
                        {!PAGE_ENFORCED.has(pg.id) && (
                          <span
                            title="This page shares its data endpoint with others in the section, so turning it off hides the page but does not block the data."
                            style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#FEF3C7', color: '#92400E' }}
                          >
                            nav only
                          </span>
                        )}
                        {isPinned(key) && (
                          <button
                            type="button"
                            onClick={() => onChange(key, null)}
                            aria-label={`Reset ${pg.label} to follow the role`}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--ink-muted)' }}
                          >
                            ↺
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write the editor screen**

Create `frontend/features/team/components/UserEditScreen.tsx`:

```tsx
'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui';
import { useMe, isAgencyActor } from '@/hooks/useMe';
import { usePermissionsMatrix } from '@/features/system/hooks';
import { useMember, useSaveMember, useCreateMember, useSetMemberPassword, useTeamList } from '../hooks';
import { PermissionEditor } from './PermissionEditor';
import type { TeamRole } from '../api';

const ROLES: { value: TeamRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'practice_manager', label: 'Practice Manager' },
  { value: 'reception', label: 'Reception' },
  { value: 'analyst', label: 'Data Analyst' },
];

export default function UserEditScreen() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const userId = params.userId;
  const isNew = userId === 'new';

  const { data: me } = useMe();
  const agencyActor = isAgencyActor(me);
  const { data: matrix } = usePermissionsMatrix();
  const { data: detail, isLoading } = useMember(isNew ? undefined : userId);
  const { data: list } = useTeamList();
  const save = useSaveMember(userId);
  const create = useCreateMember();
  const setPassword = useSetMemberPassword();

  const [pane, setPane] = useState<'info' | 'perms'>('info');
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', password: '', role: 'reception' as TeamRole,
  });
  const [touched, setTouched] = useState(false);
  const [accounts, setAccounts] = useState<string[] | null>(null);
  const [patch, setPatch] = useState<Record<string, boolean | null>>({});
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  // Server values until the field is touched, so a load that lands after the
  // first render does not blank what someone has already typed.
  const values = touched || isNew
    ? form
    : {
        full_name: detail?.member.full_name ?? '',
        email: detail?.member.email ?? '',
        phone: detail?.member.phone ?? '',
        password: '',
        role: (detail?.member.role ?? 'reception') as TeamRole,
      };

  const selectedAccounts = accounts ?? (detail?.accounts ?? []).map((a) => a.id);

  // Every account this caller administers, from the list they already loaded.
  const accountOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const m of list?.members ?? []) {
      for (const a of m.accounts ?? []) byId.set(a.id, a.name ?? a.id);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [list]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setTouched(true);
    setForm({ ...values, [key]: value });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setOkMsg('');
    const onError = (err: unknown) =>
      setError(err instanceof Error ? err.message : 'Could not save');

    if (isNew) {
      create.mutate(
        {
          email: values.email.trim(),
          full_name: values.full_name.trim(),
          phone: values.phone.trim() || undefined,
          role: values.role,
          password: values.password || undefined,
          ...(agencyActor && accounts ? { organisation_ids: accounts } : {}),
        },
        { onSuccess: () => router.push('/team-permissions'), onError },
      );
      return;
    }

    save.mutate(
      {
        full_name: values.full_name.trim(),
        phone: values.phone.trim(),
        role: values.role,
        permissions: patch,
        ...(agencyActor && accounts ? { organisation_ids: accounts } : {}),
      },
      {
        onSuccess: () => {
          setPatch({});
          setOkMsg('Saved.');
        },
        onError,
      },
    );
  }

  function onSetPassword() {
    const pw = window.prompt(
      `Set a new password for ${values.full_name || values.email} (min 8 characters). They will be signed out of existing sessions.`,
    );
    if (pw == null) return;
    if (pw.length < 8) {
      window.alert('Password must be at least 8 characters.');
      return;
    }
    setPassword.mutate(
      { user_id: userId, password: pw },
      {
        onSuccess: () => window.alert('Password updated.'),
        onError: (err) => window.alert(err instanceof Error ? err.message : 'Could not set password'),
      },
    );
  }

  if (!isNew && isLoading) {
    return <div className="space-y-3" style={{ maxWidth: 900 }}>
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
    </div>;
  }

  const busy = save.isPending || create.isPending;

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      <Link href="/team-permissions" className="text-brand" style={{ fontSize: 13 }}>
        ← Back
      </Link>
      <h1 className="display font-bold mt-2 mb-5" style={{ fontSize: 22 }}>
        {isNew ? 'Add a team member' : 'Edit or manage your team'}
      </h1>

      <div className="flex gap-6 items-start">
        <nav className="w-56 shrink-0 space-y-1">
          {([['info', 'User Info'], ['perms', 'Roles & Permissions']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPane(id)}
              className={`w-full text-left rounded-lg px-3 py-2 text-[13px] ${
                pane === id ? 'bg-brand-50 font-semibold text-brand' : 'text-ink-muted hover:bg-bg'
              }`}
              style={{ border: 'none', cursor: 'pointer' }}
            >
              {label}
            </button>
          ))}
        </nav>

        <form onSubmit={onSubmit} className="card-padded flex-1 min-w-0">
          {pane === 'info' && (
            <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label className="block">
                <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                  Full name
                </span>
                <input
                  className="input w-full"
                  required
                  value={values.full_name}
                  onChange={(e) => set('full_name', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                  Email
                </span>
                <input
                  type="email"
                  className="input w-full"
                  required
                  disabled={!isNew}
                  value={values.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                  Phone
                </span>
                <input
                  className="input w-full"
                  value={values.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </label>
              {isNew && (
                <label className="block">
                  <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                    Password
                  </span>
                  <input
                    className="input w-full"
                    minLength={8}
                    value={values.password}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder="Leave blank to send an email invite"
                  />
                </label>
              )}
              {!isNew && (
                <div className="col-span-2">
                  <button type="button" onClick={onSetPassword} className="btn-ghost">
                    Set password
                  </button>
                </div>
              )}
            </div>
          )}

          {pane === 'perms' && (
            <div>
              <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <label className="block">
                  <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                    User Role
                  </span>
                  <select
                    className="input w-full"
                    value={values.role}
                    onChange={(e) => set('role', e.target.value as TeamRole)}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </label>
                {!isNew && (
                  <div>
                    <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                      User Type
                    </span>
                    <p style={{ fontSize: 13, paddingTop: 8 }}>
                      {detail?.member.is_agency_admin ? 'Agency' : 'Account'}
                    </p>
                  </div>
                )}
              </div>

              {agencyActor && accountOptions.length > 0 && (
                <fieldset className="mb-4">
                  <legend className="text-ink-muted mb-2" style={{ fontSize: 11, fontWeight: 600 }}>
                    Add sub-accounts
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {accountOptions.map(([id, name]) => {
                      const on = selectedAccounts.includes(id);
                      return (
                        <label
                          key={id}
                          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
                            on ? 'border-brand bg-brand-50 text-brand' : 'border-border text-ink-muted'
                          }`}
                          style={{ fontSize: 12, cursor: 'pointer' }}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) =>
                              setAccounts(
                                e.target.checked
                                  ? [...selectedAccounts, id]
                                  : selectedAccounts.filter((x) => x !== id),
                              )
                            }
                          />
                          {name}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-ink-muted mt-2" style={{ fontSize: 11 }}>
                    The role and permissions on this page apply to every account ticked here.
                    A member&rsquo;s home account cannot be removed.
                  </p>
                </fieldset>
              )}

              {!isNew && matrix && detail && (
                <PermissionEditor
                  catalog={matrix.catalog}
                  effective={detail.effective}
                  overrides={detail.overrides}
                  patch={patch}
                  onChange={(key, value) => setPatch((p) => ({ ...p, [key]: value }))}
                />
              )}
              {isNew && (
                <p className="text-ink-muted" style={{ fontSize: 12 }}>
                  Permissions can be set once the member has been created — they start on their
                  role&rsquo;s defaults.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-danger mt-4" style={{ fontSize: 13 }}>{error}</p>}
          {okMsg && <p className="mt-4" style={{ fontSize: 13, color: '#059669' }}>{okMsg}</p>}

          <div className="flex justify-end gap-3 mt-6">
            <Link href="/team-permissions" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the route**

Create `frontend/app/(settings)/team-permissions/[userId]/page.tsx`:

```tsx
export { default } from '@/features/team/components/UserEditScreen';
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: typecheck and lint clean; build succeeds except the pre-existing `/forgot-password` failure.

- [ ] **Step 5: Stage — DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add frontend/features/team frontend/app
git status
```

---

### Task 11: Whole-change verification

**Files:** none created or modified unless a check fails.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified, staged, uncommitted change set.

- [ ] **Step 1: Backend suite, lint, syntax**

Run: `cd backend && npm test && npm run lint && npm run typecheck`
Expected: all tests pass; lint 0 errors (12 pre-existing warnings are acceptable); typecheck clean.

- [ ] **Step 2: Frontend checks**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: typecheck and lint clean; build succeeds except the pre-existing `/forgot-password` prerender failure.

- [ ] **Step 3: Confirm no duplicate routes and no dangling imports**

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend
find app -name 'page.tsx' | sed -E 's#app/\([a-z]+\)/##' | sort | uniq -d
grep -rn "TeamPermissionsScreen\|features/settings/components/SettingsScreen" app components features lib hooks || echo "no dangling imports"
```

Expected: no duplicate route lines; `no dangling imports`.

- [ ] **Step 4: Secret scan**

Run: `cd /Users/ruhithpasha/code/work/Dental-os && ggshield secret scan path backend/src frontend/features frontend/components frontend/app --recursive`
Expected: no secrets found.

- [ ] **Step 5: Report, stage, DO NOT COMMIT**

```bash
cd /Users/ruhithpasha/code/work/Dental-os
git add -A
git status
```

Report to the owner: what passed, the exact test counts, and that the change is staged and uncommitted awaiting their word. Do not commit, do not push, do not open a PR.

---

## Manual verification the owner should do

Neither app has a browser test harness, so these are worth walking once:

1. As a **sub-account owner**: Settings → Team shows only your own people, with no Location column, no sub-account filter and no "Add sub-accounts" control. You can add a user and change their permissions.
2. As an **agency admin at home**: the same page lists your org plus every sub-account, the Location chips are populated, and the sub-account filter narrows the list.
3. As an **agency admin switched into a sub-account**: the amber banner is visible in Settings, and the list shows only that sub-account's people.
4. Assign one person to two accounts, save, then use the account picker to sign into each — the role and permissions should be identical in both.
5. Pin a permission on one person, save, reload — the row still reads "pinned". Press ↺, save, reload — it follows their role again.
