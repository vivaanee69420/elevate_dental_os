# Multi-Organisation Membership Implementation Plan

**Goal:** One login can belong to several organisations and switch between them, instead of `users.id` (the auth user id) pinning a person to exactly one org.

**Architecture:** A `user_organisations` join table holds the memberships, each with its own role and permissions. `users.organisation_id` stays as the **home/default** org, so nothing that reads it breaks. `authenticate` resolves an *acting* org: an `x-active-org` header (injected by the Next proxy from an httpOnly cookie) is honoured **only** when the caller actually holds a membership for it — validation is against the table, so unlike the agency switch this needs no signed token. The membership's role and permissions apply while acting there.

**Interaction with the agency switch:** they stay separate and complementary. Agency switch = act inside an org you are *not* a member of (needs the HMAC token, because nothing else authorises it). Membership switch = act inside an org you *are* a member of. Agency context wins when both are present.

---

### Task 1: Migration `000136` — memberships + backfill

- `user_organisations(user_id, organisation_id, role, permissions, created_at)`, PK `(user_id, organisation_id)`, both FKs `ON DELETE CASCADE`.
- Backfill exactly one row per existing `users` row, so today's behaviour is preserved bit-for-bit.
- Index on `organisation_id` for "who is in this account".
- RLS enabled, no policies (service-role only) — the established idiom.
- `auth_bootstrap` extended to return `memberships` in the same round trip; the auth hot path must not gain a second query.

### Task 2: Repository + service

- `membership.repository.js`: `listForUser(userId)` (joined to `organisations` for the name), `listForOrg(orgId)`, `add(userId, orgId, role, permissions)`, `remove(userId, orgId)`, `exists(userId, orgId)`.
- Kept org-scoped and secrets-free like every other repo.

### Task 3: `authenticate` resolves the acting org

- Read memberships from the `auth_bootstrap` payload (fallback: a query).
- `x-active-org` honoured only when a membership matches; otherwise home org, silently (a stale cookie must never 401).
- While acting on a membership: `req.user.role` / `permissions` come from that membership row.
- Agency context takes precedence, unchanged.

### Task 4: `/auth/me` exposes the accounts

- `accounts: [{ id, name, role }]` — every org the login can reach.
- `active_organisation_id` — where it is acting now.
- Existing fields untouched.

### Task 5: Switch endpoint + Next cookie route

- `POST /api/auth/switch-org { orgId }` → 403 unless a membership exists.
- Next route `app/api/active-org/route.ts`: POST sets the httpOnly `active_org` cookie, DELETE clears it.
- The generic proxy forwards it as `x-active-org` (mirrors `x-agency-switch`).

### Task 6: Adding an existing email to a second account

- `agencyService.addSubaccountUser`: if the email already belongs to a login, add a **membership** instead of failing with "already a member". That is the whole point — the same person, reachable in both accounts.

### Task 7: Frontend account picker

- `useMe().accounts`; render a picker in the sidebar only when the login has more than one account.
- Switching posts to `/api/active-org` then hard-navigates, resetting every cache (same approach as the agency switch).

### Task 8: Docs + verification

- `docs/API.md`: the new endpoint, the header, and the precedence rule.
- Full backend suite, lint, frontend typecheck/lint/build.

## Risks

- **Auth hot path**: memberships must ride the existing `auth_bootstrap` round trip; a second query per request would undo the performance work just completed.
- **Isolation**: the acting org must be validated against the membership table on *every* request — never trusted from the header. This is the same rule that makes the agency switch safe.
- **Permissions**: a membership's role must not silently widen someone's access in their home org; role/permissions are read per acting org.
