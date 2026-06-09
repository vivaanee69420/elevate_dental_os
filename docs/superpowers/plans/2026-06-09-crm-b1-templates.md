# CRM B1 — Message Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-org CRM message templates (SMS/email with `{{var}}` placeholders) behind a CRUD API, plus a `renderTemplate` helper, and swap `TemplatesScreen` off its static mock onto live data.

**Architecture:** Standard backend layering (`routes → controllers → services → repositories → models`) on the `serviceClient` + manual `organisation_id` filter path. New table `crm_templates` (migration 000061). Pure `renderTemplate(body, values)` helper in `lib/crm-templates.js`. Frontend: React Query hook reads `/api/crm/templates`. This is Phase B1 of the CRM Suite (`phases-crm-suite.md`); foundation for B2 (Settings counts) and B3 (Sequence steps reference templates).

**Tech Stack:** Node ESM, Express, Zod, Supabase (Postgres), Vitest; Next.js 14 + React Query frontend.

**Spec:** `docs/superpowers/specs/2026-06-09-crm-suite-design.md`

---

## File Structure

**Backend (create):**
- `supabase/migrations/20260101000061_crm_templates.sql` — table + trigger + index
- `backend/src/lib/crm-templates.js` — variable catalogue + `renderTemplate()`
- `backend/src/models/crmTemplate.model.js` — Zod create/update schemas
- `backend/src/repositories/crmTemplate.repository.js` — Supabase data access
- `backend/src/services/crmTemplate.service.js` — business logic
- `backend/src/controllers/crmTemplate.controller.js` — HTTP shaping
- `backend/src/routes/crm-templates.routes.js` — Router, gated
- `backend/test/crm-templates.test.mjs` — unit tests (helper + service)

**Backend (modify):**
- `backend/src/app.js` — mount `/api/crm/templates`
- `docs/API.md` — document endpoints

**Frontend (create):**
- `frontend/features/crm/api/templates.ts` — typed API calls
- `frontend/features/crm/useTemplates.ts` — React Query hook

**Frontend (modify):**
- `frontend/features/crm/components/TemplatesScreen.tsx` — read from hook
- `phases-crm-suite.md` — tick B1

---

## Task 1: Migration — `crm_templates` table

**Files:**
- Create: `supabase/migrations/20260101000061_crm_templates.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- crm_templates — per-org reusable SMS/email message templates. Bodies carry
-- {{var}} placeholders (first_name, treatment, practice, …) rendered at send
-- time by lib/crm-templates.renderTemplate. Referenced by CRM nurturing
-- sequence steps (B3) and counted by CRM Settings (B2).
-- MULTI-TENANT: every row carries organisation_id; repos write via serviceClient
-- with an explicit organisation_id filter. Soft-delete via is_archived.
-- Idempotent. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================
CREATE TABLE IF NOT EXISTS crm_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  name TEXT NOT NULL,
  subject TEXT,                          -- null for sms
  body TEXT NOT NULL,                    -- {{var}} placeholders
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER crm_templates_updated_at BEFORE UPDATE ON crm_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_crm_templates_org_channel
  ON crm_templates(organisation_id, channel) WHERE NOT is_archived;
```

- [ ] **Step 2: Verify SQL parses locally (optional, if supabase running)**

Run: `grep -c "CREATE TABLE" supabase/migrations/20260101000061_crm_templates.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101000061_crm_templates.sql
git commit -m "feat(crm): crm_templates table (B1 migration 000061)"
```

> Apply on hosted at end of phase (Task 10), not now.

---

## Task 2: `renderTemplate` helper (pure) — TDD

**Files:**
- Create: `backend/src/lib/crm-templates.js`
- Test: `backend/test/crm-templates.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// ============================================================================
// CRM B1 — Message Templates. Covers renderTemplate (pure) + crmTemplateService
// CRUD over a stubbed repository.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { renderTemplate, TEMPLATE_VARIABLES } from '../src/lib/crm-templates.js';

describe('renderTemplate', () => {
  it('substitutes known variables', () => {
    const out = renderTemplate('Hi {{first_name}}, your {{treatment}} at {{practice}}', {
      first_name: 'Sarah', treatment: 'Invisalign', practice: 'Ashford Dental',
    });
    expect(out).toBe('Hi Sarah, your Invisalign at Ashford Dental');
  });

  it('blanks unknown / missing variables', () => {
    const out = renderTemplate('Hi {{first_name}} {{unknown_var}}', { first_name: 'Sarah' });
    expect(out).toBe('Hi Sarah ');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ first_name }}', { first_name: 'Jo' })).toBe('Jo');
  });

  it('leaves text without placeholders untouched', () => {
    expect(renderTemplate('No vars here', {})).toBe('No vars here');
  });

  it('exposes the supported variable catalogue', () => {
    expect(TEMPLATE_VARIABLES).toContain('first_name');
    expect(TEMPLATE_VARIABLES).toContain('treatment');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/crm-templates.test.mjs -t renderTemplate`
Expected: FAIL — cannot import `renderTemplate` from missing module.

- [ ] **Step 3: Write minimal implementation**

```javascript
// ============================================================================
// CRM message-template helpers. renderTemplate substitutes {{var}} placeholders
// from a flat values object; unknown / missing vars render as empty string so a
// half-populated lead never leaks a raw {{token}} into a patient message.
// ============================================================================

/** Variables a template body/subject may reference. */
export const TEMPLATE_VARIABLES = [
  'first_name',
  'last_name',
  'treatment',
  'practice',
  'appointment_date',
  'address',
  'review_link',
];

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Render a template body by replacing {{var}} with values[var].
 * Unknown or missing variables become ''.
 * @param {string} body
 * @param {Record<string, string|undefined>} values
 * @returns {string}
 */
export function renderTemplate(body, values = {}) {
  if (!body) return '';
  return body.replace(PLACEHOLDER_RE, (_match, name) => {
    const v = values[name];
    return v === undefined || v === null ? '' : String(v);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/crm-templates.test.mjs -t renderTemplate`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/crm-templates.js backend/test/crm-templates.test.mjs
git commit -m "feat(crm): renderTemplate helper + variable catalogue (B1)"
```

---

## Task 3: Zod model

**Files:**
- Create: `backend/src/models/crmTemplate.model.js`

- [ ] **Step 1: Write the model**

```javascript
// ============================================================================
// CRM template model — Zod schemas. channel + name + body required on create;
// subject only meaningful for email. Update = all-optional, at least one field.
// ============================================================================
import * as zod_1 from "zod";

export const templateCreateSchema = zod_1.z.object({
    channel: zod_1.z.enum(['sms', 'email']),
    name: zod_1.z.string().min(1),
    subject: zod_1.z.string().optional().nullable(),
    body: zod_1.z.string().min(1),
});

export const templateUpdateSchema = zod_1.z.object({
    channel: zod_1.z.enum(['sms', 'email']).optional(),
    name: zod_1.z.string().min(1).optional(),
    subject: zod_1.z.string().optional().nullable(),
    body: zod_1.z.string().min(1).optional(),
    is_archived: zod_1.z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'no fields to update' });

export const templateListQuerySchema = zod_1.z.object({
    channel: zod_1.z.enum(['sms', 'email']).optional(),
});
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/models/crmTemplate.model.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add backend/src/models/crmTemplate.model.js
git commit -m "feat(crm): template Zod model (B1)"
```

---

## Task 4: Repository

**Files:**
- Create: `backend/src/repositories/crmTemplate.repository.js`

- [ ] **Step 1: Write the repository**

```javascript
// ============================================================================
// CRM template repository — Supabase data access. serviceClient + explicit
// organisation_id filter on every query (tenant isolation). Soft-delete = set
// is_archived; list excludes archived.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const crmTemplateRepository = {
    async list(orgId, { channel } = {}) {
        let q = supabase_1.serviceClient
            .from('crm_templates')
            .select('*')
            .eq('organisation_id', orgId)
            .eq('is_archived', false)
            .order('created_at', { ascending: false });
        if (channel) q = q.eq('channel', channel);
        const { data } = await q;
        return data;
    },
    async create(row) {
        return supabase_1.serviceClient.from('crm_templates').insert(row).select().single();
    },
    async update(orgId, id, patch) {
        return supabase_1.serviceClient
            .from('crm_templates')
            .update(patch)
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
    // Soft delete.
    async archive(orgId, id) {
        return supabase_1.serviceClient
            .from('crm_templates')
            .update({ is_archived: true })
            .eq('id', id)
            .eq('organisation_id', orgId)
            .select()
            .single();
    },
};
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/repositories/crmTemplate.repository.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add backend/src/repositories/crmTemplate.repository.js
git commit -m "feat(crm): template repository (B1)"
```

---

## Task 5: Service — TDD over a stubbed repository

**Files:**
- Create: `backend/src/services/crmTemplate.service.js`
- Test: `backend/test/crm-templates.test.mjs` (append)

- [ ] **Step 1: Append the failing service tests**

```javascript
// --- appended to backend/test/crm-templates.test.mjs -----------------------
import { crmTemplateService } from '../src/services/crmTemplate.service.js';
import { crmTemplateRepository } from '../src/repositories/crmTemplate.repository.js';

describe('crmTemplateService', () => {
  const ORG = 'org-1';
  let calls;

  beforeEach(() => {
    calls = {};
    crmTemplateRepository.list = async (orgId, opts) => {
      calls.list = { orgId, opts };
      return [{ id: 't1', organisation_id: orgId, channel: 'sms', name: 'Welcome', body: 'Hi' }];
    };
    crmTemplateRepository.create = async (row) => { calls.create = row; return { data: { id: 'new', ...row }, error: null }; };
    crmTemplateRepository.update = async (orgId, id, patch) => { calls.update = { orgId, id, patch }; return { data: { id, ...patch }, error: null }; };
    crmTemplateRepository.archive = async (orgId, id) => { calls.archive = { orgId, id }; return { data: { id, is_archived: true }, error: null }; };
  });

  it('list wraps rows under { templates } and forwards channel filter', async () => {
    const out = await crmTemplateService.list(ORG, { channel: 'sms' });
    expect(out.templates).toHaveLength(1);
    expect(calls.list).toEqual({ orgId: ORG, opts: { channel: 'sms' } });
  });

  it('create stamps organisation_id + created_by and returns the row', async () => {
    const out = await crmTemplateService.create(ORG, 'user-9', { channel: 'email', name: 'Prep', subject: 'S', body: 'B' });
    expect(calls.create.organisation_id).toBe(ORG);
    expect(calls.create.created_by).toBe('user-9');
    expect(out.id).toBe('new');
  });

  it('update forwards org + id + patch', async () => {
    const out = await crmTemplateService.update(ORG, 't1', { name: 'Renamed' });
    expect(calls.update).toEqual({ orgId: ORG, id: 't1', patch: { name: 'Renamed' } });
    expect(out.name).toBe('Renamed');
  });

  it('remove archives (soft delete) and returns success', async () => {
    const out = await crmTemplateService.remove(ORG, 't1');
    expect(calls.archive).toEqual({ orgId: ORG, id: 't1' });
    expect(out).toEqual({ success: true });
  });

  it('create throws AppError on repository error', async () => {
    crmTemplateRepository.create = async () => ({ data: null, error: { message: 'dup' } });
    await expect(crmTemplateService.create(ORG, 'u', { channel: 'sms', name: 'x', body: 'y' }))
      .rejects.toThrow('dup');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run test/crm-templates.test.mjs -t crmTemplateService`
Expected: FAIL — cannot import `crmTemplateService` (module missing).

- [ ] **Step 3: Write the service**

```javascript
// ============================================================================
// CRM template service — business logic for the templates domain.
// ============================================================================
import * as crmTemplate_repository_1 from "../repositories/crmTemplate.repository.js";
import * as errors_1 from "../middleware/errors.js";

export const crmTemplateService = {
    async list(orgId, query = {}) {
        const data = await crmTemplate_repository_1.crmTemplateRepository.list(orgId, query);
        return { templates: data || [] };
    },
    async create(orgId, userId, input) {
        const { data, error } = await crmTemplate_repository_1.crmTemplateRepository.create({
            organisation_id: orgId,
            created_by: userId,
            ...input,
        });
        if (error) throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async update(orgId, id, patch) {
        const { data, error } = await crmTemplate_repository_1.crmTemplateRepository.update(orgId, id, patch);
        if (error) throw new errors_1.AppError(error.message, 400);
        return data;
    },
    async remove(orgId, id) {
        const { error } = await crmTemplate_repository_1.crmTemplateRepository.archive(orgId, id);
        if (error) throw new errors_1.AppError(error.message, 400);
        return { success: true };
    },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run test/crm-templates.test.mjs`
Expected: PASS (all renderTemplate + crmTemplateService tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/crmTemplate.service.js backend/test/crm-templates.test.mjs
git commit -m "feat(crm): template service + tests (B1)"
```

---

## Task 6: Controller

**Files:**
- Create: `backend/src/controllers/crmTemplate.controller.js`

- [ ] **Step 1: Write the controller**

```javascript
// ============================================================================
// CRM template controller — parse/validate with Zod, call service, shape HTTP.
// ============================================================================
import * as crmTemplate_service_1 from "../services/crmTemplate.service.js";
import * as crmTemplate_model_1 from "../models/crmTemplate.model.js";
import { idParamSchema } from "../models/common.model.js";

export const crmTemplateController = {
    async list(req, res) {
        const query = crmTemplate_model_1.templateListQuerySchema.parse(req.query);
        res.json(await crmTemplate_service_1.crmTemplateService.list(req.user.organisation_id, query));
    },
    async create(req, res) {
        const body = crmTemplate_model_1.templateCreateSchema.parse(req.body);
        res.json(await crmTemplate_service_1.crmTemplateService.create(req.user.organisation_id, req.user.id, body));
    },
    async update(req, res) {
        const { id } = idParamSchema.parse(req.params);
        const body = crmTemplate_model_1.templateUpdateSchema.parse(req.body);
        res.json(await crmTemplate_service_1.crmTemplateService.update(req.user.organisation_id, id, body));
    },
    async remove(req, res) {
        const { id } = idParamSchema.parse(req.params);
        res.json(await crmTemplate_service_1.crmTemplateService.remove(req.user.organisation_id, id));
    },
};
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/controllers/crmTemplate.controller.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/crmTemplate.controller.js
git commit -m "feat(crm): template controller (B1)"
```

---

## Task 7: Route + mount (gated)

CRM is Reception-accessible (project rule 5). GET = any authenticated CRM user (Reception can view). Mutations = Owner / Practice Manager only.

**Files:**
- Create: `backend/src/routes/crm-templates.routes.js`
- Modify: `backend/src/app.js`

- [ ] **Step 1: Write the route file**

```javascript
// ============================================================================
// CRM template routes — Express Router. Mounted at /api/crm/templates.
// GET: any authenticated CRM user (Reception can view). Mutations: owner +
// practice_manager only.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import { crmTemplateController } from "../controllers/crmTemplate.controller.js";

const router = (0, express_1.Router)();
const manage = (0, auth_1.requireRole)('owner', 'practice_manager');

router.get('/', (0, async_handler_1.asyncHandler)(crmTemplateController.list));
router.post('/', manage, (0, async_handler_1.asyncHandler)(crmTemplateController.create));
router.patch('/:id', manage, (0, async_handler_1.asyncHandler)(crmTemplateController.update));
router.delete('/:id', manage, (0, async_handler_1.asyncHandler)(crmTemplateController.remove));

export default router;
```

- [ ] **Step 2: Add the import to `app.js`**

Near the other route imports (after the `workflows_routes_1` import, ~line 29 in `backend/src/app.js`):

```javascript
import * as crm_templates_routes_1 from "./routes/crm-templates.routes.js";
```

- [ ] **Step 3: Mount the router in `app.js`**

In the `/api` router section (after `api.use('/workflows', …)`, ~line 203):

```javascript
api.use('/crm/templates', crm_templates_routes_1.default);
```

- [ ] **Step 4: Syntax check + full backend test run**

Run: `cd backend && node --check src/routes/crm-templates.routes.js && node --check src/app.js && npx vitest run`
Expected: syntax OK; all tests PASS (existing + new crm-templates).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/crm-templates.routes.js backend/src/app.js
git commit -m "feat(crm): mount /api/crm/templates, gated (B1)"
```

---

## Task 8: API docs

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Append the endpoint block**

Add under a `## CRM` section (create the heading if absent):

```markdown
### CRM Templates  `/api/crm/templates`
Reception may GET; owner/practice_manager may mutate. All org-scoped.

- `GET /api/crm/templates?channel=sms|email` → `{ templates: Template[] }`
- `POST /api/crm/templates` body `{ channel, name, subject?, body }` → `Template`
- `PATCH /api/crm/templates/:id` body `{ channel?, name?, subject?, body?, is_archived? }` → `Template`
- `DELETE /api/crm/templates/:id` → `{ success: true }` (soft delete: sets is_archived)

`Template = { id, organisation_id, channel, name, subject, body, is_archived, created_at, created_by, updated_at }`.
Bodies/subjects may contain `{{var}}` placeholders: first_name, last_name, treatment, practice, appointment_date, address, review_link.
```

- [ ] **Step 2: Commit**

```bash
git add docs/API.md
git commit -m "docs(api): CRM templates endpoints (B1)"
```

---

## Task 9: Frontend API + hook

**Files:**
- Create: `frontend/features/crm/api/templates.ts`
- Create: `frontend/features/crm/useTemplates.ts`

- [ ] **Step 1: Write the API module**

```typescript
import { api } from '@/lib/api';

export interface CrmTemplate {
  id: string;
  channel: 'sms' | 'email';
  name: string;
  subject: string | null;
  body: string;
  is_archived: boolean;
  created_at: string;
}

export interface TemplatesResponse {
  templates: CrmTemplate[];
}

export function listTemplates(channel?: 'sms' | 'email') {
  const qs = channel ? `?channel=${channel}` : '';
  return api<TemplatesResponse>(`/api/crm/templates${qs}`);
}

export function createTemplate(input: {
  channel: 'sms' | 'email';
  name: string;
  subject?: string | null;
  body: string;
}) {
  return api<CrmTemplate>('/api/crm/templates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTemplate(
  id: string,
  patch: Partial<{ channel: 'sms' | 'email'; name: string; subject: string | null; body: string; is_archived: boolean }>,
) {
  return api<CrmTemplate>(`/api/crm/templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTemplate(id: string) {
  return api<{ success: boolean }>(`/api/crm/templates/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Write the hook**

```typescript
'use client';
// CRM message-templates hook — reads the REAL per-org templates from
// /api/crm/templates. Replaces the static TEMPLATES mock in ./data.
import { useQuery } from '@tanstack/react-query';
import { listTemplates, type TemplatesResponse } from './api/templates';

export function useTemplates() {
  return useQuery<TemplatesResponse>({
    queryKey: ['crm-templates'],
    queryFn: () => listTemplates(),
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/crm/api/templates.ts frontend/features/crm/useTemplates.ts
git commit -m "feat(crm): templates frontend api + useTemplates hook (B1)"
```

---

## Task 10: Swap `TemplatesScreen` onto the hook

Keep the existing pixel-faithful layout; only change the data source from the
`TEMPLATES` import to `useTemplates()`, with loading/empty states.

**Files:**
- Modify: `frontend/features/crm/components/TemplatesScreen.tsx`

- [ ] **Step 1: Replace the mock import + data derivation**

Change the imports at the top:

```typescript
'use client';
// Message Templates — reads live data from useTemplates() (was the TEMPLATES mock).
// Layout is the pixel-faithful port of preview/elevate-dental-os-v2.html.
//
// Data flow: useTemplates() -> split by channel -> two grids.

import { useMemo } from 'react';
import { useTemplates } from '../useTemplates';
```

Replace the component body's data derivation. The old code read the `TEMPLATES`
constant synchronously; now read from the query:

```typescript
export default function TemplatesScreen() {
  const { data, isLoading } = useTemplates();
  const templates = data?.templates ?? [];
  const { sms, email } = useMemo(
    () => ({
      sms: templates.filter((t) => t.channel === 'sms'),
      email: templates.filter((t) => t.channel === 'email'),
    }),
    [templates],
  );

  if (isLoading) {
    return (
      <div className="mx-auto" style={{ maxWidth: 1280 }}>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>Loading templates…</p>
      </div>
    );
  }
```

- [ ] **Step 2: Update the header count + the two grids to use the new vars**

In the header subtitle, replace `{TEMPLATES.length}` with `{templates.length}`.
The grid maps already reference `sms` / `email` — leave them. (The grids and
card markup are unchanged; `t.id`, `t.name`, `t.body`, `t.subject` all still exist
on `CrmTemplate`.)

- [ ] **Step 3: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: no errors. (`TEMPLATES` import is gone; confirm no other reference remains in this file: `grep -n TEMPLATES frontend/features/crm/components/TemplatesScreen.tsx` → no matches.)

- [ ] **Step 4: Commit**

```bash
git add frontend/features/crm/components/TemplatesScreen.tsx
git commit -m "feat(crm): wire TemplatesScreen to live /api/crm/templates (B1)"
```

---

## Task 11: Apply migration on hosted + finalise

**Files:**
- Modify: `phases-crm-suite.md`

- [ ] **Step 1: Apply migration 000061 on hosted Supabase**

Apply `supabase/migrations/20260101000061_crm_templates.sql` to project `Dental Os`
(`mkfhpzjbijbachoonytt`) via the Supabase MCP `apply_migration`, then reload PostgREST:

```sql
NOTIFY pgrst, 'reload schema';
```

Verify the table exists: `SELECT to_regclass('public.crm_templates');` → `crm_templates`.

- [ ] **Step 2: Full verification gate**

Run: `cd backend && npx vitest run` → all PASS.
Run: `cd frontend && npm run typecheck && npm run lint` → clean.

- [ ] **Step 3: Tick the tracker**

In `phases-crm-suite.md`, set the B1 row Status to `✅ done` and add a Log line:

```markdown
- 2026-06-09 — B1 (Templates) built + verified (backend tests green, tsc/lint clean).
  Migration 000061 applied on hosted + schema reloaded. Next: B2 (Settings).
```

- [ ] **Step 4: Commit**

```bash
git add phases-crm-suite.md
git commit -m "chore(crm): tick B1 Templates done (CRM Suite)"
```

---

## Self-Review notes

- **Spec coverage (B1 slice):** table (Task 1), variable catalogue + renderTemplate (Task 2), CRUD API gated per rule 5 (Tasks 3–7), API docs (Task 8), frontend swap (Tasks 9–10), hosted migration + tracker (Task 11). ✅
- **Soft delete:** DELETE sets `is_archived`; list filters it out — consistent across repo/service/test/docs.
- **Naming consistency:** `crmTemplateService` / `crmTemplateRepository` / `crmTemplateController` / `renderTemplate` / `TEMPLATE_VARIABLES` used identically in every task.
- **Pence note:** Templates carry no money fields, so the whole-pounds→pence conversion does not apply to B1 (it lands in B2 Settings `treatments[].default_value_pence`).
- **Out of scope for B1:** no create/edit UI on the screen (mock has none); CRUD endpoints exist for B2/B3 + future editor. Engine/enrolment is B3.
```
