# Phase 1 Implementation Plan — Backend Wiring

Created 2026-05-20. Drives execution of `TODO_IMPORTANT.md §0`.

## Goal

Replace mock data in 7 not-wired frontend feature slices (+ 2 leftover partial-wire screens) with real API calls. Every screen reads from backend routes scoped to `req.user.organisation_id`. No new product features — wiring only.

## Scope

| # | Slice | Mock files to retire | Backend route status | Trial first? |
|---|---|---|---|---|
| 1 | `crm` (Inbox) | `data.ts` INBOX_THREADS / THREAD_MESSAGES | `comms.routes.js` exists (GET, POST /send) | **YES — Step 1 trial** |
| 2 | `crm` (Pipeline) | `data.ts` SAMPLE_LEADS + journey statuses | `leads.routes.js` exists | Step 2 |
| 3 | `crm` (Enquiries) | `data.ts` lead fixtures | `leads.routes.js` | Step 3 |
| 4 | `crm` (Templates) | `data.ts` TEMPLATES | **new route + table needed** | Step 4 |
| 5 | `crm` (Sequences/Workflows) | `data.ts` workflow fixtures | `workflows.routes.js` exists | Step 5 |
| 6 | `crm` (Reports) | `data.ts` aggregates | `analytics.routes.js` | Step 6 |
| 7 | `crm` (Today/Settings/Pages) | `data.ts` | mix | Step 7 |
| 8 | `operations` (PayScreen + data.ts) | `data.ts` PAY_RUNS | `pay-runs.routes.js` + `tasks.routes.js` exist | Step 8 |
| 9 | `intelligence` (Debt/Tax/Alerts) | 3 components + `data.ts` | `analytics.routes.js` partial | Step 9 |
| 10 | `overview/AiInsightsScreen` | mock | `analytics.routes.js` | Step 10 |
| 11 | `health/KpiScorecardScreen` | mock | `health.routes.js` exists | Step 11 |
| 12 | `growth` (5 screens + data.ts) | `data.ts` + 5 components | **new growth.routes.js needed** | Step 12 |
| 13 | `wealth` (data.ts) | `data.ts` | **new wealth.routes.js needed** | Step 13 |
| 14 | `training` (5 components) | placeholder | **new training.routes.js needed** | Step 14 |

## Per-step pattern (applies to every slice)

```
┌─────────────────────────────────────────────────────────────┐
│  1. Read backend route/controller/service/model. Confirm    │
│     Zod schemas match what UI sends.                         │
│  2. Create features/<slice>/api.ts — typed wrappers over    │
│     lib/api.ts.                                              │
│  3. Create features/<slice>/hooks.ts — React Query hooks    │
│     with keys including org+filters.                         │
│  4. Edit component: replace direct mock import with hook    │
│     call. Handle loading/empty/error states.                 │
│  5. Keep mock export only if a component still references   │
│     it (delete dead imports after all components migrated). │
│  6. If backend route missing: add routes/controllers/        │
│     services/repositories/models per layered convention.    │
│  7. If new route: add vitest unit + cross-org isolation     │
│     test before wiring frontend.                             │
│  8. Frontend: tsc --noEmit + next lint + next build.        │
│  9. Backend: npm test (vitest).                              │
│  10. Log entry in completed-tasks.md.                       │
└─────────────────────────────────────────────────────────────┘
```

## Cross-cutting rules (enforce on every step)

- Repos use `serviceClient` + manual `.eq('organisation_id', orgId)` filter. Never bypass.
- Money stays integer pence end-to-end. UI display via `lib/format.ts`.
- British English. No emojis. No dark mode.
- React Query keys: `['<domain>', orgId, ...filters]`. Stale time 30s default, individual screens can override.
- Loading skeleton components already exist in `components/ui` — reuse, don't invent.
- New endpoints documented in `docs/API.md` same PR.
- Cross-org isolation test added for every new repo method.

## Step 1 detail — CRM Inbox (trial run)

**Current state (verified):**
- `frontend/features/crm/components/InboxScreen.tsx:18` imports `INBOX_THREADS`, `THREAD_MESSAGES` from `../data`.
- `frontend/features/crm/data.ts` — 511 lines of mock fixtures.
- Backend `GET /api/comms` returns `{ communications: [...] }` filtered by `organisation_id` via `commRepository.list`.
- `commListQuerySchema` accepts `contact_id?`, `lead_id?`, `channel?` — sufficient for inbox view.

**Changes:**
1. New file `frontend/features/crm/api.ts`:
   ```ts
   import { api } from '@/lib/api';
   export interface Communication {
     id: string;
     organisation_id: string;
     contact_id?: string;
     lead_id?: string;
     channel: 'email' | 'sms' | 'whatsapp' | 'voice_ai';
     direction: 'inbound' | 'outbound';
     subject?: string;
     body: string;
     to_address?: string;
     from_address?: string;
     external_id?: string;
     delivery_status?: string;
     created_at: string;
   }
   export const fetchCommunications = (params: { contact_id?: string; lead_id?: string; channel?: string } = {}) => {
     const qs = new URLSearchParams(params as Record<string, string>).toString();
     return api<{ communications: Communication[] }>(`/comms${qs ? `?${qs}` : ''}`);
   };
   export const sendCommunication = (body: { contact_id?: string; lead_id?: string; channel: 'email'|'sms'|'whatsapp'; to: string; subject?: string; body: string }) =>
     api(`/comms/send`, { method: 'POST', body: JSON.stringify(body) });
   ```

2. New file `frontend/features/crm/hooks.ts`:
   ```ts
   import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
   import { fetchCommunications, sendCommunication } from './api';
   export function useCommunications(filters: { channel?: string } = {}) {
     return useQuery({
       queryKey: ['communications', filters],
       queryFn: () => fetchCommunications(filters),
       staleTime: 30_000,
     });
   }
   export function useSendCommunication() {
     const qc = useQueryClient();
     return useMutation({
       mutationFn: sendCommunication,
       onSuccess: () => qc.invalidateQueries({ queryKey: ['communications'] }),
     });
   }
   ```

3. Edit `InboxScreen.tsx`:
   - Replace `import { INBOX_THREADS, THREAD_MESSAGES, ... } from '../data'` with `import { useCommunications } from '../hooks'`.
   - Add `const { data, isLoading, error } = useCommunications();` at top of component.
   - Group `data?.communications` by contact_id (or lead_id when contact null) into client-side "threads" — `useMemo` reducer.
   - Reuse existing render logic.
   - Loading state: existing `components/ui` skeleton (or simple "Loading inbox..." for trial — polish in later pass).
   - Empty state: "No conversations yet — outbound sends will appear here."
   - Error state: render `error.message` in a banner.
   - KEEP imports for non-data helpers (`CRM_NAVY`, `agoLabel`) — `data.ts` stays but its INBOX_THREADS export becomes dead weight (delete later once all 10 screens migrated).

**Acceptance:**
- [ ] Inbox screen renders against real `/api/comms` response.
- [ ] Empty org shows empty state (verified with seeded fresh org if possible, else mock-empty response).
- [ ] No tsc errors. No lint errors. `npm run build` succeeds.
- [ ] Backend vitest still 47/47 passing.
- [ ] Entry appended to `completed-tasks.md` with date 2026-05-20.

## Step ordering rationale

Inbox first because:
- Backend route ready (no schema/migration work).
- Single component, well-bounded.
- Proves the `api.ts` + `hooks.ts` pattern that every later step reuses.
- Low blast radius — failure mode is "inbox shows skeleton", not data loss.

After Step 1 ships and is logged, decide whether to continue inline or hand control back to user for next-step green-light.

## Out of scope (this phase)

- Real-time updates (websockets / SSE) — polling-only this phase.
- Inbound webhook routing into `communications` — Phase 6.
- Per-tenant email/SMS identity — Phase 4.
- Templates table creation — deferred to Step 4 sub-task.
- Performance/caching tuning past default React Query defaults.

## Phase 1 exit criteria

- [ ] All 14 steps shipped and logged in `completed-tasks.md`.
- [ ] `npm run build` succeeds front+back.
- [ ] `npm test` backend green.
- [ ] Zero remaining references to `_mock` or `data.ts` mock fixtures in `app/(dashboard)/` and `features/`.
- [ ] No regressions on already-wired slices.
- [ ] Updated `TODO_IMPORTANT.md §0` status to mark Phase 1 complete.
