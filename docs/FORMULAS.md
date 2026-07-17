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
`revenue, associates, staff, lab, materials, overhead, tax, other`.

The sync heuristic (`heuristicBucket` in `xero-sync.js` / `quickbooks-sync.js`)
splits **fee-earning clinician pay** into `associates` — account names matching
`associate|locum|principal|hygien|therapist|self-employed|dentist` are tested
**before** the staff line (so "Associate salary" / "Principal salary" don't fold
into support staff). When the org's chart of accounts doesn't name clinicians
separately, `associates` stays 0 and the Dentist line reads 0% (see the honesty
flag in §1b). Per-org `xero_account_map` overrides can force any account → `associates`.

**Precedence (per period + bucket):** synced accounting actuals
(`source = xero|quickbooks`) **override** manual entries (`source = manual`).
Manual is the fallback when no synced row exists for that period+bucket.
(`bucketsByPeriod` in `services/monthlyFinancial.service.js`.)

### 1a-i. Dual accounting basis (QuickBooks parity — migration 000089)

`monthly_financials.accounting_method` is `'accrual'` (default, and the value
for all pre-existing rows) or `'cash'`. The column drives cost-bucket resolution
at read time inside `bucketsByPeriod` → `_actualsBundle` → `financeSeries`:

- **Accrual basis** (default): includes all rows with `accounting_method =
  'accrual'` **plus** rows where the column is NULL (manual and Xero rows
  predate the column and are inherently accrual — treated as accrual). This is
  the traditional P&L view matching Xero and manual-entry data.
- **Cash basis**: surfaces **only** rows with `accounting_method = 'cash'`.
  These come exclusively from the QuickBooks Cash-basis ProfitAndLoss report
  pull. No manual or Xero rows appear in this view.

The QuickBooks sync pulls **both** the Accrual and Cash ProfitAndLoss reports
for each period and persists two distinct sets of `monthly_financials` rows,
each stamped with the corresponding `accounting_method`. Callers select the
basis via the `accounting_method` query parameter on `finance-series`
(default: `accrual`). The `pl` annual sum and `dashboard-summary` cost/profit
paths also respect the selected basis when QuickBooks rows are present.

**Bucket → `calculatePL` cost lines** (`plInputFromBuckets`):
```
revenue          = bucket.revenue
costs.associates = bucket.associates   (clinician pay split by the sync heuristic)
costs.staff      = bucket.staff
costs.lab        = bucket.lab
costs.materials  = bucket.materials
costs.other      = bucket.overhead + bucket.other
costs.property   = costs.marketing = 0   (no dedicated actuals bucket; sit in overhead)
tax → EXCLUDED from operating costs (below the operating line; the baseline
      P&L has no tax cost line, so excluding it keeps actuals comparable)
```
`property`/`marketing` have no separate actuals bucket — those sit inside
`overhead`. `finance-series` groups the buckets as `{ associatePay:associates,
staffCosts:staff, labMaterials:lab+materials, opex:overhead+other }`
(`financeSeriesRowFromBuckets`).

Annual P&L (`pl`) sums the trailing ≤12 entered periods.

**Command-Centre `dashboard-summary` (period-sliced costs/profit):** `period` is
`YYYY-MM`, so actuals are fully sliceable. For a custom [from,to] range (the
MTD/QTD/6M/YTD chips all send concrete dates) the dashboard sums the bucket
actuals for **only the periods the window covers** (`sumBucketsInWindow`,
month-inclusive on both ends) before `calculatePL`; with no range it uses the
trailing-12 annual sum. Costs are org-level (`monthly_financials.practice_id` is
NULL), so a **practice-scoped** ranged request with no per-practice cost split
still yields 0 costs/profit. (Earlier the summary forced costs/profit to 0 for
*any* ranged request — net profit was structurally 0 on the dashboard.)

### 1b. Profit Benchmarking — `calculateProfitBenchmark`

The actual cost/profit ratios of a P&L against the **UK dental group benchmarks**.
These five constants are GROUP-wide (not per-org — per-org overrides are a tracked
TODO). Shishir to confirm before launch.

```
PROFIT_BENCHMARKS  (% of revenue)
  Dentist / associate ... 45
  Support staff ......... 18
  Lab + material ........ 15
  Other fixed costs ..... 12
  Profit (floor) ........ 10
                          ─────
                          100
```

calculatePL cost lines → the five benchmark categories:
```
dentist     = costs.associates
staff       = costs.staff
labMaterial = costs.lab + costs.materials
otherFixed  = costs.property + costs.marketing + costs.other
profit      = netProfit                      (a target floor, not a cost)
```

Per category: `variancePts = actualPct − benchmarkPct`.
- Cost line: **under** benchmark is good ("Lean"); over is "Overspending".
- Profit: **over** the 10% floor is good ("Above target"); under is "Below target".
- A `|variance| ≤ 1pt` dead band reads "On benchmark" (severity neutral).

`overspendPence` = Σ (cost lines above their benchmark) — the recoverable margin
("move a line to benchmark, it drops to the bottom line"). Profit is excluded.

**Honesty flag (`dentistStaffSeparable`):** when the org's chart of accounts does
NOT name clinicians separately, the sync heuristic can't split them, so `associates`
stays 0 — the Dentist row shows 0% (a false "Lean") and Staff is inflated. In that
case `calculateProfitBenchmark` sets `dentistStaffSeparable = false` so the UI
combines/annotates the two lines instead of reading the green dentist row as a real
saving. It is `true` once a real `associates` figure exists (the heuristic matched
named clinician accounts, or an account was mapped to `associates`).

**Real data or zero:** `plBenchmark` uses `monthly_financials` actuals only — never
the baseline projection (it is a Finance screen, §1a). No actuals / no cost source ⇒
`costsAvailable:false`, no rows.

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

### 2a. Real-turnover valuation seed (`valuationFromTurnover`)

Source: `backend/src/lib/formulas.js` (`valuationFromTurnover`). Used by
`analyticsService.valuation()` when **no manual `business_health` baseline** is set,
so the Exit Plan / Value & Growth screens reflect real synced data instead of
returning "No baseline set" (£0). Dentally carries **revenue but no cost side**, so
EBITDA is an **assumed margin** on the real trailing-12-month invoiced turnover
(`invoice_items`, the same accrual turnover feed as the dashboards). The private
share is derived from `nhs_charge` and drives the §2 multiple tier.

```
annualRevenue = Σ invoice_items.fee_pence over the trailing 12 months
privateRevenuePct = privateTurnover / totalTurnover × 100   (nhs_charge = false ⇒ private)
ebitda   = annualRevenue × ebitdaMarginPct / 100            [default 18%, owner-adjustable]
valuation = calculateValuation({ annualRevenue, ebitda, privateRevenuePct })   [§2 multiples]
midPoint  = (principalLed + dso) / 2                         [primary group value]

revenueMultipleValuePence = annualRevenue × revenueMultiple  [default 1.15×, cross-check only]
```

Precedence in `valuation()`: **manual baseline** → **real-turnover seed** → `{ error: 'No baseline set' }`.
The EBITDA-margin valuation is the primary figure; the revenue-multiple line is a
sanity cross-check shown beside it.

**Accountant action**: Confirm the default **18% EBITDA margin** and **1.15× revenue
multiple** for the group mix; both are owner-adjustable on the Exit Plan screen.

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

### Business Hub — Treatments Closed & Plan Fees Collected (Dentally `invoice_items`)

Per-practice plan-treatment money, from real invoiced fees (`treatments_closed_revenue_by_practice`, migrations 000074 + **000101**). A "plan line" = an `invoice_items` row with `treatment_plan_id NOT NULL`, windowed by `invoiced_on`, grouped by `practice_id`.

```
# Treatments Closed (billed / sold)
closedPence = Σ fee_pence                         # all plan lines in window

# Plan Fees Collected (amount actually collected) — migration 000101
# Allocate each invoice's settled portion pro-rata across its lines by value,
# then sum the plan lines' share. Counts PARTIAL payments — matches Dentally's
# collected basis (Invoice Timeline "Paid" / Patient Accounts), NOT the old
# all-or-nothing invoice_paid flag.
collectedRatio(invoice) = clamp01( (amount_pence − amount_outstanding_pence) / amount_pence )
paidPence   = Σ ( fee_pence × collectedRatio(parent invoice) )   over plan lines
% collected = paidPence / closedPence
```

Why it changed: the old `paid = Σ fee_pence WHERE invoice_paid IS TRUE` excluded a whole invoice the moment any balance remained (a £11,900 invoice with £27.80 outstanding counted £0), understating collected (live Ashford Jun 2026: 69% → real 96%). The gap `closed − paid` is real outstanding treatment debtors.

### Live scorecard actuals (Dentally-sourced, migration 000056)

The KPI Scorecard resolves these "hybrid" metrics from the synced Dentally
tables when data exists, otherwise falls back to the owner's manual entry
(`health_patient_actuals` / `health_production_actuals` RPCs; `chair_utilisation`
grid; `leads` for response time). A 12-month trailing window unless noted.

```
# Patient (from appointments + contacts) — health_patient_actuals
newPatientsPerMonth = count(patients whose FIRST appointment is in last 12mo) / 12
                      # registration date is not synced; first-ever visit is the proxy
activePatients      = count(distinct patients with an appointment in last 12mo)
retention12moPct    = count(patients active in prior year [24–12mo ago]
                            who are ALSO active in last 12mo)
                      / count(patients active in prior year) × 100   # null if no prior cohort
recallCompliancePct = count(patients due [next_recall_date ≤ today]
                            with an appointment on/after that date)
                      / count(patients due) × 100   # null when recall dates not synced → manual

# Production (from invoice_items real fees) — health_production_actuals
avgCaseValuePence            = avg( Σ fee_pence per treatment_plan_id )  # a case = one plan
productionPerAssociatePence  = Σ fee_pence (window)
                               / count(distinct producing associate_id)
                               / monthsInWindow

# Chair utilisation (owner-maintained grid)
chairUtilisationPct = Σ booked_minutes / Σ available_minutes × 100   # null if no available minutes

# Lead response (CRM/GHL)
leadResponseMins = avg(leads.last_response_minutes) over leads created in window
                   # null until GHL conversations populate it → manual
```

All money stays integer pence; a null actual is honest "no source" and never
fabricated — the metric stays manual/needs-input.

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
costPerLead = adSpend / (crmAttributedLeads || platformConversions)
costPerTreatment = adSpend / treatmentsConverted
ROAS = totalRevenue / adSpend     (return on ad spend, expressed as multiple)
conversionPct = treatments / leads × 100
```

**CPL denominator (`/marketing/roi`):** preferred denominator is CRM leads
attributed to an ad provider (`attributeProvider` matches `utm_source/medium/source`
against `/google|adwords/` and `/facebook|meta|instagram|fb|ig/`). GHL-synced leads
carry `source='gohighlevel'` with **no UTM**, so they attribute to nothing and
`adLeads` collapses to 0 — which made CPL structurally 0. Fallback: the ad
platforms' own `conversions` counts (`ad_metrics.conversions`, the same source the
Business Hub leads roll-up uses). `leads_from_ads` in the response is this proxy;
`crm_attributed_leads` carries the raw CRM-matched count.

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

## 11. Chair economics (Intelligence OS — Chair Efficiency view)

Source: `backend/src/lib/formulas.js` (`calculateChairStats`, `calculateOcpspd`,
`profitPerChairHour`, `chairRecovery`); tested in `backend/test/formulas-chair.test.mjs`.
All money is integer pence; all hour figures are annual.

**Group operating standards** (`CHAIR_CONFIG` code defaults — per-org overrides
now persisted in the `chair_config` table, Phase 3 / T12; `GET /chair` overlays
the saved row over these defaults):

    openHrs = 8         (surgery open hours/day)
    weeksYr = 46,  daysWk = 5   ->  workDaysYr = 230
    benchOccPct = 88            (industry benchmark occupancy)
    benchRevHrPence = 30,000    (£300 revenue per chair-hour ceiling)

**calculateChairStats** — `{ chairs, utilPct, annualRevenuePence, config? }`:

    capHrsYr            = chairs * openHrs * workDaysYr
    bookedHrsYr         = capHrsYr * utilPct/100
    emptyHrsYr          = capHrsYr - bookedHrsYr
    revPerBookedHrPence = annualRevenuePence / bookedHrsYr        (entity's own yield)
    revPotentialYrPence = capHrsYr * benchRevHrPence              (ceiling at £300/hr)
    lostPotentialYrPence= emptyHrsYr * benchRevHrPence            (cost of empty chairs)
    recoverableToBenchHrsYr = max(0, capHrsYr * (benchOccPct - utilPct)/100)
    recoverRevYrPence   = recoverableToBenchHrsYr * revPerBookedHrPence  (conservative: own yield, not ceiling)
    surgeryDaysYr       = chairs * workDaysYr
    occVariancePct      = utilPct - benchOccPct

Guards: 0 chairs -> all-zero (no division by zero); util >= benchmark -> recoverable clamps to 0.

**calculateOcpspd** (operating cost per surgery per day/hour) — `{ annualOpexPence, surgeryDaysYr, config? }`.
`annualOpexPence` = fixed run cost (staff + premises + admin), EXCLUDING clinician pay, lab, marketing:

    perDayPence = annualOpexPence / surgeryDaysYr
    perHrPence  = perDayPence / openHrs        (0 surgery-days -> 0)

**profitPerChairHour** — booking-priority ranking. Each treatment row
`{ minutes, units, revenuePence, profitPence }`:

    chairHrs        = minutes * units / 60
    profitPerHrPence= profitPence / chairHrs
    (rows sorted by profitPerHrPence desc; zero-unit/zero-minute rows dropped)
    blendedProfitPerHrPence = Σ profit / Σ chairHrs

**chairRecovery** — `{ capHrsYr, upliftPctPoints, revPerBookedHrPence, currentOccupancyPct }`:

    recoveryHrsYr        = capHrsYr * upliftPctPoints/100
    revenueUnlockedPence = recoveryHrsYr * revPerBookedHrPence   (own yield, a floor not a ceiling)
    newOccupancyPct      = min(100, currentOccupancyPct + upliftPctPoints)

## 12. Treatment Economics Workbench (Intelligence OS — Treatment Profitability)

Source: `backend/src/lib/formulas.js` (`computeServiceEconomics`, `DEFAULT_SERVICE_MODELS`);
tested in `backend/test/formulas-workbench.test.mjs`. Pure function, integer pence —
the live workbench posts a model and gets these figures back (server-authoritative,
no client formula duplication). Model fields are all pence except the `*Pct` ratios.

    marketing            = price * marketingPct/100
    labProfit            = labBill * labMarginPct/100
    compRetail/compCost  = Σ retail*qty / Σ cost*qty ;  compProfit = compRetail - compCost
    directTreatmentCost  = compCost + labBill
    grossBeforeDentist   = max(price - cbct - directTreatmentCost, 0)
    dentistGross         = dentistPct/100 * grossBeforeDentist
    practiceProfit       = grossBeforeDentist - dentistGross - marketing - utilities - surgeryRunCost
    groupProfit          = practiceProfit + compProfit + labProfit + cbct      (net profit / case)
    marginPct            = groupProfit / price * 100

Target-price solver (price that yields targetMarginPct on the practice contribution):

    contributionSlope    = (grossBeforeDentist - dentistGross) / price
    fixedBase            = -(cbct + directTreatmentCost + utilities + surgeryRunCost) + compProfit + labProfit + cbct
    targetPrice          = contributionSlope > targetMarginFrac ? -fixedBase/(contributionSlope - targetMarginFrac) : 0

  NB targetPrice = 0 when the contribution slope is below the target margin (unreachable by
  price alone — the in-house add-backs are what lift the GROUP margin above the slope).

    maxAdAt20            = groupProfit + marketing - 0.2*price   (most ad/case holding 20% CAC)
    monthlyCases         = surgeries * casesPerSurgery
    patients             = unit=='implant' ? monthlyCases/implantsPerPatient : monthlyCases
    cac                  = marketing * (unit=='implant' ? implantsPerPatient : 1)
    monthly/annualProfit = monthlyCases * groupProfit (×12)

Profit planning — who completes the work:

    associateProfit  = groupProfit                  (clinician paid their % out of gross)
    principalProfit  = groupProfit + dentistGross    (group retains the clinician margin)
    principalUplift  = dentistGross

`DEFAULT_SERVICE_MODELS` (fullarch/implant/invisalign) are documented seed defaults;
owner edits live client-side and post to the compute endpoint. Persisted overrides are a
later slice.

**Real case-fee auto-fill** (`classifyCaseFees`, tested in `formulas-workbench.test.mjs`):
the workbench `pricePence` (CASE FEE) is auto-populated from real Dentally invoices, not
the seed default, when data exists. A dental case is billed across MANY invoice line items
(an implant = placement + abutment + crown), so the honest case fee is the **mean INVOICE
total** for invoices that contain the procedure — not a single line:

    caseFee[category] = mean( invoice.total_pence ) over invoices whose item names match
                        TREATMENT_CASE_RULES[category].match and not .not
    rules: fullarch  = /all-on | full arch | arch surgery | hybrid bridge/
           implant   = /implant/  excluding /consult|review|x-ray|radiograph|assess|planning|scan/
           invisalign= /invisalign | clear aligner/  excluding /review/

  null per category when no matching invoices ⇒ the workbench keeps the seed default for it.
  This is the patient FEE only; lab/CBCT/component COST is never in the Dentally feed and
  stays owner-entered. Source: invoice_items (Dentally `/invoice_items` pull) →
  `invoice_case_rollup` RPC → `classifyCaseFees` → `GET /api/analytics/treatment-fee-benchmarks`.

## 13. Group Valuation — driver-based 3-buyer engine (Intelligence OS — Value & Growth)

Source: `backend/src/lib/formulas.js` (`computeGroupValuation`, `valuationGrowthAdjust`,
`valueUpliftLevers`, `planExitTrajectory`); tested in
`backend/test/formulas-valuation.test.mjs`. Pure functions, integer pence — the live
Value & Growth screen posts the driver state (debounced) and gets these back
(server-authoritative, no client formula duplication).

**Versioning note (important for the accountant).** This is a *new* engine that sits
alongside the legacy `calculateValuation` (§2). The legacy function is **left untouched**
so its only caller — `GET /api/analytics/valuation` — keeps producing identical numbers.
The two differ on EBITDA treatment **by design**:

- §2 (legacy) fabricates EBITDA from the Business Health baseline as `profit + revenue*4%`
  (a flat D&A/interest add-back) and applies fixed per-classification multiples.
- §13 (this engine) takes a **reported EBITDA** (TTM, from the P&L) and applies the owner's
  **explicit** add-backs and a notional principal salary — no fabricated add-back. Multiples
  and the region factor are owner-adjustable and passed in resolved (the classification /
  region / DSO-tier lookup tables are UI config, not part of the formula).

Money inputs are pence; multiples and `regionFactor` are plain numbers.

    growthAdjust       = 1 + clamp((growthRatePct - 10) / 50, -0.15, +0.20)   (10% YoY = neutral)
    principalNetProfit = reportedEbitda + addBacks                       (ANP — Principal-led basis)
    associateEbitda    = reportedEbitda + addBacks + principalSalary     (Adjusted — Assoc/DSO basis)
    principalValuation = principalNetProfit * principalMultiple * regionFactor
    associateValuation = associateEbitda   * associateMultiple * regionFactor
    dsoValuation       = associateEbitda   * dsoMultiple * regionFactor * growthAdjust
    midpoint           = (associateValuation + principalValuation) / 2   (most likely sale price)
    strategic          = dsoValuation * 1.10                              (DSO + earn-out / platform uplift)

`valueUpliftLevers` ranks (desc) the £ added to a headline figure if the owner pulls each
lever today, derived from the computed result + the resolved multiples
(`avgMultiple = (principal+associate+dso)/3`):

    growth → 15%          = dsoValuation * 0.10
    cut lab (+£50k EBITDA) = 5,000,000 * avgMultiple
    +£30k add-backs       = 3,000,000 * avgMultiple
    add second site       = dsoValuation * 0.15
    shift to private      = 0.5 * associateEbitda
    +£100k recurring @35%  = 3,500,000 * avgMultiple

`planExitTrajectory` (Sale Planner) models a target exit. `baselinePence` is today's midpoint
(passed in from the result, not recomputed). The per-year advisory `focus` copy is **not** a
formula — it is UI text computed client-side from these numbers.

    projected     = (buyer=='principal' ? futureEbitda - principalSalary : futureEbitda)
                    * futureMultiple * (buyer=='dso' && totalSites>=10 ? 1.10 : 1)
    gap           = max(0, targetValue - baseline)
    cagrNeeded    = (targetValue / baseline)^(1/targetYears) - 1
    ebitdaNeeded  = targetValue / futureMultiple
    ebitdaMargin  = futureEbitda / futureRevenue          (current = reportedEbitda / ttmRevenue)
    revenueGrowth = futureRevenue / ttmRevenue - 1
    years[i]      = linear interp now→exit of revenue, EBITDA, sites; margin + implied value per year

## 14. Cash Runway (Intelligence OS — Cashflow & Runway)

Source: `backend/src/lib/formulas.js` (`calculateRunway`); tested in
`backend/test/formulas-runway.test.mjs`. Pure function, integer pence. Surfaced on
`GET /api/analytics/cashflow` as a `runway` block alongside the real backward
13-week receipts view (§4).

**Inputs are real, not projected.** `cashOnHand` = the current bank balance
(open-banking summary). `monthlyReceipts` = the window's settled receipts annualised
to a monthly rate (`totalReceipts × 52 / (weeks × 12)`). `monthlyCosts` = the P&L cost
base per month — `monthly_financials` actuals (`totalCosts / periodsCovered`) when
present, else the org Business Health baseline cost-% applied to baseline revenue ÷ 12.
`costsAvailable=false` (`costsBasis:'none'`) when there is no cost source — the UI then
says so rather than implying a runway.

    monthlyNet   = monthlyReceipts - monthlyCosts
    cashPositive = monthlyNet >= 0
    monthlyBurn  = cashPositive ? 0 : -monthlyNet
    runwayMonths = cashPositive ? null : freeCash / monthlyBurn      (null = no finite runway)
    status       = runwayMonths < 3 -> critical ; < 6 -> warning ; else healthy

**No bills-to-plan.** There is no payables / scheduled-bill source, so `billsToPlanPence`
is `null` and the burn is the P&L cost base — never fabricated future bills. (When a
payables feed exists, bills-to-plan becomes a real line and runway can net committed
outflows.)

## 15. Cashflow Outlook — tax bills + free-cash decision (Intelligence OS)

Source: `backend/src/lib/formulas.js` (`estimateCorporationTax`, `freeCashDecision`);
tested in `backend/test/formulas-runway.test.mjs`. Powers `GET /api/analytics/cashflow-outlook`
(the month-by-month cash-in-vs-out trail, "will I run out?" projection, bills-to-plan,
and free-cash decision). Integer pence.

**Corporation Tax (UK FY2024/25) — a planning ESTIMATE.** Assumes no reliefs,
allowances, group or associated-company adjustments; the accountant's figure is
authoritative. Applied to an annualised profit (real, from `monthly_financials`; else
baseline-derived; else not shown).

    profit <= £50,000    -> 19%                                   (small profits rate)
    profit >= £250,000   -> 25%                                   (main rate)
    in between           -> profit*25% - (£250,000 - profit) * 3/200   (marginal relief)

VAT is **not** estimated — UK dental treatment income is largely VAT-exempt — and there
is no payables/scheduled-bill feed, so committed bills (VAT, PAYE, supplier invoices)
are surfaced as a gap, never fabricated.

**Free-cash decision.** Buffer = `bufferWeeks` of monthly outgoings; cash is only "free"
once the LOWEST projected closing balance still clears that buffer.

    buffer       = monthlyCosts * (12/52) * bufferWeeks          (default 2 weeks)
    freeCash     = max(0, cashOnHand - buffer)
    sweepable    = lowestProjected >= buffer ? max(0, lowestProjected - buffer) : 0
    action       = !lowClearsBuffer ? build_buffer : sweepable>0 ? sweep : hold

Outlook honesty: IN = real settled receipts/month; OUT = P&L cost base/month (accrual
proxy, flagged; 0 when no source); forward months are run-rate PROJECTIONS; closing
balances are anchored to today's real bank balance (current month closes there, earlier
months reconstructed, later months projected).

## 16. Persisted config & editable P&L sheets (Phase 3 — T12/T13)

Source: `analytics.service` (`getValuationInputs`/`saveValuationInputs`,
`getChairConfig`/`saveChairConfig`, `pl_sheets` CRUD + `plSheetToCsv`); tables
`valuation_inputs`, `chair_config`, `pl_sheets`; tested in
`backend/test/analytics-config.test.mjs`. All money integer pence.

**These are persistence, not new arithmetic.** The formulas are unchanged:
- `valuation_inputs` stores the **driver state** that `POST /compute/valuation`
  already consumes (§13). Saving then loading round-trips the same numbers into
  the same engine — no formula change, just persistence + an `updated_by` audit.
- `chair_config` stores per-org overrides of the §11 `CHAIR_CONFIG` constants.
  `GET /chair` overlays the saved row over the code defaults before running
  `calculateChairStats`; an unset org behaves exactly as before (defaults).

**Documented config constants (accountant sign-off):**

    valuation drivers   reportedEbitdaPence (from the P&L, TTM), addBacksPence,
                        principalSalaryPence, principalMultiple/associateMultiple/
                        dsoMultiple, regionFactor (0.5–2), growthRatePct (default 10)
    chair config        openHrs 8, weeksYr 46, daysWk 5, benchOccPct 88,
                        benchRevHrPence 30,000  (== §11 CHAIR_CONFIG defaults)

**P&L sheets precedence (TODO1 — resolved, scenario overlay):**

`pl_sheets` are **editable scenario / budget / forecast grids** stored as
`cols`/`lines`/`cells` JSONB (cells map `"<lineId>:<colId>" → pence`, negatives
allowed for cost/contra lines). They are a **standalone planning artifact**:

- They **DO NOT** override the real actuals P&L. `pl` and `pl-margin` stay
  Xero > monthly_financials-manual > zero (§1a). A finance screen never shows a
  hand-typed sheet number as if it were a real actual.
- They **DO NOT** feed EBITDA or the valuation (§13 EBITDA still comes only from
  the real P&L). No re-sync revert/stick problem because there is no feedback
  loop into actuals at all.
- CSV export (`plSheetToCsv`) renders lines × columns with £ to 2dp from the
  integer-pence cells (NOT localStorage — Postgres-backed, org-scoped, RLS).

This keeps the "finance screen = real actuals or honest empty, never fabricated"
guarantee while still giving the owner an editable what-if spreadsheet beside it.

## 17. Profit vs Breakeven (Daily Command Cockpit — §6)

Source: `backend/src/lib/formulas.js` (`calculateBreakeven`); tested in
`backend/test/formulas-breakeven.test.mjs`. Pure function, integer pence.
Surfaced on `GET /api/cockpit` as the `breakeven` block. Inputs are manual,
per-practice and historised in `practice_cost_model` (migration `…000113`), read
as-of the window's start.

    breakevenMid       = (breakevenLow + breakevenHigh) / 2
    contributionMargin = fixed / breakevenMid                 (NOT 1 - fixed/breakevenMid)
    fixedDay           = fixed / workingDaysPerMonth
    breakevenDay       = fixedDay / contributionMargin        ( === breakevenMid / workingDaysPerMonth )
    contribution       = revenue x contributionMargin
    fixedForWindow     = fixedDay x workingDaysInWindow
    profit             = contribution - fixedForWindow
    status             = profit >= 0 -> above ; else below ; no usable model -> not_set

**The margin is fixed/breakeven, not 1 − fixed/breakeven.** At breakeven, revenue
covers fixed + variable costs, so `variable/revenue = 1 − fixed/breakeven`. That
quantity is the **variable-cost ratio**; the contribution margin is what remains,
`fixed/breakeven`. With £31,000/mo fixed and an £81–86k/mo breakeven the two are
62.9% and 37.1% respectively. The source mockup specified the former as the
margin. Building it as specified reports a five-practice group £2,125/day in
profit on a day it actually lost £1,925 — £4,050/day adrift — and flips three of
five practices from below to above breakeven.

**The identity is the check.** `breakevenDay` must reduce to
`breakevenMid / workingDays`, because `fixedDay/margin = (fixed/wd)/(fixed/mid) =
mid/wd`. With the correct margin, £1,550/0.371 = £4,175 = £83,500/20 ✓. With the
mockup's, £1,550/0.629 = £2,464, implying a £49,280/mo breakeven — contradicting
the £81–86k/mo the same document states.

**Nulls, not zeros.** Without a usable model (`fixed <= 0`, `breakevenMid <= 0`,
`workingDays <= 0`, or `fixed > breakevenMid`) every derived figure is `null` and
status is `not_set`. A practice with no cost model has not earned £0 — we cannot
say. It is excluded from the group row rather than dragging it down with a
fiction.

**Working days are days actually traded**, counted from the practice's cash-up
rows in the window, not calendar weekdays. A day with no cash-up contributes
neither revenue nor fixed cost, so a practice that failed to key a cash-up shows
a shorter window rather than a phantom loss.

**No fixed/variable split from the P&L.** `emergent_monthly_pl` carries monthly
actuals with no fixed/variable tagging, so the margin cannot yet be derived from
real costs — it comes from the manual breakeven-revenue input. Once a tagged P&L
exists, replace the assumed margin with the real one.

---

## Revenue Leakage — `calculateRevenueLeakage(input, rates)`

"Money left on the table" over a window. Five recoverable pools, integer pence
in / integer pence out (annualisation is the caller's job — it knows the window
length). Each pool is scaled by a recoverable rate (0-100, clamped) — the share
realistically clawed back. Defaults: `{ plans:30, fta:50, recall:60, lapsed:40, collect:70 }`.

- **plans** = `max(0, presentedPlanPence − acceptedPlanPence) × rate.plans` — unaccepted treatment-plan value (real `treatment_plans` private production, presented vs completed).
- **fta** = `revenuePence × (noShows / appointments) × rate.fta` — lost chair time from no-shows (real appointment rollup).
- **recall** = `revenuePence × hygieneShare(0.12) × 0.25 × rate.recall` — unbooked hygiene recalls (modelled share until patient-level cohorts wired).
- **lapsed** = `revenuePence × lapsedShare(0.06) × rate.lapsed` — reactivation opportunity (modelled share).
- **collect** = `max(0, revenuePence − cashCollectedPence) × rate.collect` — uncollected/open balances (settled turnover vs banked receipts).

`windowTotalPence` = sum of the five pools. Pools never go negative (accepted>presented or over-collection floor to 0). The service annualises by `× 365 / windowDays` and attaches per-line label/owner metadata. Tests: `backend/test/formulas-leakage.test.mjs` (7 cases).

## M&A Acquisition Modeller — `calculateAcquisition(input)`

Buy-side deal appraisal (DentaCFO gap Phase 3): model a practice you're considering **buying**, scored against UK dental M&A benchmarks. Pure compute, integer pence in/out, percentages/multiples as plain numbers. Ports the GM demo's `mnaCalc`. Inputs: `targetRevenuePence`, `marginPct`, `multiple` (EV/EBITDA), `growthPct`, `horizonYears` (≥1), `discountPct`, `leverageMultiple` (default 3.5), optional `askingPricePence`.

- **EBITDA** = `targetRevenuePence × marginPct/100`.
- **EV** (enterprise value) = `EBITDA × multiple`.
- **debtCapacity** = `EBITDA × leverageMultiple` — supportable acquisition debt (UK dental 3-4×).
- **equityRequired** = `max(0, EV − debtCapacity)` — cash in after debt.
- **Cashflow** model: annual cashflow `cf(t) = EBITDA × (1+g)^t`; terminal exit `= EV × (1+g)^H` (exit at the entry multiple), `g = growthPct/100`, `H = round(horizonYears)`.
- **NPV** = `−EV + Σ_{t=1..H} cf(t)/(1+d)^t + terminal/(1+d)^H`, `d = discountPct/100`.
- **IRR** = the rate where NPV=0, via 80-step bisection on `[0, 2]` — `null` when the deal isn't value-positive even at 0% discount.
- **payback** = years of undiscounted cumulative cashflow to recover EV (fractional, linear within the crossing year); `null` if not recovered within 80 yrs.
- **premium** (only when `askingPricePence` supplied) = `askingPrice − EV` and `% of EV`.

**Red flags** (`flags:[{key,severity,message}]`): negative NPV; IRR null or below the discount hurdle; payback null or >6 yrs; multiple >10×; leverage >4×; margin <12%; asking price >10% above EV. Benchmarks exported as `ACQUISITION_BENCHMARKS`. Tests: `backend/test/formulas-acquisition.test.mjs` (9 cases).

## Exit Plan — personal wealth (DentaCFO gap Phase 4, REBUILT)

The owner's **personal** exit (distinct from the business Sale Planner, `planExitTrajectory`). The canonical model is `calculateExitPlan` — a faithful pence port of the GM demo's `exitCalc` (`preview/GM-Group-Intelligence-OS_2.html`). The older `calculateSaleWaterfall` / `calculateFirePlan` are retained for the back-compat `/compute/{sale-waterfall,fire}` routes but are no longer what the Exit Plan screen runs.

### `calculateExitPlan(input)` — the canonical personal endgame

Six steps, all integer pence; ages/percents plain. Inputs: `incomePence` (desired POST-TAX annual income), `people:[{name,share}]`, `currentAge`, `retireAge`, `freeholds:[{name,valuePence,rentPence}]`, `withdrawPct`, `returnPct`, `currentValuePence` (group value today), `agentPct`, `cgtPct`, `baseCostPence`, `existingInvestPence`, `targetSalePence` (0 → reverse-solved), `baseYear`.

1. **Income gross-up** — each person's share of the post-tax income is grossed up under its **own** UK 2025/26 allowance + bands (`grossUpPence` bisection over `ukIncomeTaxPence`: PA £12,570 tapering £1/£2 over £100k; 20% to £50,270, 40% to £125,140, 45% above). Splitting cuts the total `grossRequired`; `taxSaving = singleGross − grossRequired`.
2. **Freehold rent offset** — `portfolioGross = max(0, grossRequired − totalRent)`. The pot only funds what rent doesn't.
3. **The 4% pot** — `potNeeded = portfolioGross / withdrawPct%`.
4. **Reverse-solve the sale** — `requiredNet = max(0, potNeeded − existingInvest)`; `requiredSale = (requiredNet − cgt%×baseCost) / (1 − agent% − cgt%)`; `reqGrowth = (requiredSale/currentValue)^(1/years) − 1`.
5. **Forward waterfall** on `targetSale` (defaults to `requiredSale`): `− agentFee − cgt = netProceeds`; `+ existingInvest = investable`; `gap = potNeeded − investable`; `onTrack = gap ≤ max(£1k, potNeeded×0.3%)`.
6. **30-year drawdown** `projection[t]` — pot grows at `returnPct`, draws `withdrawPct` each year; with return > withdrawal the pot **and** income compound upward (never deplete).

Tax bands exported as `UK_INCOME_TAX`; defaults as `EXIT_PLAN_DEFAULTS`. The service (`wealth.service.exitPlan`) seeds `currentValuePence` from the live valuation midpoint, `existingInvestPence` from liquid (non-business) assets + pension balances, and `freeholds` from buy-to-let / income properties when not entered. Tests: `backend/test/formulas-exit-plan-v2.test.mjs` (12) + `backend/test/wealth.service.test.mjs`.

### `calculateSaleWaterfall(input)` — net cash from a practice sale *(legacy)*

What the owner personally banks after debt, ownership split and UK CGT. Inputs: `enterpriseValuePence`, `businessDebtPence`, `ownerSharePct` (0–100), `acquisitionCostPence` (base cost), `freeholdEquityPence`, `badrLifetimeUsedPence`, plus rate overrides (`badrRatePct`, `cgtHigherRatePct`, `badrLifetimeCapPence`).

- **equity value** = `max(0, EV − businessDebt)` (company debt cleared at completion).
- **owner equity proceeds** = `equityValue × ownerShare%`.
- **chargeable gain** = `max(0, ownerEquityProceeds − acquisitionCost)`.
- **CGT** — Business Asset Disposal Relief on qualifying gains up to the remaining lifetime cap (`£1m − badrLifetimeUsed`) at **18%** (BADR 2026/27), the excess at the **24%** main higher rate. `cgt = badrGain×18% + standardGain×24%`; `effectiveCgtPct = cgt/gain`.
- **net business proceeds** = `ownerEquityProceeds − cgt`; **total net proceeds** = `+ freeholdEquity` (freehold treated as already net of its mortgage/property-tax — a documented simplification, flagged in UI).

Tax constants exported as `UK_TAX` (`badrRatePct:18`, `badrLifetimeCapPence:£1m`, `cgtHigherRatePct:24`) — the single place to re-point when the Budget moves.

### `calculateFirePlan(input)` — FIRE number, progress, path

Does net worth (incl. business sale cash) clear the **FIRE number** (the "4% rule"). Inputs: `liquidAssetsPence` (pensions+ISA+cash+investments, ex-residence), `liabilitiesPence`, `businessNetProceedsPence` (from the waterfall), `targetAnnualSpendPence`, `withdrawalRatePct` (default 4), `growthRatePct` (default 7), `annualSavingsPence`, `horizonYears`.

- **current net worth** = `liquidAssets + businessNetProceeds − liabilities`.
- **FIRE number** = `targetAnnualSpend / (withdrawalRate%)` (4% → 25× spend); **gap** = `max(0, fireNumber − netWorth)`; **progress%** = `netWorth/fireNumber`.
- **sustainable income** = `netWorth × withdrawalRate%` (what 4% of today's pot yields).
- **path** `years[y]` = net worth at year `y` = `netWorth×(1+g)^y + savings × FV-annuity` (savings compound; `g=0` degrades to linear `savings×y`). `hitFire` flags the first crossing.
- **years-to-FIRE** = first `y` (≤ 50) where net worth ≥ FIRE number, else `null`.
- **required annual savings** = the savings that hit the FIRE number by the horizon: `s = (fireNumber − netWorth×(1+g)^H) / annuityFactor`, floored at 0.

Defaults exported as `FIRE_DEFAULTS`. Tests: `backend/test/formulas-exit-plan.test.mjs` (14 cases).

## Attrition & Retention — `calculateRetention(cohorts, opts)` (DentaCFO gap Phase 6)

Patient retention/attrition economics + the recoverable reactivation revenue pool. `cohorts` = integer patient counts `{ active, lapsed, dormant }` (active <12mo since last visit, lapsed 12–24mo, dormant >24mo — bucketed in Postgres by the `patient_retention_by_practice` RPC). `opts` = `{ avgPatientValuePence, reactivationRate }`.

- **known base** = `active + lapsed + dormant` (distinct patients with a real, non-cancelled past visit). Counts are floored to non-negative integers.
- **retention%** = `active / known`; **attrition%** = `(lapsed + dormant) / known` (complement; both one-decimal, 0 when no base).
- **reactivation pool** = `lapsed × avgPatientValue × reactivationRate` (integer pence). **Only lapsed (12–24mo) patients are in the pool** — dormant (>24mo) are treated as largely gone and carry no reactivation value. `reactivatablePatients = round(lapsed × rate)`.
- `reactivationRate` is clamped to `[0,1]` and defaults to `RETENTION_DEFAULTS.reactivationRate` (0.25 — the share of lapsed patients a recall campaign realistically wins back; accountant-repointable).

The service feeds `avgPatientValuePence` = trailing-12mo settled receipts ÷ active patients per practice (org-blended fallback when a practice banked revenue but has no active patients linked). Appointments with neither a CRM contact nor a Dentally patient id are the **linkage data wall** — flagged (`unlinkedAppts`), never counted in a cohort. Tests: `backend/test/formulas-retention.test.mjs` (6 cases) + `backend/test/analytics-retention.test.mjs` (6 service cases).

## Profit vs Breakeven — `calculateBreakeven(input)`

Per-practice contribution-margin breakeven (Daily Command Cockpit — §6, see §17 above for the full derivation). Pure function, integer pence. Inputs: `revenuePence`, `fixedCostPenceMonth`, `breakevenLowPence`, `breakevenHighPence`, `workingDaysPerMonth` (default 20), `workingDaysInWindow`.

- **contribution margin** = `fixed / breakevenMid` — **not** `1 − fixed/breakevenMid` (that quantity is the variable-cost ratio, the source mockup's mistake).
- **profit** = `revenue × margin − (fixed/workingDaysPerMonth) × workingDaysInWindow`; **status** = `above` (profit ≥ 0), `below`, or `not_set` when there's no usable model.
- **Nulls, not zeros**: `fixed <= 0`, `breakevenMid <= 0`, `workingDaysPerMonth <= 0`, or `fixed > breakevenMid` (margin would exceed 100%) all return `not_set` with every money field `null`, never a fabricated `£0`.

Tests: `backend/test/formulas-breakeven.test.mjs` (9 cases).

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
