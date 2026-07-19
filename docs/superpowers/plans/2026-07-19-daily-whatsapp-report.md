# Daily WhatsApp Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the owner one WhatsApp message every day at 18:00 Europe/London summarising the previous day's leads, ad spend, efficiency, cash and headline clinical/finance figures, delivered by POSTing a flat JSON payload to a GoHighLevel Inbound Webhook.

**Architecture:** A node-cron job composes existing services (`adAttributionService.getPerformance`, `cockpitService.build`, `analyticsService.businessHub`) into a metrics object, a pure formatter renders it as a single ≤350-character pipe-separated line, and a thin HTTP client POSTs it to a per-organisation webhook URL stored encrypted in a new `whatsapp_report_settings` table. An owner-only UI card on the Integrations page saves the URL, previews the line and triggers a manual send through the identical code path.

**Tech Stack:** Node 20 ESM, Express, Supabase Postgres, vitest (`.mjs` tests), Next.js 14 App Router, React Query v5.

Spec: `docs/superpowers/specs/2026-07-19-daily-whatsapp-report-design.md`

## Global Constraints

- Backend is **native ESM**. Use `import`/`export`, relative imports carry `.js` extensions. Never `require`/`module.exports`.
- Namespace-star import convention in converted files: `import * as supabase_1 from "../lib/supabase.js";`
- Repositories use `serviceClient` and MUST carry an explicit `.eq('organisation_id', orgId)` on every query. There is no automatic tenant isolation on this path.
- Repositories expose `_client()` indirection so tests can stub Supabase.
- All money is **integer pence**. Never floats. Formatting to `£` happens only in the formatter.
- British English in all UI copy (organisation, colour, optimise, centre).
- No emojis in code or UI.
- No dark mode — light/white only.
- Audit every mutation to `audit_log` (handled by the existing `audit` middleware on `/api` routes).
- Tests are `.mjs` files in `backend/test/`, using `import { supaRec } from './setup.js'`.
- Frontend styling: inline `style={{}}` objects, CSS vars `var(--brand)` / `var(--border)`, `className="card-padded"`, font sizes 10/12/16, `borderRadius: 6` for controls.
- `report_line` max length: **350 characters**. Never contains newlines, tabs, or 4+ consecutive spaces.
- Null spend renders `not reporting`, never `£0`.

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260101000117_whatsapp_report_settings.sql` | Create the settings table |
| `backend/src/services/daily-report.format.js` | **Pure.** Date window, money/percent formatting, `formatReportLine` |
| `backend/src/repositories/whatsapp-report.repository.js` | Settings CRUD, encrypt/decrypt the URL |
| `backend/src/lib/integrations/ghl-webhook.js` | POST JSON to a GHL inbound webhook, with retries |
| `backend/src/services/daily-report.service.js` | Compose services → metrics → line → send; status recording |
| `backend/src/models/daily-report.model.js` | Zod schema for the settings payload |
| `backend/src/controllers/daily-report.controller.js` | HTTP shaping + manual-send rate limit |
| `backend/src/routes/integrations.routes.js` | Modify: 4 new routes |
| `backend/src/workers/index.js` | Modify: 1 new cron entry |
| `frontend/features/integrations/api.ts` | Modify: 4 fetch functions |
| `frontend/features/integrations/hooks.ts` | Modify: 4 React Query hooks |
| `frontend/features/integrations/components/DailyReportCard.tsx` | The UI card |
| `frontend/features/integrations/components/GoHighLevelPanel.tsx` | Modify: mount the card |

Split rationale: the formatter is pure and carries almost all the test value, so it lives alone. The webhook client is the only network I/O and is stubbed in service tests. The service orchestrates but contains no formatting or SQL.

---

### Task 1: Settings table and repository

**Files:**
- Create: `supabase/migrations/20260101000117_whatsapp_report_settings.sql`
- Create: `backend/src/repositories/whatsapp-report.repository.js`
- Test: `backend/test/whatsapp-report.repository.test.mjs`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret` from `backend/src/lib/crypto.js` (needs env `INTEGRATIONS_SECRET_KEY`).
- Produces:
  - `whatsappReportRepository.get(orgId)` → `{ organisationId, webhookUrl, enabled, lastSentAt, lastStatus, lastError } | null` (webhookUrl decrypted)
  - `whatsappReportRepository.upsert(orgId, { webhookUrl, enabled })` → same shape
  - `whatsappReportRepository.listEnabled()` → `[{ organisationId, webhookUrl, enabled, lastSentAt }]` (all orgs, cron use)
  - `whatsappReportRepository.markSent(orgId, { status, error, payload, sentAt })` → `void`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260101000117_whatsapp_report_settings.sql`:

```sql
-- ============================================================================
-- whatsapp_report_settings — per-organisation configuration for the daily
-- WhatsApp report delivered via a GoHighLevel Inbound Webhook.
--
-- WHY THIS EXISTS:
-- The owner had no daily pulse on leads/spend/CPL without logging in. A cron
-- job at 18:00 Europe/London POSTs a single-line summary of the PREVIOUS full
-- day to a GHL webhook, which fans it out to WhatsApp. Recipients are managed
-- entirely inside GHL, so this table deliberately stores no phone numbers.
--
-- webhook_url is ENCRYPTED (lib/crypto encryptSecret, AES-256-GCM base64).
-- Possession of the raw URL lets anyone push an arbitrary message to the
-- owner's WhatsApp, so it is treated as a secret, not a config value.
-- ============================================================================

create table if not exists public.whatsapp_report_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  webhook_url     text        not null,
  enabled         boolean     not null default false,
  last_sent_at    timestamptz,
  last_status     text,
  last_error      text,
  last_payload    jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.whatsapp_report_settings enable row level security;

drop policy if exists whatsapp_report_settings_org_isolation on public.whatsapp_report_settings;
create policy whatsapp_report_settings_org_isolation
  on public.whatsapp_report_settings
  for all
  using (organisation_id = (auth.jwt() ->> 'organisation_id')::uuid)
  with check (organisation_id = (auth.jwt() ->> 'organisation_id')::uuid);
```

- [ ] **Step 2: Verify the RLS policy matches house convention**

Run: `grep -A4 "create policy" supabase/migrations/20260101000013_integrations.sql`

Compare the `using (...)` expression to the one above. If existing policies use a different accessor (e.g. a `current_org_id()` helper function rather than `auth.jwt()`), edit the migration to match — consistency matters more than the specific form. Do not invent a new pattern.

- [ ] **Step 3: Apply the migration locally**

Run from repo root: `supabase db reset`
Expected: completes with no error, applying `20260101000117` last.

If `supabase start` is not running, run that first.

- [ ] **Step 4: Write the failing repository test**

Create `backend/test/whatsapp-report.repository.test.mjs`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';
import { whatsappReportRepository } from '../src/repositories/whatsapp-report.repository.js';

const ORG = 'org-aaaa';
const orgFilter = (q) => q.eqs.find((e) => e.col === 'organisation_id');

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('get', () => {
  it('decrypts the webhook url and scopes to the organisation', async () => {
    supaRec.resultProvider = () => ({
      data: {
        organisation_id: ORG,
        webhook_url: encryptSecret('https://services.leadconnectorhq.com/hooks/abc'),
        enabled: true,
        last_sent_at: '2026-07-21T17:00:00.000Z',
        last_status: 'ok',
        last_error: null,
      },
      error: null,
    });

    const row = await whatsappReportRepository.get(ORG);

    expect(row.webhookUrl).toBe('https://services.leadconnectorhq.com/hooks/abc');
    expect(row.enabled).toBe(true);
    expect(row.lastStatus).toBe('ok');
    expect(orgFilter(supaRec.last).val).toBe(ORG);
  });

  it('returns null when no row exists', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    expect(await whatsappReportRepository.get(ORG)).toBeNull();
  });
});

describe('upsert', () => {
  it('encrypts the webhook url before writing', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });

    await whatsappReportRepository.upsert(ORG, {
      webhookUrl: 'https://services.leadconnectorhq.com/hooks/abc',
      enabled: true,
    });

    const written = supaRec.last.upsertVals;
    expect(written.organisation_id).toBe(ORG);
    expect(written.enabled).toBe(true);
    expect(written.webhook_url).not.toContain('leadconnectorhq');
  });
});

describe('listEnabled', () => {
  it('returns only enabled rows with decrypted urls', async () => {
    supaRec.resultProvider = () => ({
      data: [
        { organisation_id: ORG, webhook_url: encryptSecret('https://a.test/hook'), enabled: true, last_sent_at: null },
      ],
      error: null,
    });

    const rows = await whatsappReportRepository.listEnabled();

    expect(rows).toHaveLength(1);
    expect(rows[0].webhookUrl).toBe('https://a.test/hook');
    expect(supaRec.last.eqs.find((e) => e.col === 'enabled').val).toBe(true);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/whatsapp-report.repository.test.mjs`
Expected: FAIL — cannot resolve `../src/repositories/whatsapp-report.repository.js`.

- [ ] **Step 6: Write the repository**

Create `backend/src/repositories/whatsapp-report.repository.js`:

```js
import * as supabase_1 from "../lib/supabase.js";
import * as crypto_1 from "../lib/crypto.js";

const TABLE = 'whatsapp_report_settings';
const COLS = 'organisation_id, webhook_url, enabled, last_sent_at, last_status, last_error';

function toDomain(row) {
    if (!row) return null;
    return {
        organisationId: row.organisation_id,
        webhookUrl: crypto_1.decryptSecret(row.webhook_url),
        enabled: row.enabled === true,
        lastSentAt: row.last_sent_at ?? null,
        lastStatus: row.last_status ?? null,
        lastError: row.last_error ?? null,
    };
}

export const whatsappReportRepository = {
    // Indirection so tests can stub the client.
    _client() { return supabase_1.serviceClient; },

    async get(orgId) {
        const { data } = await this._client()
            .from(TABLE)
            .select(COLS)
            .eq('organisation_id', orgId)
            .maybeSingle();
        return toDomain(data);
    },

    async upsert(orgId, { webhookUrl, enabled }) {
        const { data } = await this._client()
            .from(TABLE)
            .upsert({
                organisation_id: orgId,
                webhook_url: crypto_1.encryptSecret(webhookUrl),
                enabled: enabled === true,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'organisation_id' })
            .select(COLS)
            .maybeSingle();
        return toDomain(data);
    },

    // Cron use: every org with the report switched on, across all tenants.
    async listEnabled() {
        const { data } = await this._client()
            .from(TABLE)
            .select(COLS)
            .eq('enabled', true);
        return (data ?? []).map(toDomain);
    },

    async markSent(orgId, { status, error = null, payload = null, sentAt }) {
        await this._client()
            .from(TABLE)
            .update({
                last_sent_at: sentAt,
                last_status: status,
                last_error: error,
                last_payload: payload,
                updated_at: new Date().toISOString(),
            })
            .eq('organisation_id', orgId);
    },
};
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/whatsapp-report.repository.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260101000117_whatsapp_report_settings.sql \
        backend/src/repositories/whatsapp-report.repository.js \
        backend/test/whatsapp-report.repository.test.mjs
git commit -m "feat(report): whatsapp_report_settings table and repository"
```

---

### Task 2: The formatter (pure)

This task carries most of the correctness risk. Everything here is pure — no I/O, no dates from the system clock.

**Files:**
- Create: `backend/src/services/daily-report.format.js`
- Test: `backend/test/daily-report.format.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_REPORT_CHARS` → `350`
  - `previousDayInLondon(now)` → `{ date: 'YYYY-MM-DD', label: 'DD Mon', since: 'YYYY-MM-DD', until: 'YYYY-MM-DD' }`
  - `formatPence(pence)` → `'£412'` | `'£17.17'` | `'£142k'` | `null` when input is null
  - `formatPercent(ratio)` → `'25%'` | `null`
  - `formatReportLine(metrics)` → `string`

The `metrics` object consumed by `formatReportLine` (produced by Task 4):

```js
{
  reportDateLabel: '21 Jul',
  leads:       { total: 24, google: 14, meta: 10 },
  spendPence:  { total: 41200, google: 41200, meta: null },
  cplPence:    { total: 1717, google: 2943, meta: null },
  conversions: 6,
  conversionRate: 0.25,          // ratio 0..1, or null
  cpaPence: 6867,                // or null
  cashInPence: 624000,           // or null
  dentally: { appointments: 118, dna: 7, dnaRate: 0.059, newPatients: 12 },  // or null
  qbo:      { revenueMtdPence: 14200000, marginPct: 18.4 },                  // or null
}
```

- [ ] **Step 1: Write the failing tests**

Create `backend/test/daily-report.format.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import {
  MAX_REPORT_CHARS,
  previousDayInLondon,
  formatPence,
  formatPercent,
  formatReportLine,
} from '../src/services/daily-report.format.js';

const FULL = {
  reportDateLabel: '21 Jul',
  leads: { total: 24, google: 14, meta: 10 },
  spendPence: { total: 41200, google: 41200, meta: null },
  cplPence: { total: 1717, google: 2943, meta: null },
  conversions: 6,
  conversionRate: 0.25,
  cpaPence: 6867,
  cashInPence: 624000,
  dentally: { appointments: 118, dna: 7, dnaRate: 0.059, newPatients: 12 },
  qbo: { revenueMtdPence: 14200000, marginPct: 18.4 },
};

describe('formatPence', () => {
  it('uses 2dp below one hundred pounds', () => {
    expect(formatPence(1717)).toBe('£17.17');
  });
  it('drops decimals from one hundred pounds up', () => {
    expect(formatPence(41200)).toBe('£412');
  });
  it('adds thousands separators', () => {
    expect(formatPence(624000)).toBe('£6,240');
  });
  it('abbreviates from one hundred thousand pounds up', () => {
    expect(formatPence(14200000)).toBe('£142k');
  });
  it('returns null for null', () => {
    expect(formatPence(null)).toBeNull();
  });
  it('formats zero as a real zero, not null', () => {
    expect(formatPence(0)).toBe('£0.00');
  });
});

describe('formatPercent', () => {
  it('renders a ratio as a whole percentage', () => {
    expect(formatPercent(0.25)).toBe('25%');
  });
  it('keeps one decimal for small ratios', () => {
    expect(formatPercent(0.059)).toBe('5.9%');
  });
  it('returns null for null', () => {
    expect(formatPercent(null)).toBeNull();
  });
});

describe('previousDayInLondon', () => {
  it('returns the previous day during British Summer Time', () => {
    // 2026-07-21 18:00 London == 17:00 UTC
    const r = previousDayInLondon(new Date('2026-07-21T17:00:00.000Z'));
    expect(r.date).toBe('2026-07-20');
    expect(r.since).toBe('2026-07-20');
    expect(r.until).toBe('2026-07-20');
    expect(r.label).toBe('20 Jul');
  });

  it('returns the previous day in winter (UTC offset zero)', () => {
    const r = previousDayInLondon(new Date('2026-01-15T18:00:00.000Z'));
    expect(r.date).toBe('2026-01-14');
    expect(r.label).toBe('14 Jan');
  });

  it('uses the London calendar day, not the UTC one', () => {
    // 2026-07-21 00:30 London == 2026-07-20 23:30 UTC.
    // London's "yesterday" is the 20th; UTC's would be the 19th.
    const r = previousDayInLondon(new Date('2026-07-20T23:30:00.000Z'));
    expect(r.date).toBe('2026-07-20');
  });
});

describe('formatReportLine', () => {
  it('renders every section for a complete day', () => {
    const line = formatReportLine(FULL);
    expect(line).toContain('Daily 21 Jul');
    expect(line).toContain('Leads 24 (Google 14, Meta 10)');
    expect(line).toContain('CPL £17.17');
    expect(line).toContain('Conv 6 (25%), CPA £68.67');
    expect(line).toContain('Cash in £6,240');
    expect(line).toContain('Appts 118, DNA 7 (5.9%), New pts 12');
    expect(line).toContain('QBO MTD £142k, margin 18.4%');
  });

  it('renders null spend as "not reporting", never as zero', () => {
    const line = formatReportLine(FULL);
    expect(line).toContain('Meta not reporting');
    expect(line).not.toContain('Meta £0');
  });

  it('renders metrics dependent on missing spend as n/a', () => {
    const line = formatReportLine({
      ...FULL,
      spendPence: { total: null, google: null, meta: null },
      cplPence: { total: null, google: null, meta: null },
      cpaPence: null,
    });
    expect(line).toContain('CPL n/a');
    expect(line).toContain('CPA n/a');
  });

  it('omits the Dentally section when there is no data', () => {
    const line = formatReportLine({ ...FULL, dentally: null });
    expect(line).not.toContain('Appts');
    expect(line).toContain('QBO MTD');
  });

  it('omits the QuickBooks section when there is no data', () => {
    const line = formatReportLine({ ...FULL, qbo: null });
    expect(line).not.toContain('QBO');
    expect(line).toContain('Appts 118');
  });

  it('never contains newlines, tabs, or four consecutive spaces', () => {
    const line = formatReportLine(FULL);
    expect(line).not.toMatch(/[\n\r\t]/);
    expect(line).not.toMatch(/ {4}/);
  });

  it('stays within the cap and keeps the typical line well under it', () => {
    const line = formatReportLine(FULL);
    expect(line.length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
    expect(line.length).toBeLessThan(260);
  });

  it('drops QuickBooks first when the cap would be exceeded', () => {
    const wide = {
      ...FULL,
      leads: { total: 999999, google: 999999, meta: 999999 },
      spendPence: { total: null, google: null, meta: null },
      cplPence: { total: null, google: null, meta: null },
      qbo: { revenueMtdPence: 99900000000, marginPct: 100 },
      dentally: { appointments: 999999, dna: 999999, dnaRate: 0.999, newPatients: 999999 },
    };
    const line = formatReportLine(wide);
    expect(line.length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
    expect(line).not.toContain('QBO');
  });

  it('never drops the ad metrics or cash in', () => {
    const wide = {
      ...FULL,
      leads: { total: 999999999, google: 999999999, meta: 999999999 },
      dentally: { appointments: 999999999, dna: 999999999, dnaRate: 0.9, newPatients: 999999999 },
      qbo: { revenueMtdPence: 99900000000, marginPct: 99.9 },
    };
    const line = formatReportLine(wide);
    expect(line.length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
    expect(line).toContain('Leads');
    expect(line).toContain('Cash in');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run test/daily-report.format.test.mjs`
Expected: FAIL — cannot resolve `../src/services/daily-report.format.js`.

- [ ] **Step 3: Write the formatter**

Create `backend/src/services/daily-report.format.js`:

```js
// Pure rendering for the daily WhatsApp report. No I/O, no system clock.
//
// The output is a SINGLE LINE with pipe separators. WhatsApp template
// parameters cannot contain newlines, tabs, or 4+ consecutive spaces
// (Meta Cloud API restriction), so multi-line layout is not an option.
//
// Separators are ASCII: if GoHighLevel counts bytes rather than characters,
// '£' already costs 2 bytes in UTF-8 and we do not want to pay for '·' too.

export const MAX_REPORT_CHARS = 350;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// London calendar parts for an instant, without pulling in a date library.
function londonParts(instant) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/**
 * The previous full calendar day in Europe/London.
 * Using the London day (not the UTC day) matters: at 00:30 London in summer it
 * is still the previous day in UTC, and reporting on the wrong date would be
 * silently wrong for part of the year.
 */
export function previousDayInLondon(now) {
    const { year, month, day } = londonParts(now);
    // Step back one day using a UTC-anchored date built from London parts.
    const anchor = new Date(Date.UTC(year, month - 1, day));
    anchor.setUTCDate(anchor.getUTCDate() - 1);

    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth();
    const d = anchor.getUTCDate();
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    return { date, since: date, until: date, label: `${d} ${MONTHS[m]}` };
}

/** Integer pence to a display string. Null in, null out — callers decide the copy. */
export function formatPence(pence) {
    if (pence === null || pence === undefined) return null;
    const pounds = pence / 100;
    const abs = Math.abs(pounds);
    if (abs >= 100000) return `£${Math.round(pounds / 1000).toLocaleString('en-GB')}k`;
    if (abs >= 100) return `£${Math.round(pounds).toLocaleString('en-GB')}`;
    return `£${pounds.toFixed(2)}`;
}

/** A 0..1 ratio to a percentage string. Whole numbers stay whole. */
export function formatPercent(ratio) {
    if (ratio === null || ratio === undefined) return null;
    const pct = ratio * 100;
    const rounded = Math.round(pct * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function money(pence) {
    return formatPence(pence) ?? 'n/a';
}

function spend(pence) {
    return formatPence(pence) ?? 'not reporting';
}

/**
 * Render the report. Sections are assembled in priority order and the
 * lowest-priority ones are dropped if the cap would be exceeded.
 *
 * Drop order: QuickBooks, then Dentally. Ad metrics and cash in are never
 * dropped — they are the reason the report exists.
 */
export function formatReportLine(metrics) {
    const m = metrics;

    const core = [
        `Daily ${m.reportDateLabel}`,
        `Leads ${m.leads.total} (Google ${m.leads.google}, Meta ${m.leads.meta})`,
        `Spend ${spend(m.spendPence.total)} (Google ${spend(m.spendPence.google)}, Meta ${spend(m.spendPence.meta)})`,
        `CPL ${money(m.cplPence.total)}`,
        `Conv ${m.conversions} (${formatPercent(m.conversionRate) ?? 'n/a'}), CPA ${money(m.cpaPence)}`,
        `Cash in ${money(m.cashInPence)}`,
    ];

    const optional = [];
    if (m.dentally) {
        optional.push(
            `Appts ${m.dentally.appointments}, DNA ${m.dentally.dna} (${formatPercent(m.dentally.dnaRate) ?? 'n/a'}), New pts ${m.dentally.newPatients}`,
        );
    }
    if (m.qbo) {
        const margin = m.qbo.marginPct === null || m.qbo.marginPct === undefined
            ? 'n/a'
            : `${Math.round(m.qbo.marginPct * 10) / 10}%`;
        optional.push(`QBO MTD ${money(m.qbo.revenueMtdPence)}, margin ${margin}`);
    }

    // Drop lowest-priority optional sections (last first) until we fit.
    const sections = [...core, ...optional];
    let line = sections.join(' | ');
    while (line.length > MAX_REPORT_CHARS && sections.length > core.length) {
        sections.pop();
        line = sections.join(' | ');
    }

    // Final guard: even the core could theoretically overflow with absurd values.
    if (line.length > MAX_REPORT_CHARS) line = line.slice(0, MAX_REPORT_CHARS);

    // Belt and braces — the send must never be rejected for whitespace.
    return line.replace(/[\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/daily-report.format.test.mjs`
Expected: PASS, 21 tests.

If the `drops QuickBooks first` test does not trip the cap, the synthetic values are not wide enough — raise them until the un-dropped line exceeds 350 characters. Do not lower `MAX_REPORT_CHARS` to make the test pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/daily-report.format.js backend/test/daily-report.format.test.mjs
git commit -m "feat(report): pure formatter for the daily WhatsApp report line"
```

---

### Task 3: GHL inbound webhook client

**Files:**
- Create: `backend/src/lib/integrations/ghl-webhook.js`
- Test: `backend/test/ghl-webhook.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `postToInboundWebhook(url, payload, { fetchImpl, timeoutMs, retries })` → `{ ok: true, status }` | `{ ok: false, status, error }`. Never throws.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/ghl-webhook.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import { postToInboundWebhook } from '../src/lib/integrations/ghl-webhook.js';

const URL = 'https://services.leadconnectorhq.com/hooks/abc';
const PAYLOAD = { report_line: 'Daily 21 Jul | Leads 24' };

describe('postToInboundWebhook', () => {
  it('posts json and reports success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const res = await postToInboundWebhook(URL, PAYLOAD, { fetchImpl });

    expect(res).toEqual({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(PAYLOAD);
  });

  it('retries on a server error then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'ok' });

    const res = await postToInboundWebhook(URL, PAYLOAD, { fetchImpl, retryDelayMs: 0 });

    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and returns the failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

    const res = await postToInboundWebhook(URL, PAYLOAD, { fetchImpl, retryDelayMs: 0 });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.error).toContain('boom');
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry a 4xx, which will not fix itself', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });

    const res = await postToInboundWebhook(URL, PAYLOAD, { fetchImpl, retryDelayMs: 0 });

    expect(res.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never throws when the network fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    const res = await postToInboundWebhook(URL, PAYLOAD, { fetchImpl, retryDelayMs: 0 });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('ECONNRESET');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run test/ghl-webhook.test.mjs`
Expected: FAIL — cannot resolve `../src/lib/integrations/ghl-webhook.js`.

- [ ] **Step 3: Write the client**

Create `backend/src/lib/integrations/ghl-webhook.js`:

```js
// POST a flat JSON payload to a GoHighLevel Inbound Webhook URL.
//
// GHL inbound webhooks are unauthenticated — the URL itself is the secret.
// They return 200 on accept; anything else is a failure.
//
// This never throws: a failed report must not take down the cron for other
// organisations, so the caller gets a result object instead of an exception.

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function postToInboundWebhook(url, payload, opts = {}) {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = opts.retries ?? DEFAULT_RETRIES;
    const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    let last = { ok: false, status: 0, error: 'not attempted' };

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            if (res.ok) return { ok: true, status: res.status };

            const body = await res.text().catch(() => '');
            last = { ok: false, status: res.status, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };

            // 4xx is a configuration problem — a bad URL will still be bad in a second.
            if (res.status < 500) return last;
        } catch (err) {
            last = { ok: false, status: 0, error: String(err?.message ?? err) };
        } finally {
            clearTimeout(timer);
        }

        if (attempt < retries) await sleep(retryDelayMs);
    }

    return last;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/ghl-webhook.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/integrations/ghl-webhook.js backend/test/ghl-webhook.test.mjs
git commit -m "feat(report): GHL inbound webhook client with retries"
```

---

### Task 4: The report service

**Files:**
- Create: `backend/src/services/daily-report.service.js`
- Test: `backend/test/daily-report.service.test.mjs`

**Interfaces:**
- Consumes:
  - `previousDayInLondon`, `formatReportLine`, `formatPence`, `formatPercent` from `./daily-report.format.js`
  - `whatsappReportRepository` from `../repositories/whatsapp-report.repository.js`
  - `postToInboundWebhook` from `../lib/integrations/ghl-webhook.js`
  - `adAttributionService.getPerformance(orgId, { since, until, practiceId })` — `channels[]` entries have `{ channel, leads, conversions, acceptedValuePence, spendPence, costPerLeadPence, costPerAcquisitionPence, conversionRate }`, `channel` ∈ `'google_ads' | 'meta_ads' | 'unassigned'`; `totals` adds `paidLeads`, `paidConversions`
  - `cockpitService.build(orgId, { since, until, practiceId })` → cash at `revenue.month.todayPence`
  - `analyticsService.businessHub(orgId, { since, until, label, practiceId })` → `group.{appointments, noShows, noShowRate, newPatients, marginPct, revenuePence}`
- Produces:
  - `dailyReportService.buildMetrics(orgId, { now, deps })` → the `metrics` object shaped for `formatReportLine` (the reporting window is derived internally via `previousDayInLondon(now)`, never passed in)
  - `dailyReportService.buildPayload(orgId, { now, deps })` → `{ metrics, payload }`
  - `dailyReportService.send(orgId, { now, trigger, deps })` → `{ sent: boolean, status: 'ok'|'failed'|'skipped', reason?, payload? }`

- [ ] **Step 1: Confirm the units of `noShowRate` and `marginPct`**

The formatter treats `dnaRate` as a **0..1 ratio** and `marginPct` as an **already-multiplied percentage**. Verify both before writing the service — getting this wrong renders `590%` DNA or `0.18%` margin.

Run: `grep -n "noShowRate\|marginPct" backend/src/services/analytics.service.js | head -20`

Read the assignment lines. If `noShowRate` is already a percentage (e.g. `5.9`), divide by 100 when building metrics. If `marginPct` is a ratio (e.g. `0.184`), multiply by 100. Record what you found in a comment in the service. Do not guess.

- [ ] **Step 2: Write the failing tests**

Create `backend/test/daily-report.service.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { dailyReportService } from '../src/services/daily-report.service.js';

const ORG = 'org-aaaa';
const NOW = new Date('2026-07-21T17:00:00.000Z'); // 18:00 London

function deps(overrides = {}) {
  return {
    adAttribution: {
      getPerformance: vi.fn().mockResolvedValue({
        channels: [
          { channel: 'google_ads', leads: 14, conversions: 4, spendPence: 41200, costPerLeadPence: 2943, costPerAcquisitionPence: 10300, conversionRate: 0.2857 },
          { channel: 'meta_ads', leads: 10, conversions: 2, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: 0.2 },
          { channel: 'unassigned', leads: 0, conversions: 0, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: null },
        ],
        totals: { channel: 'total', leads: 24, conversions: 6, spendPence: 41200, costPerLeadPence: 1717, costPerAcquisitionPence: 6867, conversionRate: 0.25, paidLeads: 24, paidConversions: 6 },
      }),
    },
    cockpit: {
      build: vi.fn().mockResolvedValue({ revenue: { month: { todayPence: 624000 } } }),
    },
    analytics: {
      businessHub: vi.fn().mockResolvedValue({
        group: { appointments: 118, noShows: 7, noShowRate: 0.059, newPatients: 12, marginPct: 18.4, revenuePence: 14200000 },
      }),
    },
    postWebhook: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    ...overrides,
  };
}

beforeEach(() => {
  supaRec.last = undefined;
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('buildMetrics', () => {
  it('queries the previous London day and splits channels', async () => {
    const d = deps();
    const m = await dailyReportService.buildMetrics(ORG, { now: NOW, deps: d });

    expect(d.adAttribution.getPerformance).toHaveBeenCalledWith(ORG, { since: '2026-07-20', until: '2026-07-20' });
    expect(m.reportDateLabel).toBe('20 Jul');
    expect(m.leads).toEqual({ total: 24, google: 14, meta: 10 });
    expect(m.spendPence.google).toBe(41200);
    expect(m.spendPence.meta).toBeNull();
    expect(m.cashInPence).toBe(624000);
    expect(m.dentally.appointments).toBe(118);
  });

  it('tolerates a failing optional source rather than losing the report', async () => {
    const d = deps({ analytics: { businessHub: vi.fn().mockRejectedValue(new Error('rpc timeout')) } });

    const m = await dailyReportService.buildMetrics(ORG, { now: NOW, deps: d });

    expect(m.dentally).toBeNull();
    expect(m.qbo).toBeNull();
    expect(m.leads.total).toBe(24); // ad metrics survived
  });
});

describe('buildPayload', () => {
  it('includes the rendered line and flat display fields', async () => {
    const { payload } = await dailyReportService.buildPayload(ORG, { now: NOW, deps: deps() });

    expect(payload.report_date).toBe('2026-07-20');
    expect(payload.report_line).toContain('Daily 20 Jul');
    expect(payload.leads_total).toBe(24);
    expect(payload.spend_meta).toBe('not reporting');
    expect(payload.cash_in).toBe('£6,240');
  });

  it('exposes no raw pence integers, which must never reach a message', async () => {
    const { payload } = await dailyReportService.buildPayload(ORG, { now: NOW, deps: deps() });

    for (const [key, value] of Object.entries(payload)) {
      if (key.startsWith('leads_') || key === 'conversions' || key.startsWith('appointments') || key === 'dna' || key === 'new_patients') continue;
      expect(typeof value === 'number' && value > 10000).toBe(false);
    }
  });
});

describe('send', () => {
  it('skips when the organisation has no settings row', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });

    const res = await dailyReportService.send(ORG, { now: NOW, deps: deps() });

    expect(res.status).toBe('skipped');
    expect(res.sent).toBe(false);
  });

  it('skips when there is no data at all rather than sending zeroes', async () => {
    const d = deps({
      adAttribution: {
        getPerformance: vi.fn().mockResolvedValue({
          channels: [
            { channel: 'google_ads', leads: 0, conversions: 0, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: null },
            { channel: 'meta_ads', leads: 0, conversions: 0, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: null },
            { channel: 'unassigned', leads: 0, conversions: 0, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: null },
          ],
          totals: { channel: 'total', leads: 0, conversions: 0, spendPence: null, costPerLeadPence: null, costPerAcquisitionPence: null, conversionRate: null, paidLeads: 0, paidConversions: 0 },
        }),
      },
      cockpit: { build: vi.fn().mockResolvedValue({ revenue: { month: { todayPence: null } } }) },
      analytics: { businessHub: vi.fn().mockResolvedValue({ group: {} }) },
    });
    supaRec.resultProvider = () => ({
      data: { organisation_id: ORG, webhook_url: null, enabled: true, last_sent_at: null },
      error: null,
    });

    const res = await dailyReportService.send(ORG, { now: NOW, deps: d, settings: { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null } });

    expect(res.status).toBe('skipped');
    expect(d.postWebhook).not.toHaveBeenCalled();
  });

  it('blocks a second automatic send on the same day', async () => {
    const d = deps();
    const settings = { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: '2026-07-21T17:00:00.000Z' };

    const res = await dailyReportService.send(ORG, { now: NOW, trigger: 'cron', deps: d, settings });

    expect(res.status).toBe('skipped');
    expect(d.postWebhook).not.toHaveBeenCalled();
  });

  it('allows a manual send to bypass the same-day block', async () => {
    const d = deps();
    const settings = { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: '2026-07-21T17:00:00.000Z' };

    const res = await dailyReportService.send(ORG, { now: NOW, trigger: 'manual', deps: d, settings });

    expect(res.sent).toBe(true);
    expect(d.postWebhook).toHaveBeenCalledTimes(1);
  });

  it('records a failure without throwing', async () => {
    const d = deps({ postWebhook: vi.fn().mockResolvedValue({ ok: false, status: 500, error: 'boom' }) });
    const settings = { webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null };

    const res = await dailyReportService.send(ORG, { now: NOW, trigger: 'cron', deps: d, settings });

    expect(res.sent).toBe(false);
    expect(res.status).toBe('failed');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && npx vitest run test/daily-report.service.test.mjs`
Expected: FAIL — cannot resolve `../src/services/daily-report.service.js`.

- [ ] **Step 4: Write the service**

Create `backend/src/services/daily-report.service.js`:

```js
import * as format_1 from "./daily-report.format.js";
import { whatsappReportRepository } from "../repositories/whatsapp-report.repository.js";
import { postToInboundWebhook } from "../lib/integrations/ghl-webhook.js";
import { adAttributionService } from "./ad-attribution.service.js";
import { cockpitService } from "./cockpit.service.js";
import { analyticsService } from "./analytics.service.js";

// Dependencies are injected so tests never touch the network or the real
// service graph. Production callers omit `deps` and get these.
function defaultDeps() {
    return {
        adAttribution: adAttributionService,
        cockpit: cockpitService,
        analytics: analyticsService,
        postWebhook: postToInboundWebhook,
    };
}

const byChannel = (channels, key) => channels.find((c) => c.channel === key) ?? {};

export const dailyReportService = {
    async buildMetrics(orgId, { now = new Date(), deps = defaultDeps() } = {}) {
        const day = format_1.previousDayInLondon(now);
        const window = { since: day.since, until: day.until };

        // Ad metrics are mandatory — without them there is no report worth sending.
        const perf = await deps.adAttribution.getPerformance(orgId, window);
        const google = byChannel(perf.channels, 'google_ads');
        const meta = byChannel(perf.channels, 'meta_ads');
        const totals = perf.totals ?? {};

        // Cash and clinical figures are best-effort: a failing rollup should
        // degrade the report, not cancel it.
        let cashInPence = null;
        try {
            const cockpit = await deps.cockpit.build(orgId, window);
            cashInPence = cockpit?.revenue?.month?.todayPence ?? null;
        } catch (err) {
            console.error(`[daily-report] cockpit build failed for ${orgId}`, err);
        }

        let dentally = null;
        let qbo = null;
        try {
            const hub = await deps.analytics.businessHub(orgId, { ...window, label: 'Daily report' });
            const g = hub?.group ?? {};
            // Units confirmed in Step 1: noShowRate is a 0..1 ratio,
            // marginPct is already a percentage.
            if (g.appointments !== undefined && g.appointments !== null) {
                dentally = {
                    appointments: g.appointments,
                    dna: g.noShows ?? 0,
                    dnaRate: g.noShowRate ?? null,
                    newPatients: g.newPatients ?? 0,
                };
            }
            if (g.revenuePence !== undefined && g.revenuePence !== null) {
                qbo = { revenueMtdPence: g.revenuePence, marginPct: g.marginPct ?? null };
            }
        } catch (err) {
            console.error(`[daily-report] businessHub failed for ${orgId}`, err);
        }

        return {
            reportDate: day.date,
            reportDateLabel: day.label,
            leads: {
                total: totals.leads ?? 0,
                google: google.leads ?? 0,
                meta: meta.leads ?? 0,
            },
            spendPence: {
                total: totals.spendPence ?? null,
                google: google.spendPence ?? null,
                meta: meta.spendPence ?? null,
            },
            cplPence: {
                total: totals.costPerLeadPence ?? null,
                google: google.costPerLeadPence ?? null,
                meta: meta.costPerLeadPence ?? null,
            },
            conversions: totals.conversions ?? 0,
            conversionRate: totals.conversionRate ?? null,
            cpaPence: totals.costPerAcquisitionPence ?? null,
            cashInPence,
            dentally,
            qbo,
        };
    },

    async buildPayload(orgId, { now = new Date(), deps = defaultDeps(), organisationName = null } = {}) {
        const metrics = await this.buildMetrics(orgId, { now, deps });
        const line = format_1.formatReportLine(metrics);
        const f = format_1.formatPence;
        const p = format_1.formatPercent;

        const payload = {
            report_date: metrics.reportDate,
            report_date_label: metrics.reportDateLabel,
            organisation: organisationName,
            report_line: line,

            leads_total: metrics.leads.total,
            leads_google: metrics.leads.google,
            leads_meta: metrics.leads.meta,

            spend_total: f(metrics.spendPence.total) ?? 'not reporting',
            spend_google: f(metrics.spendPence.google) ?? 'not reporting',
            spend_meta: f(metrics.spendPence.meta) ?? 'not reporting',

            cpl_total: f(metrics.cplPence.total) ?? 'n/a',
            cpl_google: f(metrics.cplPence.google) ?? 'n/a',
            cpl_meta: f(metrics.cplPence.meta) ?? 'n/a',

            conversions: metrics.conversions,
            conversion_rate: p(metrics.conversionRate) ?? 'n/a',
            cpa: f(metrics.cpaPence) ?? 'n/a',
            cash_in: f(metrics.cashInPence) ?? 'n/a',
        };

        if (metrics.dentally) {
            payload.appointments = metrics.dentally.appointments;
            payload.dna = metrics.dentally.dna;
            payload.dna_rate = p(metrics.dentally.dnaRate) ?? 'n/a';
            payload.new_patients = metrics.dentally.newPatients;
        }
        if (metrics.qbo) {
            payload.qbo_revenue_mtd = f(metrics.qbo.revenueMtdPence) ?? 'n/a';
            payload.qbo_margin = metrics.qbo.marginPct === null ? 'n/a' : `${Math.round(metrics.qbo.marginPct * 10) / 10}%`;
        }

        return { metrics, payload, line };
    },

    // A day with no leads, no spend and no cash is not worth a message.
    // A digest full of zeroes trains the reader to ignore the digest.
    _hasContent(metrics) {
        return (metrics.leads.total ?? 0) > 0
            || metrics.spendPence.total !== null
            || metrics.cashInPence !== null;
    },

    _sameLondonDay(a, b) {
        const day = (d) => new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(d);
        return day(a) === day(b);
    },

    async send(orgId, { now = new Date(), trigger = 'cron', deps = defaultDeps(), settings = undefined, organisationName = null } = {}) {
        const cfg = settings ?? await whatsappReportRepository.get(orgId);
        if (!cfg || !cfg.webhookUrl) {
            return { sent: false, status: 'skipped', reason: 'not configured' };
        }
        if (trigger === 'cron' && !cfg.enabled) {
            return { sent: false, status: 'skipped', reason: 'disabled' };
        }
        // A worker restart at 18:05 must not send the report twice.
        // Manual sends bypass this deliberately.
        if (trigger === 'cron' && cfg.lastSentAt && this._sameLondonDay(new Date(cfg.lastSentAt), now)) {
            return { sent: false, status: 'skipped', reason: 'already sent today' };
        }

        const { metrics, payload } = await this.buildPayload(orgId, { now, deps, organisationName });

        if (!this._hasContent(metrics)) {
            await whatsappReportRepository.markSent(orgId, {
                status: 'skipped', error: 'no data for the reporting day', payload: null, sentAt: now.toISOString(),
            });
            return { sent: false, status: 'skipped', reason: 'no data' };
        }

        const result = await deps.postWebhook(cfg.webhookUrl, payload);

        await whatsappReportRepository.markSent(orgId, {
            status: result.ok ? 'ok' : 'failed',
            error: result.ok ? null : result.error,
            payload,
            sentAt: now.toISOString(),
        });

        return {
            sent: result.ok,
            status: result.ok ? 'ok' : 'failed',
            reason: result.ok ? undefined : result.error,
            payload,
        };
    },
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/daily-report.service.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the whole backend suite for regressions**

Run: `cd backend && npm test`
Expected: PASS — all pre-existing tests still green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/daily-report.service.js backend/test/daily-report.service.test.mjs
git commit -m "feat(report): daily report service composing ads, cash and clinical figures"
```

---

### Task 5: Routes, controller and validation

**Files:**
- Create: `backend/src/models/daily-report.model.js`
- Create: `backend/src/controllers/daily-report.controller.js`
- Modify: `backend/src/routes/integrations.routes.js`
- Test: `backend/test/daily-report.controller.test.mjs`

**Interfaces:**
- Consumes: `dailyReportService.buildPayload`, `dailyReportService.send`, `whatsappReportRepository.get/upsert`.
- Produces: four owner-only endpoints.

| Method | Path | Body / Response |
|---|---|---|
| GET | `/api/integrations/gohighlevel/daily-report` | → `{ settings: { webhookUrlMasked, enabled, lastSentAt, lastStatus, lastError } \| null }` |
| PUT | `/api/integrations/gohighlevel/daily-report` | `{ webhookUrl, enabled }` → `{ settings }` |
| POST | `/api/integrations/gohighlevel/daily-report/preview` | → `{ line, payload }` |
| POST | `/api/integrations/gohighlevel/daily-report/send` | → `{ sent, status, reason? }` |

- [ ] **Step 1: Write the Zod model**

Create `backend/src/models/daily-report.model.js`:

```js
import { z } from "zod";

export const dailyReportSettingsSchema = z.object({
    // GHL inbound webhook URLs are https and unauthenticated — the URL is the
    // secret, so refuse to store one sent over plaintext http.
    webhookUrl: z.string().url().refine((u) => u.startsWith('https://'), {
        message: 'Webhook URL must use https',
    }),
    enabled: z.boolean().default(false),
});
```

- [ ] **Step 2: Write the failing controller tests**

Create `backend/test/daily-report.controller.test.mjs`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dailyReportController, _resetSendLimiter } from '../src/controllers/daily-report.controller.js';

const ORG = 'org-aaaa';

function res() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const req = (body = {}) => ({ user: { id: 'u1', organisation_id: ORG }, body });

beforeEach(() => { _resetSendLimiter(); });

describe('saveSettings', () => {
  it('rejects a non-https webhook url', async () => {
    const r = res();
    await dailyReportController.saveSettings(req({ webhookUrl: 'http://a.test/h', enabled: true }), r);
    expect(r.statusCode).toBe(400);
  });

  it('rejects a value that is not a url at all', async () => {
    const r = res();
    await dailyReportController.saveSettings(req({ webhookUrl: 'paste-here', enabled: true }), r);
    expect(r.statusCode).toBe(400);
  });
});

describe('send rate limit', () => {
  it('blocks manual sends beyond the hourly allowance', async () => {
    const deps = { send: vi.fn().mockResolvedValue({ sent: true, status: 'ok' }) };
    let last;
    for (let i = 0; i < 7; i++) {
      last = res();
      await dailyReportController.send(req(), last, deps);
    }
    expect(last.statusCode).toBe(429);
    expect(deps.send).toHaveBeenCalledTimes(6);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && npx vitest run test/daily-report.controller.test.mjs`
Expected: FAIL — cannot resolve `../src/controllers/daily-report.controller.js`.

- [ ] **Step 4: Write the controller**

Create `backend/src/controllers/daily-report.controller.js`:

```js
import { dailyReportSettingsSchema } from "../models/daily-report.model.js";
import { dailyReportService } from "../services/daily-report.service.js";
import { whatsappReportRepository } from "../repositories/whatsapp-report.repository.js";

// Manual sends go to the owner's WhatsApp. In-memory per-process limiter:
// good enough to stop an accidental double-click storm, and deliberately not
// a distributed limiter — this is a convenience guard, not a security control.
const MAX_MANUAL_SENDS_PER_HOUR = 6;
const WINDOW_MS = 60 * 60 * 1000;
const sendLog = new Map(); // orgId -> number[] (timestamps)

export function _resetSendLimiter() { sendLog.clear(); }

function allowSend(orgId, nowMs) {
    const recent = (sendLog.get(orgId) ?? []).filter((t) => nowMs - t < WINDOW_MS);
    if (recent.length >= MAX_MANUAL_SENDS_PER_HOUR) {
        sendLog.set(orgId, recent);
        return false;
    }
    recent.push(nowMs);
    sendLog.set(orgId, recent);
    return true;
}

// Never return the raw URL — it is a send-anything credential.
function mask(url) {
    if (!url) return null;
    return url.length <= 12 ? '********' : `${url.slice(0, 8)}********${url.slice(-4)}`;
}

function present(settings) {
    if (!settings) return null;
    return {
        webhookUrlMasked: mask(settings.webhookUrl),
        configured: Boolean(settings.webhookUrl),
        enabled: settings.enabled,
        lastSentAt: settings.lastSentAt,
        lastStatus: settings.lastStatus,
        lastError: settings.lastError,
    };
}

export const dailyReportController = {
    async getSettings(req, res) {
        const settings = await whatsappReportRepository.get(req.user.organisation_id);
        return res.json({ settings: present(settings) });
    },

    async saveSettings(req, res) {
        const parsed = dailyReportSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' });
        }
        const settings = await whatsappReportRepository.upsert(req.user.organisation_id, parsed.data);
        return res.json({ settings: present(settings) });
    },

    async preview(req, res) {
        const { line, payload } = await dailyReportService.buildPayload(req.user.organisation_id, {});
        return res.json({ line, length: line.length, payload });
    },

    async send(req, res, deps = dailyReportService) {
        const orgId = req.user.organisation_id;
        if (!allowSend(orgId, Date.now())) {
            return res.status(429).json({ error: 'Too many manual sends. Try again later.' });
        }
        const result = await deps.send(orgId, { trigger: 'manual' });
        return res.json(result);
    },
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx vitest run test/daily-report.controller.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 6: Wire the routes**

In `backend/src/routes/integrations.routes.js`, add this import alongside the existing controller import:

```js
import * as daily_report_controller_1 from "../controllers/daily-report.controller.js";
```

Then add these four lines **immediately after** the existing `/gohighlevel/dashboard` line. They must sit before any `/:provider/...` route or Express will match `daily-report` as a provider name:

```js
router.get('/gohighlevel/daily-report', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(daily_report_controller_1.dailyReportController.getSettings));
router.put('/gohighlevel/daily-report', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(daily_report_controller_1.dailyReportController.saveSettings));
router.post('/gohighlevel/daily-report/preview', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(daily_report_controller_1.dailyReportController.preview));
router.post('/gohighlevel/daily-report/send', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(daily_report_controller_1.dailyReportController.send));
```

- [ ] **Step 7: Verify route ordering and syntax**

Run: `cd backend && npm run typecheck && grep -n "gohighlevel/daily-report\|:provider" src/routes/integrations.routes.js`
Expected: typecheck passes; every `daily-report` line number is **lower** than every `:provider` line number.

- [ ] **Step 8: Document the endpoints**

Add the four endpoints to `docs/API.md` in the integrations section, matching the existing table format (method, path, role, description). House rule: `docs/API.md` is updated for any new endpoint.

- [ ] **Step 9: Commit**

```bash
git add backend/src/models/daily-report.model.js \
        backend/src/controllers/daily-report.controller.js \
        backend/src/routes/integrations.routes.js \
        backend/test/daily-report.controller.test.mjs \
        docs/API.md
git commit -m "feat(report): owner-only settings, preview and manual send endpoints"
```

---

### Task 6: The cron job

**Files:**
- Modify: `backend/src/workers/index.js`
- Test: `backend/test/daily-report.worker.test.mjs`

**Interfaces:**
- Consumes: `whatsappReportRepository.listEnabled()`, `dailyReportService.send(orgId, { now, trigger: 'cron' })`.
- Produces: `runDailyWhatsappReports({ now, deps })` → `{ sent, skipped, failed }`, exported from `backend/src/services/daily-report.service.js` so it can be tested without starting cron.

- [ ] **Step 1: Write the failing test**

Create `backend/test/daily-report.worker.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import { runDailyWhatsappReports } from '../src/services/daily-report.service.js';

const NOW = new Date('2026-07-21T17:00:00.000Z');

describe('runDailyWhatsappReports', () => {
  it('sends for every enabled organisation', async () => {
    const send = vi.fn().mockResolvedValue({ sent: true, status: 'ok' });
    const repo = { listEnabled: vi.fn().mockResolvedValue([
      { organisationId: 'org-a', webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null },
      { organisationId: 'org-b', webhookUrl: 'https://b.test/h', enabled: true, lastSentAt: null },
    ]) };

    const res = await runDailyWhatsappReports({ now: NOW, deps: { repo, send } });

    expect(res.sent).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('isolates a failing organisation so the others still send', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('exploded'))
      .mockResolvedValueOnce({ sent: true, status: 'ok' });
    const repo = { listEnabled: vi.fn().mockResolvedValue([
      { organisationId: 'org-a', webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null },
      { organisationId: 'org-b', webhookUrl: 'https://b.test/h', enabled: true, lastSentAt: null },
    ]) };

    const res = await runDailyWhatsappReports({ now: NOW, deps: { repo, send } });

    expect(res.failed).toBe(1);
    expect(res.sent).toBe(1);
  });

  it('counts skips separately from failures', async () => {
    const send = vi.fn().mockResolvedValue({ sent: false, status: 'skipped', reason: 'no data' });
    const repo = { listEnabled: vi.fn().mockResolvedValue([
      { organisationId: 'org-a', webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null },
    ]) };

    const res = await runDailyWhatsappReports({ now: NOW, deps: { repo, send } });

    expect(res).toEqual({ sent: 0, skipped: 1, failed: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/daily-report.worker.test.mjs`
Expected: FAIL — `runDailyWhatsappReports` is not exported.

- [ ] **Step 3: Add the runner to the service**

Append to `backend/src/services/daily-report.service.js`:

```js
/**
 * Cron entry point. One organisation failing must never stop the rest, so
 * every send is individually caught — this mirrors the isolation in
 * gohighlevel-sync's syncAllOrgs.
 */
export async function runDailyWhatsappReports({ now = new Date(), deps = {} } = {}) {
    const repo = deps.repo ?? whatsappReportRepository;
    const send = deps.send ?? ((orgId, opts) => dailyReportService.send(orgId, opts));

    const rows = await repo.listEnabled();
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
        try {
            const result = await send(row.organisationId, { now, trigger: 'cron', settings: row });
            if (result.sent) sent++;
            else skipped++;
        } catch (err) {
            failed++;
            console.error(`[worker] daily whatsapp report failed for org ${row.organisationId}`, err);
        }
    }

    return { sent, skipped, failed };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/daily-report.worker.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Register the cron job**

In `backend/src/workers/index.js`, add the import near the other service imports:

```js
import { runDailyWhatsappReports } from "../services/daily-report.service.js";
```

Then add this registration next to the other `Europe/London` jobs (near `board-report-delivery`):

```js
scheduleMonitored('daily-whatsapp-report', '0 18 * * *', async () => {
    try {
        const { sent, skipped, failed } = await runDailyWhatsappReports({ now: new Date() });
        console.log(`[worker] Daily WhatsApp reports: ${sent} sent, ${skipped} skipped, ${failed} failed`);
    } catch (err) {
        console.error('[worker] Daily WhatsApp report job failed', err);
    }
}, { timezone: 'Europe/London' });
```

- [ ] **Step 6: Verify the worker still parses**

Run: `cd backend && npm run typecheck`
Expected: PASS, no syntax errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/daily-report.service.js \
        backend/src/workers/index.js \
        backend/test/daily-report.worker.test.mjs
git commit -m "feat(report): 18:00 Europe/London cron for the daily WhatsApp report"
```

---

### Task 7: Frontend card

**Files:**
- Modify: `frontend/features/integrations/api.ts`
- Modify: `frontend/features/integrations/hooks.ts`
- Create: `frontend/features/integrations/components/DailyReportCard.tsx`
- Modify: `frontend/features/integrations/components/GoHighLevelPanel.tsx`

**Interfaces:**
- Consumes: the four endpoints from Task 5.
- Produces: `<DailyReportCard />`, mounted inside `GoHighLevelPanel`.

- [ ] **Step 1: Add the API functions**

Append to `frontend/features/integrations/api.ts`:

```ts
export type DailyReportSettings = {
  webhookUrlMasked: string | null;
  configured: boolean;
  enabled: boolean;
  lastSentAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

const DAILY_REPORT = '/api/backend/integrations/gohighlevel/daily-report';

export function getDailyReportSettings() {
  return api<{ settings: DailyReportSettings | null }>(DAILY_REPORT);
}

export function saveDailyReportSettings(body: { webhookUrl: string; enabled: boolean }) {
  return api<{ settings: DailyReportSettings }>(DAILY_REPORT, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function previewDailyReport() {
  return api<{ line: string; length: number }>(`${DAILY_REPORT}/preview`, { method: 'POST' });
}

export function sendDailyReport() {
  return api<{ sent: boolean; status: string; reason?: string }>(`${DAILY_REPORT}/send`, {
    method: 'POST',
  });
}
```

Check the existing `api()` helper first: if other functions in this file do **not** prefix paths with `/api/backend`, match whatever they do instead. Run `head -30 frontend/features/integrations/api.ts` before writing.

- [ ] **Step 2: Add the hooks**

Append to `frontend/features/integrations/hooks.ts`:

```ts
export function useDailyReportSettings() {
  return useQuery({
    queryKey: ['daily-report-settings'],
    queryFn: getDailyReportSettings,
    staleTime: 30_000,
  });
}

export function useSaveDailyReportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { webhookUrl: string; enabled: boolean }) => saveDailyReportSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily-report-settings'] }),
  });
}

export function usePreviewDailyReport() {
  return useMutation({ mutationFn: previewDailyReport });
}

export function useSendDailyReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendDailyReport,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily-report-settings'] }),
  });
}
```

Add the four function names to the existing import from `./api` at the top of the file.

- [ ] **Step 3: Write the card**

Create `frontend/features/integrations/components/DailyReportCard.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  useDailyReportSettings,
  useSaveDailyReportSettings,
  usePreviewDailyReport,
  useSendDailyReport,
} from '../hooks';

export function DailyReportCard() {
  const { data } = useDailyReportSettings();
  const save = useSaveDailyReportSettings();
  const preview = usePreviewDailyReport();
  const send = useSendDailyReport();

  const settings = data?.settings ?? null;
  const [url, setUrl] = useState('');

  const enabled = settings?.enabled ?? false;
  const configured = settings?.configured ?? false;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Daily WhatsApp report</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!configured || save.isPending}
            onChange={(e) => save.mutate({ webhookUrl: url || '', enabled: e.target.checked })}
          />
          Enabled
        </label>
      </div>

      <p className="text-ink-muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
        Sends group totals for the previous day at 18:00 UK, every day. Recipients are
        managed in GoHighLevel.
      </p>

      <label style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
        Inbound webhook URL
      </label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <input
          type="url"
          value={url}
          placeholder={settings?.webhookUrlMasked ?? 'https://services.leadconnectorhq.com/hooks/...'}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }}
        />
        <button
          type="button"
          disabled={!url || save.isPending}
          onClick={() => save.mutate({ webhookUrl: url, enabled })}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--brand)', color: '#fff', fontSize: 12 }}
        >
          {save.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
      <p className="text-ink-muted" style={{ fontSize: 10, margin: '0 0 12px' }}>
        Paste the URL from your GoHighLevel workflow&apos;s Inbound Webhook trigger.
      </p>

      {save.isError && (
        <p style={{ fontSize: 12, color: '#b42318', margin: '0 0 12px' }}>
          Could not save. Check the URL uses https.
        </p>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Preview</span>
          <button
            type="button"
            onClick={() => preview.mutate()}
            disabled={preview.isPending}
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: '#fff', fontSize: 12 }}
          >
            {preview.isPending ? 'Building...' : 'Refresh preview'}
          </button>
        </div>
        <div style={{ background: '#f7f8fa', borderRadius: 6, padding: 10, fontSize: 12, minHeight: 40, wordBreak: 'break-word' }}>
          {preview.data?.line ?? 'Refresh to see the line that would be sent.'}
        </div>
        {preview.data && (
          <p className="text-ink-muted" style={{ fontSize: 10, margin: '4px 0 0' }}>
            {preview.data.length} characters
          </p>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <span className="text-ink-muted" style={{ fontSize: 12 }}>
          {settings?.lastSentAt
            ? `Last sent ${new Date(settings.lastSentAt).toLocaleString('en-GB')} - ${settings.lastStatus === 'ok' ? 'Delivered' : settings.lastError ?? settings.lastStatus}`
            : 'Not sent yet'}
        </span>
        <button
          type="button"
          onClick={() => send.mutate()}
          disabled={!configured || send.isPending}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: '#fff', fontSize: 12 }}
        >
          {send.isPending ? 'Sending...' : 'Send now'}
        </button>
      </div>

      {send.data && !send.data.sent && (
        <p style={{ fontSize: 12, color: '#b42318', margin: '8px 0 0' }}>
          Not sent: {send.data.reason ?? send.data.status}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount the card**

In `frontend/features/integrations/components/GoHighLevelPanel.tsx`, add the import:

```tsx
import { DailyReportCard } from './DailyReportCard';
```

Then render `<DailyReportCard />` as the last child inside the panel's `CollapsibleCard`, after the existing subaccount list.

- [ ] **Step 5: Verify the frontend builds**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: all three pass.

If `typecheck` complains that `preview.data` is possibly undefined, that is real — the guards above handle it; do not add `any` to silence it.

- [ ] **Step 6: Commit**

```bash
git add frontend/features/integrations/api.ts \
        frontend/features/integrations/hooks.ts \
        frontend/features/integrations/components/DailyReportCard.tsx \
        frontend/features/integrations/components/GoHighLevelPanel.tsx
git commit -m "feat(report): daily WhatsApp report card on the integrations page"
```

---

### Task 8: End-to-end verification

**Files:** none created.

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, including the ~40 new tests.

- [ ] **Step 2: Lint the backend**

Run: `cd backend && npm run lint`
Expected: clean.

- [ ] **Step 3: Verify the report against the dashboard**

Start the backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`), log in as an owner, open Integrations, and click **Refresh preview**.

Compare the previewed numbers against the Ad Performance page for the same date (yesterday). Leads, spend and CPL must match exactly. If they do not, the window passed to `getPerformance` is wrong — check `previousDayInLondon` output rather than adjusting the formatter.

- [ ] **Step 4: Verify the length against a real GHL custom field**

Copy the previewed line, paste it into the `dental_os` Multi line custom field in GoHighLevel, and save. Confirm it stores without truncation.

If GHL truncates, lower `MAX_REPORT_CHARS` in `backend/src/services/daily-report.format.js` to the observed limit and re-run the formatter tests — the drop order will shed QuickBooks first automatically.

- [ ] **Step 5: Send a real test message**

Paste a real GHL inbound webhook URL, save, and press **Send now**. Confirm in GHL that the workflow fired and the WhatsApp message arrived intact.

Watch for whitespace mangling: if the message is truncated at the first `£`, GHL is counting bytes — reduce `MAX_REPORT_CHARS` accordingly.

- [ ] **Step 6: Commit any adjustments**

```bash
git add -A
git commit -m "fix(report): adjust report length after live GHL verification"
```

---

## Deployment notes

- The worker runs in the separate Railway worker service (`node src/workers/index.js`). The new cron ships with it — **the web service alone will not send reports.**
- `INTEGRATIONS_SECRET_KEY` must be set in the worker environment, not just the API, or `decryptSecret` throws when the cron reads the URL.
- Apply migration `20260101000117` on hosted Supabase, then run `NOTIFY pgrst, 'reload schema';` — PostgREST's cache goes stale and the settings endpoints will 404 on the new table until it reloads.
- The report is off by default (`enabled` defaults to false). Nothing sends until an owner saves a URL and enables it.
