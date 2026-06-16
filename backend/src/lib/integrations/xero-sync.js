// Xero sync — pulls the Profit & Loss report per active org integration, maps
// each account line to a dental_bucket, and upserts into monthly_financials so
// the Finance / Valuation / Corporation Tax screens read real actuals.
//
//   GET https://api.xero.com/api.xro/2.0/Reports/ProfitAndLoss?fromDate=&toDate=
//     Authorization: Bearer <access_token>
//     Xero-tenant-id: <tenant captured at connect>
//   -> walk Report.Rows (nested Sections) -> {account, amount}
//   -> bucket via xero_account_map (per-org override) else a name heuristic
//   -> upsert monthly_financials (period, account_code, dental_bucket, amount_pence)
//
// Access tokens expire in 30 min, so we refresh before the call when near expiry.
//
// NOTE: balance-sheet + bank-feed pulls and practice-level tracking-category
// allocation are follow-ups (see docs/plans/DENTALLY_CSV_INTEGRATION_PLAN.md).
// Verify the report JSON shape against a live tenant during UAT — Xero wraps
// the P&L in Reports[0].Rows with nested RowType Section/Row/SummaryRow.

import { integrationRepository } from "../../repositories/integration.repository.js";
import { decryptSecret } from "../crypto.js";
import * as supabase_1 from "../supabase.js";

const REPORTS_BASE = 'https://api.xero.com/api.xro/2.0/Reports';
const BUCKETS = ['revenue', 'associates', 'staff', 'lab', 'materials', 'overhead', 'tax', 'other'];
const REQUEST_TIMEOUT_MS = 30000; // abort a hung Xero report so one stuck tenant can't stall the nightly cron forever

// fetch with an abort-based timeout. A hung Node fetch never rejects on its own,
// so without this a single unresponsive Xero tenant would block syncAllOrgs
// indefinitely (the per-org try/catch only catches thrown errors, not a hang).
async function fetchWithTimeout(url, opts) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...opts, signal: ac.signal });
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error(`Xero request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function toPence(amount) {
    const n = Number(String(amount ?? '').replace(/[(),]/g, (m) => (m === '(' ? '-' : '')));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Heuristic bucket from the account name + the section it sits under. Used when
// the org hasn't mapped the account code explicitly in xero_account_map.
function heuristicBucket(accountName, sectionTitle) {
    const s = `${sectionTitle || ''} ${accountName || ''}`.toLowerCase();
    if (/income|revenue|sales|turnover/.test(s)) return 'revenue';
    // Fee-earning clinician pay (the 45% "dentist/associate" benchmark line) MUST
    // be tested before the staff line — account names like "Associate salary" /
    // "Principal salary" carry "salary" and would otherwise fold into support staff.
    if (/associate|locum|principal|hygien|hygenist|therapist|self.?employed|dentist/.test(s)) return 'associates';
    if (/wage|salary|salaries|payroll|staff/.test(s)) return 'staff';
    if (/\blab\b|laboratory/.test(s)) return 'lab';
    if (/material|consumable|stock|supplies/.test(s)) return 'materials';
    if (/\btax\b|corporation tax|vat/.test(s)) return 'tax';
    if (/expense|overhead|rent|rates|utilit|insurance|admin|marketing/.test(s)) return 'overhead';
    return 'other';
}

function mapBucket(accountName, sectionTitle, accountMap) {
    const override = accountMap.get(String(accountName));
    if (override && BUCKETS.includes(override)) return override;
    return heuristicBucket(accountName, sectionTitle);
}

// Walk Xero's nested report rows. Each leaf RowType 'Row' has Cells:
// Cells[0] = account name (+ Attributes with the account id), Cells[1] = amount.
// Section rows carry a Title and nested Rows. Returns flat [{account, amount, section}].
function parseReportRows(report) {
    const out = [];
    const reportObj = report?.Reports?.[0] ?? report;
    const walk = (rows, sectionTitle) => {
        for (const row of rows ?? []) {
            if (row.RowType === 'Section') {
                walk(row.Rows, row.Title || sectionTitle);
            } else if (row.RowType === 'Row' && Array.isArray(row.Cells) && row.Cells.length >= 2) {
                const account = row.Cells[0]?.Value;
                const amount = row.Cells[1]?.Value;
                if (account && amount !== '' && amount != null) {
                    out.push({ account, amount, section: sectionTitle ?? '' });
                }
            }
        }
    };
    walk(reportObj?.Rows, undefined);
    return out;
}

const FIRST_FILL_MONTHS = 12; // first-fill (on-connect) window: last 12 calendar months
const NIGHTLY_MONTHS = 6;     // nightly cron window: re-pull the trailing 6 calendar months (catches late edits)

// The most-recent `n` calendar months, oldest first, as { period, from, to }.
// `period` is YYYY-MM; the current (last) month's `to` is capped at today, every
// earlier month runs to its real last day. Each month is pulled + stored
// independently so a later re-sync never disturbs earlier periods.
function monthWindows(n) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(y, m - i, 1));
        const yy = d.getUTCFullYear();
        const mm = d.getUTCMonth(); // 0-based
        const period = `${yy}-${String(mm + 1).padStart(2, '0')}`;
        const from = `${period}-01`;
        const lastDay = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
        const to = i === 0
            ? now.toISOString().slice(0, 10)
            : `${period}-${String(lastDay).padStart(2, '0')}`;
        out.push({ period, from, to });
    }
    return out;
}

async function loadAccountMap(orgId) {
    const { data } = await supabase_1.serviceClient
        .from('xero_account_map')
        .select('account_code, dental_bucket')
        .eq('organisation_id', orgId);
    const map = new Map();
    for (const r of data ?? []) map.set(String(r.account_code), r.dental_bucket);
    return map;
}

// Ensure a fresh access token (refresh when within 60s of expiry / already expired).
async function ensureToken(orgId, integration) {
    const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
    if (expiresAt && expiresAt - Date.now() > 60_000) return integration;
    const { XeroProvider } = await import('./xero-provider.js');
    await XeroProvider.refresh(orgId);
    return integrationRepository.getByProvider(orgId, 'xero');
}

// Pull + store ONE month's P&L for an org. Replaces the whole period: delete this
// period's xero rows then insert fresh. Idempotent, and avoids depending on the
// COALESCE functional unique index as an ON CONFLICT arbiter (which Supabase
// upsert can't target). Returns the number of lines stored for the month.
async function syncMonth(orgId, tenantId, access_token, accountMap, { period, from, to }) {
    const res = await fetchWithTimeout(`${REPORTS_BASE}/ProfitAndLoss?fromDate=${from}&toDate=${to}`, {
        headers: {
            Authorization: `Bearer ${access_token}`,
            'Xero-tenant-id': tenantId,
            Accept: 'application/json',
        },
    });
    if (!res.ok) throw new Error(`Xero P&L (${period}) -> HTTP ${res.status}`);
    const report = await res.json();

    const rows = parseReportRows(report).map((r) => ({
        organisation_id: orgId,
        practice_id: null,
        period,
        account_code: String(r.account),
        dental_bucket: mapBucket(r.account, r.section, accountMap),
        amount_pence: toPence(r.amount),
        source: 'xero',
    }));

    const { error: delErr } = await supabase_1.serviceClient
        .from('monthly_financials')
        .delete()
        .eq('organisation_id', orgId)
        .eq('period', period)
        .eq('source', 'xero');
    if (delErr) throw new Error(`monthly_financials clear (${period}): ${delErr.message}`);
    if (rows.length > 0) {
        const { error } = await supabase_1.serviceClient.from('monthly_financials').insert(rows);
        if (error) throw new Error(`monthly_financials insert (${period}): ${error.message}`);
    }
    return rows.length;
}

// opts.months overrides the window; otherwise first fill (no prior sync) backfills
// 12 months and the nightly cron refreshes the trailing 6.
export async function syncOneOrg(orgId, integrationArg, _onProgress, opts = {}) {
    let integration = integrationArg ?? await integrationRepository.getByProvider(orgId, 'xero');
    if (!integration?.secrets) {
        await integrationRepository.markFailed(orgId, 'xero', 'no_auth: no stored credentials');
        return { error: 'no_auth' };
    }
    try {
        integration = await ensureToken(orgId, integration);
        const tenantId = integration.config?.tenant_id;
        if (!tenantId) throw new Error('no Xero tenant connected');
        const { access_token } = JSON.parse(decryptSecret(integration.secrets));
        const accountMap = await loadAccountMap(orgId);

        const months = opts.months ?? (integration.last_sync_at ? NIGHTLY_MONTHS : FIRST_FILL_MONTHS);
        const windows = monthWindows(months);

        let lines = 0;
        const periods = [];
        for (const w of windows) {
            lines += await syncMonth(orgId, tenantId, access_token, accountMap, w);
            periods.push(w.period);
        }

        await integrationRepository.upsert(orgId, 'xero', {
            last_sync_at: new Date().toISOString(), last_error: null, status: 'active',
        });
        return { lines, periods };
    } catch (err) {
        await integrationRepository.markFailed(orgId, 'xero', String(err.message).slice(0, 500));
        throw err;
    }
}

export async function syncAllOrgs() {
    const { data: rows } = await supabase_1.serviceClient
        .from('integrations')
        .select('*')
        .eq('provider', 'xero')
        .eq('status', 'active');
    const results = [];
    for (const row of rows ?? []) {
        try {
            const r = await syncOneOrg(row.organisation_id, row);
            results.push({ orgId: row.organisation_id, ...r });
        } catch (err) {
            results.push({ orgId: row.organisation_id, error: err.message });
        }
    }
    return results;
}

export const __test = { toPence, heuristicBucket, mapBucket, parseReportRows };
