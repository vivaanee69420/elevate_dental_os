# rules.md

**Read this file at the start of every session, before touching anything.** It is
imported by `CLAUDE.md` and echoed by a `SessionStart` hook, so there is no
"I didn't see it" — if these rules are not being followed, the failure is a
choice, not an oversight.

`CLAUDE.md` describes *how this codebase is built*. This file describes *how the
work is done*. Where the two disagree, this file wins.

---

## Part 1 — The owner's rules

These came from the owner directly. They are not guidelines and they are not
mine to trade off against speed.

### 1. Every line of code is written for a multi-tenant SaaS

Not for one practice group, not for the account currently on screen. Before any
data access, the questions are: whose data is this, how is that enforced, and
what happens when a second tenant does the same thing tomorrow.

Concretely, non-negotiably:

- Every business table carries `organisation_id`. No exceptions, no "this one is
  small".
- Repositories run on `serviceClient`, which **bypasses RLS**. The explicit
  `.eq('organisation_id', orgId)` chained on every query **is** the isolation.
  Forgetting it is not a bug, it is a data breach.
- The organisation comes from `req.user.organisation_id` (or, for an agency
  actor, the server-resolved `req.agencyOrgId`) — **never** from a request body,
  a query parameter, or a row in a payload. A record that can name its own
  tenant is a cross-org write waiting to happen.
- Never use a PostgREST embed (`contact:contacts(...)`) on the service client.
  An embed resolves the FK as a join with **no org predicate**. This has already
  caused a real cross-org PII read here — see `docs/ISOLATION_AUDIT.md` and
  `lib/tenant-guard.js` (`assertOrgOwns`, `stripImmutable`).
- No freeform `z.record(z.any())` update schemas. They make `organisation_id`
  writable and let any user PATCH their row into another tenant.
- RPCs take `p_org` and are `SECURITY DEFINER`. Every one gets the revoke idiom:
  `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`
- No hardcoded ids, names, thresholds, pipeline names, campaign-name regexes or
  practice names that only make sense for the current customer. Mapping is
  explicit, stored, and per-tenant. **Never match on a name** where an id exists.
- Every new feature is asked the tenant question: what does an org see that has
  none of this data yet? An empty state must say "not connected", never render a
  confident £0.

### 2. A fix is a fix for every account, never just the one reported

When the owner points at a wrong number, a broken screen or a bad row, that is a
**sample**, not the scope. The job is:

1. Find the root cause, not the symptom.
2. Fix it at the choke point so it is fixed for every tenant, past and future.
3. Check what else the same cause has already damaged, across all organisations.
4. Backfill or restamp the historical rows the bug produced, where the data
   still exists to do so.
5. Say plainly which accounts were affected and what was repaired.

Patching the one visible row and moving on is not acceptable and never has been.

### 3. Before building any feature, ask: agency, sub-account, or both?

This is a mandatory question, asked **before** design, not discovered during
implementation. The answer changes the route gate, the UI gate and the data
scope:

- **Agency feature** — administered by Plan4growth across sub-accounts.
  `requireAgencyActor`. Agency powers are a **per-user grant**
  (`users.is_agency_admin`), never "owner of an org with `is_agency`".
- **Sub-account feature** — the tenant's own. `requireRole` /
  `requirePermission` + the module/feature key in `lib/features.js`.
- **Both** — say explicitly what each side may do, and which mutations belong to
  which. Reads are frequently open where writes are agency-only; that split is a
  decision to state, not to assume.

Also settle up front whether it needs a feature key, whether it appears in nav,
and whether Reception can see it (rule 5 of `CLAUDE.md`: Reception is CRM only).

If the answer is not obvious from the request, **ask the owner**. Do not guess.

### 4. Code review is thorough, and every edge case is handled

Mandatory before anything is called done:

- Read the whole diff, not the parts that were interesting to write.
- Enumerate edge cases explicitly and handle them: empty result, single row,
  null vs zero, zero denominator, a tenant with no data, a tenant with no
  integration, a window with no rows, first-ever run, duplicate delivery,
  partial failure mid-loop, an id that appears under two parents, a renamed
  entity, a deleted upstream record, a paged read that exceeds 1000 rows.
- **Null is not zero.** A cost per nothing is an em dash, never "£0.00" — see
  `formatPence` and the memory it earned.
- Cross-tenant isolation is checked by an actual test, not by reading.
- Nothing is reported as working until it has been **run**. Tests pass, lint
  passes, typecheck passes, build passes — and if any of them do not, that is
  said out loud with the output, not glossed.

### 5. No keys reach the repository. Ever. Checked every time.

No API key, token, secret, password, connection string or service-role key in
any file — not in a `.txt`, not in a migration, not in a script, not in a
comment, not in a test fixture, not in a doc, not in a commit message.

- Run `ggshield secret scan pre-commit` before **every** commit, and
  `ggshield secret scan commit-range origin/main..HEAD` before every push.
  A `PreToolUse` hook now enforces this on `git commit` / `git push`.
- ggshield findings are the source of truth. Triage false positives; never
  assume.
- Secrets live in environment variables, and integration credentials are
  encrypted at rest via `lib/crypto.js`.
- If a key is ever found in history: say so immediately, and treat it as
  compromised and needing rotation — scrubbing the file is not sufficient.
  (This has happened here once already — see the `hosted-db-security-drift`
  memory.)

### 6. Claude does not look at patient records

This database holds real UK dental patients.

- Never read patient-identifying data into the transcript: names, emails, phone
  numbers, dates of birth, addresses, postcodes, clinical notes.
- Learn about people by **aggregating** — count them, never list them.
- If a specific patient's details are genuinely needed to diagnose something,
  **stop and ask the owner's permission**, and prefer that they run the query
  themselves.
- `.claude/hooks/block-patient-pii.sh` refuses such queries on `execute_sql`. It
  is deliberately strict and blocks some legitimate aggregates. **Do not work
  around it** — rewrite the query, or ask. The hook is a backstop, not the rule;
  the rule is this paragraph.
- The same restraint applies to logs, Sentry payloads, screenshots, test
  fixtures and anything published or sent anywhere.

---

## Part 2 — Additions, from what has already gone wrong here

Every item below is a real failure in this repository, not a hypothetical.

### 7. Verify before asserting

Do not tell the owner what the data says until it has actually been checked. In
this session alone I claimed a pipeline mapping was wrong and that ~190 leads
would be lost; both were false and both were stated confidently. If something is
inferred rather than measured, say which it is.

### 8. Measure before and after any change to a number

A change to a reported figure is not done until the old value and the new value
have both been measured on live data and the difference is explained. "It should
now be correct" is not a result.

### 9. Migrations: applied, verified, and never assumed

- Find the **last** migration that *defines* an RPC before copying or amending
  it — not the first one that names it. Building from a stale copy has already
  silently reverted a later fix here.
- After any hosted DDL: `NOTIFY pgrst, 'reload schema';`
- After any deploy adding an RPC, sweep every `.rpc('…')` in `backend/src`
  against `pg_proc`. Code has shipped here calling a function that was never
  applied.
- The hosted ledger's `version` values are apply-time timestamps, not the repo's
  numbers — **compare by name, never by number**.
- Verify grants after applying: `anon`/`authenticated` false, `service_role`
  true.
- Ask before applying anything to hosted, and never run a destructive statement
  (`DROP`, `DELETE`, `TRUNCATE`, unqualified `UPDATE`) without explicit
  confirmation of that exact statement.

### 10. Reads are paged, aggregates happen in SQL

PostgREST silently truncates at 1000 rows — tables and set-returning RPCs alike.
Page on a unique key and stop on an **empty** page, never a short one. Never
compute a total by `.filter().length` over a list endpoint: that reports the
page, not the population.

### 11. Probe an external API before writing code against it

Never guess a field name, a response shape or a retention limit. Probe it, and
record what came back in the file header. Guessing has cost real pulls here.

### 12. Shared git working tree — stage explicit paths

Another Claude session may share this checkout. Check `HEAD` before committing,
stage named paths rather than `git add -A`, and never rewrite shared history
(rebase, amend, force-push) while another session may be working.

### 13. Respect the house rules in CLAUDE.md

No dark mode. Money in integer pence. British English in all UI. No emojis in
code or UI. Every mutation audited to `audit_log`. Reception sees CRM only.
"Italy Implant Residency" is excluded everywhere.

### 14. Scope discipline

Do what was asked, in full. Do not silently widen it, do not silently narrow it,
and do not start a refactor nobody requested. If something outside the ask is
genuinely broken, say so and let the owner decide.
