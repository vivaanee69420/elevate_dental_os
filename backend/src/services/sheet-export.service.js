// Outbox drainer for the GHL→Dentally conversion export. All external I/O
// (Google) lives HERE — never in the webhook request path. Claim is atomic
// (FOR UPDATE SKIP LOCKED RPC) so the webhook-kicked drain and the worker
// sweep operate on disjoint rows; exactly-once appends via the Export ID
// column dedup. Spec: docs/superpowers/specs/2026-08-06-ghl-dentally-sheet-export-design.md
import { sheetExportRepository } from '../repositories/sheet-export.repository.js';
import { integrationRepository } from '../repositories/integration.repository.js';
import { AppError } from '../middleware/errors.js';
import { findMatch } from './sheet-export-match.service.js';
import { WRITER_PROVIDER_ID } from '../lib/integrations/google-sheets-writer-provider.js';
import { parseSpreadsheetId } from '../lib/integrations/google-sheets-provider.js';
import { ensurePracticeTab, appendRows, readExportIds, formatLondonDate }
    from '../lib/integrations/google-sheets-writer.js';
import { writerFetch } from '../lib/integrations/google-sheets-writer-provider.js';

const lastKick = new Map(); // orgId -> ms; 60s debounce, in-process only

// Recovery writes (markRetry/markNoMatch) run inside catch blocks whose whole
// purpose is to keep the row/batch loops alive on failure. If the recovery
// write itself throws (e.g. a transient Supabase blip), that must NEVER
// escape and abort the remaining rows/batches — log and move on; the row
// stays in its previous status and gets picked up by the next drain/claim.
async function safeMark(fn, label, orgId) {
    try {
        await fn();
    } catch (err) {
        console.warn(`[sheet-export] ${label} failed`, { orgId, err: err?.message || String(err) });
    }
}

export const sheetExportService = {
    async status(orgId) {
        const integ = await integrationRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
        const counts = integ ? await sheetExportRepository.counts(orgId) : null;
        return {
            connected: !!integ && integ.status !== 'revoked',
            status: integ?.status ?? 'not_connected',
            spreadsheetId: integ?.config?.spreadsheet_id ?? null,
            exportSince: integ?.config?.export_since ?? null,
            lastError: integ?.last_error ?? null,
            counts,
        };
    },

    // Rolling last-24h view of what the export checked — feeds the panel's
    // on-demand activity modal. Older entries drop out of the window; the
    // queue rows themselves are kept (they are the dedup record).
    async activity(orgId) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const rows = await sheetExportRepository.recentActivity(orgId, since);
        return {
            entries: rows.map((r) => ({
                id: r.id,
                name: [r.contacts?.first_name, r.contacts?.last_name].filter(Boolean).join(' ') || 'Unknown patient',
                practice: r.practices?.name ?? 'Unassigned',
                status: r.status,
                reason: r.status === 'no_match' ? (r.last_error ?? null) : null,
                appointmentAt: r.appointment_starts_at,
                at: r.updated_at ?? r.created_at,
            })),
        };
    },

    async setDestination(orgId, url) {
        const spreadsheetId = parseSpreadsheetId(url);
        if (!spreadsheetId) throw new AppError('Not a valid Google Sheets URL', 400);
        const integ = await integrationRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
        if (!integ || !integ.secrets) throw new AppError('Connect Google Sheets export first', 409);
        // Verify we can actually reach the sheet with the write-scoped token.
        await writerFetch(orgId, `/v4/spreadsheets/${spreadsheetId}`, {
            params: { fields: 'spreadsheetId' },
        });
        // export_since is stamped ONCE — this is the go-forward-only cutoff.
        const export_since = integ.config?.export_since ?? new Date().toISOString();
        await integrationRepository.mergeConfig(orgId, WRITER_PROVIDER_ID, { spreadsheet_id: spreadsheetId, export_since });
        return { spreadsheetId, exportSince: export_since };
    },

    async disconnect(orgId) {
        await integrationRepository.markRevoked(orgId, WRITER_PROVIDER_ID);
        return { ok: true };
    },

    kickDrain(orgId) {
        const now = Date.now();
        if ((lastKick.get(orgId) ?? 0) > now - 60_000) return;
        lastKick.set(orgId, now);
        // Fire-and-forget AFTER the webhook 200 — a Google outage must never
        // block appointment ingestion or trigger Dentally webhook retries.
        setImmediate(() => {
            sheetExportService.drainOrg(orgId).catch((err) => {
                console.warn('[sheet-export] kicked drain failed', { orgId, err: err?.message || String(err) });
            });
        });
    },

    async drainOrg(orgId, { includeNoMatch = false, ignoreBackoff = false } = {}) {
        const integ = await integrationRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
        if (!integ || integ.status === 'revoked' || !integ.secrets) return { skipped: 'not_connected' };
        const spreadsheetId = integ.config?.spreadsheet_id;
        const since = integ.config?.export_since;
        if (!spreadsheetId || !since) return { skipped: 'no_destination' };
        // An outage (Google-side or destination sheet gone) flips the
        // integration to 'failed'. Pause draining entirely rather than
        // keep claiming + failing rows into terminal state — enqueue is a
        // full rescan from export_since, so nothing is lost by pausing;
        // reconnect resumes and the next drain catches the backlog.
        if (integ.status === 'failed') return { skipped: 'integration_failed' };

        await sheetExportRepository.enqueue(orgId, since);
        const rows = await sheetExportRepository.claim(orgId, { limit: 50, includeNoMatch, ignoreBackoff });
        if (rows.length === 0) return { exported: 0, noMatch: 0, retried: 0, skippedDuplicates: 0 };

        const practiceName = new Map((await sheetExportRepository.practices(orgId)).map((p) => [p.id, p.name]));
        const perPractice = new Map(); // practiceId -> [{ queueRow, values }]
        let exported = 0, noMatch = 0, retried = 0, skippedDuplicates = 0;

        for (const row of rows) {
            try {
                const contact = await sheetExportRepository.getContact(orgId, row.contact_id);
                const match = contact ? await findMatch(orgId, contact) : null;
                if (!match) {
                    await safeMark(() => sheetExportRepository.markNoMatch(orgId, row.id,
                        contact ? 'no GHL pipeline lead matched' : 'contact missing'), 'markNoMatch', orgId);
                    noMatch += 1;
                    continue;
                }
                const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
                // Order must mirror the writer's HEADER exactly (Export ID last, hidden).
                const treatment = await sheetExportRepository
                    .appointmentType(orgId, row.appointment_id).catch(() => null);
                const values = [formatLondonDate(match.leadCreatedAt), name,
                    contact.email ?? '', contact.phone ?? '', match.pipelineName,
                    formatLondonDate(row.appointment_starts_at), treatment ?? '', row.id];
                await sheetExportRepository.recordMatch(orgId, row.id, match.matchedContact.id, match.lead.id);
                const key = row.practice_id ?? 'unassigned';
                if (!perPractice.has(key)) perPractice.set(key, []);
                perPractice.get(key).push({ queueRow: row, values });
            } catch (err) {
                await safeMark(() => sheetExportRepository.markRetry(orgId, row.id, err?.message || 'match failed'),
                    'markRetry', orgId);
                retried += 1;
            }
        }

        for (const [practiceId, batch] of perPractice) {
            try {
                const title = await ensurePracticeTab(orgId, spreadsheetId, practiceId,
                    practiceName.get(practiceId) ?? 'Unassigned');
                const already = await readExportIds(orgId, spreadsheetId, title);
                const fresh = batch.filter((b) => !already.has(b.queueRow.id));
                await appendRows(orgId, spreadsheetId, title, fresh.map((b) => b.values));
                await sheetExportRepository.markExported(orgId, batch.map((b) => b.queueRow.id));
                exported += fresh.length;
                skippedDuplicates += batch.length - fresh.length;
            } catch (err) {
                // Distinct handling (spec): sheet deleted or access revoked → the
                // whole integration flips to failed with a specific reason, so the
                // Integrations panel shows "sheet not accessible" + Reconnect
                // instead of rows silently retrying forever. Rows stay pending.
                if (err?.status === 403 || err?.status === 404) {
                    await safeMark(() => integrationRepository.markFailed(orgId, WRITER_PROVIDER_ID,
                        'destination sheet not accessible'), 'markFailed', orgId);
                }
                for (const b of batch) {
                    await safeMark(() => sheetExportRepository.markRetry(orgId, b.queueRow.id, err?.message || 'append failed'),
                        'markRetry', orgId);
                    retried += 1;
                }
            }
        }
        await integrationRepository.setSyncTime(orgId, WRITER_PROVIDER_ID).catch(() => {});
        return { exported, noMatch, retried, skippedDuplicates };
    },

    async drainAllOrgs() {
        // Enumerate orgs with a writer row — mirror google-sheets-sync.syncAllOrgs.
        const orgs = await sheetExportRepository.orgsWithWriter();
        const results = [];
        for (const orgId of orgs) {
            try {
                results.push({ orgId, ...(await sheetExportService.drainOrg(orgId, { includeNoMatch: true })) });
            } catch (err) {
                console.error('[sheet-export] drain failed', { orgId, err: err?.message || String(err) });
                results.push({ orgId, error: err?.message || 'drain failed' });
            }
        }
        return results;
    },
};
