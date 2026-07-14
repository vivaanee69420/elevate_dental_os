# Daily Command Cockpit v2 — Drill-downs, Pipeline Tags, Practice Filter, Charts

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make every cockpit card click-to-expand into its row-level source data (Business-Hub style, no modals), tag each lead/conversion with the GHL pipeline it came from (Google/Facebook/Website/…), add a practice scope filter, and add validated interactive charts.

**Architecture:** Backend threads a `practiceId` through `/api/cockpit` + the attribution service and adds three lazy detail endpoints (`/api/cockpit/leads|treatments|cashup-days`); the channel classifier broadens to google/facebook/instagram/website/other and each lead detail carries its raw pipeline name + cleaned channel. Frontend: enable the ScopePeriodBar scope selector; convert sections to clickable `KpiTile` + inline `Panel` breakdowns and expandable `<Fragment>` rows (copy Clinicians/PLMargin patterns); pipeline tags via `Chip`; recharts charts using the pre-validated palette.

**Tech Stack:** Node ESM backend, vitest; Next 14, React Query (`useQuery` gated `enabled: open`), recharts, Tailwind. Money integer pence.

## Global Constraints
- Native ESM; money integer pence; repos serviceClient + `.eq('organisation_id', orgId)`. Light theme only; British English.
- Windows `{since, until}` half-open (until EXCLUSIVE). Practice scope: `scope` = 'all' | `<practiceId>` from `useScopePeriod()`; pass `practiceId` (undefined when 'all') to the API.
- **Validated chart palette (light, PASSES CVD):** categorical `#2563eb, #f59e0b, #10b981, #8b5cf6`; channel map Facebook=`#2563eb`, Google=`#f59e0b`, Website=`#10b981`, Instagram=`#8b5cf6`, Other=`#94a3b8`. Contrast WARN on amber/green → **direct value labels + table view are mandatory relief** (both present via drill-downs). Do NOT dual-axis. Legend present for ≥2 series. Hover tooltip on every chart.
- Channel classifier: `/facebook|\bfb\b/i`→facebook, `/google/i`→google, `/instagram|\big\b/i`→instagram, `/website|web|organic/i`→website, else 'other'.
- Commit after each task; trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Backend tests `cd backend && npx vitest run <file>`; frontend verify = typecheck + lint + route compiles (no FE test framework).

## File Structure
- Modify `backend/src/services/lead-attribution.service.js` (broaden classifier; per-lead pipeline tag; accept practiceId).
- Modify `backend/src/services/cockpit.service.js` + `cockpit.controller.js` + `cockpit.model.js` (thread practiceId).
- Modify `backend/src/repositories/cockpit.repository.js` (practice filter on reads; detail reads).
- Create detail routes on `cockpit.routes.js`: `GET /leads`, `/treatments`, `/cashup-days`.
- Frontend `features/cockpit/`: `api.ts`/`hooks.ts` (detail fetchers + hooks), `components/CockpitScreen.tsx` (scope selector + clickable KpiTiles + drill panels), new `components/{RevenueDrill,TreatmentDrill,LeadDrill,CashUpDrill,MonthlyDrill,CockpitCharts}.tsx`, `components/PipelineTag.tsx`.

---

### Task 1: Backend — practice filter + broadened classifier + pipeline tags + monthly P&L lines
**Files:** modify `lead-attribution.service.js`, `cockpit.service.js`, `cockpit.controller.js`, `cockpit.model.js`, `cockpit.repository.js`; tests `test/lead-attribution.test.mjs`, `test/cockpit-service.test.mjs`.
**Interfaces:**
- `classifyChannel` → now returns 'google'|'facebook'|'instagram'|'website'|'other' (never null; 'other' is the catch-all). Update existing test expectations (`Dental Patient Pipeline`→'other').
- `matchBreakdown(pipes, leads, accepted)` → each lead carries `{ pipelineId, pipelineName, channel }`; breakdown still per practice×channel but channels now the broader set (the cockpit UI shows google/facebook prominently, others under "Other channels").
- `channelBreakdown(orgId, { since, until, practiceId })` — when practiceId set, filter pipes/leads to that practice.
- `cockpitService.build(orgId, { since, until, practiceId })` — pass practiceId to every repo read + channelBreakdown; add `monthly.costLines` / `monthly.opexLines` / `monthly.lineNotes` (from `emergent_monthly_pl` typed line columns + `custom_lines`/`line_notes`) to the payload.
- `cockpitQuerySchema` gains `scope` (already) → controller derives `practiceId = (scope && scope !== 'all' && isUuid(scope)) ? scope : undefined`.
- Repo reads (`cashupRollup`, `monthlyPl`, `acceptedContactsInWindow`, `adLeadsInWindow`) gain an optional `practiceId` that adds `.eq('practice_id', practiceId)` when set.

- [ ] Step 1: extend `test/lead-attribution.test.mjs` — assert `classifyChannel('Website enquiries')==='website'`, `'IG Lead Engine'==='instagram'`, `'Dental Patient Pipeline'==='other'`; assert `matchBreakdown` leads carry `pipelineName`+`channel`. Extend `test/cockpit-service.test.mjs` — mock repo returns a monthly row with cost/opex lines; assert `monthly.costLines`/`opexLines` present; assert passing `practiceId` reaches the repo mocks (spy called with practiceId).
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement the classifier broadening, per-lead tag, practiceId threading, monthly lines. Keep money integer pence.
- [ ] Step 4: run both files → PASS; full suite → only the 6 pre-existing failures.
- [ ] Step 5: commit `feat(cockpit): practice filter + broadened channel classifier + pipeline tags + P&L lines`.

---

### Task 2: Backend — lazy detail endpoints
**Files:** modify `cockpit.repository.js`, `cockpit.controller.js`, `cockpit.routes.js`; test `test/cockpit-detail.test.mjs`.
**Interfaces (all gated `requirePermission('finance.view')`, `{since,until,practiceId?,limit?,offset?}`):**
- `GET /api/cockpit/leads` → `{ window, lines: [{ id, createdAt, practiceName, channel, pipelineName, name, email, phone, converted, matchedValuePence }], limit, offset }`. Reuses the attribution match to set `converted`/`matchedValuePence` per lead. Optional `channel` filter.
- `GET /api/cockpit/treatments` → `{ window, lines: [{ id, acceptedDate, practiceName, patientName, treatmentName, valuePence, source }], limit, offset }` from `treatment_accepted`.
- `GET /api/cockpit/cashup-days` → `{ window, lines: [{ cashupDate, practiceName, cashTakenPence, detailPence, variancePence, refunds }] }` from `emergent_daily_cashup`.
- Repo methods with LIMIT/OFFSET + org + optional practice filter, `.order(...desc)`. Cap `limit` ≤ 500.

- [ ] Step 1: `test/cockpit-detail.test.mjs` — mock repo; assert each service method shapes `lines[]` correctly, money integer pence, practiceId reaches the repo, and the leads detail sets `converted`/`matchedValuePence` via the same phone/email match as Task 1 (reuse `matchBreakdown` internals or a shared matcher — DRY, don't duplicate the normalise logic).
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement repo reads + service methods + controller handlers + routes (mount before any `/:x` catch-all; static paths). Reuse the normalise/match helpers from `lead-attribution.service.js` (export them if needed) — do NOT copy-paste the matching logic.
- [ ] Step 4: run → PASS; full suite → only 6 pre-existing failures.
- [ ] Step 5: commit `feat(cockpit): lazy detail endpoints (leads/treatments/cashup-days)`.

---

### Task 3: Frontend — practice filter + drill-downs + pipeline tags
**Files:** `features/cockpit/api.ts`, `hooks.ts`, `components/CockpitScreen.tsx`, new `components/PipelineTag.tsx` + per-section drill components.
- [ ] Step 1: **api/hooks** — add `fetchCockpitLeads/Treatments/CashupDays({since,until,practiceId,channel?,limit,offset})` + `useCockpitLeads(open, params)` etc. (React Query, `enabled: open`, key includes all params). Thread `practiceId` into `fetchCockpit`/`useCockpit` (from `scope`).
- [ ] Step 2: **scope filter** — change `<ScopePeriodBar hideScope />` to `<ScopePeriodBar />` (scope selector visible); read `scope` from `useScopePeriod()` and pass `practiceId = scope !== 'all' ? scope : undefined` to `useCockpit` + all detail hooks.
- [ ] Step 3: **clickable sections** — convert each section's headline into a `KpiTile` (`frontend/components/ui/KpiTile.tsx`) with `onClick`/`active`, one-open-at-a-time `useState` enum (copy `CliniciansScreen` `drill` pattern). On open, render an inline `Panel` (`features/intelligence/components/os-ui.tsx`) breakdown below.
- [ ] Step 4: **drill content** — Revenue→per-practice + `useCockpitCashupDays`; Treatment→`useCockpitTreatments` table; Lead→`useCockpitLeads` table with **`<PipelineTag channel pipelineName />`** column + Converted badge (✓ + matched £); CashUp→cashup-days table (variance, refunds); Monthly→P&L line items from `data.monthly.costLines/opexLines` (in-payload, expandable `<Fragment>` rows per the PLMargin pattern). Use `formatPence`, British English, light theme; heavy lists lazy (fetch on open) + paginate if `lines.length === limit`.
- [ ] Step 5: **PipelineTag** — a `Chip`-based coloured tag: cleaned channel label (Facebook/Google/Website/Instagram/Other) coloured per the validated palette, with the raw `pipelineName` as small subtext/title. No colour-only meaning — always includes the text label.
- [ ] Step 6: verify — `cd frontend && npm run typecheck && npm run lint` clean; `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/cockpit` = 200/307.
- [ ] Step 7: commit `feat(cockpit): click-to-expand drill-downs + pipeline tags + practice filter`.

---

### Task 4: Frontend — interactive charts (recharts, validated palette)
**Files:** `features/cockpit/components/CockpitCharts.tsx` (+ small chart components); modify `CockpitScreen.tsx` to place them.
- [ ] Step 1: **Lead comparison chart** — a grouped/stacked recharts `BarChart`: x = channel (or practice), series = Leads vs Conversions. Legend present (2 series), direct value labels (relief for the contrast WARN), `<Tooltip>` hover, single y-axis (count), recessive grid. Colours from the validated palette; **colour follows the channel entity, fixed order** (Facebook blue, Google amber, …) — a practice filter must NOT repaint survivors.
- [ ] Step 2: **Revenue trend** — recharts line/area of daily cash-taken over the window (single series → no legend, title names it; crosshair+tooltip). Uses cashup-days data (reuse the detail fetch or a compact series in the main payload — prefer a small `revenue.dailySeries` added to the payload to avoid a second fetch; if added, update Task 1/2 — otherwise fetch cashup-days).
- [ ] Step 3: **Treatment / channel mix** — a small bar or donut of accepted value by practice OR leads by channel (magnitude/identity). Keep to ONE clear chart; avoid chart clutter.
- [ ] Step 4: **Accessibility pass** — every chart: legend for ≥2 series, direct labels, hover tooltip, and the drill-down table is the "table view" relief. No dual axis. Render + eyeball for label collisions (screenshot/curl the page).
- [ ] Step 5: verify typecheck + lint clean; route compiles.
- [ ] Step 6: commit `feat(cockpit): interactive charts (validated palette, drill-linked)`.

## Notes / self-review
- If Task 4 wants `revenue.dailySeries` in the main payload, add it in Task 1 (a compact `[{date, cashPence}]`) so the trend chart needs no extra fetch — decide in Task 1 and keep the plan consistent.
- Detail endpoints must be mounted as STATIC paths under `/api/cockpit/...` before any param routes.
- Pipeline tag colour is decorative; the text label carries meaning (CVD/print safe).
- Emergent conversions matched only by phone/email — the leads detail's `converted` flag reflects that; low match rate is honest, not a bug.
