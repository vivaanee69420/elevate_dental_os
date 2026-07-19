# Ad Performance Cockpit Treatment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/ad-performance` in the Daily Cockpit's visual language, with click-to-drill on every metric that has records behind it, using only data the existing API already returns.

**Architecture:** The cockpit's presentational primitives (`SecHead`, `SectionCard`, `Kpi`, `DetailPanel`, `cx`) move from `features/cockpit/components/cockpit-ui.tsx` into `components/ui/SectionKit.tsx`; the cockpit file becomes a pure re-export so no cockpit consumer changes. Ad Performance then composes five `SectionCard`s. All lead drill-downs are served by **one** `useAdLeads` fetch whose result is filtered in memory by pure helpers in `features/ad-performance/derive.ts`.

**Tech Stack:** Next.js 14 App Router, TypeScript, React Query, Tailwind, CSS Modules, recharts (already present).

## Global Constraints

- **Frontend only.** No backend, service, repository, route, or migration change.
- **Money is integer pence.** `formatPence` must never be called on a nullable pence value — every nullable goes through the `money()` guard. `null` renders as `"Not reporting"`, never `£0` or `£NaN`.
- **The Daily Cockpit must render identically** after Task 1. It is the one plausible regression.
- **British English** in all UI copy (organisation, colour, optimise, centre).
- **No dark mode. No emojis.**
- **Do not change the `"Not reporting"` copy on cost tiles.** Out of scope by explicit decision.
- **React Query keys must keep `'ad-performance'` as element zero** — `features/ad-attribution/hooks.ts` invalidates by that prefix.
- **No test framework exists on the frontend.** Every task's gate is `npm run typecheck && npm run lint && npm run build` from `frontend/`, plus the stated browser check. Do not scaffold a test framework; it is out of scope.

## File Structure

| File | Responsibility |
|---|---|
| Create `frontend/components/ui/SectionKit.tsx` | The five promoted presentational primitives. No data logic. |
| Create `frontend/components/ui/cockpit.module.css` | Moved verbatim from the cockpit. |
| Modify `frontend/features/cockpit/components/cockpit-ui.tsx` | Becomes a re-export shim. |
| Modify `frontend/components/ui/index.ts` | Barrel exports for the new primitives. |
| Create `frontend/features/ad-performance/derive.ts` | Pure lead-derivation helpers. No React. |
| Create `frontend/features/ad-performance/format.ts` | `money()` / `pct()` null guards, shared by every component. |
| Modify `frontend/features/ad-performance/api.ts` | Declare the latent `trend` on `PracticeChannels`. |
| Rewrite `frontend/features/ad-performance/components/ChannelScorecard.tsx` | Sections 1 and 2 as cockpit tiles. |
| Create `frontend/features/ad-performance/components/AttributionSection.tsx` | Section 3 — Emergent match quality. |
| Create `frontend/features/ad-performance/components/OverlapTable.tsx` | The cross-channel overlap panel body. |
| Create `frontend/features/ad-performance/components/PracticeSparkline.tsx` | Inline-SVG sparkline for the per-practice trend. |
| Modify `frontend/features/ad-performance/components/ByPracticeTable.tsx` | Section 4 — adopt section skin, add sparkline column. |
| Modify `frontend/features/ad-performance/components/ChannelTrend.tsx` | Section 5 — adopt section skin. |
| Rewrite `frontend/features/ad-performance/components/AdPerformanceScreen.tsx` | Drill state, single leads fetch, panel routing. |

---

### Task 1: Promote the cockpit primitives to shared UI

**Files:**
- Create: `frontend/components/ui/cockpit.module.css` (moved)
- Create: `frontend/components/ui/SectionKit.tsx`
- Modify: `frontend/features/cockpit/components/cockpit-ui.tsx` (full replace)
- Modify: `frontend/components/ui/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SecHead`, `SectionCard`, `Kpi`, `DetailPanel`, `cx`, `cockpitStyles` — exported from both `@/components/ui` and, unchanged, `@/features/cockpit/components/cockpit-ui`.

Exact signatures later tasks rely on:

```ts
export const cx: (...parts: Array<string | false | null | undefined>) => string;

export function SecHead(props: {
  n: number | string;
  title: ReactNode;
  desc?: ReactNode;
  src?: { label: string; ok?: boolean };
  tone?: 'green' | 'ok';
}): JSX.Element;

export function SectionCard(props: { children: ReactNode }): JSX.Element;

export function Kpi(props: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  noteTone?: 'muted' | 'pos' | 'neg';
  tag?: { text: string; tone: 'pos' | 'neg' | 'amb' | 'muted' };
  valueMuted?: boolean;
  info?: ReactNode;
  onClick?: () => void;
  active?: boolean;
}): JSX.Element;

export function DetailPanel(props: { title: string; sub?: string; children: ReactNode }): JSX.Element;
```

- [ ] **Step 1: Move the stylesheet with git so history follows it**

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend
git mv features/cockpit/components/cockpit.module.css components/ui/cockpit.module.css
```

- [ ] **Step 2: Move the component file to its new home**

```bash
git mv features/cockpit/components/cockpit-ui.tsx components/ui/SectionKit.tsx
```

The moved file's `import s from './cockpit.module.css';` still resolves, because both files moved into the same directory. Change only the header comment so it no longer claims to be cockpit-private. Replace the first five lines of `components/ui/SectionKit.tsx`:

```tsx
'use client';
// Section presentation kit — a numbered section head, a section card, a KPI
// tile with a built-in "?" explainer and drill-down affordance, and the detail
// panel a drill-down opens into. Originally the Daily Command Cockpit skin
// (`elevate-cockpit-mockup_1.html`); promoted to shared UI so Ad Performance
// and the cockpit read as one product. No data logic lives here.
import { useState, type ReactNode } from 'react';
import s from './cockpit.module.css';
```

Leave the rest of the file byte-for-byte unchanged.

- [ ] **Step 3: Replace the cockpit file with a re-export shim**

Create `frontend/features/cockpit/components/cockpit-ui.tsx` with exactly this content:

```tsx
// Moved to @/components/ui/SectionKit — these primitives are now shared with
// Ad Performance. This shim keeps every existing cockpit import path working;
// prefer importing from '@/components/ui' in new code.
export {
  cx,
  SecHead,
  SectionCard,
  Kpi,
  DetailPanel,
  cockpitStyles,
} from '@/components/ui/SectionKit';
```

Note there is no `'use client'` here: a re-export of client components does not itself need the directive, and `SectionKit.tsx` carries it.

- [ ] **Step 4: Add the barrel exports**

Append to `frontend/components/ui/index.ts`:

```ts
export { cx, SecHead, SectionCard, Kpi, DetailPanel, cockpitStyles } from './SectionKit';
```

Import `SectionKit` directly (`@/components/ui/SectionKit`) from the cockpit shim rather than via this barrel, to keep the shim free of the barrel's other dependencies.

- [ ] **Step 5: Confirm no import path was missed**

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend
grep -rn "cockpit.module.css" --include=*.tsx --include=*.ts .
```

Expected: exactly one hit, `components/ui/SectionKit.tsx`. If any cockpit component imports the stylesheet directly, repoint it to `@/components/ui/cockpit.module.css`.

- [ ] **Step 6: Verify the build**

```bash
npm run typecheck && npm run lint && npm run build
```

Expected: all three clean. A "module not found: ./cockpit.module.css" here means a component other than `SectionKit.tsx` was importing it — fix per Step 5.

- [ ] **Step 7: Verify the cockpit is visually unchanged**

Run `npm run dev`, open `/cockpit`, and confirm: numbered green section circles render, KPI tiles are mint-tinted with working `?` toggles, and clicking a drill-down tile still opens its inline detail panel. This is the regression gate for the whole plan — do not proceed on assumption.

- [ ] **Step 8: Commit**

```bash
git add components/ui/SectionKit.tsx components/ui/cockpit.module.css components/ui/index.ts features/cockpit/components/cockpit-ui.tsx
git commit -m "refactor(ui): promote cockpit section primitives to components/ui"
```

---

### Task 2: Null-guard formatters and the latent per-practice trend type

**Files:**
- Create: `frontend/features/ad-performance/format.ts`
- Modify: `frontend/features/ad-performance/api.ts` (the `PracticeChannels` interface)

**Interfaces:**
- Consumes: `TrendMonth` from `./api`.
- Produces: `money(p: number | null): string`, `pct(r: number | null): string`, and `PracticeChannels.trend: TrendMonth[]`.

Background: `backend/src/services/ad-attribution.service.js:378` already attaches `trend` to every `byPractice` entry, and `getPerformance` spreads it through at `:473`. The frontend type does not declare it, so it is fetched and discarded. This task only declares it.

- [ ] **Step 1: Create the shared null guards**

Create `frontend/features/ad-performance/format.ts`:

```ts
// Load-bearing null guards for this feature. A null money or rate means "not
// known", never zero — zero would read as a real measurement (free leads, or a
// channel converting nothing) when the truth is that no spend feed maps to it.
// formatPence() coerces null to £0.00 on its own, so every nullable pence value
// on this page MUST go through money() rather than formatPence directly.
import { formatPence } from '@/lib/format';

export const money = (p: number | null) => (p === null ? 'Not reporting' : formatPence(p));

export const pct = (r: number | null) => (r === null ? 'Not reporting' : `${(r * 100).toFixed(1)}%`);

export const count = (n: number) => n.toLocaleString('en-GB');
```

- [ ] **Step 2: Declare the trend the backend already sends**

In `frontend/features/ad-performance/api.ts`, replace the `PracticeChannels` interface:

```ts
export interface PracticeChannels {
  practiceId: string;
  practiceName: string | null;
  channels: ChannelStats[];
  total: AdTotals;
  /**
   * Per-practice monthly trend. The backend has always sent this
   * (`ad-attribution.service.js` byPractice), it was simply not declared here
   * and so was discarded. Same non-additive caveat as the group `trend`:
   * points dedupe per person PER MONTH, so they do not sum to the scorecard.
   */
  trend: TrendMonth[];
}
```

`TrendMonth` is declared below `PracticeChannels` in this file. That is fine — TypeScript interface declarations are hoisted, so no reordering is needed.

- [ ] **Step 3: Verify**

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend && npm run typecheck && npm run lint
```

Expected: clean. `format.ts` is not yet imported anywhere; that is expected and is not a lint error under this config.

- [ ] **Step 4: Commit**

```bash
git add features/ad-performance/format.ts features/ad-performance/api.ts
git commit -m "feat(ads): shared null-guard formatters, declare per-practice trend"
```

---

### Task 3: Pure lead-derivation helpers

**Files:**
- Create: `frontend/features/ad-performance/derive.ts`

**Interfaces:**
- Consumes: `AdLeadLine`, `PerfChannel` from `./api`.
- Produces:

```ts
export function personKey(l: AdLeadLine): string;
export function distinctPeople(lines: AdLeadLine[]): AdLeadLine[];
export interface OverlapPerson { key: string; name: string | null; email: string | null; phone: string | null; channels: PerfChannel[]; }
export function overlapPeople(lines: AdLeadLine[]): OverlapPerson[];
export interface MatchStats { matched: number; total: number; rate: number | null; matchedValuePence: number; }
export function matchStats(lines: AdLeadLine[]): MatchStats;
```

- [ ] **Step 1: Write the helpers**

Create `frontend/features/ad-performance/derive.ts`:

```ts
// Pure derivations over the lead rows the API already returns. No React, no
// fetching — everything here is computed from one `GET /ad-attribution/leads`
// response so the page issues a single request for all its drill-downs.
import type { AdLeadLine, PerfChannel } from './api';

// Identify a person the same way the shared cockpit LeadsTable does
// (`dedupeByPerson`, LeadsTable.tsx): contactId, falling back to a synthetic
// per-row key. KNOWN LIMITATION: a lead with a null contactId gets a unique
// key and therefore can never be seen as overlapping, even if the same human
// really did enquire through both channels. Every count derived from this is a
// LOWER BOUND on true overlap and must be presented as such.
export function personKey(l: AdLeadLine): string {
  return l.contactId ?? `lead:${l.id}`;
}

// The API dedupes per `channel|personKey`, so a person in two channels comes
// back twice. Collapse to one row per person, keeping the earliest touch.
export function distinctPeople(lines: AdLeadLine[]): AdLeadLine[] {
  const byPerson = new Map<string, AdLeadLine>();
  for (const l of lines) {
    const key = personKey(l);
    const seen = byPerson.get(key);
    if (!seen || Date.parse(l.createdAt) < Date.parse(seen.createdAt)) byPerson.set(key, l);
  }
  return Array.from(byPerson.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface OverlapPerson {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  channels: PerfChannel[];
}

// People who appear under more than one channel — the gap between the deduped
// group total and the sum of the channel columns, as a list of names.
export function overlapPeople(lines: AdLeadLine[]): OverlapPerson[] {
  const byPerson = new Map<string, OverlapPerson>();
  for (const l of lines) {
    const key = personKey(l);
    const seen = byPerson.get(key);
    if (!seen) {
      byPerson.set(key, { key, name: l.name, email: l.email, phone: l.phone, channels: [l.channel] });
      continue;
    }
    if (!seen.channels.includes(l.channel)) seen.channels.push(l.channel);
  }
  return Array.from(byPerson.values()).filter((p) => p.channels.length > 1);
}

export interface MatchStats {
  matched: number;
  total: number;
  /** null when there are no leads at all — 0/0 is not 0%. */
  rate: number | null;
  matchedValuePence: number;
}

// How many distinct people tie to an accepted treatment in Emergent, and the
// value carried by those matches.
export function matchStats(lines: AdLeadLine[]): MatchStats {
  const people = distinctPeople(lines);
  const matched = people.filter((l) => l.matchedTreatmentName !== null);
  return {
    matched: matched.length,
    total: people.length,
    rate: people.length === 0 ? null : matched.length / people.length,
    matchedValuePence: matched.reduce((n, l) => n + l.matchedValuePence, 0),
  };
}
```

- [ ] **Step 2: Verify**

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend && npm run typecheck && npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add features/ad-performance/derive.ts
git commit -m "feat(ads): pure lead-derivation helpers for drill-downs"
```

---

### Task 4: Rebuild the scorecard as cockpit sections

**Files:**
- Modify: `frontend/features/ad-performance/components/ChannelScorecard.tsx` (full rewrite)

**Interfaces:**
- Consumes: `SectionCard`, `SecHead`, `Kpi` from `@/components/ui`; `Explainer` from `@/components/ui`; `money`, `pct`, `count` from `../format`.
- Produces:

```ts
export type ScorecardDrill = 'leads' | 'paidLeads' | 'conversions' | 'acceptedValue' | 'overlap' | PerfChannel;
export function ChannelScorecard(props: {
  channels: ChannelStats[];
  totals: AdTotals;
  overlapCount: number;
  drill: ScorecardDrill | null;
  onDrill: (d: ScorecardDrill) => void;
}): JSX.Element;
```

Note the prop change from the current signature: `onDrill` now takes the wider `ScorecardDrill`, and `drill` + `overlapCount` are new. Task 6 supplies all three.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `frontend/features/ad-performance/components/ChannelScorecard.tsx`:

```tsx
'use client';
// Sections 1 and 2 — the deduped group total, then Google vs Facebook vs
// Unassigned. Rendered in the shared section kit so this page and the Daily
// Cockpit read as one product.
//
// Spend and the two cost metrics are deliberately NOT clickable: the
// performance endpoint returns one spend number per channel with no
// per-account or per-campaign breakdown to open, and an empty panel is worse
// than no panel. They carry an Explainer instead.
import { formatPence } from '@/lib/format';
import { SectionCard, SecHead, Kpi, Explainer } from '@/components/ui';
import { money, pct, count } from '../format';
import type { AdTotals, ChannelStats, PerfChannel } from '../api';

const LABEL: Record<PerfChannel, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Facebook Ads',
  unassigned: 'Unassigned',
};

export type ScorecardDrill =
  | 'leads' | 'paidLeads' | 'conversions' | 'acceptedValue' | 'overlap' | PerfChannel;

export function ChannelScorecard({
  channels,
  totals,
  overlapCount,
  drill,
  onDrill,
}: {
  channels: ChannelStats[];
  totals: AdTotals;
  overlapCount: number;
  drill: ScorecardDrill | null;
  onDrill: (d: ScorecardDrill) => void;
}) {
  return (
    <>
      <SectionCard>
        <SecHead
          n={1}
          title="Group total (deduped)"
          desc="One person counts once here even if they appear in more than one channel below. The three channel columns are not additive — this is the true group figure. Click any tile with a chevron to see the people behind it."
        />
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <Kpi
            label="Leads"
            value={count(totals.leads)}
            onClick={() => onDrill('leads')}
            active={drill === 'leads'}
            info={(
              <Explainer
                what="Every person who enquired through a mapped pipeline in this window, counted once."
                how="All leads across Google, Facebook and Unassigned pipelines, deduped per person."
                now={`${count(totals.leads)} people.`}
              />
            )}
          />
          <Kpi
            label="Paid leads"
            value={count(totals.paidLeads)}
            note="Google + Facebook only — the denominator for the cost metrics"
            onClick={() => onDrill('paidLeads')}
            active={drill === 'paidLeads'}
            info={(
              <Explainer
                what="The narrower population that paid advertising can actually take credit for."
                how="Leads on Google-tagged or Facebook-tagged pipelines only, deduped per person. Unassigned pipelines are excluded because no spend maps to them."
                now={`${count(totals.paidLeads)} of ${count(totals.leads)} leads came through a paid channel.`}
              />
            )}
          />
          <Kpi
            label="In more than one channel"
            value={count(overlapCount)}
            note={overlapCount > 0 ? 'At least this many — see panel' : undefined}
            onClick={() => onDrill('overlap')}
            active={drill === 'overlap'}
            info={(
              <Explainer
                what="People who enquired through both a Google-tagged and a Facebook-tagged pipeline. They are why the channel columns do not sum to the total."
                how="Lead rows grouped by contact, keeping anyone who appears under more than one channel."
                now="A lower bound: leads with no contact record cannot be matched across channels, so the true figure may be higher."
              />
            )}
          />
          <Kpi
            label="Spend"
            value={money(totals.spendPence)}
            info={(
              <Explainer
                what="Advertising spend recorded against Google and Facebook in this window."
                how="Summed from the ad spend feed. Unassigned contributes nothing — no spend feed maps to it."
                now={money(totals.spendPence)}
              />
            )}
          />
          <Kpi
            label="Cost per lead"
            value={money(totals.costPerLeadPence)}
            note="Spend ÷ paid leads"
            info={(
              <Explainer
                what="What one paid enquiry costs on average."
                how="Total spend divided by paid leads. Shows “Not reporting” when spend is unknown for either paid channel — dividing known spend by an incomplete population would understate the true cost."
                now={money(totals.costPerLeadPence)}
              />
            )}
          />
          <Kpi
            label="Conversions"
            value={count(totals.conversions)}
            onClick={() => onDrill('conversions')}
            active={drill === 'conversions'}
            info={(
              <Explainer
                what="Leads that went on to accept a treatment."
                how="A lead is a conversion when it matches an accepted treatment record from Emergent."
                now={`${count(totals.conversions)} of ${count(totals.leads)} leads converted.`}
              />
            )}
          />
          <Kpi
            label="Paid conversions"
            value={count(totals.paidConversions)}
            note="The denominator for cost per acquisition"
            info={(
              <Explainer
                what="Conversions attributable to Google or Facebook."
                how="Conversions on paid pipelines only, deduped per person."
                now={`${count(totals.paidConversions)} of ${count(totals.conversions)} conversions came through a paid channel.`}
              />
            )}
          />
          <Kpi
            label="Conversion rate"
            value={pct(totals.conversionRate)}
            info={(
              <Explainer
                what="How often an enquiry becomes an accepted treatment."
                how="Conversions divided by leads, across all channels including Unassigned — deliberately not the paid-only population, so it describes the whole funnel."
                now={pct(totals.conversionRate)}
              />
            )}
          />
          <Kpi
            label="Cost per acquisition"
            value={money(totals.costPerAcquisitionPence)}
            note="Spend ÷ paid conversions"
            info={(
              <Explainer
                what="What one accepted treatment costs in advertising."
                how="Total spend divided by paid conversions. Shows “Not reporting” under the same rule as cost per lead."
                now={money(totals.costPerAcquisitionPence)}
              />
            )}
          />
          <Kpi
            label="Accepted value"
            value={formatPence(totals.acceptedValuePence)}
            onClick={() => onDrill('acceptedValue')}
            active={drill === 'acceptedValue'}
            info={(
              <Explainer
                what="The value of treatment accepted by people who came in as leads."
                how="Summed from the accepted treatment records in Emergent that matched a lead."
                now={formatPence(totals.acceptedValuePence)}
              />
            )}
          />
        </div>
      </SectionCard>

      <SectionCard>
        <SecHead
          n={2}
          title="By channel"
          desc="The same window split by where the enquiry came from. These three columns are not additive — someone who enquired through both Google and Facebook is counted once under each, which is correct for comparing channels but wrong for totalling them. Click a lead count to see that channel's people."
        />
        <div className="grid gap-3 md:grid-cols-3">
          {channels.map((c) => (
            <div key={c.channel}>
              <Kpi
                label={LABEL[c.channel]}
                value={count(c.leads)}
                note="leads"
                onClick={() => onDrill(c.channel)}
                active={drill === c.channel}
                info={(
                  <Explainer
                    what={
                      c.channel === 'unassigned'
                        ? 'Leads on pipelines with no channel set, so no spend can be attributed to them.'
                        : `Leads on pipelines you have mapped to ${LABEL[c.channel]}.`
                    }
                    how="Counted once per person within this channel for this window."
                    now={`${count(c.leads)} leads, ${count(c.conversions)} converted, ${formatPence(c.acceptedValuePence)} accepted.`}
                  />
                )}
              />
              <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <Figure label="Spend" value={money(c.spendPence)} />
                <Figure label="Cost per lead" value={money(c.costPerLeadPence)} />
                <Figure label="Conversions" value={count(c.conversions)} />
                <Figure label="Conversion rate" value={pct(c.conversionRate)} />
                <Figure label="Cost per acquisition" value={money(c.costPerAcquisitionPence)} />
                <Figure label="Accepted value" value={formatPence(c.acceptedValuePence)} />
              </div>
              {c.channel === 'unassigned' ? (
                <p className="mt-2 text-[11px] text-slate-500">
                  Map these pipelines to a channel on the ad attribution settings page to bring
                  them into the paid figures.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend && npm run typecheck
```

Expected: **FAILS**, with an error on `AdPerformanceScreen.tsx` — it still calls `ChannelScorecard` with the old `onDrill: (c: PerfChannel) => void` signature and passes no `drill` or `overlapCount`. This is expected; Task 6 fixes the call site. Do not "fix" it here by widening the screen's state ad hoc.

- [ ] **Step 3: Commit**

```bash
git add features/ad-performance/components/ChannelScorecard.tsx
git commit -m "feat(ads): rebuild scorecard as cockpit sections with explainers"
```

---

### Task 5: Attribution section, overlap table, and practice sparkline

**Files:**
- Create: `frontend/features/ad-performance/components/AttributionSection.tsx`
- Create: `frontend/features/ad-performance/components/OverlapTable.tsx`
- Create: `frontend/features/ad-performance/components/PracticeSparkline.tsx`
- Modify: `frontend/features/ad-performance/components/ByPracticeTable.tsx`

**Interfaces:**
- Consumes: `matchStats`, `OverlapPerson` from `../derive`; `SectionCard`, `SecHead`, `Kpi`, `Explainer` from `@/components/ui`; `money`, `count` from `../format`.
- Produces:

```ts
export function AttributionSection(props: { lines: AdLeadLine[]; totalAcceptedPence: number; loading: boolean }): JSX.Element;
export function OverlapTable(props: { people: OverlapPerson[] }): JSX.Element;
export function PracticeSparkline(props: { trend: TrendMonth[] }): JSX.Element;
```

- [ ] **Step 1: Create the attribution section**

Create `frontend/features/ad-performance/components/AttributionSection.tsx`:

```tsx
'use client';
// Section 3 — how well leads tie back to accepted treatment.
//
// Emergent is NOT an advertising channel. It is the source of accepted
// treatment records that leads are matched against, which is what turns a lead
// into a conversion and gives it a value. So it belongs here, as a measure of
// downstream outcome and of match quality, rather than as a fourth column
// beside Google and Facebook.
import { formatPence } from '@/lib/format';
import { SectionCard, SecHead, Kpi, Explainer } from '@/components/ui';
import { matchStats } from '../derive';
import { pct, count } from '../format';
import type { AdLeadLine } from '../api';

export function AttributionSection({
  lines,
  totalAcceptedPence,
  loading,
}: {
  lines: AdLeadLine[];
  totalAcceptedPence: number;
  loading: boolean;
}) {
  const st = matchStats(lines);
  // Accepted value the group recorded that no tracked lead accounts for.
  // Clamped at zero: the lead list is capped at 500 rows, so on a large window
  // the matched sum can legitimately exceed nothing but never go negative.
  const unmatchedPence = Math.max(0, totalAcceptedPence - st.matchedValuePence);

  return (
    <SectionCard>
      <SecHead
        n={3}
        title="Attribution and match quality"
        desc="Emergent supplies accepted treatment records, not leads. A lead becomes a conversion when it matches one of those records, which is also where its value comes from. These figures show how much of that matching is actually landing."
      />
      {loading ? (
        <p className="text-sm text-slate-500">Loading attribution…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Kpi
            label="Leads matched to a treatment"
            value={count(st.matched)}
            note={`of ${count(st.total)} leads shown`}
            info={(
              <Explainer
                what="Leads that tie to an accepted treatment record in Emergent."
                how="Each lead is matched against accepted treatments in the same window on name and contact details."
                now={`${count(st.matched)} of ${count(st.total)}.`}
              />
            )}
          />
          <Kpi
            label="Match rate"
            value={pct(st.rate)}
            info={(
              <Explainer
                what="The share of leads that could be tied to an accepted treatment."
                how="Matched leads divided by total leads shown. A low rate means either that most enquiries have not accepted treatment yet, or that the records are not matching cleanly."
                now={pct(st.rate)}
              />
            )}
          />
          <Kpi
            label="Value from matched leads"
            value={formatPence(st.matchedValuePence)}
            info={(
              <Explainer
                what="Accepted treatment value that can be traced back to a specific lead."
                how="Summed across the matched leads in the list below."
                now={formatPence(st.matchedValuePence)}
              />
            )}
          />
          <Kpi
            label="Accepted value with no lead"
            value={formatPence(unmatchedPence)}
            valueMuted={unmatchedPence === 0}
            info={(
              <Explainer
                what="Treatment accepted in this window that no tracked lead accounts for."
                how="Group accepted value minus the value traced to matched leads. Usually walk-ins, referrals, returning patients, or enquiries that never reached a mapped pipeline."
                now={
                  unmatchedPence === 0
                    ? 'Everything traced back to a lead.'
                    : `${formatPence(unmatchedPence)} untraced.`
                }
              />
            )}
          />
        </div>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 2: Create the overlap table**

Create `frontend/features/ad-performance/components/OverlapTable.tsx`:

```tsx
'use client';
// The people counted under more than one channel — the reason the channel
// columns do not sum to the group total.
import type { OverlapPerson } from '../derive';
import type { PerfChannel } from '../api';

const LABEL: Record<PerfChannel, string> = {
  google_ads: 'Google',
  meta_ads: 'Facebook',
  unassigned: 'Unassigned',
};

export function OverlapTable({ people }: { people: OverlapPerson[] }) {
  if (people.length === 0) {
    return (
      <p className="py-2 text-sm text-slate-500">
        No one in this window was found under more than one channel.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto" style={{ maxHeight: 420 }}>
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">Email</th>
            <th className="py-2 pr-3 font-medium">Phone</th>
            <th className="py-2 pr-3 font-medium">Counted under</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.key} className="border-b border-slate-100">
              <td className="py-2 pr-3 text-slate-900">{p.name ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-600">{p.email ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-600">{p.phone ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-600">
                {p.channels.map((c) => LABEL[c]).join(' + ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create the sparkline**

Create `frontend/features/ad-performance/components/PracticeSparkline.tsx`:

```tsx
'use client';
// A tiny inline-SVG lead-volume sparkline. Deliberately not recharts: this
// renders once per practice row, and recharts is already the heaviest thing in
// this bundle.
import type { TrendMonth } from '../api';

export function PracticeSparkline({ trend }: { trend: TrendMonth[] }) {
  const values = trend.map((t) =>
    t.channels.reduce((n, c) => n + c.leads, 0));

  if (values.length < 2) {
    return <span className="text-[11px] text-slate-400">Not enough history</span>;
  }

  const w = 72;
  const h = 20;
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ');

  const first = values[0];
  const last = values[values.length - 1];
  const stroke = last >= first ? '#0f766e' : '#b91c1c';

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Lead volume trend, ${first} to ${last} per month`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Add the sparkline column and section skin to ByPracticeTable**

In `frontend/features/ad-performance/components/ByPracticeTable.tsx` make four edits.

Replace the import block and the local `money` helper:

```tsx
import { formatPence } from '@/lib/format';
import { SectionCard, SecHead } from '@/components/ui';
import { money } from '../format';
import { PracticeSparkline } from './PracticeSparkline';
import type { PracticeChannels, PerfChannel } from '../api';
```

(Delete the now-duplicated `const money = …` line and the `Card` import.)

Replace the opening `<Card>` and heading:

```tsx
    <SectionCard>
      <SecHead
        n={4}
        title="By practice"
        desc="The same metrics split by practice, with each practice's deduped total on its own row. The trend column is lead volume month by month."
      />
```

Change the closing `</Card>` to `</SectionCard>`.

Add the trend header cell after the "Accepted value" header:

```tsx
              <th className="py-2 pr-3 text-right font-medium">Accepted value</th>
              <th className="py-2 pr-3 font-medium">Trend</th>
```

Add a matching empty cell to the channel row (it is the total row that carries the sparkline), immediately after the channel row's accepted-value `<td>`:

```tsx
                  <td className="py-2 pr-3 text-right text-slate-600">{formatPence(c.acceptedValuePence)}</td>
                  <td className="py-2 pr-3"></td>
```

And the sparkline itself on the total row, immediately after its accepted-value `<td>`:

```tsx
                <td className="py-2 pr-3 text-right text-slate-900">{formatPence(p.total.acceptedValuePence)}</td>
                <td className="py-2 pr-3"><PracticeSparkline trend={p.trend} /></td>
```

Finally widen the table's minimum width so the new column does not crush the others — change `min-w-[760px]` to `min-w-[860px]`.

- [ ] **Step 5: Verify**

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend && npm run lint
```

Expected: clean. `npm run typecheck` will still fail on `AdPerformanceScreen.tsx` from Task 4 — that is expected and is fixed in Task 6.

- [ ] **Step 6: Commit**

```bash
git add features/ad-performance/components/AttributionSection.tsx features/ad-performance/components/OverlapTable.tsx features/ad-performance/components/PracticeSparkline.tsx features/ad-performance/components/ByPracticeTable.tsx
git commit -m "feat(ads): attribution section, overlap table, per-practice sparkline"
```

---

### Task 6: Rewire the screen — single fetch, drill routing, mapping health

**Files:**
- Modify: `frontend/features/ad-performance/components/AdPerformanceScreen.tsx` (full rewrite)

**Interfaces:**
- Consumes: `ScorecardDrill` from `./ChannelScorecard`; `distinctPeople`, `overlapPeople` from `../derive`; `DetailPanel`, `SectionCard`, `SecHead` from `@/components/ui`.
- Produces: the default-exported screen. Nothing depends on it.

The key behavioural change: `useAdLeads` is called **without** a `channel`, so one request returns every lead and each panel filters it in memory. Do not reintroduce a per-channel fetch — it would issue a request per tile and make the panels inconsistent with each other.

- [ ] **Step 1: Rewrite the screen**

Replace the entire contents of `frontend/features/ad-performance/components/AdPerformanceScreen.tsx`:

```tsx
'use client';
// Ad performance — Google vs Facebook, measured against explicitly mapped
// pipelines, in the Daily Cockpit's section language. Uses the shared
// ScopePeriod window and practice scope so it agrees with every other
// analytics screen.
//
// ONE leads request serves every drill-down: useAdLeads is called without a
// channel filter and each panel filters the result in memory. Do not add a
// per-channel fetch — it would fire a request per tile and let the panels
// disagree with one another.
import { useMemo, useState } from 'react';
import { PageHeader, SectionCard, SecHead, DetailPanel } from '@/components/ui';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { useAdPerformance, useAdLeads } from '../hooks';
import { ChannelScorecard, type ScorecardDrill } from './ChannelScorecard';
import { ByPracticeTable } from './ByPracticeTable';
import { ChannelTrend } from './ChannelTrend';
import { AdLeadsDrilldown } from './AdLeadsDrilldown';
import { AttributionSection } from './AttributionSection';
import { OverlapTable } from './OverlapTable';
import { distinctPeople, overlapPeople } from '../derive';
import { count } from '../format';
import type { AdLeadLine } from '../api';

const PANEL_TITLE: Record<ScorecardDrill, string> = {
  leads: 'Every lead',
  paidLeads: 'Paid leads',
  conversions: 'Leads that converted',
  acceptedValue: 'Leads with accepted treatment',
  overlap: 'People counted under more than one channel',
  google_ads: 'Google Ads leads',
  meta_ads: 'Facebook Ads leads',
  unassigned: 'Unassigned leads',
};

const PANEL_SUB: Record<ScorecardDrill, string> = {
  leads: 'One row per person, most recent first.',
  paidLeads: 'People who came in through a Google-tagged or Facebook-tagged pipeline.',
  conversions: 'People who went on to accept a treatment.',
  acceptedValue: 'Highest accepted value first.',
  overlap: 'These people are why the channel columns do not add up to the group total. This is a lower bound — leads with no contact record cannot be matched across channels.',
  google_ads: 'People on pipelines mapped to Google Ads.',
  meta_ads: 'People on pipelines mapped to Facebook Ads.',
  unassigned: 'People on pipelines with no channel set.',
};

// Which rows a given drill-down shows. Every branch works off the same fetched
// list so the panels can never disagree with one another.
function rowsFor(drill: ScorecardDrill, lines: AdLeadLine[]): AdLeadLine[] {
  switch (drill) {
    case 'leads':
      return distinctPeople(lines);
    case 'paidLeads':
      return distinctPeople(lines.filter((l) => l.channel !== 'unassigned'));
    case 'conversions':
      return distinctPeople(lines.filter((l) => l.converted));
    case 'acceptedValue':
      return distinctPeople(lines.filter((l) => l.matchedValuePence > 0))
        .sort((a, b) => b.matchedValuePence - a.matchedValuePence);
    case 'overlap':
      return [];
    default:
      return lines.filter((l) => l.channel === drill);
  }
}

export default function AdPerformanceScreen() {
  const sp = useScopePeriod();
  const practiceId = sp.scope === 'all' ? undefined : sp.scope;
  const params = useMemo(
    () => ({ since: sp.win.since, until: sp.win.until, practiceId }),
    [sp.win.since, sp.win.until, practiceId],
  );

  const { data, isLoading, error } = useAdPerformance(params);
  const [drill, setDrill] = useState<ScorecardDrill | null>(null);

  // Fetched for the attribution section as well as the drill-downs, so it is
  // enabled unconditionally once the page has data rather than on drill.
  const leads = useAdLeads(Boolean(data), params);
  const lines = useMemo(() => leads.data?.leads ?? [], [leads.data]);
  const overlap = useMemo(() => overlapPeople(lines), [lines]);

  if (isLoading) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (error || !data) return <p className="p-6 text-sm text-slate-500">Could not load ad performance.</p>;

  const noPaidLeads = data.channels.every((c) => c.channel === 'unassigned' || c.leads === 0);
  // Distinguish "nothing is mapped yet" (a real setup gap — send the operator
  // to fix it) from "everything is mapped, this window is just quiet" (true
  // but would send them to redo work that's already done if conflated).
  const nothingMapped = noPaidLeads && data.unmappedPipelineCount > 0;
  const mappedButQuiet = noPaidLeads && data.unmappedPipelineCount === 0;
  const hasMappingGap = data.unmappedPipelineCount > 0 || data.excludedUnmappedLeads > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ad performance"
        subtitle="Google and Facebook leads, cost per lead and conversions, from the pipelines you have mapped to each channel."
      />

      {nothingMapped ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          No pipelines are assigned to a channel yet, so there is nothing to report.{' '}
          <a className="underline" href="/settings/ad-attribution">Set up ad attribution</a>.
        </div>
      ) : null}

      {mappedButQuiet ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700">
          No Google or Facebook leads in this window. Pipelines are already mapped to a
          channel — this is just a quiet period.
        </div>
      ) : null}

      <ChannelScorecard
        channels={data.channels}
        totals={data.totals}
        overlapCount={overlap.length}
        drill={drill}
        onDrill={(d) => setDrill(d === drill ? null : d)}
      />

      {drill !== null ? (
        <DetailPanel title={PANEL_TITLE[drill]} sub={PANEL_SUB[drill]}>
          {leads.isLoading ? (
            <p className="text-sm text-slate-500">Loading leads…</p>
          ) : drill === 'overlap' ? (
            <OverlapTable people={overlap} />
          ) : (
            <AdLeadsDrilldown lines={rowsFor(drill, lines)} />
          )}
        </DetailPanel>
      ) : null}

      <AttributionSection
        lines={lines}
        totalAcceptedPence={data.totals.acceptedValuePence}
        loading={leads.isLoading}
      />

      <ByPracticeTable rows={data.byPractice} />

      <ChannelTrend trend={data.trend} />

      {hasMappingGap ? (
        <SectionCard>
          <SecHead
            n={6}
            title="Mapping health"
            desc="What is missing from the figures above, and why."
            tone="ok"
          />
          <ul className="ml-4 list-disc text-[13px] text-slate-700">
            {data.unmappedPipelineCount > 0 ? (
              <li className="py-1">
                <strong>{count(data.unmappedPipelineCount)} pipeline(s) have no channel set.</strong>{' '}
                Their leads appear under Unassigned and no advertising spend can be attributed
                to them, so they pull the group conversion rate down without contributing to
                cost per lead.
              </li>
            ) : null}
            {data.excludedUnmappedLeads > 0 ? (
              <li className="py-1">
                <strong>{count(data.excludedUnmappedLeads)} lead(s) are excluded entirely.</strong>{' '}
                They sit on GoHighLevel subaccounts that are not connected to a practice, so
                they cannot be attributed to anywhere and are left out of every figure on this
                page rather than being counted against the wrong practice.
              </li>
            ) : null}
          </ul>
          <p className="mt-2 text-[12px] text-slate-500">
            <a className="underline" href="/settings/ad-attribution">Review ad attribution</a> to
            close these gaps.
          </p>
        </SectionCard>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify the whole thing compiles**

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend && npm run typecheck && npm run lint && npm run build
```

Expected: all three clean. This is the first point in the plan where typecheck should pass; the Task 4 and 5 failures are now resolved.

- [ ] **Step 3: Verify in the browser**

Run `npm run dev` and open `/ad-performance`. Confirm each of these:

1. Six numbered sections render as separate cards with visible boundaries (section 6 only when there is a mapping gap).
2. Clicking **Leads**, **Paid leads**, **In more than one channel**, **Conversions**, **Accepted value**, and each channel tile opens a populated detail panel; clicking the active tile again closes it.
3. **Spend**, **Cost per lead**, **Paid conversions**, **Conversion rate** and **Cost per acquisition** show no chevron and do not respond to clicks.
4. Every `?` button opens an explainer and does not also trigger the tile's drill-down.
5. Nullable money still reads "Not reporting" — never `£0` or `£NaN`.
6. The Network tab shows **one** request to `/api/ad-attribution/leads`, not one per tile.

- [ ] **Step 4: Commit**

```bash
git add features/ad-performance/components/AdPerformanceScreen.tsx
git commit -m "feat(ads): cockpit drill-down routing, single leads fetch, mapping health"
```

---

### Task 7: Restyle the trend chart and final verification

**Files:**
- Modify: `frontend/features/ad-performance/components/ChannelTrend.tsx`

**Interfaces:**
- Consumes: `SectionCard`, `SecHead` from `@/components/ui`.
- Produces: nothing new.

- [ ] **Step 1: Swap the card for a section**

In `frontend/features/ad-performance/components/ChannelTrend.tsx`, replace the `Card` import:

```tsx
import { SectionCard, SecHead } from '@/components/ui';
```

Replace the opening `<Card>` and its heading:

```tsx
    <SectionCard>
      <SecHead
        n={5}
        title="Trend"
        desc="Lead volume and cost per lead month by month. These points dedupe per person within each month, so they are not additive to the totals above — someone who enquired in two different months is one lead up there but two down here. A gap in a cost line means spend was not reported that month, not that leads were free."
      />
```

Change the closing `</Card>` to `</SectionCard>`.

- [ ] **Step 2: Full verification**

```bash
cd /Users/ruhithpasha/code/work/Dental-os/frontend && npm run typecheck && npm run lint && npm run build
```

Expected: all three clean.

- [ ] **Step 3: Confirm the cockpit is still unchanged**

Open `/cockpit` one final time and confirm it renders exactly as it did before Task 1. The shared primitives have been in use by two pages since Task 4; this is the last chance to catch a style leak before the branch lands.

- [ ] **Step 4: Confirm the page end to end**

Open `/ad-performance` and re-run the six checks from Task 6 Step 3, plus:

7. The **By practice** table shows a trend sparkline on each practice's total row, and "Not enough history" where a practice has fewer than two months.
8. The **Attribution and match quality** section shows a match rate and an "Accepted value with no lead" figure that is never negative.

- [ ] **Step 5: Commit**

```bash
git add features/ad-performance/components/ChannelTrend.tsx
git commit -m "feat(ads): trend chart in the shared section skin"
```

---

## Deferred — needs backend work, deliberately not in this plan

- **Account-level mapping health.** Which of the ad accounts, GoHighLevel subaccounts and Emergent businesses map to which practice. Only the two aggregate counts are on this endpoint.
- **Spend drill-down.** Requires per-account, per-campaign or per-day spend rows on the performance response.
- **Exact cross-channel overlap.** Requires the server's `personKey` on `AdLeadLine`; the client figure is a lower bound.
- **Richer lead rows.** `practiceName`, `matchedPatientName` and `matchedAcceptedDate` come back null from this endpoint. `LeadsTable` does not render them, so nothing visibly degrades today.
- **The `"Not reporting"` cost-tile diagnosis.** `ad-attribution.service.js:343` nulls both cost metrics when a paid channel has leads but zero accumulated spend. Explaining that specific cause in the UI was explicitly excluded.
