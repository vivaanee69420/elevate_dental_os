# Settings shell and team management — design

**Date:** 2026-09-06
**Status:** approved, not yet implemented
**Migration:** none

## Problem

Settings is four rows in the dashboard sidebar's pinned footer (`Integrations`,
`Data Hub`, `Team Permissions`, `Settings`). Opening one keeps the whole product
around it — the section rail, the section tab strip, the scope/period bar — so
configuration and daily work sit in the same frame and read as the same kind of
thing.

Team management is worse. `TeamPermissionsScreen` is a 969-line file doing two
unrelated jobs on one page: a small members table with an inline add-member
form, and the role permission matrix. Neither answers the question an owner
actually arrives with, which is about **one person** — what can Jane see, which
accounts does she reach. Permissions can only be edited a whole role at a time.
The per-user override layer exists in the backend (`users.permissions`, top of
the precedence chain, `PUT /api/admin/permissions/user`) and has never had a UI.

And the agency has no way to see its people. `user_organisations` (migration
`000136`, applied on hosted) already lets one login belong to several accounts
with a role and permission set per account, and `AgencyDialog` can add a user to
one sub-account — but there is no list of who reaches what, and assigning one
person to five accounts means five separate visits.

## Shape of the solution

Settings becomes its own shell — its own left rail, no dashboard chrome, a
`← Go Back` out of it — and Team inside it becomes a list of people that opens
into a per-person editor. An agency actor sees every account's users in that one
list and can assign a person to several accounts at once. A sub-account owner
sees the identical screen scoped to their own account, and administers their own
team with no agency involvement.

## Decisions taken

Four questions were settled before design, and each rules out a cheaper path
that would have been wrong:

1. **Permissions are per-user overrides layered on the role.** The role sets the
   baseline; the editor pins exceptions for one person, with a reset control
   that unpins. The role matrix survives as its own page, so "change what every
   Practice Manager sees" stays a one-place edit. The rejected alternative —
   per-user only, retiring the matrix — makes a role-wide change an N-user
   chore and leaves `role_permissions` as dead weight.
2. **An agency actor's Team list spans the agency org and every sub-account**,
   one table, with a Location column and a sub-account filter. A sub-account
   owner's list is their own org only.
3. **The Settings menu carries what Settings carries today**, nothing new.
4. **One role and one permission set apply to every account a person is
   assigned to.** The table stores them per membership row, so per-account
   divergence stays available later without a migration.

## Architecture

### A. Shell and routing

New route group `frontend/app/(settings)/`, holding folders **moved** out of
`(dashboard)`:

| Path | Was | Becomes |
|---|---|---|
| `/team-permissions` | members table + role matrix | Team list |
| `/team-permissions/[userId]` | — | user editor (new) |
| `/settings/roles` | — | role matrix (moved off `/team-permissions`) |
| `/integrations` | dashboard page | unchanged screen, settings shell |
| `/data-hub` | dashboard page | unchanged screen, settings shell |
| `/settings` | cards linking elsewhere | redirects to `/team-permissions` |
| `/settings/billing` | a button on `/settings` | its own page (new) |
| `/settings/ad-attribution` | dashboard page | unchanged screen, settings shell |

**URLs do not change.** Next route groups do not appear in the path, so the
seven in-app links to these routes (`DashboardScreen`, `OpenDaySplit`,
`HealthScreen` ×2, `CallReportingScreen`, `SettingsScreen`) keep working and no
redirects or link edits are needed. "Other pages hidden" is then a consequence
of layout nesting — the dashboard sidebar, `TopBar` and `SectionTabs` live in
`app/(dashboard)/layout.tsx` and simply never wrap a settings route — rather
than conditional rendering inside a shared shell, which would leave the two
layouts free to drift.

None of the four moving screens reads `useScopePeriod`, so leaving
`ScopePeriodProvider` behind in the dashboard group costs nothing.

`app/(settings)/layout.tsx` renders: left rail with `← Go Back` (to
`/business-hub`), a "Settings" heading and the menu; content on the right; a
slim header above both carrying the agency-switch banner, notification bell and
sign-out. The rail is **white, not GHL's navy** — project rule 1, no dark mode.
The existing `TopBar` cannot be reused: its hamburger toggles a sidebar that
does not exist here, so a `SettingsTopBar` composes the same children
(`NotificationBell`, the `exitSwitch` banner) without it.

Menu rows: **Team · Roles & Permissions · Integrations · Data Hub · Billing ·
Ad attribution**. Billing and Ad attribution are the two cards on today's
`/settings` page promoted to rows. Every row keeps the exact `ROUTE_PERMISSION`
and `SECTION_FEATURE` gate it has today, so a Practice Manager sees a shorter
menu than an owner and an org without a module sees no row for it.

Sub-account administration (create, feature toggles, delete, switch) stays in
the existing `AgencyDialog`. No Sub-accounts page is added.

### B. Team list — `/team-permissions`

Filter row: **User Type** · **User Role** · **Select sub-account** *(agency
actors only)* · search (name, email) · `+ Add User`.

Columns: Name (initials avatar, name, email) · Phone · User Type ·
**Location** *(agency actors only)* · Actions (edit, remove).

Phone is the real `users.phone` column, not a placeholder. Location renders the
accounts a person reaches as chips with `+N` overflow, from their
`user_organisations` rows.

A non-agency caller's screen drops the Location column, the sub-account filter
and the User Type column — everyone in a single-account tenant is an account
user, and a column with one value in every row is noise. This is decided from
the server's response, not merely hidden client-side: the endpoint does not
return other accounts' users to a non-agency caller at all.

`+ Add User` opens the editor in create mode over the existing `provision`
(password) and `invite` (email) paths.

### C. User editor — `/team-permissions/[userId]`

Left mini-nav, two panes.

**User Info** — full name, email, phone, status, Set password, Remove.
No profile-image upload: `users.avatar_url` exists but nothing writes it, and a
control that appears to save and does not is worse than initials.

**Roles & Permissions** —

- **User Role** dropdown (`owner` · `practice_manager` · `reception` ·
  `analyst`).
- **User Type** shown read-only. Agency admin is `users.is_agency_admin`, granted
  only by a platform superadmin (`PATCH /api/platform/users/:id/agency-admin`)
  across a separate auth system; an editable-looking control that cannot save
  would lie.
- **Add sub-accounts** multiselect — *agency actors only*.
- Search, then permission sections: a master toggle per section with per-page
  checkboxes nested under it. This maps onto what already exists — the master is
  the catalogue key (`crm.view`), the children are the `page:<id>` keys, and
  `resolveEffectivePermissions` already treats a page key as inheriting its
  section unless explicitly set.
- Every row displays the role-inherited state until pinned, with `↺` to unpin.
  These are overrides, and a row that cannot be told apart from its inherited
  value hides the fact that one person has been singled out.
- Save writes one role and one permission map to the home org **and** to every
  assigned account.

### D. Backend — no migration

All four routes sit under `/api/admin/team`, gated `requireRole('owner')` — the
same reasoning as `permissions.routes.js`: this writes the top-precedence layer
of the permission chain, so delegating it via a permission key would let a
holder self-escalate.

A **sub-account owner is `role: 'owner'` in their own org**, so this grants them
the full screen inside their account — create users, set roles, assign
permissions — with no gate changes and no agency involvement. The agency
widening below is gated on `is_agency_admin` alone and can never leak sideways.

1. **`GET /api/admin/team`** — widened only when
   `req.user.is_agency_admin && req.agencyOrgId && !req.agencyContext`: the
   agency org plus its children, each member carrying `accounts[]` and
   `is_agency_admin`. A plain owner's response is byte-identical to today's. A
   *switched* agency actor is acting as that child's owner, so they get that
   child only — `req.agencyContext` being set is what excludes them.
   `authRepository.listOrgMembers` widens its select to add `phone`,
   `organisation_id` and `is_agency_admin`.
2. **`GET /api/admin/team/:userId`** — profile, role, memberships, effective
   permissions, and which keys are explicit rather than inherited (the same
   distinction `getMatrix` already returns for roles).
3. **`PUT /api/admin/team/:userId`** — one save:
   `{ full_name, phone, role, permissions: { key: bool | null }, organisation_ids? }`.
   - Role change guarded by the existing `canManageTarget` hierarchy.
   - Permissions guarded by `assertGrantCeiling` — a caller cannot grant what
     they do not themselves hold.
   - `organisation_ids` accepted **only** from an agency actor; every id is
     validated as a child of `req.agencyOrgId` via `assertChild` (or the agency
     org itself) before any write. No organisation id is ever trusted from the
     body.
   - Reconciles `user_organisations` rows (add and remove), writing the same
     role and permission map to each.
   - Refuses to drop the user's home org from the list: a login with no home
     org is unreachable.
4. **`POST /api/admin/team`** (create) — reuses `provisionMember` / `invite`,
   then applies role, permissions and `organisation_ids` through the same path
   as (3).

Mutations are audited by the existing `audit` middleware; an agency actor's
writes carry `diff.via_agency` as they do elsewhere.

### E. The gap this closes

`setUserOverride` writes to `users.permissions` — the **home org** row. In a
multi-account world the per-account layer is `user_organisations.permissions`,
and nothing writes it today. Section C's "apply to every assigned account" is
what closes that: without it, a person assigned to five accounts would carry
their overrides in one and fall back to role defaults in the other four, which
is exactly the kind of silent widening this screen exists to prevent.

## Testing

Backend (vitest):

- a plain owner's list is their own org only
- an agency actor's list spans the agency org and its children
- a *switched* agency actor sees only the child they are switched into
- assigning a user to an org that is not a child returns 404
- `assertGrantCeiling` rejects a bulk save granting a key the caller lacks
- the role hierarchy rejects promoting a target above the caller
- removing the home org from `organisation_ids` is refused
- a sub-account owner sending `organisation_ids` is rejected
- a sub-account owner CAN create a user and set permissions in their own org

Frontend has no test framework: `npm run typecheck`, `npm run lint`,
`npm run build`.

## Out of scope

- Profile-image upload (`avatar_url` has no writer).
- Making User Type editable (platform superadmin surface, separate auth system).
- A Sub-accounts page — `AgencyDialog` keeps that job.
- Per-account divergent roles/permissions — the table supports it, the UI does
  not offer it.

## Unrelated defect found while reading

Commit `2eb7453` overwrote `backend/src/repositories/membership.repository.js`
with the user-organisation membership repo. `membershipService.listPlans`,
`.list` and `.create` now call functions that no longer exist, so
`/api/memberships` (patient membership plans — the Loyalty page) throws.
Separate ticket; not addressed here.
