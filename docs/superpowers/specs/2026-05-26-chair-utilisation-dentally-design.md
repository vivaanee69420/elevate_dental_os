# Operations: Manual Chair Utilisation + Associates from Dentally — Design

**Date:** 2026-05-26
**Status:** Approved (pending spec review)
**Area:** Operations → Chair Utilisation (manual) + Associates (Dentally-linked)

## Summary

Two independent tracks, each its own implementation plan:

- **Track A — Manual Chair Utilisation.** Replace the hardcoded `CHAIR_UTIL` heatmap with a
  fully manual, detailed data-entry feature: owner adds/edits/deletes utilisation records at
  **practice + chair + weekday + slot** grain (booked vs available hours → computed %). No
  Dentally involvement.
- **Track B — Associates from Dentally.** Replace the mock `ASSOCIATES` roster with real data:
  extend the Dentally sync to pull `/practitioners`, create/map `associates` rows, capture
  `practitioner_id` on synced appointments (link appt→associate), and add an aggregation
  endpoint. The Associates page then shows real appointment volume / treatments / completion /
  no-show per associate. Production / UDA / conversion are not in the Dentally feed and stay
  manual or blank.

Earlier auto-computed-utilisation-from-Dentally approach is dropped (chair grain is not in
the Dentally feed; owner wants manual control).

---

## Track A — Manual Chair Utilisation

### Data model

New table `chair_utilisation` (migration `supabase/migrations/20260101000023_chair_utilisation.sql`):

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `uuid_generate_v4()` |
| `organisation_id` | UUID NOT NULL | FK organisations, ON DELETE CASCADE |
| `practice_id` | UUID NOT NULL | FK practices |
| `chair_name` | TEXT NOT NULL | e.g. "Surgery 1" |
| `weekday` | SMALLINT NOT NULL | ISO 1=Mon … 7=Sun, CHECK 1..7 |
| `slot` | TEXT NOT NULL | CHECK in ('morning','midday','afternoon','evening') |
| `booked_minutes` | INT NOT NULL DEFAULT 0 | CHECK >= 0 |
| `available_minutes` | INT NOT NULL DEFAULT 0 | CHECK >= 0 |
| `notes` | TEXT | optional |
| `created_at` / `updated_at` | TIMESTAMPTZ | `updated_at` trigger |

- `UNIQUE (organisation_id, practice_id, chair_name, weekday, slot)` — one record per cell.
- Indexes: `(organisation_id, practice_id)`.
- Idempotent migration; after hosted apply run `NOTIFY pgrst, 'reload schema';`. Mirror into `db/01_schema.sql`.
- Minutes (not hours) stored as INT — matches the project's "integers, never floats" discipline.

### Computation

Utilisation % is derived, never stored: `utilPct = available>0 ? min(100, round(100*booked/available)) : null`.
The heatmap grid aggregates across chairs: for each (weekday, slot),
`gridPct = Σbooked / Σavailable` over all chairs in the selected practice.

### Backend (routes → controller → service → repo → model)

- `backend/src/models/chair-utilisation.model.js` — Zod: `chairUtilisationCreateSchema`
  (`practice_id` uuid, `chair_name` non-empty, `weekday` int 1..7, `slot` enum, `booked_minutes` int ≥0,
  `available_minutes` int ≥0, `notes` optional), `chairUtilisationUpdateSchema` (partial), and
  `chairUtilisationListQuerySchema` (`practice_id` uuid optional).
- `backend/src/repositories/chair-utilisation.repository.js` — `serviceClient`, explicit
  `.eq('organisation_id', orgId)` on every query: `list(orgId, practiceId?)`, `create(orgId, input)`,
  `update(orgId, id, patch)`, `remove(orgId, id)`.
- `backend/src/services/chair-utilisation.service.js` — passthrough CRUD plus `grid(orgId, practiceId)`
  that lists records and aggregates the weekday×slot grid (sum booked/available, compute %).
- `backend/src/controllers/chair-utilisation.controller.js` — validate, call service, shape response.
- `backend/src/routes/chair-utilisation.routes.js` — `GET /` (list), `GET /grid`, `POST /`,
  `PATCH /:id`, `DELETE /:id`. Mounted at `/api/chair-utilisation` behind `authenticate`,
  gated `requireRole('owner','practice_manager')`. Mutations audited by existing `audit` middleware.

### Frontend

- `ChairScreen.tsx` — practice selector; fetch `GET /api/backend/chair-utilisation/grid?practice_id=`
  for the heatmap + KPIs (avg %, peak/lowest slot, idle hours). Render `null` cells as blank.
  12-hour slot labels (8:00am–11:00am etc.).
- New management UI on the same page (or a sub-panel): a table of records
  (`GET /api/backend/chair-utilisation?practice_id=`) with **Add** (form: practice, chair, weekday,
  slot, booked hrs, available hrs, notes), **Edit** (PATCH), **Delete**. Hours entered in the form
  are converted to minutes for the API.
- Remove `CHAIR_UTIL` / `CHAIR_DAYS` / `CHAIR_SLOTS` mock once wired.
- Time formatting helper in `lib/format.ts` (12h) if absent.

### Track A testing

- Unit: a pure `aggregateGrid(records)` helper (extracted into the service or `lib/`) — sums per
  cell, caps at 100%, `null` when available=0, multiple chairs combine correctly.
- Service/controller: CRUD happy paths + cross-org isolation (records from another org excluded).

---

## Track B — Associates from Dentally

### Schema change

Migration `supabase/migrations/20260101000024_associate_pms_link.sql`:
- `ALTER TABLE associates ADD COLUMN IF NOT EXISTS pms_external_id TEXT` — Dentally practitioner id.
- `CREATE UNIQUE INDEX IF NOT EXISTS uq_associates_org_pms ON associates(organisation_id, pms_external_id) WHERE pms_external_id IS NOT NULL`.
- Idempotent; `NOTIFY pgrst`. Mirror into `db/01_schema.sql`.

### Dentally sync changes — `backend/src/lib/integrations/dentally-sync.js`

1. **`pullPractitioners()`** (new) — GET Dentally `/practitioners` (paginated, same client/rate-limit
   pattern as existing pulls). For each practitioner: resolve site→`practice_id` via the existing
   site map; upsert into `associates` keyed on `(organisation_id, pms_external_id)`:
   `full_name` (from name fields), `email`, `primary_practice_id`, `pms_external_id`, `active`.
   Does NOT overwrite owner-set `pay_pct` / `lab_split_pct` on update (only fills name/email/practice).
   Returns synced count.
2. **Practitioner→associate map** — after `pullPractitioners`, build
   `practitionerMap: { [pms_external_id]: associate_id }` (query associates for the org) for the
   appointment pull, mirroring how the site map is built/passed.
3. **`appointmentRow()`** — read `a.practitioner_id` (Dentally appointment payload), look up
   `practitionerMap[practitioner_id]` → set `associate_id` on the row (null if unmapped). Leave all
   other mapping unchanged.
4. **Sync order** — run `pullPractitioners` before `pullAppointments` in the full/bootstrap sync so
   the map is populated; incremental sync also refreshes practitioners first.
5. **Backfill** — a one-time `relink_dentally_appointment_associates()` SQL function (in the same
   migration) that sets `appointments.associate_id` from a join of `appointments.pms_external_id`-era
   data is **not** possible (appointments don't store practitioner id historically). Instead: document
   that a full re-sync (existing backfill path) re-populates `associate_id` going forward. (No fake
   historical data.)

### Backend aggregation endpoint

- `backend/src/models/associate.model.js` — `associateListQuerySchema` (`practice_id` uuid optional,
  `weeks` int default 52 max 104 for the TTM window).
- `backend/src/repositories/associate.repository.js` — `serviceClient` + explicit org filter:
  `list(orgId, practiceId?)` (roster rows joined to practice name), and
  `appointmentStatsByAssociate(orgId, since)` — counts grouped by `associate_id`
  (total, completed, no_show) over the window. Prefer a new RPC
  `associate_appointment_stats(p_org, p_since)` for the grouping (mirrors
  `appointments_rollup_by_practice`), with a JS-side fallback if the RPC is absent
  (consistent with the `auth_bootstrap` fallback pattern).
- `backend/src/services/associate.service.js` — `list(orgId, practiceId, weeks)`: merge roster with
  appointment stats. Per associate return: `id`, `full_name`, `practice` (name), `pay_pct` (as %),
  `joined_date`, `treatments` (= completed count), `appointments_total`, `no_shows`,
  `completion_pct`, `no_show_pct`, `status` (derived band from completion/volume), and
  `ttm_production`/`ttm_uda`/`conversion` = `null` (not in Dentally; UI shows "—").
- `backend/src/controllers/associate.controller.js` + `backend/src/routes/associate.routes.js` —
  `GET /` mounted at `/api/associates`, behind `authenticate`, gated `requireRole('owner','practice_manager')`.

### Frontend

- `AssociatesScreen.tsx` — fetch `GET /api/backend/associates`; render roster + KPIs from real data.
  Columns with no Dentally source (production, UDA, conversion) render `—` with a tooltip
  "Not available from Dentally". `status` band from `completion_pct`/volume.
- `PayScreen.tsx` — keep using `pay_pct` per associate from the same endpoint; production inputs
  remain manual (out of scope to auto-fill).

### Track B testing

- Unit: practitioner→associate mapping (mapped/unmapped → associate_id null), associate stats merge
  (completion %, no-show %, treatments = completed), status banding, null financial columns.
- Service: cross-org isolation; RPC fast-path + JS fallback parity.
- Sync: `pullPractitioners` upsert does not clobber owner-set `pay_pct`.

---

## Error handling (both tracks)

- Invalid/missing query or body → 400 (Zod).
- Record/practice not in caller's org → repo returns none → 404 (mutations) / empty (lists).
- Unmapped Dentally practitioner → `associate_id` stays null, appointment still synced (no error).
- Aggregation with no appointments → zeros, not errors.

## Docs

- `docs/API.md` — new endpoints: `/api/chair-utilisation*`, `/api/associates`.
- `docs/FORMULAS.md` — utilisation % aggregation + completion/no-show derivations (project rule:
  new formula ⇒ FORMULAS.md + unit test).

## Out of scope

- Auto-computing chair utilisation from Dentally (now manual by decision).
- Per-associate production £, UDA, conversion (not in the Dentally feed; manual/blank).
- Historical backfill of `associate_id` on already-synced appointments (no practitioner id stored
  historically — re-sync repopulates going forward).
- Per-weekday distinct opening hours; per-room beyond named chairs.
