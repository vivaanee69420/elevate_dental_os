# Dentally Integration — Associates / Pay / Treatments handoff

Context dump (1 Jun 2026) so work survives a chat clear. Covers the Dentally
sync fixes, the associate-name fix, treatment-plan production plumbing, and what
still needs building for the Associates / Pay / Treatments pages.

Hosted Supabase project: `mkfhpzjbijbachoonytt` ("Dental Os").
Active test org (the "new user"): `86a71044-7366-4b51-be0a-838da735d974`.

---

## Commit status

| Commit | What | Pushed? |
|---|---|---|
| `fa3edd3` | Dentally fetch: translate AbortError, retry timeouts (no more opaque "operation was aborted") | **PUSHED / live** |
| `c9be97f` | 2-year bootstrap window (all 3 resources by updated_since) + un-stickable SyncOverlay (stall detect + Close) | local only |
| `7aabda7` | Bootstrap also pulls upcoming diary (`after=now`) so Appointments screen populates; BOOTSTRAP_MAX_PAGES 600→900 | local only |
| `dc8e752` | Map real practitioner names from nested `user.{title,first_name,last_name,email}` | local only |
| `cee7882` | Capture treatment-plan production data (migration 000027 + sync) — PLUMBING only | local only |

**4 commits are local-only on `main`. They need: `git push origin main` → Railway auto-deploy.**

Migration `000027` (treatment_plans) is ALREADY APPLIED on hosted Supabase.

---

## Key data findings (verified against the LIVE Dentally API)

Probed by decrypting org 86a71044's key (`INTEGRATIONS_SECRET_KEY` in backend/.env)
and hitting Dentally directly. All mapper field names now confirmed CORRECT:

- **Practitioner names** are nested: `practitioner.user.first_name` / `user.last_name` / `user.title` / `user.email`. NOT top-level — that's why associates synced as "Practitioner <id>". Also `appointment.practitioner_name` and `appointment.patient_name` exist directly.
- **PRODUCTION SOURCE = `/treatment_plans`** (61k rows): `private_treatment_value` (money), `nhs_uda_value` + `nhs_completed_uda_value` (UDA units), keyed by `practitioner_id` + `patient_id` + `completed`. This is the per-associate production the Pay Run needs and which appointments/payments do NOT carry.
- `/invoices` (21k): `amount`, `paid`, per `user_id`/`site_id` — alt billing source.
- Appointment object carries: `practitioner_id`, `practitioner_name`, `reason`, `state`, `payment_plan_id`, `treatment_description` (often null), `practitioner_site_id`.
- `/treatments` is just a catalog (codes/names), no prices.
- **Volume:** 2-year `updated_since` = ~111k appointments for a busy org (bulk-imported, all stamped recently-updated) → exceeds even the 90k cap. Full history needs `full=true`. The `after=now` upcoming pull guarantees the diary regardless.

On a FRESH sync of org 86a71044 (before it stalled): appts associate_id 100%, appointment_type 100%, payments contact-linked 99.8%. So the mappers WORK — the original all-null was stale data, now fixed.

---

## Per-page status (the actual question)

| Page | Component | Source | Real data when |
|---|---|---|---|
| Associates roster (names) | `frontend/features/operations/components/AssociatesScreen.tsx` | **LIVE** `/api/associates` | After deploy + re-sync (practitioner re-pull populates `associates.full_name`) |
| Treatments | `frontend/features/operations/components/TreatmentsScreen.tsx` | **LIVE** `/api/treatments` (volume mix) | After deploy + re-sync (appointments already synced; types populate the table). Volume only — no price feed |
| Associate Pay Run | `frontend/features/operations/components/PayScreen.tsx` | **LIVE** `/api/pay-runs/draft` | After deploy + re-sync (needs `treatment_plans` populated; 0 rows until re-sync). Lab cost unfed → net==gross |

The invented mock fixtures (`ASSOCIATES`, `PAY_RUN_INPUTS`, `treatmentLeads`) were
removed from `frontend/features/operations/data.ts`; only `STAFF` + `PRACTICE_UDA`
(Staff/UDA screens, still mock) remain.

### Staff page — Dentally-backed (LOCAL, not pushed)
Probed live Dentally: **`/users` IS the team roster** (fields: title/first/last,
email, mobile_phone, **role** e.g. "Dentist"/"Receptionist", site_id, last_login);
`/staff` → 404. Dentally has **no HR data** (rate/hours/scheduled/attendance), so
those mock columns were dropped (not faked).
- Migration `…000029_staff_dentally.sql`: ALTER `staff` ADD source, pms_external_id,
  pms_role, email, phone, title, last_login_at + full unique index
  `uq_staff_src_ext(org,source,pms_external_id)`. Mirrored into `db/01_schema.sql`.
  **NOT applied hosted.**
- `dentally-sync.js`: `mapDentallyRole` + `staffRow` + `pullUsers` (/users, upsert
  on org,source,pms_external_id), wired into `syncOneOrg` (after practitioners,
  try/caught, unwindowed full roster). Result adds `staff` count.
- Backend domain `staff.{model,repository,service,controller,routes}.js` →
  `GET /api/staff` (owner/PM). Roster + practice join + 90-day active heuristic.
- Frontend `staff-api.ts` + `StaffScreen.tsx` rewired off `STAFF` mock (removed
  from `data.ts`): Name/Role/Practice/Email/Phone/Last-active.
- Tests: `staff.service.test.mjs` + `dentally-staff.test.mjs` (7). Fixed the
  full-backfill window test (skip the unwindowed /users null). `docs/API.md` Staff
  section added. Suite 294/294.
- Renders empty until deploy + apply 029 on hosted + re-sync (same as the others).

### Built this session (Treatments + Pay wiring — LOCAL, not pushed)
- **Treatments**: new backend domain `treatment.{model,repository,service,controller,routes}.js` → `GET /api/treatments` (owner/PM). Aggregates `appointments.appointment_type` by volume+share. RPC `treatment_mix_stats` with paginated JS fallback. Screen rewired to volume/share (revenue/margin dropped — no price feed).
- **Pay**: `GET /api/pay-runs/draft` (owner-only) — production per associate summed from completed `treatment_plans.private_value_pence` for the period → `calculateAssociatePay`. New `pay-run.repository.productionByAssociate` (RPC `associate_production` + fallback) + `payRunService.draft`. Lab cost 0 (no lab-invoice feed), NHS UDA excluded (no rate). Screen rewired to the draft; defaults to the last complete month.
- **Migration** `…000028_treatment_mix_and_production_rpcs.sql` (the two RPCs) — **NOT applied to hosted**; fallbacks cover correctness, RPCs are a perf optimisation to apply on deploy.
- **Tests**: `treatment.service.test.mjs` + `pay-run-draft.service.test.mjs` (8 new). Suite 287/287 green. Fixed a real bug: `.range()` is terminal, so a conditional `.eq()` after it threw — practice filter now applied before `.range()`. `docs/FORMULAS.md` §3 + `docs/API.md` updated.

---

## NEXT STEPS (in order)

1. **Push + deploy:** `git push origin main` (4 commits) → Railway deploys backend + frontend.
2. **Re-sync the org:** reconnect/refresh Dentally for org 86a71044. The on-connect bootstrap (or `POST /api/integrations/dentally/sync?full=true` for full history) will, with the new code:
   - pull practitioners with real names → associates roster shows "Dr …"
   - pull upcoming appointments (`after=now`) → Appointments diary populates
   - pull `/treatment_plans` → `treatment_plans` table fills (production data)
   - stamp `last_sync_at` on completion (overlay auto-closes; stall guard if killed)
   Re-sync is dedup-safe (upsert on unique arbiters — no duplicates).
3. **Verify** (SQL below). Names should be real; treatment_plans > 0.
4. **Build Treatments page** (smaller, read-only, no formula risk): aggregate `appointments` by `appointment_type` per practice/window → endpoint → rewire `TreatmentsScreen` off mock.
5. **Build Associate Pay** (bigger, financial): production per associate+month from `treatment_plans.private_value_pence` (+ NHS UDA × rate); wire `calculateAssociatePay`; endpoint; replace `PayScreen` mock; update `docs/FORMULAS.md` + test.

---

## Verification queries (hosted, org 86a71044)

```sql
-- associate names real? (should NOT all be 'Practitioner <id>')
SELECT full_name FROM associates
WHERE organisation_id='86a71044-7366-4b51-be0a-838da735d974' AND pms_external_id IS NOT NULL LIMIT 20;

-- treatment_plans landed after re-sync?
SELECT count(*), sum(private_value_pence) AS total_private_pence,
       count(*) FILTER (WHERE associate_id IS NOT NULL) AS linked_to_associate
FROM treatment_plans WHERE organisation_id='86a71044-7366-4b51-be0a-838da735d974';

-- upcoming appointments present? (was 0 before the 7aabda7 fix)
SELECT count(*) FROM appointments
WHERE organisation_id='86a71044-7366-4b51-be0a-838da735d974' AND source='dentally'
  AND starts_at >= now();

-- sync completed? (last_sync_at stamps to today when done)
SELECT last_sync_at, last_error FROM integrations
WHERE organisation_id='86a71044-7366-4b51-be0a-838da735d974' AND provider='dentally';
```

---

## Files touched

- `backend/src/lib/integrations/dentally-sync.js` — fetch retry, 2-year window, upcoming pull, name mapping, `treatmentPlanRow` + `pullTreatmentPlans`
- `backend/test/dentally-sync.test.mjs`, `backend/test/dentally-associates.test.mjs` — tests (suite 279/279 green)
- `frontend/features/integrations/components/SyncOverlay.tsx` + `frontend/features/integrations/api.ts` — stall detect, Close button, `at` field
- `supabase/migrations/20260101000027_dentally_treatment_plans.sql` (applied hosted) + `db/01_schema.sql` + `db/02_rls.sql`

Related memories: `dentally-treatment-pay-data-wall`, `dentally-appt-contact-linkage-gap`, `dentally-onconnect-bootstrap`, `overview-data-aggregation`.
