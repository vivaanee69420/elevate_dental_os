# Task Manager — live, owner-gated, with reminders

Date: 2026-06-06

## Goal

Turn the mock `TaskManagerScreen` into a working manual task manager backed by
the real `tasks` table. **Only the Owner may add/edit/complete/delete/remind
tasks; all other roles get read-only.** Reminder emails (manual + nightly auto)
fire to the assignee.

## Decisions (locked with user)

1. **Admin = Owner only.** All mutations gated `requireRole('owner')`. Read open
   to every authenticated role.
2. **Simplify UI to the DB schema.** Drop the mock's Business + Category fields
   and fake `TEAM`/`BUSINESSES`. Assignee = real org users.
3. **Scope = CRUD + reminders.** Manual "Remind" / "Send all overdue" buttons
   send real email via `lib/messaging.sendEmail`; one nightly cron auto-reminds
   overdue tasks. No SMS.

## Data model — migration `20260101000051_task_reminders.sql`

`tasks` already has: `title, description, assigned_to (FK users), due_date,
priority(low|normal|high|urgent), status(open|in_progress|done|cancelled),
related_lead_id, related_contact_id, completed_at, created_at, updated_at`.

Add (idempotent):
- `reminder_count INT NOT NULL DEFAULT 0`
- `last_reminded_at TIMESTAMPTZ`

End with `NOTIFY pgrst, 'reload schema';`. Mirror into `db/01_schema.sql`.

## Backend

`routes/tasks.routes.js`
- `GET /` — `authenticate` only (all roles).
- `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /:id/remind`, `POST /remind-overdue`
  — `requireRole('owner')`.

`models/task.model.js`
- Keep `taskCreateSchema`. Tighten `taskUpdateSchema` from `z.record(any)` to an
  explicit partial: `title?, description?, assigned_to?, due_date?,
  priority?(enum), status?(enum)`.

`repositories/task.repository.js` — add `remove(orgId,id)`,
`listOverdue(orgId)`, `bumpReminder(orgId,id)` (increment count + set
`last_reminded_at=now`). Keep explicit `.eq('organisation_id', orgId)`.

`services/task.service.js` — add `remove`; `remind(orgId,id)` loads the task +
assignee email, calls `sendEmail({orgId,to,subject,body})` (cc owner), then
`bumpReminder`; `remindOverdue(orgId)` loops `listOverdue`.

`controllers/task.controller.js` — add `remove`, `remind`, `remindOverdue`.

`workers/index.js` — nightly `node-cron` job: per active org, find overdue
non-done tasks, email each assignee. Follows the existing snapshot/GHL cron
pattern (uses `serviceClient`).

## Frontend — rewrite `features/overview/components/TaskManagerScreen.tsx`

- New `features/overview/tasks-api.ts`: `listTasks`, `createTask`, `updateTask`,
  `deleteTask`, `remindTask`, `remindOverdue` (wrap `lib/api`). Reuse
  `features/system/api.fetchTeam()` for the assignee dropdown.
- React Query for the task list + mutations (invalidate on success).
- `useMe()` → `isOwner = role === 'owner'`. Add-form + Remind/Delete/status
  buttons render only when `isOwner`. Non-owners see the list, KPIs, overdue
  banner, By-Person grouping — no write controls.
- Fields map straight to DB. Status glyphs/labels for
  open|in_progress|done|cancelled. Priority colours for low|normal|high|urgent.
- Tabs: All · Overdue · By Person (real members) · Reminder Rules (static info).
  Drop "By Business". British English, no emojis.

## Tests (`backend/test`, vitest + supaRec)

- `requireRole('owner')` middleware: non-owner → 403, owner → next().
- Task repo/service: list/create/remove are org-scoped; `bumpReminder`
  increments. Mirrors existing recorder-based tests.

## Out of scope

SMS reminders; Business/Category columns; snooze/pop-up-on-login; per-rule
toggles (Rules tab is static display).
