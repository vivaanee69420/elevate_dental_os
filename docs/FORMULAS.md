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

---

## 4. Cash Flow Forecast (13-week rolling)

For each week:
```
closing_balance = opening_balance + receipts - payments
```

Status flags:
- **Healthy**: closing > 50% of opening
- **Warning**: closing > 0 but < 50% of opening
- **Critical**: closing ≤ 0

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
