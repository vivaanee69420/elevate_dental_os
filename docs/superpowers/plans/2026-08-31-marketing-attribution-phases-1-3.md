# Marketing Attribution (Phases 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the ad attribution GoHighLevel already sends, join it to real ad spend, and surface cost-per-lead and lead-to-patient conversion in a new Marketing section.

**Architecture:** GHL's contact list response carries `attributions[]` (campaign id, ad id, gclid) at zero extra API cost; the sync currently discards it. Persist it on `contacts`, resolve each lead to one of three attribution tiers (`campaign` / `channel` / `unattributed`), match leads to Dentally patients through an indexed UNION-ALL RPC, and read it all through a new Marketing nav section.

**Tech Stack:** Node 22 ESM, Express, Supabase Postgres (`serviceClient` + explicit `organisation_id` filters), vitest, Next.js 14 App Router, React Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-31-marketing-section-and-ad-lead-attribution-design.md`

## Global Constraints

- **Money is integer pence.** Never floats. Display as `(pence/100).toLocaleString('en-GB')`.
- **British English in all UI copy** — organisation, colour, optimise, centre.
- **No emojis** in code or UI.
- **No dark mode.** Light/white only.
- **Tenant isolation:** every new table carries `organisation_id`. Repositories use `serviceClient`, which has **no** automatic isolation — every query must chain `.eq('organisation_id', orgId)` explicitly.
- **RLS enabled with no policies** on new tables, matching the Emergent-era precedent.
- **After any hosted DDL:** `NOTIFY pgrst, 'reload schema';` — include it in the migration file.
- **Reception must never see marketing** (project rule 5). Reception is CRM-only.
- **Audit every mutation** to `audit_log`.
- Backend is **native ESM**. Relative imports carry `.js` extensions. No `require`/`module.exports`.
- Migrations are **idempotent** and must re-apply cleanly on `supabase db reset`.
- Run backend tests with `cd backend && npx vitest run <path>`. Full suite: `npm test`.

## Design note: attribution lives on `contacts`, not `leads`

The spec's §1 table says `leads`. **Implement on `contacts` instead.** `attributions[]` arrives in the contact pull, and `pullContacts` writes `contacts`. A contact holds one first-touch attribution but may own several leads; storing per-lead would duplicate it and let rows disagree. Reads join `leads → contacts`, which is already the established pattern (Cockpit dedupes on `contact_id`).

## File Structure

**Create:**
- `supabase/migrations/20260101000137_lead_attribution.sql` — attribution columns on `contacts` + indexes
- `supabase/migrations/20260101000138_ad_lead_conversions.sql` — conversion RPC + functional indexes
- `backend/src/lib/integrations/ghl-attribution.js` — pure extractors (no I/O)
- `backend/src/repositories/marketing.repository.js` — data access only
- `backend/src/services/marketing.service.js` — tier resolution, aggregation
- `backend/src/controllers/marketing.controller.js`
- `backend/src/routes/marketing.routes.js`
- `backend/test/ghl-attribution.test.mjs`
- `backend/test/marketing.service.test.mjs`
- `frontend/features/marketing/{api.ts,hooks.ts}`
- `frontend/features/marketing/components/{MarketingOverviewScreen.tsx,CampaignsScreen.tsx,TierBadge.tsx}`
- `frontend/app/(dashboard)/marketing-overview/page.tsx`
- `frontend/app/(dashboard)/marketing-campaigns/page.tsx`

**Modify:**
- `backend/src/lib/integrations/gohighlevel-sync.js` — `contactRow`, `loadContactDedupMaps`, `pullContacts`
- `backend/src/lib/permissions.js` — add `marketing.view`
- `backend/src/lib/features.js` — add `marketing` module key
- `backend/src/app.js` — mount the route
- `frontend/lib/nav.ts` — new Marketing section
- `frontend/lib/permissions.ts` — `SECTION_FEATURE`

---

# Phase 1 — Attribution ingest

### Task 1: Attribution columns on contacts

**Files:**
- Create: `supabase/migrations/20260101000137_lead_attribution.sql`

**Interfaces:**
- Produces: columns `contacts.ad_campaign_id`, `.ad_id`, `.ad_set_id`, `.gclid`, `.landing_page_url`, `.attribution_source`, `.attribution_medium`, `.attribution_campaign_name`, `.attribution_captured_at`, `.utm_source`, `.utm_medium`, `.utm_campaign`. Later tasks test "needs fill" as `attribution_captured_at IS NULL`.
- **The full set matters:** Task 3 spreads Task 2's entire extractor output into a `contacts` upsert. Any key missing a column fails the whole write.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Ad attribution on contacts. GoHighLevel returns an attributions[] array on
-- every contact in the LIST response; the sync has always discarded it. These
-- columns persist it so a lead can be joined to the campaign that produced it.
--
-- ON CONTACTS, NOT LEADS: attribution arrives in the contact pull and is
-- contact-level (one person, one first touch). A contact may own several leads;
-- storing it per-lead would duplicate it and let the copies disagree. Reads
-- join leads -> contacts.
--
-- attribution_captured_at is the "have we filled this row" flag. A single
-- nullable timestamp beats testing several columns, and records when we got it.
--
-- Additive + idempotent; re-applies cleanly on a local `supabase db reset`.
-- ============================================================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_campaign_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_set_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gclid TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS landing_page_url TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attribution_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attribution_medium TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attribution_campaign_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attribution_captured_at TIMESTAMPTZ;
-- utm_* exist on `leads` but NOT on `contacts`. contactRow spreads the whole
-- extractor output into a contacts upsert, so without these three every contact
-- write fails with "column does not exist" and the entire GHL sync breaks.
-- utmMedium is not redundant: for Meta it carries the AD SET name
-- ("Photos | 35+ | 258K | 03/08/26"), which no other column holds.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

-- The hot read: join a lead's contact to ad_metrics by campaign.
CREATE INDEX IF NOT EXISTS idx_contacts_ad_campaign
  ON contacts(organisation_id, ad_campaign_id)
  WHERE ad_campaign_id IS NOT NULL;

-- The opportunistic-fill probe: which already-synced contacts still need
-- attribution. Partial, so it stays small as coverage grows.
CREATE INDEX IF NOT EXISTS idx_contacts_attribution_pending
  ON contacts(organisation_id, ghl_contact_id)
  WHERE attribution_captured_at IS NULL AND ghl_contact_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verify it applies cleanly**

Run: `cd /Users/ruhithpasha/code/work/Dental-os && supabase db reset`
Expected: completes without error; migration `000137` listed.

If Supabase local is not running, skip and verify by re-reading the SQL for syntax. Do NOT apply to hosted in this task.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101000137_lead_attribution.sql
git commit -m "feat(db): ad attribution columns on contacts"
```

---

### Task 2: Pure attribution extractors

**Files:**
- Create: `backend/src/lib/integrations/ghl-attribution.js`
- Test: `backend/test/ghl-attribution.test.mjs`

**Interfaces:**
- Produces: `extractAttribution(ghlContact) -> object|null` and `parseGadCampaignId(url) -> string|null`. Task 3 consumes both.

Returned object shape (all keys always present, value `null` when absent):
`{ ad_campaign_id, ad_id, ad_set_id, gclid, landing_page_url, attribution_source, attribution_medium, attribution_campaign_name, utm_source, utm_medium, utm_campaign }`

- [ ] **Step 1: Write the failing test**

```javascript
// GHL attribution extraction. The LIST endpoint (/contacts/?locationId=) uses
// utm-prefixed keys — utmCampaignId, utmAdId — while the single-contact GET
// uses bare campaignId/adId for the same values. We read the list shape,
// because that is the response the sync already has in hand.
import { describe, it, expect } from 'vitest';
import { extractAttribution, parseGadCampaignId } from '../src/lib/integrations/ghl-attribution.js';

describe('parseGadCampaignId', () => {
    it('pulls gad_campaignid out of a landing page URL', () => {
        expect(parseGadCampaignId('https://gmdentalbarnet.dentaloffers.co.uk/orthodontist-lp/?gad_source=1&gad_campaignid=22794584316&gclid=CjwKCAjw'))
            .toBe('22794584316');
    });
    it('returns null when the parameter is absent, malformed or the URL is junk', () => {
        expect(parseGadCampaignId('https://example.com/lp?gclid=abc')).toBeNull();
        expect(parseGadCampaignId('not a url')).toBeNull();
        expect(parseGadCampaignId(null)).toBeNull();
        expect(parseGadCampaignId('')).toBeNull();
    });
    it('ignores a non-numeric campaign id rather than trusting it', () => {
        expect(parseGadCampaignId('https://e.com/?gad_campaignid=%7Bcampaignid%7D')).toBeNull();
    });
});

describe('extractAttribution', () => {
    const metaContact = { attributions: [
        { utmSessionSource: 'Social media', medium: 'instagram', isFirst: false },
        { utmSessionSource: 'Paid Social', adSource: 'facebook', medium: 'facebook',
          utmSource: 'facebook', utmCampaign: 'Dental Implant Open Day Sept 26',
          utmCampaignId: '120249721894530517', utmAdId: '120249722055010517',
          utmMedium: 'Photos | 35+ | 258K | 03/08/26', utmContent: 'AD 2', isFirst: true },
    ] };

    it('takes the FIRST-touch row, not merely the first array element', () => {
        // First touch is deliberate: a person later moved into an "Open Day"
        // pipeline must not steal credit from the ad that actually won them.
        const a = extractAttribution(metaContact);
        expect(a.ad_campaign_id).toBe('120249721894530517');
        expect(a.ad_id).toBe('120249722055010517');
        expect(a.attribution_source).toBe('Paid Social');
        expect(a.attribution_campaign_name).toBe('Dental Implant Open Day Sept 26');
        expect(a.utm_source).toBe('facebook');
    });

    it('falls back to the first element when no row is flagged isFirst', () => {
        const a = extractAttribution({ attributions: [{ utmSessionSource: 'Paid Search', utmGclid: 'Cj0KCQ' }] });
        expect(a.gclid).toBe('Cj0KCQ');
        expect(a.attribution_source).toBe('Paid Search');
    });

    it('recovers a Google campaign id from the landing page URL', () => {
        // Google Paid Search carries NO utmCampaignId — 305/305 sampled contacts
        // carried only utmGclid. The campaign id lives in the landing page URL.
        const a = extractAttribution({ attributions: [{
            utmSessionSource: 'Paid Search', utmGclid: 'CjwKCAjw',
            pageUrl: 'https://gmdentalbarnet.dentaloffers.co.uk/orthodontist-lp/?gad_source=1&gad_campaignid=22794584316&gclid=CjwKCAjw',
        }] });
        expect(a.ad_campaign_id).toBe('22794584316');
        expect(a.gclid).toBe('CjwKCAjw');
        expect(a.landing_page_url).toContain('orthodontist-lp');
    });

    it('prefers an explicit utmCampaignId over the URL parse', () => {
        const a = extractAttribution({ attributions: [{
            utmCampaignId: '111', pageUrl: 'https://e.com/?gad_campaignid=999' }] });
        expect(a.ad_campaign_id).toBe('111');
    });

    it('returns null when there is nothing to attribute', () => {
        expect(extractAttribution({})).toBeNull();
        expect(extractAttribution({ attributions: [] })).toBeNull();
        expect(extractAttribution(null)).toBeNull();
    });

    it('always returns every key, null-filled, so callers never see undefined', () => {
        const a = extractAttribution({ attributions: [{ utmSessionSource: 'Direct traffic' }] });
        for (const k of ['ad_campaign_id','ad_id','ad_set_id','gclid','landing_page_url',
                         'attribution_source','attribution_medium','attribution_campaign_name',
                         'utm_source','utm_medium','utm_campaign']) {
            expect(a).toHaveProperty(k);
            expect(a[k]).not.toBeUndefined();
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/ghl-attribution.test.mjs`
Expected: FAIL — cannot find module `ghl-attribution.js`.

- [ ] **Step 3: Write the implementation**

```javascript
// Pure extractors for GoHighLevel ad attribution. No I/O, so the poll path and
// the webhook path map identically — the precedent set by contactRow.
//
// FIELD NAMES MATTER: the /contacts/ LIST response uses utm-prefixed keys
// (utmCampaignId, utmAdId, utmGclid); the single-contact GET uses bare
// campaignId/adId for the same values. The sync reads the list, so we read the
// list shape. A reader written against the single-GET shape silently finds
// nothing on every contact.

// Google Paid Search leads carry no campaign id, only a click id — but the
// campaign id is present in the landing page URL that Google built:
//   .../orthodontist-lp/?gad_source=1&gad_campaignid=22794584316&gclid=...
// Only a numeric id is accepted: unexpanded ValueTrack templates arrive
// literally as "{campaignid}" and must never be stored as a campaign.
export function parseGadCampaignId(url) {
    if (!url) return null;
    let parsed;
    try { parsed = new URL(String(url)); } catch { return null; }
    const raw = parsed.searchParams.get('gad_campaignid');
    return raw && /^\d+$/.test(raw) ? raw : null;
}

const EMPTY = {
    ad_campaign_id: null, ad_id: null, ad_set_id: null, gclid: null,
    landing_page_url: null, attribution_source: null, attribution_medium: null,
    attribution_campaign_name: null, utm_source: null, utm_medium: null, utm_campaign: null,
};

const clean = (v) => (v === undefined || v === '' ? null : v ?? null);

// Pick the first-touch attribution row. A contact accumulates several — GHL
// flags them isFirst/isLast — and first touch is the project-wide rule
// (cockpit_accepted_lead_source does the same): otherwise a patient later moved
// into an "Open Day" pipeline steals credit from the ad that won them.
export function extractAttribution(contact) {
    const rows = contact?.attributions;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const a = rows.find((r) => r?.isFirst === true) ?? rows[0];
    if (!a) return null;
    const landing = clean(a.pageUrl ?? a.url);
    return {
        ...EMPTY,
        // Meta supplies the campaign id directly; Google only via the URL.
        ad_campaign_id: clean(a.utmCampaignId) ?? parseGadCampaignId(landing),
        ad_id: clean(a.utmAdId),
        ad_set_id: clean(a.adSetId),
        gclid: clean(a.utmGclid),
        landing_page_url: landing,
        attribution_source: clean(a.utmSessionSource),
        attribution_medium: clean(a.medium),
        attribution_campaign_name: clean(a.utmCampaign),
        utm_source: clean(a.utmSource),
        utm_medium: clean(a.utmMedium),
        utm_campaign: clean(a.utmCampaign),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/ghl-attribution.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/ghl-attribution.js backend/test/ghl-attribution.test.mjs
git commit -m "feat(ghl): pure extractors for contact ad attribution"
```

---

### Task 3: Write attribution through contactRow

**Files:**
- Modify: `backend/src/lib/integrations/gohighlevel-sync.js` (`contactRow`, around line 121)
- Test: `backend/test/gohighlevel-practice-stamp.test.js` (add a describe block; it already imports `contactRow`)

**Interfaces:**
- Consumes: `extractAttribution` from Task 2.
- Produces: `contactRow` output now carries the attribution columns plus `attribution_captured_at` when attribution was found.

- [ ] **Step 1: Write the failing test**

```javascript
// Appended to backend/test/gohighlevel-practice-stamp.test.js
describe('contactRow attribution', () => {
    it('stamps attribution and a capture timestamp when GHL sends it', () => {
        const r = contactRow('org-1', {
            id: 'c1', firstName: 'Ada', email: 'A@Example.com',
            attributions: [{ utmSessionSource: 'Paid Social', utmCampaignId: '120249721894530517',
                             utmAdId: '120249722055010517', isFirst: true }],
        }, 'practice-1', 'acct-1');
        expect(r.ad_campaign_id).toBe('120249721894530517');
        expect(r.ad_id).toBe('120249722055010517');
        expect(r.attribution_source).toBe('Paid Social');
        expect(typeof r.attribution_captured_at).toBe('string');
    });

    it('omits attribution keys entirely when there is none, so an upsert cannot null out a row that already has it', () => {
        const r = contactRow('org-1', { id: 'c2', firstName: 'Bob' }, null, null);
        expect(r).not.toHaveProperty('ad_campaign_id');
        expect(r).not.toHaveProperty('attribution_captured_at');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/gohighlevel-practice-stamp.test.js`
Expected: FAIL — `r.ad_campaign_id` is undefined.

- [ ] **Step 3: Implement**

Add the import at the top of `gohighlevel-sync.js`:

```javascript
import { extractAttribution } from './ghl-attribution.js';
```

Then in `contactRow`, replace the final `return { ... }` with:

```javascript
    // Attribution keys are SPREAD ONLY WHEN PRESENT. contacts is written with
    // upsert, so emitting explicit nulls would wipe attribution captured on an
    // earlier run every time GHL sends the contact back without it.
    const attribution = extractAttribution(c);
    return {
        organisation_id: orgId,
        practice_id: practiceId,
        integration_account_id: integrationAccountId,
        source: 'gohighlevel',
        ghl_contact_id: c.id ?? null,
        first_name: c.firstName ?? first ?? 'Unknown',
        last_name: c.lastName ?? (rest.join(' ') || null),
        email: c.email ? String(c.email).toLowerCase() : null,
        phone: c.phone ?? null,
        ...(createdIso ? { created_at: createdIso } : {}),
        ...(attribution ? { ...attribution, attribution_captured_at: new Date().toISOString() } : {}),
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/gohighlevel-practice-stamp.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/gohighlevel-sync.js backend/test/gohighlevel-practice-stamp.test.js
git commit -m "feat(ghl): persist contact ad attribution on sync"
```

---

### Task 4: Opportunistic fill for already-synced contacts

**Files:**
- Modify: `backend/src/lib/integrations/gohighlevel-sync.js` (`loadContactDedupMaps`, `pullContacts`)
- Test: `backend/test/ghl-attribution-fill.test.mjs` (create)

**Interfaces:**
- Consumes: `contactRow` from Task 3.
- Produces: `loadContactDedupMaps` now also returns `needsAttribution: Set<string>` of `ghl_contact_id`.

**Why:** `pullContacts` walks every contact (GHL cannot filter server-side) but only *writes* rows changed since `since`. The attribution for unchanged contacts is therefore already in memory and thrown away. Including those rows costs no extra API call.

- [ ] **Step 1: Write the failing test**

```javascript
// Opportunistic attribution fill. The nightly walk already holds every
// contact; a contact outside the incremental window whose attribution has
// never been captured is written anyway. A contact that ALREADY has
// attribution is still skipped — otherwise the incremental sync degenerates
// into a full rewrite every night.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { getByProvider: vi.fn(), markSynced: vi.fn(), markFailed: vi.fn() },
}));

const { __test } = await import('../src/lib/integrations/gohighlevel-sync.js');

describe('selectContactsToWrite', () => {
    const older = '2020-01-01T00:00:00.000Z';
    const newer = '2030-01-01T00:00:00.000Z';
    const since = '2025-01-01T00:00:00.000Z';

    it('includes contacts changed since the last sync', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'a', dateUpdated: newer }], since, new Set());
        expect(out.map((c) => c.id)).toEqual(['a']);
    });

    it('includes an UNCHANGED contact whose attribution was never captured', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'b', dateUpdated: older }], since, new Set(['b']));
        expect(out.map((c) => c.id)).toEqual(['b']);
    });

    it('skips an unchanged contact that already has attribution', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'c', dateUpdated: older }], since, new Set());
        expect(out).toEqual([]);
    });

    it('keeps a contact with no update timestamp rather than silently dropping it', () => {
        const out = __test.selectContactsToWrite([{ id: 'd' }], since, new Set());
        expect(out.map((c) => c.id)).toEqual(['d']);
    });

    it('a full run (no since) takes everything', () => {
        const out = __test.selectContactsToWrite(
            [{ id: 'e', dateUpdated: older }], null, new Set());
        expect(out.map((c) => c.id)).toEqual(['e']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/ghl-attribution-fill.test.mjs`
Expected: FAIL — `__test.selectContactsToWrite is not a function`.

- [ ] **Step 3: Implement**

In `loadContactDedupMaps`, widen the select and build the set:

```javascript
async function loadContactDedupMaps(orgId) {
    const byGhl = new Map();   // ghl_contact_id -> our id
    const byEmail = new Map(); // lower(email)   -> { id, ghl }
    const byPhone = new Map(); // normphone      -> { id, ghl }
    // ghl_contact_ids whose attribution has never been captured. Drives the
    // opportunistic fill: the walk already holds these contacts, so writing
    // them costs no extra API call.
    const needsAttribution = new Set();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data } = await supabase_1.serviceClient
            .from('contacts').select('id, ghl_contact_id, email, phone, attribution_captured_at')
            .eq('organisation_id', orgId).range(from, from + PAGE - 1);
        const rows = data ?? [];
        for (const c of rows) {
            if (c.ghl_contact_id) {
                byGhl.set(String(c.ghl_contact_id), c.id);
                if (!c.attribution_captured_at) needsAttribution.add(String(c.ghl_contact_id));
            }
            const e = c.email ? String(c.email).toLowerCase() : null;
            if (e && !byEmail.has(e)) byEmail.set(e, { id: c.id, ghl: c.ghl_contact_id });
            const np = normalizePhone(c.phone);
            if (np && !byPhone.has(np)) byPhone.set(np, { id: c.id, ghl: c.ghl_contact_id });
        }
        if (rows.length < PAGE) break;
    }
    return { byGhl, byEmail, byPhone, needsAttribution };
}

// Which fetched contacts are worth writing. Changed-since-last-sync, OR
// unchanged but still missing attribution we already hold. Pure, so the rule
// is testable without a sync.
export function selectContactsToWrite(fetched, since, needsAttribution) {
    const sinceMs = since == null ? null : Date.parse(since);
    if (sinceMs == null || Number.isNaN(sinceMs)) return fetched;
    return fetched.filter((rc) => {
        if (rc?.id != null && needsAttribution.has(String(rc.id))) return true;
        const raw = rc?.dateUpdated ?? rc?.updatedAt ?? null;
        if (raw == null) return true;   // no timestamp -> never silently dropped
        const t = Date.parse(raw);
        return Number.isNaN(t) || t >= sinceMs;
    });
}
```

In `pullContacts`, replace the `sinceMs`/`remote` block and move the dedup-map load above it:

```javascript
    const { byGhl, byEmail, byPhone, needsAttribution } = await loadContactDedupMaps(orgId);
    const remote = selectContactsToWrite(fetched, since, needsAttribution);
```

(Delete the now-duplicated `const { byGhl, byEmail, byPhone } = await loadContactDedupMaps(orgId);` line further down.)

Finally add to the `__test` export at the bottom of the file (create the export if absent):

```javascript
export const __test = { selectContactsToWrite };
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run test/ghl-attribution-fill.test.mjs test/gohighlevel-practice-stamp.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite — this task edits a hot path**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/integrations/gohighlevel-sync.js backend/test/ghl-attribution-fill.test.mjs
git commit -m "feat(ghl): opportunistic attribution fill for already-synced contacts"
```

---

# Phase 2 — Tiers and conversion

### Task 5: Lead-to-patient conversion RPC

**Files:**
- Create: `supabase/migrations/20260101000138_ad_lead_conversions.sql`

**Interfaces:**
- Produces: `ad_lead_conversions(p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid)` returning `(contact_id uuid, ad_campaign_id text, attribution_source text, converted boolean, matched_by text)`.

**Window convention:** `since`/`until` come from the shared `ScopePeriod` window, which produces **ISO datetimes with an EXCLUSIVE `until`** (`resolveWindow` returns the start of the next London day/month). The RPC must therefore be `>= p_since AND < p_until` — a `<=` or a `+1` here double-counts the boundary day.

**Why UNION ALL:** measured at 25,127 leads × 63,349 patients, a single OR'd join forces a nested loop and times out through PostgREST while running fine in the SQL editor. Same lesson as `cockpit_accepted_lead_source` (`000112`).

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- ad_lead_conversions — did a GoHighLevel lead become a Dentally patient?
--
-- This is DELIBERATELY NOT the ad platforms' own `conversions` figure. Google
-- and Facebook count a form submission; this counts a person who appears in
-- Dentally. Both are shown in the UI, labelled distinctly. Never conflate them.
--
-- MUST be a UNION ALL of equi-joins, never one OR'd join: measured at 25,127
-- lead contacts against 63,349 patients, the OR form plans a nested loop and
-- times out through PostgREST while looking fine in the SQL editor. Same
-- lesson as cockpit_accepted_lead_source (000112).
--
-- Matching is email OR last-10-digits of phone. Dentally patients are contacts
-- with a pms_external_id. Org-scoped on every arm (rule 3).
-- ============================================================================

-- Functional indexes the equi-joins need; without these each arm seq-scans.
CREATE INDEX IF NOT EXISTS idx_contacts_org_lower_email
  ON contacts(organisation_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_org_phone10
  ON contacts(organisation_id, right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10))
  WHERE phone IS NOT NULL;

-- p_since/p_until are timestamptz and the window is HALF-OPEN: >= since, < until.
-- The shared ScopePeriod window already hands us the start of the next London
-- day/month as `until`, so any <= or +1 here would double-count the boundary.
CREATE OR REPLACE FUNCTION ad_lead_conversions(
  p_org uuid, p_since timestamptz, p_until timestamptz, p_practice uuid DEFAULT NULL
)
RETURNS TABLE (
  contact_id uuid, ad_campaign_id text, attribution_source text,
  converted boolean, matched_by text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lead_contacts AS (
    SELECT DISTINCT c.id, c.ad_campaign_id, c.attribution_source,
           lower(c.email) AS em,
           right(regexp_replace(coalesce(c.phone,''), '[^0-9]', '', 'g'), 10) AS ph
    FROM leads l
    JOIN contacts c ON c.id = l.contact_id AND c.organisation_id = p_org
    WHERE l.organisation_id = p_org
      AND l.created_at >= p_since AND l.created_at < p_until
      AND (p_practice IS NULL OR l.practice_id = p_practice)
      AND c.pms_external_id IS NULL          -- the lead side, not the patient side
  ),
  patients AS (
    SELECT lower(email) AS em,
           right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) AS ph
    FROM contacts
    WHERE organisation_id = p_org AND pms_external_id IS NOT NULL
  ),
  matches AS (
    SELECT lc.id, 'email'::text AS how
    FROM lead_contacts lc JOIN patients p ON p.em = lc.em
    WHERE lc.em IS NOT NULL
    UNION ALL
    SELECT lc.id, 'phone'::text
    FROM lead_contacts lc JOIN patients p ON p.ph = lc.ph
    WHERE length(lc.ph) >= 10
  )
  SELECT lc.id, lc.ad_campaign_id, lc.attribution_source,
         (m.id IS NOT NULL) AS converted,
         min(m.how) AS matched_by
  FROM lead_contacts lc
  LEFT JOIN matches m ON m.id = lc.id
  GROUP BY lc.id, lc.ad_campaign_id, lc.attribution_source, (m.id IS NOT NULL);
$$;

-- SECURITY DEFINER + p_org means this must never be callable by an anon or
-- end-user role; the backend calls it with the service key. Mandatory idiom.
REVOKE ALL ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ad_lead_conversions(uuid, timestamptz, timestamptz, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verify syntax**

Run: `cd /Users/ruhithpasha/code/work/Dental-os && supabase db reset`
Expected: applies without error. If local Supabase is unavailable, re-read the SQL carefully; do NOT apply to hosted here.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260101000138_ad_lead_conversions.sql
git commit -m "feat(db): ad_lead_conversions RPC (UNION ALL equi-joins)"
```

---

### Task 6: Tier resolution and marketing aggregation

**Files:**
- Create: `backend/src/repositories/marketing.repository.js`
- Create: `backend/src/services/marketing.service.js`
- Test: `backend/test/marketing.service.test.mjs`

**Interfaces:**
- Consumes: `ad_lead_conversions` RPC (Task 5), `contacts` attribution columns (Task 1).
- Produces:
  - `marketingRepository.campaignSpend(orgId, since, until, practiceId) -> [{provider, customer_id, campaign_id, campaign_name, spend_pence, impressions, clicks, conversions}]`
  - `marketingRepository.leadsByCampaign(orgId, since, until, practiceId) -> [{ad_campaign_id, attribution_source, contact_id, converted}]`
  - `marketingService.resolveTier(lead) -> 'campaign'|'channel'|'unattributed'`
  - `marketingService.campaignPerformance(orgId, {since, until, practiceId}) -> {rows, totals}`

- [ ] **Step 1: Write the failing test**

```javascript
// Tier model + campaign aggregation. Every figure must declare which tier it
// came from: a blended number must never present itself as a measured one.
import { describe, it, expect } from 'vitest';
const { __test } = await import('../src/services/marketing.service.js');

describe('resolveTier', () => {
    it('campaign tier when the lead carries a campaign id', () => {
        expect(__test.resolveTier({ ad_campaign_id: '120249721894530517' })).toBe('campaign');
    });
    it('channel tier when only a mapped pipeline channel is known', () => {
        expect(__test.resolveTier({ ad_campaign_id: null, channel: 'meta_ads' })).toBe('channel');
    });
    it('unattributed when neither is present', () => {
        expect(__test.resolveTier({ ad_campaign_id: null, channel: null })).toBe('unattributed');
    });
    it('campaign id WINS over a pipeline channel — tiers are strictly ordered', () => {
        // A lead that resolves at campaign level never consults the pipeline map.
        expect(__test.resolveTier({ ad_campaign_id: '111', channel: 'google_ads' })).toBe('campaign');
    });
});

describe('joinSpendToLeads', () => {
    const spend = [
        { provider: 'meta_ads', campaign_id: '120249721894530517', campaign_name: 'Dental Implant Open Day Sept 26',
          spend_pence: 147265, impressions: 105437, clicks: 2400, conversions: 412 },
        { provider: 'google_ads', campaign_id: '22794584316', campaign_name: '.G New Patient',
          spend_pence: 88668, impressions: 10916, clicks: 764, conversions: 52 },
    ];
    const leads = [
        { ad_campaign_id: '120249721894530517', contact_id: 'c1', converted: true },
        { ad_campaign_id: '120249721894530517', contact_id: 'c2', converted: false },
        { ad_campaign_id: '22794584316', contact_id: 'c3', converted: true },
        { ad_campaign_id: null, contact_id: 'c4', converted: false },
    ];

    it('computes cost per lead in integer pence, per campaign', () => {
        const { rows } = __test.joinSpendToLeads(spend, leads);
        const meta = rows.find((r) => r.campaignId === '120249721894530517');
        expect(meta.leads).toBe(2);
        expect(meta.spendPence).toBe(147265);
        expect(meta.costPerLeadPence).toBe(73633);  // round(147265 / 2)
        expect(meta.patients).toBe(1);
        expect(meta.costPerPatientPence).toBe(147265);
    });

    it('counts PEOPLE, not lead rows — one contact in two pipelines is one lead', () => {
        const dupes = [
            { ad_campaign_id: '22794584316', contact_id: 'c9', converted: false },
            { ad_campaign_id: '22794584316', contact_id: 'c9', converted: false },
        ];
        const { rows } = __test.joinSpendToLeads(spend, dupes);
        expect(rows.find((r) => r.campaignId === '22794584316').leads).toBe(1);
    });

    it('never divides by zero — a campaign with spend and no leads has null CPL, not Infinity', () => {
        const { rows } = __test.joinSpendToLeads(spend, []);
        expect(rows.every((r) => r.costPerLeadPence === null)).toBe(true);
    });

    it('keeps unattributed leads out of every campaign row but counted in totals', () => {
        const { rows, totals } = __test.joinSpendToLeads(spend, leads);
        expect(rows.some((r) => r.campaignId === null)).toBe(false);
        expect(totals.unattributedLeads).toBe(1);
        expect(totals.leads).toBe(4);
    });

    it('reports platform conversions separately from real patients', () => {
        // Google/Facebook count a form submission; we count someone in Dentally.
        const { totals } = __test.joinSpendToLeads(spend, leads);
        expect(totals.platformConversions).toBe(464);   // 412 + 52
        expect(totals.patients).toBe(2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/marketing.service.test.mjs`
Expected: FAIL — cannot find module `marketing.service.js`.

- [ ] **Step 3: Write the repository**

```javascript
// Marketing data access — queries in, rows out. No logic here.
// serviceClient has NO automatic isolation: every query filters
// organisation_id explicitly (rule 3).
import * as supabase_1 from '../lib/supabase.js';

export const marketingRepository = {
    // Spend per campaign per provider over the window. ad_metrics is campaign x
    // day; this collapses it to campaign. Paginated: PostgREST caps reads at
    // 1000 rows and a 6-month window across several accounts exceeds that.
    async campaignSpend(orgId, since, until, practiceId = null) {
        const PAGE = 1000;
        const out = [];
        for (let from = 0; ; from += PAGE) {
            let q = supabase_1.serviceClient
                .from('ad_metrics')
                .select('provider, customer_id, campaign_id, campaign_name, spend_pence, impressions, clicks, conversions')
                .eq('organisation_id', orgId)
                // metric_date is a DATE while the scope window is an ISO
                // datetime with an EXCLUSIVE until — slice to the date part and
                // keep the half-open comparison, or the last day double-counts.
                .gte('metric_date', String(since).slice(0, 10))
                .lt('metric_date', String(until).slice(0, 10))
                .range(from, from + PAGE - 1);
            if (practiceId) q = q.eq('practice_id', practiceId);
            const { data, error } = await q;
            if (error) throw new Error(`ad_metrics read: ${error.message}`);
            const rows = data ?? [];
            out.push(...rows);
            if (rows.length < PAGE) break;
        }
        // Collapse campaign x day -> campaign.
        const byCampaign = new Map();
        for (const r of out) {
            const k = `${r.provider}|${r.campaign_id}`;
            const e = byCampaign.get(k) ?? {
                provider: r.provider, customer_id: r.customer_id, campaign_id: r.campaign_id,
                campaign_name: r.campaign_name, spend_pence: 0, impressions: 0, clicks: 0, conversions: 0,
            };
            e.spend_pence += Number(r.spend_pence ?? 0);
            e.impressions += Number(r.impressions ?? 0);
            e.clicks += Number(r.clicks ?? 0);
            e.conversions += Number(r.conversions ?? 0);
            if (!e.campaign_name && r.campaign_name) e.campaign_name = r.campaign_name;
            byCampaign.set(k, e);
        }
        return [...byCampaign.values()];
    },

    // Leads with their attribution and whether they became a Dentally patient.
    async leadsByCampaign(orgId, since, until, practiceId = null) {
        const { data, error } = await supabase_1.serviceClient.rpc('ad_lead_conversions', {
            p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
        });
        if (error) throw new Error(`ad_lead_conversions: ${error.message}`);
        return (data ?? []).map((r) => ({
            ad_campaign_id: r.ad_campaign_id ?? null,
            attribution_source: r.attribution_source ?? null,
            contact_id: r.contact_id,
            converted: r.converted === true,
        }));
    },
};
```

- [ ] **Step 4: Write the service**

```javascript
// Marketing business logic: attribution tiers + campaign performance.
// Money is integer pence throughout (rule 2) — never floats.
import { marketingRepository } from '../repositories/marketing.repository.js';

// Tiers are STRICTLY ORDERED. A lead that carries a campaign id never consults
// the pipeline map; the map exists only for the residue. Every figure the UI
// renders declares its tier so a blended number can never masquerade as a
// measured one.
function resolveTier(lead) {
    if (lead?.ad_campaign_id) return 'campaign';
    if (lead?.channel) return 'channel';
    return 'unattributed';
}

// Integer-pence division that refuses to invent a number. A campaign with
// spend and no leads has NO cost per lead — null, never Infinity or 0.
function perUnitPence(totalPence, units) {
    return units > 0 ? Math.round(totalPence / units) : null;
}

function joinSpendToLeads(spendRows, leadRows) {
    // Count PEOPLE, not lead rows: one contact sitting in several pipelines is
    // one lead. This is the same correction made in the Cockpit's matchBreakdown.
    const peopleByCampaign = new Map();   // campaign_id -> Map<contact_id, converted>
    let unattributedPeople = new Set();
    const allPeople = new Set();

    for (const l of leadRows) {
        allPeople.add(l.contact_id);
        if (!l.ad_campaign_id) { unattributedPeople.add(l.contact_id); continue; }
        if (!peopleByCampaign.has(l.ad_campaign_id)) peopleByCampaign.set(l.ad_campaign_id, new Map());
        const m = peopleByCampaign.get(l.ad_campaign_id);
        m.set(l.contact_id, (m.get(l.contact_id) ?? false) || l.converted);
    }

    const rows = spendRows.map((s) => {
        const people = peopleByCampaign.get(s.campaign_id) ?? new Map();
        const leads = people.size;
        const patients = [...people.values()].filter(Boolean).length;
        return {
            provider: s.provider,
            campaignId: s.campaign_id,
            campaignName: s.campaign_name,
            spendPence: s.spend_pence,
            impressions: s.impressions,
            clicks: s.clicks,
            platformConversions: s.conversions,
            leads,
            patients,
            costPerLeadPence: perUnitPence(s.spend_pence, leads),
            costPerPatientPence: perUnitPence(s.spend_pence, patients),
            tier: 'campaign',
        };
    }).sort((a, b) => b.spendPence - a.spendPence);

    const totals = {
        spendPence: rows.reduce((n, r) => n + r.spendPence, 0),
        impressions: rows.reduce((n, r) => n + r.impressions, 0),
        clicks: rows.reduce((n, r) => n + r.clicks, 0),
        platformConversions: rows.reduce((n, r) => n + r.platformConversions, 0),
        leads: allPeople.size,
        patients: rows.reduce((n, r) => n + r.patients, 0),
        unattributedLeads: unattributedPeople.size,
    };
    totals.costPerLeadPence = perUnitPence(totals.spendPence, totals.leads);
    totals.costPerPatientPence = perUnitPence(totals.spendPence, totals.patients);
    return { rows, totals };
}

export const marketingService = {
    async campaignPerformance(orgId, { since, until, practiceId = null } = {}) {
        const [spend, leads] = await Promise.all([
            marketingRepository.campaignSpend(orgId, since, until, practiceId),
            marketingRepository.leadsByCampaign(orgId, since, until, practiceId),
        ]);
        return joinSpendToLeads(spend, leads);
    },
};

export const __test = { resolveTier, joinSpendToLeads, perUnitPence };
```

- [ ] **Step 5: Run tests**

Run: `cd backend && npx vitest run test/marketing.service.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repositories/marketing.repository.js backend/src/services/marketing.service.js backend/test/marketing.service.test.mjs
git commit -m "feat(marketing): attribution tiers and campaign performance aggregation"
```

---

# Phase 3 — Marketing section

### Task 7: Backend route, feature key, permission key

**Files:**
- Create: `backend/src/controllers/marketing.controller.js`
- Create: `backend/src/routes/marketing.routes.js`
- Modify: `backend/src/lib/permissions.js`, `backend/src/lib/features.js`, `backend/src/app.js`
- Test: `backend/test/marketing.routes.test.mjs`

**Interfaces:**
- Consumes: `marketingService.campaignPerformance` (Task 6).
- Produces: `GET /api/marketing/performance?scope=&since=&until=` → `{ rows, totals }`. `scope` is `'all'` or a practice UUID; `since`/`until` are ISO datetimes, half-open.

- [ ] **Step 1: Write the failing test**

```javascript
// Marketing route wiring: the permission key exists, the feature key exists,
// and Reception can never reach it (project rule 5 — Reception is CRM-only).
import { describe, it, expect } from 'vitest';
const { PERMISSION_CATALOG, DEFAULT_ROLE_PERMISSIONS } = await import('../src/lib/permissions.js');
const { FEATURE_CATALOG } = await import('../src/lib/features.js');

describe('marketing gating', () => {
    it('registers a marketing.view permission', () => {
        expect(PERMISSION_CATALOG).toHaveProperty('marketing.view');
    });
    it('registers a marketing module feature defaulting ON with its nav section', () => {
        expect(FEATURE_CATALOG.marketing).toMatchObject({
            kind: 'module', default: true, navSection: 'Marketing',
        });
    });
    it('grants marketing.view to practice_manager but NEVER to reception', () => {
        expect(DEFAULT_ROLE_PERMISSIONS.practice_manager['marketing.view']).toBe(true);
        expect(DEFAULT_ROLE_PERMISSIONS.reception['marketing.view']).toBeUndefined();
    });
    it('owner keeps everything, marketing included', () => {
        expect(DEFAULT_ROLE_PERMISSIONS.owner['marketing.view']).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/marketing.routes.test.mjs`
Expected: FAIL — `marketing.view` missing.

- [ ] **Step 3: Register the keys**

In `backend/src/lib/permissions.js`, add to `PERMISSION_CATALOG` after `'growth.view'`:

```javascript
  'marketing.view': 'View marketing (campaigns, ad spend, cost per lead)',
```

and to `DEFAULT_ROLE_PERMISSIONS.practice_manager`:

```javascript
    'marketing.view': true,
```

In `backend/src/lib/features.js`, add to `FEATURE_CATALOG` after the `growth` entry:

```javascript
  marketing:       { label: 'Marketing', kind: 'module', default: true, navSection: 'Marketing' },
```

- [ ] **Step 4: Write the controller**

```javascript
// Marketing controller — parse/validate, call the service, shape the response.
// No business logic.
import { z } from 'zod';
import { marketingService } from '../services/marketing.service.js';

// The shared ScopePeriod bar sends ISO datetimes (not plain dates) and a
// `scope` that is either the literal 'all' or a practice UUID. Guard the UUID
// rather than trusting the string — the same pattern Contacts/Leads/Pipeline use.
const PerformanceQuerySchema = z.object({
    since: z.string().datetime({ offset: true }),
    until: z.string().datetime({ offset: true }),
    scope: z.string().optional(),
    label: z.string().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getPerformance(req, res, next) {
    try {
        const q = PerformanceQuerySchema.parse(req.query);
        const practiceId = q.scope && UUID_RE.test(q.scope) ? q.scope : null;
        const data = await marketingService.campaignPerformance(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId,
        });
        res.json(data);
    } catch (err) { next(err); }
}
```

- [ ] **Step 5: Write the route and mount it**

`backend/src/routes/marketing.routes.js`:

```javascript
import express from 'express';
import { requireRole } from '../middleware/auth.js';
import { requireFeature } from '../middleware/features.js';
import { getPerformance } from '../controllers/marketing.controller.js';

const router = express.Router();

// Reception is CRM-only (rule 5) and must never reach marketing figures.
router.get('/performance', requireRole('owner', 'practice_manager'), getPerformance);

export default router;
```

In `backend/src/app.js`, beside the other `/api` mounts:

```javascript
import marketingRoutes from './routes/marketing.routes.js';
// ...
app.use('/api/marketing', authenticate, audit, requireFeature('marketing'), marketingRoutes);
```

Match the exact mount style used by neighbouring routes in `app.js` — read the surrounding lines and follow them rather than copying this verbatim if they differ.

- [ ] **Step 6: Run tests**

Run: `cd backend && npx vitest run test/marketing.routes.test.mjs && npm test`
Expected: all green. The features module-gate test (`test/features.module-gates.test.mjs`) pins the gated/ungated route lists — if it fails, add `/api/marketing` to the gated list, which is correct here since Marketing is its own nav section.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/marketing.controller.js backend/src/routes/marketing.routes.js backend/src/lib/permissions.js backend/src/lib/features.js backend/src/app.js backend/test/marketing.routes.test.mjs
git commit -m "feat(marketing): performance endpoint, feature key and permission key"
```

---

### Task 8: Frontend slice and Marketing nav section

**Files:**
- Create: `frontend/features/marketing/api.ts`, `frontend/features/marketing/hooks.ts`, `frontend/features/marketing/components/TierBadge.tsx`, `frontend/features/marketing/components/MarketingOverviewScreen.tsx`
- Create: `frontend/app/(dashboard)/marketing-overview/page.tsx`
- Modify: `frontend/lib/nav.ts`, `frontend/lib/permissions.ts`

**Interfaces:**
- Consumes: `GET /api/marketing/performance` (Task 7).
- Produces: `useMarketingPerformance()` hook; `CampaignRow`/`MarketingTotals` types used by Task 9.

- [ ] **Step 1: Write the API client**

```typescript
// Marketing API client. NOTE the /api prefix: the Next proxy forwards the path
// verbatim, so omitting it 404s SILENTLY into an empty state.
import { api } from '@/lib/api';

export type Tier = 'campaign' | 'channel' | 'unattributed';

export interface CampaignRow {
  provider: 'google_ads' | 'meta_ads';
  campaignId: string;
  campaignName: string | null;
  spendPence: number;
  impressions: number;
  clicks: number;
  platformConversions: number;
  leads: number;
  patients: number;
  costPerLeadPence: number | null;
  costPerPatientPence: number | null;
  tier: Tier;
}

export interface MarketingTotals {
  spendPence: number;
  impressions: number;
  clicks: number;
  platformConversions: number;
  leads: number;
  patients: number;
  unattributedLeads: number;
  costPerLeadPence: number | null;
  costPerPatientPence: number | null;
}

export interface MarketingPerformance { rows: CampaignRow[]; totals: MarketingTotals }

export const EMPTY_PERFORMANCE: MarketingPerformance = {
  rows: [],
  totals: {
    spendPence: 0, impressions: 0, clicks: 0, platformConversions: 0,
    leads: 0, patients: 0, unattributedLeads: 0,
    costPerLeadPence: null, costPerPatientPence: null,
  },
};

export async function fetchMarketingPerformance(qs: string): Promise<MarketingPerformance> {
  return api(`/api/marketing/performance?${qs}`);
}
```

- [ ] **Step 2: Write the hook**

```typescript
// useScopePeriod returns { scope, win: { since, until, label } } — NOT a flat
// since/until. windowParams and scopeKey are the shared helpers every other
// analytics hook uses; going around them is how a screen ends up disagreeing
// with the rest of the dashboard about which window it is showing.
import { useQuery } from '@tanstack/react-query';
import { useScopePeriod, windowParams, scopeKey } from '@/features/_shared/scope-context';
import { fetchMarketingPerformance, type MarketingPerformance } from './api';

export function useMarketingPerformance() {
  const { scope, win } = useScopePeriod();
  return useQuery<MarketingPerformance>({
    queryKey: ['marketing', 'performance', scopeKey({ scope, win })],
    queryFn: () => fetchMarketingPerformance(windowParams(scope, win)),
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Write TierBadge**

```tsx
// Every marketing figure declares how it was attributed. A blended number must
// never present itself as a measured one.
const LABEL: Record<string, string> = {
  campaign: 'Matched to campaign',
  channel: 'Channel only',
  unattributed: 'Unattributed',
};
const STYLE: Record<string, string> = {
  campaign: 'bg-brand-50 text-brand',
  channel: 'bg-[#FDF3E4] text-warning',
  unattributed: 'bg-bg text-ink-muted',
};

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${STYLE[tier] ?? STYLE.unattributed}`}>
      {LABEL[tier] ?? LABEL.unattributed}
    </span>
  );
}
```

- [ ] **Step 4: Write the Overview screen**

```tsx
'use client';
// Marketing overview — spend, leads, cost per lead and real patients for the
// scoped window. Money is integer pence; display via formatPence.
//
// Leads that became patients is measured against Dentally, NOT the ad
// platforms' own conversion counter. Both are shown, labelled distinctly:
// Google and Facebook count a form submission, we count someone who walked in.
import { PageHeader, KpiTile, EmptyState, SkeletonKpiRow } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useMarketingPerformance } from '../hooks';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));

export default function MarketingOverviewScreen() {
  const { data, isLoading, isError, error } = useMarketingPerformance();
  const t = data?.totals;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Marketing overview"
        subtitle="Spend, leads and real patients per campaign, measured against your own records."
      />
      <ScopePeriodBar />
      {isError ? (
        <EmptyState message={`Couldn't load marketing data: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading || !t ? (
        <SkeletonKpiRow count={5} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiTile label="Ad spend" value={money(t.spendPence)} />
            <KpiTile label="Leads" value={t.leads.toLocaleString('en-GB')} />
            <KpiTile label="Cost per lead" value={money(t.costPerLeadPence)} />
            <KpiTile label="Became patients" value={t.patients.toLocaleString('en-GB')} />
            <KpiTile label="Cost per patient" value={money(t.costPerPatientPence)} />
          </div>
          {t.unattributedLeads > 0 ? (
            <p className="text-[13px] text-ink-muted">
              {t.unattributedLeads.toLocaleString('en-GB')} leads in this window carry no ad
              tracking, so they are counted in the lead total but not against any campaign.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
```

Signatures confirmed against `frontend/components/ui`: `PageHeader({ title, subtitle })`, `KpiTile({ label, value, delta?, deltaTone?, info?, onClick?, active? })`, `EmptyState({ message, icon? })`, `SkeletonKpiRow({ count })`, `SkeletonTable({ rows, cols })`. Use them as written above.

- [ ] **Step 5: Add the page and nav entries**

`frontend/app/(dashboard)/marketing-overview/page.tsx`:

```tsx
export { default } from '@/features/marketing/components/MarketingOverviewScreen';
```

In `frontend/lib/nav.ts`, add a new section after the `Growth` section:

```typescript
  { label: 'Marketing', items: [
    { id: 'marketing-overview', label: 'Overview', isNew: true },
    { id: 'marketing-campaigns', label: 'Campaigns', isNew: true },
  ]},
```

In `frontend/lib/permissions.ts`, add to `SECTION_FEATURE`:

```typescript
  Marketing: 'marketing',
```

- [ ] **Step 6: Verify**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/features/marketing frontend/app/\(dashboard\)/marketing-overview frontend/lib/nav.ts frontend/lib/permissions.ts
git commit -m "feat(marketing): overview screen and Marketing nav section"
```

---

### Task 9: Campaigns table

**Files:**
- Create: `frontend/features/marketing/components/CampaignsScreen.tsx`
- Create: `frontend/app/(dashboard)/marketing-campaigns/page.tsx`

**Interfaces:**
- Consumes: `useMarketingPerformance`, `CampaignRow`, `TierBadge` (Task 8).

- [ ] **Step 1: Write the screen**

```tsx
'use client';
// Campaigns — one row per campaign, highest spend first, with the cost of a
// lead and of a real patient beside it.
//
// Platform conversions and patients are DIFFERENT NUMBERS and are shown in
// separate columns on purpose: Google and Facebook count a form submission,
// "Patients" counts someone matched to a Dentally record.
import { useState } from 'react';
import { PageHeader, EmptyState, SkeletonTable } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useMarketingPerformance } from '../hooks';
import { TierBadge } from './TierBadge';
import type { CampaignRow } from '../api';

const money = (p: number | null) => (p === null ? '—' : formatPence(p));
const CHANNEL: Record<string, string> = { google_ads: 'Google', meta_ads: 'Facebook' };

export default function CampaignsScreen() {
  const { data, isLoading, isError, error } = useMarketingPerformance();
  const [provider, setProvider] = useState<string | null>(null);
  const rows: CampaignRow[] = (data?.rows ?? []).filter((r) => !provider || r.provider === provider);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Campaigns"
        subtitle="Every campaign with spend in this window, ordered by spend."
      />
      <ScopePeriodBar />

      <div className="flex gap-2">
        {[null, 'google_ads', 'meta_ads'].map((p) => (
          <button
            key={p ?? 'all'}
            type="button"
            onClick={() => setProvider(p)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] ${
              provider === p ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-ink-muted hover:bg-bg'
            }`}
          >
            {p === null ? 'All channels' : CHANNEL[p]}
          </button>
        ))}
      </div>

      {isError ? (
        <EmptyState message={`Couldn't load campaigns: ${(error as Error)?.message ?? 'unknown error'}`} />
      ) : isLoading ? (
        <SkeletonTable rows={8} cols={8} />
      ) : rows.length === 0 ? (
        <EmptyState message="No campaign spend in this window. Connect Google Ads or Meta Ads in Integrations to see campaigns here." />
      ) : (
        <div className="overflow-x-auto rounded-panel border border-border bg-surface">
          <table className="w-full text-[13.5px]">
            <thead className="bg-bg">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-ink-muted">Campaign</th>
                <th className="px-4 py-3 text-left font-medium text-ink-muted">Channel</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Spend</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Clicks</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Leads</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Cost per lead</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Patients</th>
                <th className="px-4 py-3 text-right font-medium text-ink-muted">Cost per patient</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.provider}-${r.campaignId}`} className="border-t border-border hover:bg-bg">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{r.campaignName ?? r.campaignId}</div>
                    <div className="mt-1"><TierBadge tier={r.tier} /></div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{CHANNEL[r.provider] ?? r.provider}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(r.spendPence)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.clicks.toLocaleString('en-GB')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.leads.toLocaleString('en-GB')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(r.costPerLeadPence)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.patients.toLocaleString('en-GB')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(r.costPerPatientPence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the page**

`frontend/app/(dashboard)/marketing-campaigns/page.tsx`:

```tsx
export { default } from '@/features/marketing/components/CampaignsScreen';
```

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add frontend/features/marketing/components/CampaignsScreen.tsx frontend/app/\(dashboard\)/marketing-campaigns
git commit -m "feat(marketing): campaigns table with cost per lead and per patient"
```

---

## Final verification

- [ ] `cd backend && npm test` — full suite green
- [ ] `cd backend && npm run lint` — 0 errors
- [ ] `cd frontend && npm run typecheck && npm run lint && npm run build` — clean
- [ ] `yes | ggshield secret scan path <changed files>` — no secrets

## Applying migrations to hosted

**Not part of any task above — do this deliberately, with the owner.**

Apply `000137` then `000138` to project `mkfhpzjbijbachoonytt`, then run `NOTIFY pgrst, 'reload schema';` (both migrations include it, but confirm). Verify with:

```sql
select column_name from information_schema.columns
 where table_name='contacts' and column_name like '%attribution%' or column_name='ad_campaign_id';
select proname from pg_proc where proname='ad_lead_conversions';
```

Attribution only starts populating on the next GHL sync, and `MAX_PAGES = 50` caps a routine run at ~5k rows per resource — so coverage builds over several nightly runs rather than appearing at once. Expect the Marketing section to be sparse on day one; that is the designed behaviour, and the unattributed-leads note on the overview makes it visible.

## Deferred to later phases

The spec's Google resolution **route B** (`gclid` -> Google Ads `click_view` GAQL) is NOT in this plan. Route A (the `gad_campaignid` URL parse, Task 2) ships first precisely so its real coverage can be measured; build route B only if that number comes back low. Also deferred: Phase 4 (mapping screen rebuild — mockup at https://claude.ai/code/artifact/33fa0836-9344-4f72-8ae4-4541ff46ebff), Phase 5 (`ad_entities`/`ad_insights` ad-set and ad depth, Meta action-type breakdown), Phase 6 (keywords and demographics). The `channel` tier's pipeline fallback is defined in `resolveTier` but not yet fed by `ad_channel_pipelines` — that wiring belongs with Phase 4.
