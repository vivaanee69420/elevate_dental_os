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
