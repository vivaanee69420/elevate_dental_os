# Data Model

How the entities relate, where each piece comes from, and the rules for ingestion / normalisation.

The authoritative schema is `DATABASE_SCHEMA.sql`. This document is the prose explanation.

---

## Top-level hierarchy

```
organization        (1 — GM Dental Group)
  └── entity        (N legal entities · usually 1-3 Ltd companies per group)
        └── practice (N clinical sites · 5 for GM Dental Group v1)
              ├── patients
              ├── appointments
              ├── invoices + payments
              └── treatment_plans
```

A `practice` belongs to exactly one `entity`. An `entity` belongs to exactly one `organization`. Users are scoped to one organization.

---

## Source-of-truth rules

| Domain | System of record | Notes |
|---|---|---|
| Patients, appointments, invoices, payments, treatment plans | Dentally | Never use the CRM or spreadsheets as the long-term master. |
| P&L, balance sheet, bank, AR/AP, journals | Xero **or** QuickBooks | One accounting master per legal entity. Never both live for the same entity. |
| Leads, pipelines, conversations, tasks | GoHighLevel | Elevate mirrors and reports on this. GHL stays the engine in v1. |
| Board commentary, one-off adjustments, fallback uploads | Manual feed (with approval) | Flagged, versioned, approved before becoming trusted. |

`source_type` column on every ingested record:
- `api` — pulled from a connector
- `manual` — uploaded via CSV
- `derived` — computed from other tables (e.g. `monthly_financials` rolled up from `accounting_transactions`)

---

## Ingestion pipeline

```
External system → webhook payload → raw_events (raw JSON) → normalization worker → core tables
                                                          ↓
                                                      audit_logs entry
```

Three guarantees:
1. **Every webhook payload is stored raw before any processing.** Lets you replay history when normalization logic changes.
2. **External IDs are stable keys.** `(source_system, external_id)` is unique on every clinical / CRM / accounting table.
3. **Upserts, never inserts.** Webhooks may deliver out of order or be retried. Always upsert by external ID.

---

## ID matching across systems

Patients are the trickiest. A GHL contact and a Dentally patient describe the same person but have different IDs. The CRM-patient match runs on every contact / opportunity ingest:

1. **Phone match** (E.164 normalised). Wins if exact.
2. **Email match** (lowercased, trimmed). Wins if exact.
3. **(First + Last + DOB)** match. Wins if exact.
4. **Fuzzy match** (Levenshtein on name + same practice + appointment within ±60 days). Surfaces as a *suggested* match — never auto-linked. Goes to the exception queue as `crm_patient_match_failure`.

When matched, `crm_contacts.patient_id` is populated. When not, the contact sits unmatched and the daily `treatment_starts` reconciliation flags any won opportunity that has no matching `treatment_plans` start.

---

## Accounting normalisation

Each accounting account (from Xero or QuickBooks) gets mapped to one `dental_bucket`. This is set during onboarding and rarely changes.

Buckets used by `monthly_financials`:

**Revenue**
- `revenue.private`
- `revenue.nhs`
- `revenue.implants`
- `revenue.hygiene`
- `revenue.orthodontics`
- `revenue.other`

**Cost of Sales**
- `cos.lab`
- `cos.materials`
- `cos.associate`
- `cos.finance`

**Overhead**
- `overhead.staff`
- `overhead.rent`
- `overhead.utilities`
- `overhead.marketing`
- `overhead.software`
- `overhead.insurance`
- `overhead.professional`
- `overhead.other`

Unmapped accounts trigger an `unmapped_account_code` exception. They don't break ingestion — they just don't roll up into `monthly_financials` until mapped.

---

## Practice-level allocation

Xero tracking categories (or QuickBooks classes / locations) tag every transaction line with a practice. The `accounting_tracking_categories` table maps that string value to a `practice_id`.

If a transaction lands without a practice tag, it goes into the "Group" bucket and shows on the entity-level rollup only — it doesn't appear in any individual practice's P&L. This is correct behaviour for genuine entity-level costs (e.g. group insurance, owner remuneration).

---

## Monthly close

A month is "closed" when:
1. All Dentally data for the period is synced.
2. All accounting data for the period is in Xero / QuickBooks and locked.
3. The five reconciliation controls all show green.
4. Manual feed uploads (if any) are approved.
5. The `monthly_financials` row has `closed_at` set.

After close, the row is read-only. Changes require a manual journal in the accounting system and a re-close.

---

## KPI snapshots

`kpi_snapshots` is the dashboard's read model. It exists because:
- Computing live from raw tables is expensive at month-end
- Historic numbers should freeze (so changing a treatment plan today doesn't retroactively change last month's conversion rate)
- It gives you a clean point to mark `source_quality` (`reconciled` / `provisional` / `manual`)

Job cadence:
- Daily snapshot computed at 02:00 local
- Weekly snapshot computed Sunday 02:30
- Monthly snapshot computed on close

---

## Retention

| Object | Retention | Notes |
|---|---|---|
| `raw_events` | 90 days online · indefinite cold archive | GDPR-compliant deletion of patient-identifiable payloads on request |
| `audit_logs` | 7 years online | Immutable · can never be edited or deleted |
| `manual_uploads` + `manual_upload_rows` | 7 years | Required for financial audit |
| `sessions` | 30 days post-expiry | Then deleted |
| `patients` | Indefinite while active · 7 years after deactivation | Per Data Protection Act 2018 |
| `kpi_snapshots` | Indefinite | Aggregates only · no PII |
