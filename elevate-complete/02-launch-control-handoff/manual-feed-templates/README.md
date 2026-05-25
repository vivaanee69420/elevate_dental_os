# Manual Feed Templates

These templates let the product launch with controlled fallback uploads while API connections are being completed or repaired.

## Rules

1. Do not change the header names.
2. Use UTF-8 CSV.
3. Use ISO dates like `2026-05-25` and ISO datetimes like `2026-05-25T09:00:00+01:00`.
4. Keep `entity_code` and `practice_code` consistent with the product database.
5. Upload into staging first, then approve.
6. Replace manual data with API data as soon as the connector is stable.

## Files

- `monthly_financials_template.csv`: fallback monthly management numbers when Xero or QuickBooks is not yet connected.
- `appointments_template.csv`: fallback operational diary data for chair utilisation and DNA tracking.
- `payments_template.csv`: fallback collections and cash-reconciliation data.
- `treatment_plans_template.csv`: fallback open-treatment-plan and quote-value data.
- `leads_template.csv`: fallback lead and pipeline data if GoHighLevel sync is delayed.

## Suggested upload order

1. `appointments_template.csv`
2. `payments_template.csv`
3. `treatment_plans_template.csv`
4. `leads_template.csv`
5. `monthly_financials_template.csv`

## Approval rule

One user uploads. A different user approves. Both actions should be written to the audit log.
