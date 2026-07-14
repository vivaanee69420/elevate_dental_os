# Daily Command Cockpit v3 — name matching, treatment on leads, every card clickable, per-channel ROI, descriptions

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** (1) Match GHL Google/Facebook pipeline leads to Emergent conversions by name OR email OR phone; (2) show the matched TREATMENT (+ patient/name/email/phone) on each lead; (3) make EVERY cockpit card click-to-expand; (4) compute + display cost-per-lead and ROI per channel; (5) add a plain-English description to every card.

**Architecture:** Backend — extend the shared matcher (`lead-attribution.service.js`) with a name key and a richer accepted-map value (`{valuePence, treatmentName, patientName, acceptedDate}`); the leads detail returns the matched treatment; add per-channel `spendPence/cplPence/roi` to `leadRoi`. Frontend — convert the remaining sub-cards to clickable `KpiTile`s with per-practice drill-downs (data already in `treatment.byPractice`), add a treatment column + description explainers, and a per-channel CPL/ROI display.

**Tech Stack:** Node ESM backend + vitest; Next 14, React Query, recharts, Tailwind. Money integer pence. Light theme.

## Global Constraints
- Native ESM; money integer pence; serviceClient + `.eq('organisation_id', orgId)`. Light theme; British English; money via `formatPence`.
- Match keys: `normPhone` (last-10 digits), `normEmail` (lower/trim), `normName` (lower, collapse spaces, `firstName lastName`). A lead converts if phone OR email match ANY accepted row, OR name matches an accepted row **with the same practice_id** (name-only cross-practice is NOT a match — reduces false positives). Phone/email are cross-practice OK.
- Per-channel spend: google ← `ad_metrics` provider `google_ads`; facebook ← `meta_ads`. CPL = spendPence / leads (null if leads 0). ROI = matchedValuePence / spendPence (null if spend 0). Charts palette unchanged (validated hex).
- Do NOT modify `backend/test/setup.js`; do NOT touch the user's uncommitted `lead.*`/`crm`/`leads`/migration `000111` files. Commit ONLY cockpit files. Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure
- Modify `backend/src/services/lead-attribution.service.js` (name key; richer accepted value; per-channel roi in `channelBreakdown`).
- Modify `backend/src/services/cockpit.service.js` (leadsDetail returns matched treatment; per-channel roi in payload) + `cockpit.repository.js` if a new field needed.
- Modify `frontend/features/cockpit/api.ts` (types: matched treatment on lead lines; per-channel roi), `components/CockpitScreen.tsx` (clickable sub-cards + descriptions), `components/LeadComparison.tsx` (treatment column + per-channel CPL/ROI).

---

### Task 1: Backend — name matching + matched-treatment + per-channel ROI
**Files:** `lead-attribution.service.js`, `cockpit.service.js`, (maybe) `cockpit.repository.js`; tests `test/lead-attribution.test.mjs`, `test/cockpit-detail.test.mjs`, `test/cockpit-service.test.mjs`.

**Interfaces (produce):**
- `normName(first, last | fullName)` exported; `buildAcceptedByKey(accepted)` now maps each key → `{ valuePence, treatmentName, patientName, acceptedDate }` (first match wins) and also indexes a name→value map scoped by practice (`nameByPractice: Map<practiceId, Map<normName, {…}>>`).
- `matchAcceptedValue(lead, acceptedByKey, nameByPractice)` returns the matched `{valuePence, treatmentName, patientName, acceptedDate}` or null; checks phone, then email (cross-practice), then name within `lead.practiceId`.
- `channelBreakdown(...)` unchanged shape PLUS a NEW `groupChannels` object computed **org-wide (IGNORING the practiceId filter)**: `{ google:{leads,conversions,matchedValuePence,spendPence,cplPence,roi}, facebook:{…} }`. CPL/ROI live HERE only — because ad spend isn't practice-attributable, cost-per-lead (`spendPence/leads`) and ROI (`matchedValuePence/spendPence`) are only meaningful org-wide, so they use org-wide leads even when a practice is scoped. cpl null when leads 0; roi null when spend 0. The practice-scoped `channels[]` keep leads/conversions/matchedValue only (no per-practice spend/cpl/roi). Payload: `leadRoi.groupChannels` added; the frontend's CPL/ROI block reads it and is labelled "group (all practices)".
- `cockpitService.leadsDetail` lines gain `matchedTreatmentName`, `matchedPatientName`, `matchedAcceptedDate` (null when not converted).
- Contacts read for leads must include `first_name,last_name` (extend the embed `contacts(phone,email,first_name,last_name)`), and `treatment_accepted` accepted read must include `patient_name`, `treatment_name`, `accepted_date` (already selected — confirm).

- [ ] Step 1: extend tests — `lead-attribution.test.mjs`: a lead matching only by name within the same practice converts; a same-name lead in a DIFFERENT practice does NOT; matched result carries `treatmentName`. `channelBreakdown` group carries `cplPence`/`roi`. `cockpit-detail.test.mjs`: a converted lead line carries `matchedTreatmentName`/`matchedPatientName`. RED.
- [ ] Step 2: implement. Keep phone/email precedence; name is last + practice-scoped. Money integer pence; cpl/roi null-guarded.
- [ ] Step 3: GREEN on the 3 files; full suite `cd backend && npx vitest run` → only the 6 pre-existing failures.
- [ ] Step 4: commit `feat(cockpit): name matching + matched-treatment on leads + per-channel CPL/ROI`.

---

### Task 2: Frontend — every card clickable + descriptions + treatment column + per-channel ROI
**Files:** `frontend/features/cockpit/api.ts`, `components/CockpitScreen.tsx`, `components/LeadComparison.tsx`.

- [ ] Step 1: **types** — add `matchedTreatmentName/matchedPatientName/matchedAcceptedDate` to the leads-detail line type; add `spendPence/cplPence/roi` to the channel/group types.
- [ ] Step 2: **every card clickable** — convert the remaining `Card`s (Tx plans given, New leads, Attended) in `TreatmentSection` to `KpiTile`s, each with its own drill state (widen the `Drill` enum, still one-open-at-a-time), expanding to a per-practice breakdown table sourced from `data.treatment.byPractice` (already in payload — the columns exist: acceptedValue, txPlansGiven/value; add newLeads/attended per practice to the payload IF absent — check `cockpitRepository.cashupRollup`/`cockpit.service` and add `newLeads`/`attended` to `treatment.byPractice[]` in Task 1 if missing). New leads drill may also link to "View leads".
- [ ] Step 3: **descriptions** — add a one-line plain-English description under each section heading / card (what it measures + source), e.g. Revenue = "Till cash taken, entered in Emergent"; Accepted = "Treatments a patient accepted (Emergent), matched to the ad lead that produced them"; Lead comparison = "Google/Facebook ad leads (GHL pipelines) matched to Emergent conversions by name, email or phone". Use the existing muted-note style (`text-xs text-slate-400`) or the `Explainer` primitive.
- [ ] Step 4: **treatment on leads** — in `LeadsList`, add a "Treatment" column showing `matchedTreatmentName` for converted leads (and keep the ✓ + matched £). The row already shows name/email/phone/pipeline/created.
- [ ] Step 5: **per-channel CPL/ROI** — in `LeadComparison`, show for each channel (Google, Facebook): Spend, Cost/Lead (`cplPence`), Conversions, ROI (`roi`) — sourced from `leadRoi.groupChannels` (org-wide) and labelled "group (all practices)". These stay org-wide even when a practice is scoped. Keep the honest note that Facebook spend may be £0 (stale Meta feed) and per-practice spend isn't attributable.
- [ ] Step 6: verify `cd frontend && npm run typecheck && npm run lint` clean; `/cockpit` route 200/307.
- [ ] Step 7: commit `feat(cockpit): all cards clickable + descriptions + treatment on leads + per-channel CPL/ROI (v3 UI)`.

## Notes
- Name matching is deliberately practice-scoped to cut false positives; phone/email stay the strong cross-practice keys. Surface which key matched only if cheap; otherwise the treatment + contact detail already makes the mapping auditable.
- If `treatment.byPractice` lacks `newLeads`/`attended`, add them in Task 1 (they're already summed per practice in `cashupRollup`).
- Meta spend is stale (ended Dec 2025) → Facebook CPL/ROI will read £0/— honestly until the owner reconnects Meta.
