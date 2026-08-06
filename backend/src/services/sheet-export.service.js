// Outbox drainer for the GHL→Dentally conversion export. All external I/O
// (Google) lives HERE — never in the webhook request path. Claim is atomic
// (FOR UPDATE SKIP LOCKED RPC) so the webhook-kicked drain and the worker
// sweep operate on disjoint rows; exactly-once appends via the Export ID
// column dedup. Spec: docs/superpowers/specs/2026-08-06-ghl-dentally-sheet-export-design.md
import { sheetExportRepository } from '../repositories/sheet-export.repository.js';
import { integrationRepository } from '../repositories/integration.repository.js';
import { findMatch } from './sheet-export-match.service.js';
import { WRITER_PROVIDER_ID } from '../lib/integrations/google-sheets-writer-provider.js';
import { parseSpreadsheetId } from '../lib/integrations/google-sheets-provider.js';
import { ensurePracticeTab, appendRows, readExportIds, formatLondonDate }
    from '../lib/integrations/google-sheets-writer.js';

const lastKick = new Map(); // orgId -> ms; 60s debounce, in-process only

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

    async setDestination(orgId, url) {
        const spreadsheetId = parseSpreadsheetId(url);
        if (!spreadsheetId) throw Object.assign(new Error('Not a valid Google Sheets URL'), { status: 400 });
        const integ = await integrationRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
        if (!integ || !integ.secrets) throw Object.assign(new Error('Connect Google Sheets export first'), { status: 409 });
        // Verify we can actually reach the sheet with the write-scoped token.
        const { writerFetch } = await import('../lib/integrations/google-sheets-writer-provider.js');
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
            this.drainOrg(orgId).catch((err) => {
                console.warn('[sheet-export] kicked drain failed', { orgId, err: err?.message || String(err) });
            });
        });
    },

    async drainOrg(orgId, { includeNoMatch = false } = {}) {
        const integ = await integrationRepository.getByProvider(orgId, WRITER_PROVIDER_ID);
        if (!integ || integ.status === 'revoked' || !integ.secrets) return { skipped: 'not_connected' };
        const spreadsheetId = integ.config?.spreadsheet_id;
        const since = integ.config?.export_since;
        if (!spreadsheetId || !since) return { skipped: 'no_destination' };

        await sheetExportRepository.enqueue(orgId, since);
        const rows = await sheetExportRepository.claim(orgId, { limit: 50, includeNoMatch });
        if (rows.length === 0) return { exported: 0, noMatch: 0, retried: 0 };

        const practiceName = new Map((await sheetExportRepository.practices(orgId)).map((p) => [p.id, p.name]));
        const perPractice = new Map(); // practiceId -> [{ queueRow, values }]
        let exported = 0, noMatch = 0, retried = 0;

        for (const row of rows) {
            try {
                const contact = await sheetExportRepository.getContact(orgId, row.contact_id);
                const match = contact ? await findMatch(orgId, contact) : null;
                if (!match) {
                    await sheetExportRepository.markNoMatch(orgId, row.id,
                        contact ? 'no GHL pipeline lead matched' : 'contact missing');
                    noMatch += 1;
                    continue;
                }
                const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
                const values = [name, contact.email ?? '', contact.phone ?? '',
                    match.pipelineName, formatLondonDate(row.appointment_starts_at),
                    formatLondonDate(match.leadCreatedAt), row.id];
                await sheetExportRepository.recordMatch(orgId, row.id, match.matchedContact.id, match.lead.id);
                const key = row.practice_id ?? 'unassigned';
                if (!perPractice.has(key)) perPractice.set(key, []);
                perPractice.get(key).push({ queueRow: row, values });
            } catch (err) {
                await sheetExportRepository.markRetry(orgId, row.id, err?.message || 'match failed');
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
                exported += batch.length;
            } catch (err) {
                // Distinct handling (spec): sheet deleted or access revoked → the
                // whole integration flips to failed with a specific reason, so the
                // Integrations panel shows "sheet not accessible" + Reconnect
                // instead of rows silently retrying forever. Rows stay pending.
                if (err?.status === 403 || err?.status === 404) {
                    await integrationRepository.markFailed(orgId, WRITER_PROVIDER_ID,
                        'destination sheet not accessible').catch(() => {});
                }
                for (const b of batch) {
                    await sheetExportRepository.markRetry(orgId, b.queueRow.id, err?.message || 'append failed');
                    retried += 1;
                }
            }
        }
        await integrationRepository.setSyncTime(orgId, WRITER_PROVIDER_ID).catch(() => {});
        return { exported, noMatch, retried };
    },

    async drainAllOrgs() {
        // Enumerate orgs with a writer row — mirror google-sheets-sync.syncAllOrgs.
        const orgs = await sheetExportRepository.orgsWithWriter();
        const results = [];
        for (const orgId of orgs) {
            try {
                results.push({ orgId, ...(await this.drainOrg(orgId, { includeNoMatch: true })) });
            } catch (err) {
                console.error('[sheet-export] drain failed', { orgId, err: err?.message || String(err) });
                results.push({ orgId, error: err?.message || 'drain failed' });
            }
        }
        return results;
    },
};
