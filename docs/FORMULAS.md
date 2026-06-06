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

**Honesty flag (`dentistStaffSeparable`):** Xero books associate pay inside the
`staff`/`overhead` buckets, so actuals carry **no** `associates` bucket (it is 0 —
see §1a). When `associates = 0` the Dentist row shows 0% (a false "Lean") and Staff
is inflated. `calculateProfitBenchmark` sets `dentistStaffSeparable = false` so the
UI combines/annotates the two lines instead of reading the green dentist row as a
real saving. It is `true` only when a real `associates` figure exists.

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
