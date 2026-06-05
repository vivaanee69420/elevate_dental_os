# Financial Formulas — for accountant review

Every calculation in Elevate Dental OS lives in `backend/src/lib/formulas.ts`. Shishir Khadka FCCA should review these before launch.

## Conventions

- All money stored as **integer pence**. Display: `(pence / 100).toLocaleString('en-GB')`
- All percentages stored as **decimal** (e.g., 12.5 = 12.5%), except pay rates which are **basis points** (4500 = 45.00%)
- All time periods refer to trailing 12 months unless stated otherwise

---

## 1. Profit & Loss

```
totalCosts = sum(costs.associates, costs.lab, costs.materials,
                 costs.staff, costs.property, costs.marketing, costs.other)
netProfit = revenue - totalCosts
marginPct = netProfit / revenue × 100
```

**UK dental benchmarks (Shishir to confirm):**
- Net margin average: 15%
- Top quartile: 20%+
- Below 10%: concerning

### 1a. Real-data sourcing + bucket mapping

Finance shows **real data or zero — never an estimate**:
- **Revenue** (`finance-series`, `financial`, `cashflow`): **exact** settled
  `payments`, summed in Postgres via the `settled_receipts_by_day` RPC (NOT by
  fetching rows and summing in Node — that hit PostgREST's 1000-row read cap and
  undercounted orgs with >1000 payments). Or the `monthly_financials` revenue
  actual when one exists for that period.
- **Costs / profit / margins**: `monthly_financials` actuals (Xero P&L sync +
  manual entry) when present (real, `costsAvailable:true`). When there is **no
  real cost source, cost lines, profit and margins are 0** — never estimated
  from the baseline. Dentally carries no cost data; Xero will.
- **Balance sheet** (`financial`): only **real bank cash** (Σ `bank_accounts`);
  every other line (receivables/payables/liabilities/equity beyond cash) is **0**
  — no assumption-driven estimates.
- **No baseline projection or estimate anywhere** in the Finance section. The
  baseline is used only by the Overview/Command-Centre screens.

Actuals are stored per `dental_bucket`:
`revenue, staff, lab, materials, overhead, tax, other`.

**Precedence (per period + bucket):** synced accounting actuals
(`source = xero|quickbooks`) **override** manual entries (`source = manual`).
Manual is the fallback when no synced row exists for that period+bucket.
(`bucketsByPeriod` in `services/monthlyFinancial.service.js`.)

**Bucket → `calculatePL` cost lines** (`plInputFromBuckets`):
```
revenue          = bucket.revenue
costs.staff      = bucket.staff
costs.lab        = bucket.lab
costs.materials  = bucket.materials
costs.other      = bucket.overhead + bucket.other
costs.associates = costs.property = costs.marketing = 0   (no actuals bucket)
tax → EXCLUDED from operating costs (below the operating line; the baseline
      P&L has no tax cost line, so excluding it keeps actuals comparable)
```
Actuals carry no separate associate/property/marketing bucket — those sit inside
`staff`/`overhead` depending on how the org books them. `finance-series` groups
the same buckets as `{ associatePay:0, staffCosts:staff, labMaterials:lab+materials,
opex:overhead+other }` (`financeSeriesRowFromBuckets`).

Annual P&L (`pl`) sums the trailing ≤12 entered periods.

---

## 2. Practice Valuation

Source: **Dental Elite Goodwill Report 2024-25**

Determine practice type by `privateRevenuePct`:
- **Private**: ≥ 75%
- **Mixed**: 30% – 74.99%
- **NHS**: < 30%

Apply multiples to EBITDA:

| Buyer type | Private | Mixed | NHS |
|---|---|---|---|
| Principal-led | 7.3× | 7.0× | 6.4× |
| Associate-led | 3.5× | 3.3× | 2.9× |
| DSO / corporate | 7.0× | 6.5× | 5.5× |

```
principalLed = ebitda × principalMultiple
associateLed = ebitda × associateMultiple
dso = ebitda × dsoMultiple
midPoint = (principalLed + dso) / 2
```

EBITDA calculation (in P&L formula):
```
ebitda = netProfit + depreciation + amortisation + interest + tax
       ≈ netProfit + (revenue × 4%)   [approximation if D&A not available]
```

**Accountant action**: Confirm or override the 4% D&A approximation per practice mix.

---

## 3. Associate Pay

UK standard formula:

```
gross = production_pence × pay_pct / 10000
     (basis points: 4500 = 45%)

labDeduction = labCost_pence × labSplitPct / 10000
            (e.g., 5000 = 50% — associate covers half of lab cost)

net = gross - labDeduction + prev_balance_pence
   (prev_balance carries forward any negative or positive balance)
```

**Edge cases**:
- Negative net → associate owes practice; carry as `prev_balance` to next pay run
- UDA pay: separate formula, calculated as `uda_count × uda_rate_pence × pay_pct / 10000`
- Hygiene therapist pay: same formula, different default pay_pct (typically 4000 = 40%)

**Production source (draft pay run, `GET /api/pay-runs/draft`)**: `production_pence`
is summed from **`treatment_plans.private_value_pence`** for rows where
`completed = true` and `completed_at` falls in the period (the Dentally
`/treatment_plans` feed — appointments and payments carry no per-associate
production). Caveats, surfaced in the UI:
- **Lab cost has no feed yet** (no lab-invoice import) → `labCost_pence = 0`, so
  `labDeduction = 0` and `net == gross`. Lab invoices are entered/uploaded
  separately (the persisted `POST /api/pay-runs/calculate` path still takes a
  real `lab_cost_pence` per line).
- **NHS UDA production is excluded** from `production_pence`: it is paid in UDA
  units (`treatment_plans.nhs_completed_uda_value`) with no per-UDA rate stored,
  so it cannot be converted to pence here (see the UDA-pay edge case above).
- `prev_balance_pence = 0` in the draft (carry-forward is applied at persist time).
- `pay_pct` / `lab_split_pct` come from the `associates` row (basis points).

---

## 4. Cash Flow (13-week, REAL backward view)

Not a forecast. Each of the last 13 weeks shows **real cash received** — settled
`payments` bucketed by the week of `processed_at` (deduped by payment id; null
`processed_at` skipped). Opening = real bank balance (Σ `bank_accounts`, £0 +
flagged when none connected). There is no projected receipts line and no cost
line (Dentally has no outflow source).
```
opening_week0   = Σ bank_accounts.balance_pence
receipts_week   = Σ settled payments with processed_at in that week
closing_week    = opening_week + receipts_week        (running balance)
opening_week+1  = closing_week
```
`baselineWeeklyRunRatePence = round(baseline.revenue × 100 / 52)` is returned
**separately** as a comparison target (the owner's Business Health run-rate) and
is never added into the real receipts. `practice_id` scopes receipts to one
practice. (`analyticsService.cashflow`.)

---

## 5. KPIs (23-metric scorecard)

### Conversion KPIs
```
leadToConsult% = consultationsBooked / monthlyLeads × 100
consultToTreatment% = treatmentsStarted / consultationsAttended × 100
leadToTreatment% = treatmentsStarted / monthlyLeads × 100
```

### Money KPIs
```
monthlyRevenuePerLead = (annualRevenue / 12) / monthlyLeads
netMarginPct = netProfit / revenue × 100
recurringRevenuePct = (membership_revenue + plan_revenue) / revenue × 100
```

### Patient KPIs
```
retentionRatePct = activePatients / (activePatients + lapsedPatients) × 100
```

### Traffic light thresholds

| Metric | 🟢 Green | 🟡 Amber | 🔴 Red |
|---|---|---|---|
| Lead-to-treatment % | ≥ 18 | 12–17.9 | < 12 |
| Net margin % | ≥ 18 | 12–17.9 | < 12 |
| Chair utilisation % | ≥ 85 | 70–84.9 | < 70 |
| FTA rate % | ≤ 5 | 5.1–8 | > 8 |
| Recall compliance % | ≥ 80 | 65–79.9 | < 65 |
| Patient retention % | ≥ 80 | 65–79.9 | < 65 |

---

## 6. CAGR (Compound Annual Growth Rate)

For projecting profit growth required to hit targets:
```
cagr = (endValue / startValue) ^ (1 / years) - 1
     × 100  // express as %
```

Example: To go from £459k to £918k in 3 years requires:
```
cagr = (918,000 / 459,000) ^ (1/3) - 1 = 0.2599 = 25.99% per year
```

---

## 7. Patient Lifetime Value (LTV)

```
lifetimeRevenue = averageAnnualSpend × averageRetentionYears
lifetimeProfit = lifetimeRevenue × (netMarginPct / 100)
ltv = lifetimeProfit  (stored as pence)
```

UK dental typical inputs:
- Average annual spend: £400 (NHS), £850 (private)
- Average retention: 7 years
- Net margin: 15%

Example private patient LTV:
```
850 × 7 × 0.15 = £892
```

### 7a. LTV from the Business Health baseline (`ltvFromBaseline`)

Derives the three `calculateLTV` inputs from the saved baseline instead of
assuming them, so LTV (and LTV:CAC on the Valuation / marketing screens) is
grounded in the org's own numbers. Baseline `revenue`/`profit` are stored in
**whole pounds**, so they are scaled to pence.

```
averageAnnualSpendPence = (baseline.revenue × 100) / baseline.active_patients
averageRetentionYears   = baseline.active_patients / (baseline.new_per_month × 12)
netMarginPct            = (baseline.profit / baseline.revenue) × 100
ltv = calculateLTV(...)   (pence)
```

`averageRetentionYears` uses Little's law: at steady state, mean tenure =
patient stock ÷ annual inflow. Returns `0` when `active_patients`,
`new_per_month` or `revenue` are missing/zero (callers then hide LTV:CAC).

LTV:CAC ratio (acquisition quality, used on Valuation): `ltv_pence / cac_pence`,
where `cac_pence = ad_spend / new_patients`. Healthy benchmark ≥ 3.

---

## 8. Marketing ROI

```
costPerLead = adSpend / leads
costPerTreatment = adSpend / treatmentsConverted
ROAS = totalRevenue / adSpend     (return on ad spend, expressed as multiple)
conversionPct = treatments / leads × 100
```

Benchmarks:
- Good CPL UK dental: £30–80 (general), £100–200 (implants)
- Target ROAS: 5× minimum, 10×+ excellent

---

## 9. Progress Tracker

Per metric:
```
if better === 'higher':
    progressPct = (current - baseline) / (target - baseline) × 100
else (better === 'lower'):
    progressPct = (baseline - current) / (baseline - target) × 100

Clamp: max(0, min(100, progressPct))

deltaFromBaselinePct = (current - baseline) / baseline × 100
remainingToTarget = target - current
```

---

## 10. Implied scenarios (Scenario Planner)

User changes one input → recalculate everything downstream:

```
If conversion improves from 11.5% → 15%:
    new_treatments_per_month = leads_per_month × 0.15 = 380 × 0.15 = 57
    delta_treatments = 57 - 44 = 13 extra/month
    delta_revenue_pa = 13 × 12 × averageCaseValue
                     = 13 × 12 × 2,850
                     = £444,600/year
    delta_profit_pa = delta_revenue_pa × marginPct/100
                    = 444,600 × 0.10  (incremental margin)
                    = £44,460/year
```

**Note**: Incremental margin used here is lower than net margin because variable costs (associate pay, lab, materials) scale with revenue. Default to 50% incremental margin (revenue minus variable costs) unless overridden.

---

## Chair utilisation (manual)

Per (weekday, slot) cell, summed across all chairs of the selected practice:

    bookedMin    = Σ booked_minutes
    availableMin = Σ available_minutes
    utilPct      = availableMin > 0 ? min(100, round(100 * bookedMin / availableMin)) : null  (null = no capacity)

KPIs: `avgUtilPct` = mean of non-null cell %s; `peakSlot`/`lowestSlot` = max/min non-null cells;
`idleChairHours` = Σ max(0, availableMin − bookedMin) / 60, rounded to 1dp.
Source of truth: `backend/src/lib/chair-utilisation.js` (`aggregateGrid`), unit-tested in
`backend/test/chair-utilisation.test.mjs`.

## Audit trail

Every calculation result that's saved to the database (e.g., pay run net amounts, valuations) is logged in `audit_log` with:
- The formula inputs
- The formula version
- Who triggered it
- When

This means Shishir can always recreate any historical calculation.

## Unit tests

All formulas have unit tests in `backend/src/lib/__tests__/formulas.test.ts`. Run with:

```bash
cd backend && npm test
```

Required coverage: 100% for `formulas.ts`. No exceptions.
