# Phases — DentaCFO Feature-Gap Build

Phase tracker for porting the demo's missing modules (`GM-Group-Intelligence-OS_2.html`)
into the real app. **One phase per context**, committed individually; clear context
between phases. Detailed context + integration table: `BUILD-DENTACFO-MODULES.md`.

Branch: `feat/dentacfo-modules`. Resume after `/clear`: read this file + `BUILD-DENTACFO-MODULES.md`, then say the next phase number.

| Phase | Module | New integration | Status | Commit |
|---|---|---|---|---|
| 1 | Revenue Leakage | none | ✅ done | committed (see `git log` HEAD of branch) |
| 2 | Board Report Generator | none (Claude + SES email) | ✅ done | committed (branch HEAD) |
| 3 | M&A Acquisition Modeller (buy-side) | none | ✅ done | committed (branch HEAD) |
| 4 | Exit Plan (full 4% personal-wealth model) | none | ✅ done | committed (branch HEAD) |
| 5 | Data Quality Engine | none | ✅ done | committed (branch HEAD) |
| 6 | Attrition & Retention | none (may need Dentally re-sync) | ⬜ | — |
| 7 | Open Banking | **GoCardless Bank Account Data** (decided) | ⬜ | — |

## Per-phase done-criteria
Backend: formula (+ test + FORMULAS.md if new calc) → repo → service → controller → route (gated) → API.md. Frontend: api → hook → screen → page → nav + route-perm. Verify: backend `npm test` green + frontend `tsc --noEmit` clean. Then commit + tick this table.

## Decisions
- **Phase 7 provider = GoCardless Bank Account Data** (free AIS tier, balances + transactions, read-only cash position). Mirrors existing Xero/GHL OAuth + encrypted-secret pattern.

## Log
- 2026-06-09 — Phase 1 (Revenue Leakage) built + verified (606 backend tests, tsc clean), committing now.
- 2026-06-09 — Phase 2 (Board Report Generator) built + verified (613 backend tests, tsc + lint clean). Migration 000060 (board_report_schedules) applied on hosted. No new integration (Claude + SES). Next: Phase 3 (M&A Acquisition Modeller).
- 2026-06-09 — Phase 3 (M&A Acquisition Modeller, buy-side) built + verified (622 backend tests, tsc + lint clean). Pure compute, no integration, no migration, no new page — adds an "M&A Modeller" third tab to the existing Valuation page (valuation.view). Route is `POST /api/analytics/compute/acquisition` (not `/acquisition` as the BUILD doc sketched) — the `/compute/` path is audit-exempt, right for a slider-driven recompute. Next: Phase 4 (Exit Plan full 4% model).
- 2026-06-09 — Phase 5 (Data Quality Engine) built + verified (658 backend tests, backend typecheck + frontend tsc + lint clean). Reads existing warehouse data only (appointments/invoices/integrations) — no integration, no new page. Migration **000062** (RPC `data_quality_by_practice`, per-practice defect counts in one query) applied on hosted. Per-practice cleanliness score = weighted, dimension-renormalised blend (coded 0.30 / linked 0.30 / invoice-match 0.20 / collection 0.20); record-volume-weighted org rollup; RAG ≥90/≥70; connector staleness classifier (Dentally/GHL 36h, Xero/QB 48h) + prioritised alert list. `associate_id` is flagged not scored (null on every synced Dentally appt — data wall — would crater every score). Route `GET /api/analytics/data-quality` gated **`system.manage`** to match the Data Hub page (not finance.view). Frontend `DataQualityPanel` mounted at the top of the existing `DataHubScreen` (no new nav/route-perm). Next: Phase 6 (Attrition & Retention).
- 2026-06-09 — Phase 4 (Exit Plan, **full** personal-wealth model + sale waterfall) built + verified (641 backend tests, tsc + lint clean). User chose the full option: a personal net-sale-proceeds waterfall (debt → equity split by owner % → UK CGT with BADR 18% to £1m cap then 24% → freehold) feeds personal net worth in the FIRE projection. The demo's surviving `_3` "Exit Plan" is the BUSINESS-exit planner = already-shipped Sale Planner (`planExitTrajectory`); the `_2` personal 4% source is gone, so the waterfall/tax math is original (constants in `lib/formulas.UK_TAX`/`FIRE_DEFAULTS`, accountant-repointable). Backend: `calculateSaleWaterfall` + `calculateFirePlan` (+14 formula tests, +5 service tests) + migration **000061 wealth_inputs** (org-scoped JSONB balance sheet, applied on hosted) + repo/service/controller + rewrote `wealth.routes.js` (was a business_health stub) to GET/PUT `/inputs`, GET `/net`+`/fire`, POST `/compute/{sale-waterfall,fire}` (reads `wealth.view`, write owner-only, `/compute` audit-exempt). EV pulled live from the valuation midpoint. Frontend: `wealth-api.ts` + `wealth-hooks.ts`; wired `FirePlanScreen` (live plan + editable persisted FIRE/sale assumptions + waterfall panel) and `NetWorthScreen` (editable persisted balance sheet) off mock. Pension/Property screens left on mock (out of phase scope). FORMULAS.md §Exit Plan + API.md §Wealth updated. Next: Phase 5 (Data Quality Engine).
