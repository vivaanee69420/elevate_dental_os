# Integration Priority

What to build first, in what order, with realistic time estimates.

All integrations are at **zero** right now. None are wired. This document tells you which one unlocks the most value per developer-hour.

---

## Priority order

| # | Integration | Build time | UI value unlocked | Blocks |
|---|---|---|---|---|
| 1 | **Auth + RBAC** | 5 days | All gated pages | Everything |
| 2 | **Xero** (per entity) | 5 days | ~60% of Finance UI · Cash Flow · P&L · Balance Sheet · Valuation | Reconciliation control `cash_received` + `revenue_by_practice` |
| 3 | **Dentally** | 5 days | Dashboard · Patients · Chair · Treatments · UDA · Practice IQ | Reconciliation controls 1-4 |
| 4 | **GoHighLevel** | 4 days | Inbox · Pipeline · CRM Today · Reviews · Call Centre | Reconciliation control `treatment_starts` |
| 5 | **Reconciliation engine** | 5 days | Launch Control · Trust layer · Board Pack readiness | Go-live |
| 6 | **Manual feed** | 3 days | Fallback for any delayed connector | Onboarding flexibility |
| 7 | **Stripe** | 2 days | Patient Payments page | Optional for v1 |
| 8 | **QuickBooks** | 4 days | Alternative to Xero · same UI surface | Only needed if any entity uses QB |
| 9 | **Open Banking** | 3 days | Independent bank balance verification | Post-v1 unless owner specifically wants it |
| 10 | **Meta / Google Ads** | 3 days | Marketing Pro · ROAS · CPL by channel | Post-v1 (UI works with sample data until then) |

**Total v1: ~30 developer days = 6 weeks at full focus.**

---

## Why this order

### Why Xero before Dentally?
Xero unlocks more UI per day of work. P&L, cash flow, balance sheet and valuation are all powered by Xero alone — those are six core pages. Dentally adds clinical depth but the dashboard's headline numbers come from accounting.

### Why GHL after Dentally, not before?
GHL is the CRM mirror — the value of it is matching leads to clinical outcomes. With no Dentally data, the GHL pages still show pipeline but can't show conversion to treatment, which is the whole point.

### Why reconciliation in the middle, not at the end?
Reconciliation exposes data quality issues early. Building it after all three primary connectors are live means you find broken mappings, missing tracking categories and unmatched patients while you still have context loaded.

### Why Stripe is small but tagged optional?
Most patient payments at GM Dental Group flow through Dentally (in-chair card terminals) and finance providers (Medenta, Tabeo). Stripe is for online deposits and the practice's e-commerce. If the practice isn't taking online payments yet, defer.

### Why QuickBooks is conditional?
Pick one accounting connector per entity. If every entity uses Xero, skip QuickBooks entirely. If one uses QB, build QB after Xero is solid — the patterns are similar but the APIs differ enough to be a 4-day rebuild, not a 1-day copy.

### Why Open Banking is post-v1?
Xero and QB pull bank transactions via their own bank feeds. Open Banking duplicates this. Build it only when you need: (a) faster than daily cash visibility, (b) bank-side verification independent of accounting, or (c) personal-finance scenarios (owner's pensions, investments).

---

## What can ship without integrations

Some pages work fully on sample data and don't need any backend at all in v1:

- ✅ Mastermind AI chat (calls Claude API directly from the prototype)
- ✅ Training Library / My Modules / Mentorship Calls (content-only, file-backed)
- ✅ Policy Library / Checklists / Audit templates
- ✅ Compliance Calendar (UI scheduler, no integration)
- ✅ Permissions editor (purely RBAC config)

These pages can launch on day one with auth alone. Use them as the "demo path" while connectors are still in flight.

---

## Parallel work

If you have two developers, the optimal split:

**Dev A (frontend + auth + reconciliation):**
- Week 1: Auth + RBAC + permissions
- Week 2-3: Wire prototype pages to API as data lands
- Week 4-5: Reconciliation engine + exception queue
- Week 6: Manual feed + UAT

**Dev B (connectors):**
- Week 1: Xero connector
- Week 2: Dentally connector + webhooks
- Week 3: GHL connector + deep links
- Week 4: Stripe + QuickBooks (if needed)
- Week 5-6: Backfills + monitoring + alerting

Total: 6 weeks to live with two developers vs 8 with one.

---

## Risk-ranked: what's most likely to slow you down

1. **Dentally NextGen API rollout (end of June 2026).** If you start on v1 then have to migrate mid-build, plan one extra week.
2. **Account code mapping in Xero.** Practice owners often don't have clean charts of accounts. Budget time for a workshop with the practice's accountant to map every code to a `dental_bucket`.
3. **GHL deep-link URLs vary per sub-account.** Don't hardcode. Build the `ghl_deep_links` table from day one and store URLs per module per practice.
4. **CRM-patient matching.** First reconciliation will surface dozens of unmatched contacts. Plan a manual sweep with the practice manager to resolve them, then the matching gets clean.
5. **MFA rollout.** Don't underestimate the social friction of forcing MFA on every user. Schedule a 1-hour onboarding session before go-live.

---

## See per-system guides for the actual steps

- `DENTALLY_SETUP.md`
- `XERO_SETUP.md`
- `QUICKBOOKS_SETUP.md`
- `GOHIGHLEVEL_SETUP.md`
- `STRIPE_SETUP.md`
- `OPEN_BANKING_SETUP.md`
