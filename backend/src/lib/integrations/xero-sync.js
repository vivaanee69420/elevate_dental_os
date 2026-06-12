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

function currentPeriod() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthBounds() {
    const d = new Date();
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const to = d.toISOString().slice(0, 10);
    return { from, to };
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

export async function syncOneOrg(orgId, integrationArg) {
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
        const { from, to } = monthBounds();

        const res = await fetch(`${REPORTS_BASE}/ProfitAndLoss?fromDate=${from}&toDate=${to}`, {
            headers: {
                Authorization: `Bearer ${access_token}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
            },
        });
        if (!res.ok) throw new Error(`Xero P&L -> HTTP ${res.status}`);
        const report = await res.json();

        const accountMap = await loadAccountMap(orgId);
        const period = currentPeriod();
        const rows = parseReportRows(report).map((r) => ({
            organisation_id: orgId,
            practice_id: null,
            period,
            account_code: String(r.account),
            dental_bucket: mapBucket(r.account, r.section, accountMap),
            amount_pence: toPence(r.amount),
            source: 'xero',
        }));

        // A P&L sync replaces the whole month: delete this period's xero rows then
        // insert fresh. Idempotent, and avoids depending on the COALESCE functional
        // unique index as an ON CONFLICT arbiter (which Supabase upsert can't target).
        const { error: delErr } = await supabase_1.serviceClient
            .from('monthly_financials')
            .delete()
            .eq('organisation_id', orgId)
            .eq('period', period)
            .eq('source', 'xero');
        if (delErr) throw new Error(`monthly_financials clear: ${delErr.message}`);
        if (rows.length > 0) {
            const { error } = await supabase_1.serviceClient.from('monthly_financials').insert(rows);
            if (error) throw new Error(`monthly_financials insert: ${error.message}`);
        }
        await integrationRepository.upsert(orgId, 'xero', {
            last_sync_at: new Date().toISOString(), last_error: null, status: 'active',
        });
        return { lines: rows.length, period };
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
