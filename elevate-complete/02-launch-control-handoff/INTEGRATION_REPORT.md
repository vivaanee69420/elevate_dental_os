# Elevate Dental OS Integration Report

Updated: 23 May 2026

For the implementation-ready handoff, use [DATA_CONNECTION_PLAYBOOK.md](/Users/gauravmehta/Downloads/codex%20prohjects/Marketing%20OS/DATA_CONNECTION_PLAYBOOK.md). This report stays as the shorter strategic summary.

## Recommendation

Do not build a full CRM inside Elevate Dental OS for v1.

Use GoHighLevel as the CRM engine and make Elevate the command layer on top:

- Elevate owns CEO dashboards, KPIs, finance, operations, valuations, exit planning, coaching, tasks and recommendations.
- GoHighLevel owns pipelines, inbox, WhatsApp/SMS/email, call workflows, forms, automations, calendars and follow-up.
- Dentally owns clinical PMS data.
- Xero or QuickBooks owns accounting truth.

Fastest stable v1: API sync plus deep links into GHL. Avoid iframe-first delivery unless GHL explicitly supports the target pages in an embeddable way for your account, because CRM apps often block iframe embedding, carry their own navigation, and can break with UI changes.

## GoHighLevel Questions

| Question | Practical answer |
|---|---|
| Can GHL be auto-populated from our software? | Yes. Use GHL API v2 contacts, opportunities, tasks/notes, calendars, conversations and workflows where available. |
| Can users log in through our dashboard? | Use OAuth 2.0 for multi-account/Marketplace style integrations or Private Integration Tokens for internal/single-location usage. True white-label SSO into the full GHL UI depends on GHL account/app capabilities and should be verified in your agency account. |
| Can GHL open without showing the full GHL sidebar? | Not reliably as a general assumption. Deep links may land users inside GHL, but hiding GHL's own sidebar is a UI/product capability, not something to depend on through unsupported hacks. |
| Can we deep-link to call centre, inbox, pipeline, WhatsApp, leads and enquiries? | Usually yes for practical navigation if the relevant GHL URLs are known per location. Build a configurable `ghl_links` table and store URLs per sub-account/module. |
| Can Elevate collapse its own sidebar when opening GHL? | Yes. The local prototype now demonstrates this pattern. |
| Best approach | API sync + configurable deep links first. Marketplace OAuth later. Embedded iframe only after a proof-of-concept confirms the exact GHL pages render cleanly. Custom CRM only if GHL becomes a blocker. |

Sources checked:

- HighLevel API overview and support article: https://help.gohighlevel.com/support/solutions/articles/48001060529
- HighLevel API docs: https://marketplace.gohighlevel.com/docs/

## Dentally Integration

Official endpoints:

- UK/ROI production: `https://api.dentally.co`
- Sandbox: `https://api.sandbox.dentally.co`
- APAC production: `https://api.apac.dentally.com`
- Canada production: `https://api.ca.dentally.com`

Important implementation notes:

- Dentally is REST/JSON.
- Use date filters and avoid huge pulls. Dentally advises avoiding more than 3 months of appointment data per request.
- Pagination defaults to 25 and can usually go up to 100 per page.
- Every API request needs a valid `User-Agent`.
- Patients and appointments support limited metadata, useful for storing your integration IDs.

Sources:

- Dentally API docs: https://developer.dentally.co/
- Dentally webhook docs: https://help.dentally.com/en/articles/15031727-using-webhooks-in-dentally

### Dentally Data Needed

| Elevate module | Dentally data/API needed | Why |
|---|---|---|
| Overview KPIs | Appointments, payments, accounts, invoices, treatment plan items, users/practitioners, rooms/sites | Revenue, patients, chair use, operational health |
| Break-even treatments/patients | Treatment plan items, invoices, payments, appointment counts | Convert break-even revenue into treatments/patients |
| Chair utilisation | Appointments, rooms, practitioners, sites, opening/session hours | Booked vs available chair time |
| Associate scheduling | Appointments, practitioners/users, rooms, sites | Clinician calendar and capacity |
| Associate pay | Invoices, invoice items, payments, treatment plan items, practitioners, lab cost mapping from accounting | Production and pay calculations |
| Treatment profitability | Treatment plan items, invoice items, sundries, payments, practitioner, lab/material costs from Xero/QB | Margin by treatment |
| UDA tracker | NHS-related treatment plan items/claims where available, appointments, practitioners | Contract delivery |
| Chair recovery | Cancelled appointments, DNA/no-show state, appointment cancellation reasons | Lost chair value and recovery queue |
| Growth attribution | Patients, acquisition sources, appointments, treatment starts, payments | Source to treatment conversion |
| Review requests | Appointments completed, patients, consent/contact details, payments/treatment completion | Trigger review request sequences |
| Call centre | Patients, appointments, appointment status, source/acquisition data | Match GHL lead to clinical outcome |

### Dentally Webhooks Required

Dentally currently supports webhooks for:

- `appointment.created`
- `appointment.updated`
- `appointment.deleted`
- `patient.created`
- `patient.updated`
- `patient.deleted`
- `payment.created`
- `payment.updated`
- `payment.deleted`

Set webhook endpoint:

- `POST /webhooks` in Dentally, or Settings -> Developer -> Webhooks.
- Use one receiver in your backend, for example: `POST https://api.elevateos.co/webhooks/dentally`.
- Validate payloads, store raw event, then enqueue normalization jobs.
- Monitor failed/successful deliveries. Dentally deactivates after repeated failures, so alert before this becomes invisible.

### Dentally API Pull Schedule

| Frequency | Pull |
|---|---|
| Real time | Webhook event receives appointment/patient/payment changes, then fetch the full object by ID |
| Every 15 minutes | Today's appointments, appointment state changes, payments |
| Nightly | Prior 90 days appointments, invoices, invoice items, treatment plan items, accounts |
| Monthly close | Month's completed treatments, payments, invoices, cancellation reasons, users, rooms, sites |

## Xero Integration

Use Xero as accounting truth where the practice uses Xero.

Core API areas:

- Accounting API: invoices, payments, bank transactions, contacts, accounts, journals/manual journals, tracking categories.
- Reports API: Profit and Loss, Balance Sheet, Bank Summary, Trial Balance where available.
- OAuth 2.0 with per-tenant connection.

Sources:

- Xero Accounting API invoices: https://developer.xero.com/documentation/api/accounting/invoices
- Xero Reports API: https://developer.xero.com/documentation/api/accounting/reports

### Xero Data Needed

| Elevate module | Xero data/API needed |
|---|---|
| Monthly P&L | Reports: ProfitAndLoss; fallback to accounts + journals/transactions |
| Balance sheet | Reports: BalanceSheet |
| Cash flow | BankTransactions, Payments, Bank Summary, bank account balances |
| Cost of sales | Chart of accounts mapping for labs, materials, associate direct costs |
| Overheads | Chart of accounts mapping for staff, rent, utilities, subscriptions, marketing, admin |
| Tax estimate | P&L profit, tax account balances, manual tax rules |
| Retained cash | Cash balances minus reserves/tax/supplier liabilities |
| Treatment profitability | Lab bills, supplier invoices, account codes, tracking categories |
| Associate pay export | Bills/manual journals/pay-run export, depending accountant workflow |
| Practice valuation | Trailing 12-month EBITDA, add-backs, exceptional costs, normalized profit |

### Xero Setup Needed From Accountant

- Chart of accounts export.
- Account code mapping into dental categories:
  - Revenue: private, NHS, implants, hygiene, orthodontics, membership.
  - Cost of sales: lab, materials, associate direct pay, finance fees.
  - Overheads: staff, rent, utilities, marketing, software, insurance, professional fees.
- Tracking categories by practice/location and optionally clinician.
- Confirmation of cash vs accrual reporting basis.
- Month-end close date and tax estimate rules.

## QuickBooks Integration

QuickBooks should be the alternative accounting connector for practices not using Xero.

Sources:

- QuickBooks Online API overview: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api
- QuickBooks Profit and Loss report API: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/profitandloss

Core API/report areas:

- Reports: `ProfitAndLoss`, `BalanceSheet`, `CashFlow`, `GeneralLedger`.
- Entities: Account, Customer, Vendor, Invoice, Bill, Payment, BillPayment, Purchase, Deposit, JournalEntry.
- Use OAuth 2.0 and realm/company IDs.
- Use `summarize_column_by=Month` for monthly P&L where appropriate.

## Backend Data Model Needed

Minimum production tables:

- `practices`
- `users`
- `roles`
- `permissions`
- `integrations`
- `integration_tokens`
- `sync_jobs`
- `raw_events`
- `patients`
- `appointments`
- `payments`
- `invoices`
- `invoice_items`
- `treatments`
- `practitioners`
- `rooms`
- `accounting_accounts`
- `accounting_transactions`
- `monthly_financials`
- `kpi_snapshots`
- `ghl_contacts`
- `ghl_opportunities`
- `ghl_conversations`
- `tasks`
- `valuation_inputs`
- `exit_strategy_inputs`

## Launch Sequence

1. Ship static/prototype UI as the agreed workflow.
2. Add authentication and role permissions.
3. Add Xero first if your accountant's books are cleanest there.
4. Add Dentally read sync plus webhooks.
5. Add GHL contacts/opportunities sync and deep links.
6. Add monthly KPI snapshot generation.
7. Add recommendations/coaching layer once raw data is reliable.

## Details To Ask Dentally / Claude Extension To Confirm

Ask for:

- API access method and OAuth/client setup for your Dentally account.
- Sandbox availability.
- Exact scopes required for:
  - patients read/update
  - appointments read/update
  - payments read
  - accounts read
  - invoices and invoice items read
  - treatment plan items read
  - users/practitioners read
  - rooms/sites read
  - webhooks manage/read
- Whether NHS/UDA claim data is exposed for your account.
- Whether treatment codes, fee items, charting or completed treatment data are available in the API for your account.
- Whether patient marketing consent fields are exposed and which fields should be used for SMS/email/review requests.
- Whether appointment reason/treatment description is standardized enough for reporting, or if you need a treatment mapping table.
- Webhook payload examples for appointment, patient and payment events.
- Rate limits for your account/region.

## What The App Should Not Do In V1

- Do not rebuild full CRM.
- Do not rebuild online booking.
- Do not depend on scraping GHL screens.
- Do not assume financial truth from Dentally alone.
- Do not calculate associate pay without a clear accountant-approved rule set.
- Do not expose Wealth pages to non-owner roles.
