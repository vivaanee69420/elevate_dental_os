# TODOS

## Frontend `src/` migration (deferred)

**What:** Move `frontend/{app,components,features,lib,middleware.ts}` under `frontend/src/`.

**Why:** Cleaner repo root; standard Next.js layout. Deferred from the
feature-first restructure (commit `e7c1615`) to keep that diff safe while
deploy was being stabilised.

**Scope when picked up:**
- `tsconfig.json` path: `@/*` → `./src/*`
- Relocate `middleware.ts` → `src/middleware.ts` (Next supports natively)
- Verify `frontend/Dockerfile` build context still resolves (standalone copy)
- `npm run typecheck && npm run lint && npm run build` must stay green

**Depends on / blocked by:** Railway frontend deploy green first (don't stack
churn on an unstable deploy). Do as its own PR — no behaviour change.

**Context:** Decided in `/plan-eng-review` (D1 scope reduction). Feature-first
modules + `components/ui` primitives already landed; only the directory
wrapper remains. Strictly mechanical + path updates.

## Force password change on first login (`must_change_password`)

**What:** Add a `users.must_change_password` column, enforce it in
`authService.login()`, build a change-password screen, and set the flag when
an admin provisions or resets a member's password.

**Why:** Admin-set passwords are known to the admin forever. Until the member
changes it, the credential is effectively shared — weak audit story for
who-did-what. This closes that gap.

**Pros:** Real fix for the shared-credential risk; proper attribution.
**Cons:** Touches the login state machine and needs a new change-password UI
flow the app does not have yet.

**Depends on / blocked by:** a change-password / account-settings screen
existing (none today).

**Context:** Consciously deferred in `/plan-eng-review` (decision D3) as scope
creep past the bounded "admin can set passwords + invite fallback" ask. The
provision/reset endpoints intentionally create `status:'active'` members with
no forced change. Revisit when any password-change UI is built.
