# Elevate OS Live Data Connection Playbook

Last verified: 25 May 2026

This is the implementation-ready handoff for making the prototype launchable with live data.

## Purpose

- Connect Dentally as the operational and clinical source of truth.
- Connect Xero or QuickBooks as the accounting source of truth.
- Keep GoHighLevel as the CRM and communications engine.
- Add a controlled manual-feed fallback so the product can still go live even if one connector is delayed.
- Add reconciliation, audit and security controls so the owner can trust the numbers.

## Source Of Truth

| Domain | System of record | Notes |
|---|---|---|
| Patients, appointments, invoices, payments, treatment plans | Dentally | Do not use CRM or spreadsheets as the long-term master here. |
| P&L, balance sheet, bank, AR/AP, journals, management accounts | Xero or QuickBooks | Pick one accounting master per legal entity. Do not run both live for the same entity. |
| Leads, pipelines, conversations, tasks, automation events | GoHighLevel | Elevate should mirror and report on this data, not replace the engine in v1. |
| Board commentary, one-off adjustments, fallback uploads | Manual feed with approval | Manual data must be flagged, versioned and approved before it becomes trusted. |

## Missing Features Added To The App

The new `Launch Control` tab covers the launch gaps that mattered more than adding another dashboard:

1. Integration health monitoring.
2. Dentally-to-accounting reconciliation.
3. Manual feed management with validation.
4. Board pack and quality-of-earnings controls.
5. Security, audit and role governance.

## Target Architecture

1. Pull from Dentally, Xero or QuickBooks, and GoHighLevel into raw ingestion tables.
2. Store all webhook payloads unchanged in `raw_events`.
3. Normalize to core entities such as `patients`, `appointments`, `payments`, `treatment_plans`, `accounting_transactions`, `monthly_financials`, `crm_contacts`, and `crm_opportunities`.
4. Reconcile Dentally cash and revenue against accounting before publishing owner-facing KPI snapshots.
5. Publish approved snapshots to dashboard tables.
6. Keep manual uploads in the same normalization path, but mark them `source_type = manual`.

## Dentally

### What the official docs indicate

- Official v1 API base URLs currently published:
  - UK/ROI: `https://api.dentally.co`
  - Sandbox: `https://api.sandbox.dentally.co`
  - APAC: `https://api.apac.dentally.com`
  - Canada: `https://api.ca.dentally.com`
- Dentally’s official FAQ says the new NextGen API starts rolling out to an initial group of partners at the end of June 2026, while existing v1 APIs continue working during transition.
- Dentally’s developer docs still require a valid `User-Agent`.
- Dentally advises using date filters and avoiding appointment pulls larger than roughly three months at a time.
- Dentally documents page sizes up to 100 per page.

### What to confirm with the practice immediately

| Item | Why it matters |
|---|---|
| Dentally account region | Chooses the correct base URL. |
| Current access path | Confirm whether this launch will start on existing v1 access and later migrate to NextGen OAuth 2.0. |
| Number of practices in one Dentally tenant | Controls tenant and site mapping. |
| Sandbox availability | Needed for safe connector testing. |
| Webhook setup permissions | Needed for real-time changes. |
| Whether NHS or UDA-related data is exposed in this account | Needed for the NHS pages. |
| Whether treatment codes and patient marketing-consent fields are exposed | Needed for attribution and review workflows. |

### Dentally objects to ingest

| Object | Why |
|---|---|
| Patients | Identity, contact, consent, patient matching. |
| Appointments | Utilisation, DNA, chair recovery, clinician diaries. |
| Payments | Cash collection and reconciliation. |
| Accounts | Debtors and balance tracking. |
| Invoices and invoice items | Revenue analysis and treatment-level profitability. |
| Treatment plan items | Open plans, case conversion, pipeline-to-start reporting. |
| Users or practitioners | Associate productivity and diary ownership. |
| Rooms and sites | Chair performance and site filters. |

### Dentally webhooks to enable

Based on the current Dentally help documentation:

- `appointment.created`
- `appointment.updated`
- `appointment.deleted`
- `patient.created`
- `patient.updated`
- `patient.deleted`
- `payment.created`
- `payment.updated`
- `payment.deleted`

Recommended endpoint:

`POST https://api.<your-domain>/webhooks/dentally`

Required handling:

1. Accept and log the raw payload.
2. Validate signature or source trust mechanism once confirmed for the account.
3. Enqueue a fetch-by-ID job to retrieve the latest full object.
4. Upsert normalized data.
5. Alert if deliveries fail repeatedly because Dentally can deactivate failing webhooks.

### Dentally sync cadence

| Frequency | Action |
|---|---|
| Real time | Receive webhook, fetch latest object by ID, upsert normalized record. |
| Every 15 minutes | Refresh today’s appointments, same-day payments, recent plan changes. |
| Nightly | Backfill the prior 90 days for appointments, invoices, invoice items and treatment plans. |
| Monthly close | Rebuild the closed month snapshot used by dashboards and board packs. |

### Dentally field mapping priorities

| Elevate metric | Dentally field group |
|---|---|
| Chair utilisation | Appointment start/end, room, site, practitioner, status |
| Money leak detector | DNA/cancellation status, open treatment plans, overdue balances |
| Associate productivity | Practitioner, completed revenue, working days, chair time |
| Treatment profitability | Invoice item or treatment plan item, treatment code, value, clinician |
| Review trigger eligibility | Completed appointment or completed paid treatment plus contact/consent |

## Xero

### What the official docs indicate

- Xero’s OAuth scope documentation now describes granular scopes as the default direction for new integrations.
- Xero states granular scopes were assigned to web and PKCE apps in March 2026 and to custom connections on 29 April 2026.
- Xero says broad scopes remain supported until September 2027, but new builds should use granular scopes now.
- Xero webhooks do not cover every accounting object you will need for this product, so scheduled polling is still required for reports and bank data.

### Recommended Xero scope set

Start with the minimum read-focused set and expand only if write-back is truly needed:

- `openid`
- `profile`
- `email`
- `offline_access`
- `accounting.settings.read`
- `accounting.contacts.read`
- `accounting.transactions.read`
- `accounting.reports.read`

If your registered app exposes a separate bank-transaction read scope in the live portal, include it as well.

### Xero data to ingest

| Area | Xero source |
|---|---|
| Monthly management P&L | Reports API: Profit and Loss |
| Balance sheet | Reports API: Balance Sheet |
| Cash position | Bank accounts, bank transactions, payments |
| Debtors and creditors | Invoices, payments, contacts, account balances |
| Chart mapping | Accounts and tracking categories |
| Add-backs and exceptional items | Journals or manual-journal review |

### Xero setup checklist

| Item | Owner |
|---|---|
| App registration and redirect URI | Engineering |
| Tenant connection for each legal entity | Finance + engineering |
| Tracking category or equivalent by practice/site | Finance |
| Account-code mapping to dental buckets | Finance |
| Cash vs accrual basis decision | Finance |
| Board-pack add-back policy | Finance + owner |

### Xero polling cadence

| Frequency | Action |
|---|---|
| Hourly | Refresh bank transactions and cash position if needed. |
| Nightly | Refresh Profit and Loss, Balance Sheet, contacts, invoices, payments and accounts. |
| Monthly close | Freeze management snapshot used for owner and investor reporting. |

## QuickBooks Online

### What the official docs indicate

- QuickBooks Online uses OAuth 2.0.
- The standard accounting scope is `com.intuit.quickbooks.accounting`.
- Intuit’s troubleshooting guidance says the connecting user should be a company admin.
- QuickBooks recommends limiting report queries to date ranges of six months or less and chunking longer history into smaller requests.
- QuickBooks supports webhooks and CDC, which is useful for catching up between scheduled pulls.

### Recommended QuickBooks scope set

- `com.intuit.quickbooks.accounting`
- `offline_access`

Add OpenID scopes only if you want to use Intuit identity data directly.

### QuickBooks data to ingest

| Area | QuickBooks source |
|---|---|
| Management P&L | `ProfitAndLoss` report |
| Balance sheet | `BalanceSheet` report |
| Cash flow | `CashFlow` report |
| Ledger detail | `GeneralLedger` report |
| AR/AP | Invoices, payments, bills, vendors, customers |
| Chart mapping | Accounts, classes, locations |

### QuickBooks implementation rules

1. Use the company admin to authorize the first connection.
2. Store `realmId` per legal entity.
3. Query historical reports in chunks of six months or less.
4. Use webhooks plus CDC for changes, but still run nightly report refreshes.
5. Map classes or locations to practices if one QuickBooks company covers multiple sites.

## Manual Feed Layer

Manual feed is a launch enabler, not the preferred long-term operating model.

### Rules

1. Manual files must be uploaded into staging, never straight into live KPI tables.
2. Every upload must carry `entity_code`, `practice_code`, period or timestamp, and source owner.
3. Every file must pass schema validation before loading.
4. Every promoted upload must be approved by a second user.
5. Every approved upload must write an audit event.
6. Manual values must remain visually flagged in the app until replaced by API data.

### Provided templates

| File | Purpose |
|---|---|
| `manual-feed-templates/monthly_financials_template.csv` | Fallback management P&L and cash summary |
| `manual-feed-templates/appointments_template.csv` | Chair diary and utilisation fallback |
| `manual-feed-templates/payments_template.csv` | Collections and cash-reconciliation fallback |
| `manual-feed-templates/treatment_plans_template.csv` | Open plan, quote value and conversion fallback |
| `manual-feed-templates/leads_template.csv` | Growth and CRM fallback if GHL sync is delayed |

## Reconciliation Rules

These controls are mandatory if the owner is going to rely on the dashboards.

| Control | Compare | Tolerance | Frequency | Sign-off |
|---|---|---|---|---|
| Cash received | Dentally payments vs Xero/QB receipts | 0.5% | Daily | Finance |
| Revenue by practice | Dentally invoiced value vs accounting site totals | 1.0% | Weekly | Finance |
| Aged debt | Dentally account balances vs AR report | Exact patient or invoice match | Weekly | Finance + PM |
| Treatment start attribution | GHL won/started opportunities vs Dentally treatment starts | Exact lead match | Daily | Growth ops |
| Group close | Practice totals vs group close pack | 0.5% | Monthly | Finance lead |

### Exception categories

Use these fixed reasons in the exception queue:

- Timing difference
- Unmapped account code
- Missing practice or site mapping
- Duplicate payment
- Deleted or reversed transaction
- Manual override pending approval
- CRM-patient match failure

## Core Tables To Build

- `organizations`
- `entities`
- `practices`
- `users`
- `roles`
- `permissions`
- `integrations`
- `integration_tokens`
- `sync_jobs`
- `raw_events`
- `manual_uploads`
- `manual_upload_rows`
- `patients`
- `appointments`
- `payments`
- `accounts_receivable`
- `invoices`
- `invoice_items`
- `treatment_plans`
- `treatment_plan_items`
- `practitioners`
- `rooms`
- `crm_contacts`
- `crm_opportunities`
- `crm_conversations`
- `accounting_accounts`
- `accounting_transactions`
- `monthly_financials`
- `reconciliation_runs`
- `reconciliation_exceptions`
- `kpi_snapshots`
- `audit_logs`

## Security And Compliance Baseline

1. Require MFA for all non-patient users.
2. Keep tokens in a proper secrets store, not in frontend code or flat config checked into source.
3. Write immutable audit events for syncs, uploads, approvals, exports and admin changes.
4. Restrict Wealth, entity settings and integration configuration to owner or finance-admin roles.
5. Publish retention rules by object type.
6. Log and alert on repeated webhook failures, token refresh failures and upload-validation failures.

## Delivery Order

1. Freeze canonical entity, practice and role model.
2. Ship Dentally read sync and webhook receiver.
3. Ship Xero first or QuickBooks first by entity, not both at once for the same ledger.
4. Build reconciliation tables and approval flow.
5. Wire GoHighLevel CRM mirror.
6. Add manual-feed ingestion as fallback.
7. Run UAT with one real practice before rolling to the whole group.

## Go-Live Acceptance Criteria

The build is ready to go live only when all of these are true:

1. Dentally sync is live for patients, appointments, payments and treatment plans.
2. One accounting master is connected for each entity.
3. Revenue and cash reconciliation are within agreed tolerance for two consecutive weekly checks.
4. GHL lead-to-treatment matching works on real records.
5. Manual-upload templates import cleanly and write audit events.
6. MFA, RBAC and audit logging are enabled.
7. Board-pack numbers are approved by finance for one closed month.

## Official Source Links

Last checked on 25 May 2026.

- Dentally developer docs: [developer.dentally.co](https://developer.dentally.co/)
- Dentally webhooks help article: [help.dentally.com](https://help.dentally.com/en/articles/15031727-using-webhooks-in-dentally)
- Dentally NextGen API FAQ collection: [help.dentally.com](https://help.dentally.com/en/collections/13200453-dentally-api)
- Xero OAuth scopes guide: [developer.xero.com](https://developer.xero.com/documentation/guides/oauth2/scopes/)
- Xero reports API: [developer.xero.com](https://developer.xero.com/documentation/api/accounting/reports)
- Xero webhooks overview: [developer.xero.com](https://developer.xero.com/documentation/guides/webhooks/overview/)
- QuickBooks Online API overview: [developer.intuit.com](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api)
- QuickBooks OAuth 2.0: [developer.intuit.com](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
- QuickBooks reports overview: [developer.intuit.com](https://developer.intuit.com/app/developer/qbo/docs/workflows/run-reports)
- QuickBooks event notifications and webhooks: [developer.intuit.com](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks)
