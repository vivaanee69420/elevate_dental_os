# Phase 5 Implementation Plan — Platform-Admin (Super-Admin) Layer

Created 2026-05-20. Self-contained. Designed to run in a parallel Claude session alongside Phase 1.

> **2026-05-20 patch (eng review):**
> - **Route prefix renamed `/api/admin/*` → `/api/platform/*`.** Existing tenant code already uses `/api/admin/permissions` and `/api/admin/team` for Owner-level admin **inside** a tenant org. Collision avoided.
> - **Frontend group renamed `app/(admin)/` → `app/(platform)/`** and auth path `/admin/login` → `/platform/login` for the same reason.
> - **Login rate-limit is mandatory** (`express-rate-limit`, 5/min/IP) — not just a comment.
> - **Audit log is fail-closed**, not best-effort: if `platform_audit_log` insert fails, the request returns 500. Platform-owner surface crosses tenant boundaries; silent log gaps are unacceptable for SaaS compliance.
> - **Impersonation = admin-scoped read endpoints, no tenant-token crossing.** "Impersonate" never issues a Supabase tenant JWT. Instead, every drill-down view (`/api/platform/orgs/:id/*`) returns data scoped to that org using `serviceClient`, gated by `requirePlatformRole('superadmin', 'support')` and audited per call. There is no "log in as user" mode in Phase 5; Phase 6+ may add a one-time Supabase magic-link impersonation token if needed.
> - **Bootstrap admin must change password on first login** (`must_change_password BOOL` in schema; login response carries the flag; `/platform/login` page forces a password-change screen).
> - **Audit retention** captured as a TODO in TODO_IMPORTANT.md (GDPR — IP + UA + payload across tenants).

## Mission

Build the **platform-owner monitoring + control surface**. Separate from tenant users. We (the SaaS owners) need: org count, signups/day, MRR, churn, integration health, audit search, read-only impersonation.

## Why separate session is safe

Phase 5 touches **zero tenant-facing code**:
- New tables only (`platform_admins`, `platform_audit_log`).
- New backend route prefix `/api/admin/*` — mounted via one line in `backend/src/app.js`.
- New frontend route group `app/(admin)/` — own layout, own auth flow.
- No edits to `features/*`, `app/(dashboard)/*`, or any tenant-facing route.

Only coordination point: 1-line addition to `backend/src/app.js` route mounting. Trivial merge.

## Reserved resources for this session

| Resource | Reserved value |
|---|---|
| Migration filename | `supabase/migrations/20260101000009_platform_admins.sql` |
| Backend route prefix | `/api/platform/*` (was `/api/admin/*` — collided with tenant Owner admin) |
| Frontend route group | `app/(platform)/` |
| Auth path | `/platform/login` (separate from tenant `/login`) |
| Env vars | `PLATFORM_ADMIN_JWT_SECRET`, `PLATFORM_ADMIN_BOOTSTRAP_EMAIL` |
| Permission code prefix | `platform_admin:*` |

Do NOT use migration numbers `…000007` (Phase 2 reserved) or `…000008` (Phase 3 reserved).

## Strict guard rails — DO NOT TOUCH

- `frontend/features/**` — Phase 1 owns this.
- `frontend/app/(dashboard)/**` — Phase 1 owns this.
- `frontend/app/(auth)/**` — tenant auth, leave alone.
- `backend/src/middleware/auth.js` — tenant auth, leave alone. Build separate middleware.
- `backend/src/lib/supabase.js` — read-only here. Reuse `serviceClient`, don't modify.
- `backend/src/routes/*` (except adding the new admin routes file) — leave existing routes alone.
- Any file in `features/_mock`.

Only edit existing file allowed: **one line** in `backend/src/app.js` to mount the admin router.

---

## Architecture

```
                ┌──────────────────────────────────────┐
                │     Platform Admin                   │
                │  (us, the SaaS owners)               │
                └──────────────┬───────────────────────┘
                               │
                  /admin/login (separate from /login)
                               │
                               ▼
                    platform_admins table
                  (NOT in public.users; separate auth)
                               │
                               ▼
              JWT signed with PLATFORM_ADMIN_JWT_SECRET
                  (separate from Supabase JWT)
                               │
                               ▼
                  middleware/platform-auth.js
                               │
                               ▼
                 /api/admin/*  routes
                               │
                               ▼
                  serviceClient (RLS bypass)
                               │
                               ▼
                  ALL tenant tables, read-mostly
                               │
                               ▼
              Every request logged to platform_audit_log
                  (who, what, which org, when, IP)
                               │
                               ▼
                  app/(admin)/ frontend
                  (own layout, no tenant chrome)
```

## Schema (migration `20260101000009_platform_admins.sql`)

```sql
-- ============================================================================
-- Platform admin layer — completely separate from tenant users.
-- ============================================================================

CREATE TABLE platform_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,            -- bcrypt
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'support'
       CHECK (role IN ('superadmin', 'support', 'readonly')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER platform_admins_updated_at
  BEFORE UPDATE ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE platform_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,                   -- 'list_orgs' | 'view_org' | 'impersonate' | 'login' | ...
  target_organisation_id UUID,            -- nullable, set when action affects a specific org
  target_user_id UUID,                    -- nullable
  ip_address INET,
  user_agent TEXT,
  payload JSONB NOT NULL DEFAULT '{}',    -- request params, response summary
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_platform_audit_admin   ON platform_audit_log(platform_admin_id, created_at DESC);
CREATE INDEX idx_platform_audit_org     ON platform_audit_log(target_organisation_id, created_at DESC) WHERE target_organisation_id IS NOT NULL;
CREATE INDEX idx_platform_audit_action  ON platform_audit_log(action, created_at DESC);

-- Bootstrap: insert first superadmin from env at app startup (see backend/src/lib/platform-admin-bootstrap.js).
-- DO NOT insert here — bootstrap runs in code so password isn't in version control.

-- RLS: platform tables have NO RLS. Only serviceClient touches them and only
-- through middleware/platform-auth.js which validates the platform JWT first.
ALTER TABLE platform_admins      DISABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_log   DISABLE ROW LEVEL SECURITY;

-- After applying:
-- NOTIFY pgrst, 'reload schema';
```

## Backend — file-by-file checklist

Strict 5-layer architecture (matches tenant code): `routes → controllers → services → repositories → models`.

### New files

```
backend/src/
├── lib/
│   └── platform-admin-bootstrap.js   ← on boot, if PLATFORM_ADMIN_BOOTSTRAP_EMAIL set
│                                        and no platform_admins exist, create one.
├── middleware/
│   └── platform-auth.js              ← verifies platform JWT, loads req.platformAdmin
├── models/
│   └── platform-admin.model.js       ← Zod: loginSchema, listOrgsQuerySchema, etc.
├── repositories/
│   └── platform-admin.repository.js  ← serviceClient queries for platform_admins +
│                                        cross-org aggregations
├── services/
│   └── platform-admin.service.js     ← business logic, audit logging
├── controllers/
│   └── platform-admin.controller.js  ← HTTP shape, calls service
└── routes/
    └── platform-admin.routes.js      ← express.Router, mounted at /api/admin
```

### Routes (in `routes/platform-admin.routes.js`)

```
POST   /admin/login                        — exchange email+password for platform JWT
POST   /admin/logout                       — invalidate (stateless: client just drops token)
GET    /admin/me                           — return current platform admin

GET    /admin/orgs                         — list all orgs + user/lead/payment counts
GET    /admin/orgs/:id                     — drill-down, read-only
GET    /admin/orgs/:id/users               — list users in org
GET    /admin/orgs/:id/activity            — recent communications + payments

GET    /admin/users                        — global user search (?q=email)

GET    /admin/metrics/overview             — signups, MRR, churn, active orgs (7/30/90d)
GET    /admin/metrics/integrations         — per-provider connection counts + error rates

GET    /admin/audit                        — cross-org audit log search
GET    /admin/audit/platform               — platform_audit_log search

POST   /admin/impersonate/:org_id          — issue read-only token scoped to org
                                             (logged to platform_audit_log)
```

**All `/admin/*` routes EXCEPT `/admin/login`** pass through `platform-auth.js`. `/admin/login` is public (rate-limited).

### Middleware — `platform-auth.js`

```js
// Verifies platform JWT (signed with PLATFORM_ADMIN_JWT_SECRET, NOT Supabase).
// Loads req.platformAdmin = { id, email, role }.
// Exports requirePlatformRole('superadmin', ...) for route-level RBAC.

import jwt from 'jsonwebtoken';
import { serviceClient } from '../lib/supabase.js';
import { AppError } from './errors.js';

export async function platformAuthenticate(req, _res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return next(new AppError('Missing platform token', 401));
  const token = auth.slice(7);

  let payload;
  try {
    payload = jwt.verify(token, process.env.PLATFORM_ADMIN_JWT_SECRET);
  } catch {
    return next(new AppError('Invalid platform token', 401));
  }

  const { data: admin } = await serviceClient
    .from('platform_admins')
    .select('id, email, role')
    .eq('id', payload.sub)
    .single();

  if (!admin) return next(new AppError('Platform admin not found', 401));
  req.platformAdmin = admin;
  req.platformIp = req.ip;
  req.platformUserAgent = req.headers['user-agent'];
  next();
}

export function requirePlatformRole(...roles) {
  return (req, _res, next) => {
    if (!req.platformAdmin) return next(new AppError('Unauthenticated', 401));
    if (!roles.includes(req.platformAdmin.role))
      return next(new AppError('Forbidden', 403));
    next();
  };
}
```

### Audit logging helper — call from every service method

```js
// In services/platform-admin.service.js
async function logAction(admin, action, { orgId, userId, payload, req }) {
  await serviceClient.from('platform_audit_log').insert({
    platform_admin_id: admin.id,
    action,
    target_organisation_id: orgId ?? null,
    target_user_id: userId ?? null,
    ip_address: req?.platformIp,
    user_agent: req?.platformUserAgent,
    payload: payload ?? {},
  });
}
```

Every controller calls this. No exceptions. **Audit insert is awaited and must succeed**; if it errors the request fails with 500. Rationale: platform-owner surface crosses tenant boundaries — a silent log gap defeats the audit log's purpose.

### Bootstrap — `lib/platform-admin-bootstrap.js`

Runs once at server start in `app.js`:

```js
export async function bootstrapPlatformAdmin() {
  const email = process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) return;

  const { count } = await serviceClient
    .from('platform_admins')
    .select('id', { count: 'exact', head: true });
  if (count > 0) return;

  const password_hash = await bcrypt.hash(password, 12);
  await serviceClient.from('platform_admins').insert({
    email, password_hash, full_name: 'Bootstrap Admin', role: 'superadmin',
  });
  console.log(`[platform] bootstrapped first superadmin: ${email}`);
}
```

Add `bootstrapPlatformAdmin()` call in `app.js` after `buildApp()` (or in `server.js` before listen).

### Single edit to `backend/src/app.js`

Add ONE line in the route-mounting block:

```js
// AFTER tenant auth middleware mounts (so /api/admin/* gets its OWN auth):
app.use('/api/admin', platformAdminRouter);
```

Position: between `/healthcheck` and `/api/*` tenant routes. Mount BEFORE the tenant `authenticate` middleware so admin requests skip Supabase JWT check. Admin routes use their own `platformAuthenticate` middleware applied inside the router.

Concrete: search `app.js` for `app.use('/healthcheck'` and add the platform admin mount immediately after the public routes block. **Do not modify any other line in app.js.**

---

## Frontend — `app/(admin)/`

### Route group

```
frontend/app/(admin)/
├── layout.tsx              ← own layout: dark sidebar, "PLATFORM" badge, no tenant chrome
├── login/
│   └── page.tsx            ← email + password → POST /api/admin/login → store token in
│                              httpOnly cookie via /api/admin-auth/login proxy route
├── page.tsx                ← redirect to /admin/overview
├── overview/
│   └── page.tsx            ← metrics cards: orgs, signups/d, MRR, churn
├── orgs/
│   ├── page.tsx            ← table of all orgs
│   └── [id]/
│       ├── page.tsx        ← org drill-down
│       └── activity/page.tsx
├── users/
│   └── page.tsx            ← global user search
├── audit/
│   ├── page.tsx            ← cross-org audit log (audit_log table)
│   └── platform/page.tsx   ← platform_audit_log
├── integrations/
│   └── page.tsx            ← per-provider health
└── impersonate/
    └── page.tsx            ← pick org → issue read-only token
```

### Frontend proxy + auth

- `frontend/app/api/admin-auth/login/route.ts` — POST proxy that sets platform-admin JWT as httpOnly cookie.
- `frontend/app/api/admin-backend/[...path]/route.ts` — same pattern as existing `app/api/backend/[...path]/route.ts` but reads platform admin cookie instead of Supabase cookie.
- `frontend/lib/admin-api.ts` — same shape as `lib/api.ts` but hits `/api/admin-backend/*`.
- `frontend/middleware.ts` — extend to gate `/admin/*` paths on platform admin cookie presence; redirect to `/admin/login` if missing. **Coordinate carefully:** existing `middleware.ts` handles tenant cookie. Add a second matcher block for admin paths. Do NOT remove existing tenant logic.

### UI primitives

Reuse `components/ui/*` (already exists). No new design system. Add ONE new component if needed: `components/admin/PlatformBadge.tsx` to make it visually obvious this is the admin surface (red banner top of every admin page saying "PLATFORM ADMIN — SaaS owner view").

---

## Tests

### Backend (vitest)

`backend/src/services/platform-admin.service.test.js`:
- Login with wrong password → 401.
- Login with right password → returns JWT.
- `listOrgs` returns all orgs (not RLS-filtered).
- `impersonate` writes audit log row.
- Audit log captures `ip_address` and `user_agent`.
- Bootstrap creates admin only if none exist (idempotent).
- `requirePlatformRole('superadmin')` rejects `support` and `readonly`.

`backend/src/middleware/platform-auth.test.js`:
- Missing token → 401.
- Invalid token → 401.
- Valid token but admin deleted → 401.
- Valid token → sets `req.platformAdmin`.

### Integration

- Spin up app, hit `/api/admin/orgs` with no token → 401.
- Login → get token → hit `/api/admin/orgs` → 200 with org list.
- Verify `platform_audit_log` has one `login` row and one `list_orgs` row.
- Verify tenant `/api/contacts` with platform token → 401 (platform JWT must NOT work as tenant auth).

### Cross-cutting

- Tenant token must NOT work on `/api/admin/*` (verify by trying — should 401).
- Platform admin token must NOT work on `/api/*` tenant routes.
- Auth isolation is a hard test — write it.

---

## Step-by-step execution order

```
1. Migration file       supabase/migrations/20260101000009_platform_admins.sql
2. Run locally          supabase db reset  (verifies migration)
3. Hosted Supabase      apply migration via SQL Editor, NOTIFY pgrst
4. Backend models       backend/src/models/platform-admin.model.js
5. Backend repository   backend/src/repositories/platform-admin.repository.js
6. Backend service      backend/src/services/platform-admin.service.js
7. Backend controller   backend/src/controllers/platform-admin.controller.js
8. Backend middleware   backend/src/middleware/platform-auth.js
9. Backend routes       backend/src/routes/platform-admin.routes.js
10. Bootstrap           backend/src/lib/platform-admin-bootstrap.js
11. Mount in app.js     ONE line addition, between public routes and tenant /api
12. Backend tests       vitest run platform-admin
13. Frontend proxy      app/api/admin-auth/login + app/api/admin-backend/[...path]
14. Frontend lib        lib/admin-api.ts
15. Frontend middleware extend matcher in middleware.ts (additive only)
16. Frontend layout     app/(admin)/layout.tsx + login/page.tsx
17. Frontend pages      overview, orgs, users, audit, integrations, impersonate
18. Frontend build      npm run build, npm run typecheck, npm run lint
19. Manual smoke test   bootstrap admin, log in, list orgs, view audit log
20. Documentation       update docs/API.md with /api/admin/* surface
21. Log to              completed-tasks.md (new entry dated 2026-05-20)
```

## Env vars to add to deployment

```
PLATFORM_ADMIN_JWT_SECRET=<random 64+ hex chars>
PLATFORM_ADMIN_BOOTSTRAP_EMAIL=ruhithpasha813@gmail.com   # or whatever owner email
PLATFORM_ADMIN_BOOTSTRAP_PASSWORD=<strong, change immediately after first login>
```

Add to Railway env. Bootstrap runs ONCE then no-op afterwards.

## Acceptance criteria — Phase 5 done means

- [ ] Migration `20260101000009_platform_admins.sql` applied locally + hosted.
- [ ] Bootstrap creates first superadmin from env vars on first boot.
- [ ] `/admin/login` works against `platform_admins`, returns JWT in httpOnly cookie.
- [ ] `/api/admin/orgs` returns all orgs across all tenants when called with platform JWT.
- [ ] Tenant JWT rejected on `/api/admin/*` (401).
- [ ] Platform JWT rejected on `/api/*` tenant routes (401).
- [ ] Every `/api/admin/*` request writes a `platform_audit_log` row.
- [ ] `app/(admin)/overview` shows org count, signups, MRR, active users — populated from real data.
- [ ] `app/(admin)/orgs/[id]` drill-down works read-only.
- [ ] `app/(admin)/audit` shows audit history searchable by action + org.
- [ ] `app/(admin)/impersonate` issues a read-only token, logged.
- [ ] Backend vitest green, including new platform-admin suite.
- [ ] Frontend `npm run build` + `typecheck` + `lint` green.
- [ ] `docs/API.md` updated.
- [ ] Entry appended to `completed-tasks.md`.

## Out of scope (for Phase 5)

- Multi-factor auth for platform admins — log it as a TODO for later.
- Platform-admin password reset flow — stub it, do manual DB resets for now.
- Email notifications when platform actions happen — Phase 4 territory.
- Granular per-resource permissions inside platform — only 3 roles (`superadmin`, `support`, `readonly`).

## Conflict-avoidance reminders for the session running this

1. Do not start before the parallel Phase 1 session has merged any changes to `backend/src/app.js`. If it has unmerged changes, coordinate the 1-line mount addition.
2. Migration number is fixed at `…000009`. If another session has already claimed it, bump to next free.
3. Do NOT edit `backend/src/middleware/auth.js`. Build separate file `platform-auth.js`.
4. Do NOT add platform admin route to `frontend/middleware.ts` via REPLACING the matcher — append a new conditional block.
5. Reuse `components/ui` — do not create a parallel design system.
6. If you discover something Phase 5 needs that wasn't in this plan, write it in `TODO_IMPORTANT.md` under §1, don't rabbit-hole.

## When you finish

Log this entry in `completed-tasks.md` (append, do not edit older entries):

```markdown
## 2026-05-20 — Phase 5: Platform-admin layer shipped

- Migration `20260101000009_platform_admins.sql` applied (local + hosted).
- New tables: `platform_admins`, `platform_audit_log`.
- Backend: `routes/platform-admin.routes.js`, full 5-layer stack, separate `middleware/platform-auth.js`, bootstrap on first boot.
- Frontend: `app/(admin)/` route group with own layout + login + overview/orgs/users/audit/integrations/impersonate pages.
- Auth isolation verified — tenant tokens 401 on `/api/admin/*`, platform tokens 401 on `/api/*` tenant routes.
- Every platform action audit-logged with IP + UA.
- Backend vitest: <N>/<N> passing.
- Frontend build green.
- docs/API.md updated with `/api/admin/*` surface.
```
