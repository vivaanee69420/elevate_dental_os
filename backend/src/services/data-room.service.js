// backend/src/services/data-room.service.js
// ============================================================================
// Data Room service — the one place that turns a (user, source, dataset,
// query) into rows or a CSV stream.
//
//   - resolves the registry entry (404 on unknown)
//   - validates the period window for event datasets (roster ignores it)
//   - PII gate: pii columns are only ever selected for role === 'owner' AND
//     query.pii === true; anyone else asking for PII gets a 403
//   - practice scope: direct column, or `via` parent-key resolution (an empty
//     key list short-circuits to zero rows — no query)
//   - pagination: keyset via opaque cursors (export batching, default), or
//     numbered pages (`page=N` -> offset mode) for the UI; derived (in-memory)
//     datasets slice by offset either way — including `derived: 'rpc'`
//     (source `summaries`), which windows + practice-scopes a Postgres
//     function's rows the same way `ghl_pipelines` slices its in-memory rows
//   - CSV streaming in 1000-row batches through a sink (Express res in prod,
//     a recorder in tests); every export is audited (rows, aborted flag) —
//     the audited since/until always come from the validated `window()`,
//     table-backed or rpc-backed alike
//   - Excel export in two halves: prepareExport() validates and decides the
//     worksheets (one per practice + Unassigned for a scope=all export of a
//     practice-column dataset) and refuses anything over XLSX_ROW_CAP with a
//     413 BEFORE a byte is written, so failures still answer JSON;
//     writeXlsx() then streams the workbook and audits format: 'xlsx'
//   - freshness(user): per-source (+ per-GHL-account) last_sync_at/status for
//     the "data as of" badge, derived from dataRoomRepository.freshness()
//
// orgId always comes from req.user, never from the request.
// ============================================================================
import { once } from 'node:events';
import { AppError } from '../middleware/errors.js';
import { dataRoomRepository } from '../repositories/data-room.repository.js';
import { getDataset, columnNames, registryForClient } from '../lib/data-room/registry.js';
import { encodeCursor, decodeCursor } from '../lib/data-room/cursor.js';
import { BOM, csvLine, rowsToCsv } from '../lib/data-room/csv.js';
import { openWorkbook } from '../lib/data-room/xlsx.js';

const EXPORT_BATCH = 1000; // PostgREST hard cap per request
export const XLSX_ROW_CAP = 500_000; // Excel holds 1,048,576 rows; stay well under and keep files openable

function londonDate(iso) {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function resolve(source, key) {
    const ds = getDataset(source, key);
    if (!ds) throw new AppError('Unknown dataset', 404);
    return ds;
}

function assertPii(user, wantPii) {
    if (wantPii && user.role !== 'owner') throw new AppError('PII export is owner-only', 403);
    return !!wantPii;
}

/** Window for event datasets (validated); null bounds for roster datasets. */
function window(ds, query) {
    if (!ds.dateCol) return { since: null, until: null };
    if (!query.since || !query.until) throw new AppError('since and until are required for this dataset', 400);
    const s = new Date(query.since).toISOString();
    const u = new Date(query.until).toISOString();
    if (s >= u) throw new AppError('since must be before until', 400);
    return { since: s, until: u };
}

/** { practiceId, practiceKeys } for the scope; `empty: true` when a via scope matched nothing. */
async function practiceFilter(orgId, ds, scope) {
    if (scope === 'all') return { practiceId: null, practiceKeys: null, empty: false };
    if (ds.practice.col) return { practiceId: scope, practiceKeys: null, empty: false };
    const keys = await dataRoomRepository.viaKeys(orgId, ds.practice.via, scope);
    return { practiceId: null, practiceKeys: keys, empty: keys.length === 0 };
}

async function buildFilters(orgId, ds, query) {
    const win = window(ds, query);
    const pf = await practiceFilter(orgId, ds, query.scope);
    return { filters: { practiceId: pf.practiceId, practiceKeys: pf.practiceKeys, ...win }, empty: pf.empty };
}

function project(rows, cols) {
    const allowed = new Set(cols);
    return rows.map((r) => {
        const o = {};
        for (const c of Object.keys(r)) {
            if (allowed.has(c)) o[c] = r[c];
        }
        return o;
    });
}

function lastCursor(ds, rows) {
    const last = rows[rows.length - 1];
    return encodeCursor({ d: ds.dateCol ? last[ds.dateCol] : null, id: last.id });
}

/** Registry columns (name + unit) for the selected column names, in order. */
function typedColumns(ds, cols) {
    const byName = new Map(ds.columns.map((c) => [c.col, c]));
    return cols.map((name) => ({ col: name, unit: byName.get(name)?.unit ?? 'text' }));
}

/**
 * All rows for a filter set, in keyset batches, handed to `onBatch`.
 * `isAborted()` is polled between batches (client disconnect) -> { aborted: true }.
 * The CALLER counts rows inside `onBatch` rather than reading a returned total,
 * so a batch that throws mid-stream still leaves the rows already written in
 * the caller's audit diff (a returned count would be lost with the exception).
 */
async function eachBatch(orgId, ds, filters, cols, isAborted, onBatch) {
    let after = null;
    for (;;) {
        if (isAborted()) return { aborted: true };
        const batch = await dataRoomRepository.page(orgId, ds, filters, { after, limit: EXPORT_BATCH, columns: cols });
        if (batch.length === 0) break;
        onBatch(batch);
        if (batch.length < EXPORT_BATCH) break;
        after = decodeCursor(lastCursor(ds, batch));
    }
    return { aborted: false };
}

/** Derived datasets live in memory; page them by numeric offset. */
async function derivedRows(orgId, ds, query) {
    if (ds.derived === 'ghl_pipelines') {
        const practiceId = query.scope === 'all' ? null : query.scope;
        return dataRoomRepository.pipelineRows(orgId, practiceId);
    }
    if (ds.derived === 'rpc') {
        const win = window(ds, query);
        const practiceId = query.scope === 'all' ? null : query.scope;
        return dataRoomRepository.rpcRows(orgId, ds.rpc, { since: win.since, until: win.until, practiceId });
    }
    throw new AppError(`Unknown derived dataset ${ds.derived}`, 500);
}

export const dataRoomService = {
    datasets() {
        return registryForClient();
    },

    async page(user, source, key, query) {
        const ds = resolve(source, key);
        const includePii = assertPii(user, query.pii);
        const cols = columnNames(ds, includePii);
        const orgId = user.organisation_id;
        // page=N (numbered pages) -> offset mode; otherwise keyset via cursor.
        const offset = query.page ? (query.page - 1) * query.limit : undefined;
        const after = offset == null && query.cursor ? decodeCursor(query.cursor) : null;

        if (ds.derived) {
            const all = await derivedRows(orgId, ds, query);
            const start = offset ?? (after ? Number(after.id) : 0);
            const rows = all.slice(start, start + query.limit);
            const next = start + rows.length < all.length ? encodeCursor({ d: null, id: start + rows.length }) : null;
            return { rows: project(rows, cols), next_cursor: next, total: all.length };
        }

        const { filters, empty } = await buildFilters(orgId, ds, query);
        if (empty) return { rows: [], next_cursor: null, total: 0 };
        const [rows, total] = await Promise.all([
            dataRoomRepository.page(orgId, ds, filters, { after, offset, limit: query.limit, columns: cols }),
            dataRoomRepository.count(orgId, ds, filters),
        ]);
        const next = rows.length === query.limit ? lastCursor(ds, rows) : null;
        return { rows: project(rows, cols), next_cursor: next, total };
    },

    exportFilename(ds, query, ext = 'csv') {
        const base = `${ds.source}-${ds.key}`;
        if (!ds.dateCol) return `${base}_${londonDate(new Date().toISOString())}.${ext}`;
        // until is exclusive: show the last INCLUDED London day.
        const lastDay = londonDate(new Date(new Date(query.until).getTime() - 1).toISOString());
        return `${base}_${londonDate(query.since)}_${lastDay}.${ext}`;
    },

    /**
     * Stream the whole filtered set as CSV through `sink` ({ write, end }).
     * `meta.isAborted()` is polled between batches (client disconnect).
     * Resolves { rows } and always writes ONE audit row (aborted: true when
     * the stream stopped early or a batch failed).
     */
    async streamCsv(user, source, key, query, sink, meta) {
        const ds = resolve(source, key);
        const includePii = assertPii(user, query.pii);
        const cols = columnNames(ds, includePii);
        const orgId = user.organisation_id;
        // Validate BEFORE the first byte so errors still map to a JSON status
        // (also before the diff is built: window() throws on a bad/missing
        // range, and diff.since/until must reflect the VALIDATED bounds, not
        // raw query input — new Date(undefined) would otherwise throw a
        // RangeError that maps to an unmapped 500 instead of window()'s 400).
        const win = window(ds, query); // validates before the first byte
        const prepared = ds.derived
            ? { derived: await derivedRows(orgId, ds, query) }
            : await buildFilters(orgId, ds, query);

        const diff = {
            source: ds.source, dataset: ds.key, scope: query.scope,
            since: win.since, until: win.until,
            pii: includePii, rows: 0,
        };

        const audit = async (aborted) => {
            const d = aborted ? { ...diff, aborted: true } : diff;
            await dataRoomRepository.logExport(orgId, user.id, d, { ip: meta.ip, userAgent: meta.userAgent });
        };

        sink.write(BOM + csvLine(cols));
        try {
            if (prepared.derived) {
                sink.write(rowsToCsv(cols, prepared.derived));
                diff.rows = prepared.derived.length;
            } else if (!prepared.empty) {
                const { aborted } = await eachBatch(orgId, ds, prepared.filters, cols, meta.isAborted, (batch) => {
                    sink.write(rowsToCsv(cols, batch));
                    diff.rows += batch.length;
                });
                if (aborted) { await audit(true); sink.end(); return { rows: diff.rows }; }
            }
        } catch (err) {
            await audit(true);
            throw err;
        }
        await audit(false);
        sink.end();
        return { rows: diff.rows };
    },

    /**
     * Validate an Excel export and decide its worksheets BEFORE any byte is
     * written (so failures still answer JSON). Throws 400/403/404/413.
     */
    async prepareExport(user, source, key, query) {
        const ds = resolve(source, key);
        const includePii = assertPii(user, query.pii);
        const cols = columnNames(ds, includePii);
        const orgId = user.organisation_id;
        const win = window(ds, query);
        const plan = { ds, cols, typed: typedColumns(ds, cols), orgId, userId: user.id, query, win, includePii, sheets: [] };

        if (ds.derived) {
            plan.derived = await derivedRows(orgId, ds, query);
            if (plan.derived.length > XLSX_ROW_CAP) throw new AppError(`Export too large for Excel (${plan.derived.length} rows). Narrow the period or use CSV.`, 413);
            plan.sheets.push({ name: 'All practices', derived: true });
            return plan;
        }

        const { filters, empty } = await buildFilters(orgId, ds, query);
        plan.filters = filters;
        plan.empty = empty;
        if (!empty) {
            const total = await dataRoomRepository.count(orgId, ds, filters);
            if (total > XLSX_ROW_CAP) throw new AppError(`Export too large for Excel (${total} rows). Narrow the period or use CSV.`, 413);
        }
        const practices = await dataRoomRepository.practices(orgId);
        if (query.scope === 'all' && ds.practice.col) {
            for (const p of practices) plan.sheets.push({ name: p.name, filters: { ...filters, practiceId: p.id } });
            plan.sheets.push({ name: 'Unassigned', filters: { ...filters, practiceId: null, practiceNull: true } });
        } else if (query.scope !== 'all') {
            const p = practices.find((x) => x.id === query.scope);
            plan.sheets.push({ name: p?.name ?? 'Practice', filters });
        } else {
            // scope=all on a `via` dataset: one sheet, the whole org (a per-practice
            // split would need a viaKeys round trip per practice).
            plan.sheets.push({ name: 'All practices', filters });
        }
        return plan;
    },

    /**
     * Stream the prepared workbook to `stream`. Always settles, and always
     * writes EXACTLY ONE audit row — which is why the audit is written before
     * the final flush rather than after it (see `flush`).
     */
    async writeXlsx(plan, stream, meta) {
        const { ds, cols, typed, orgId, userId, query, win, includePii } = plan;
        const diff = {
            source: ds.source, dataset: ds.key, scope: query.scope,
            since: win.since, until: win.until, pii: includePii, format: 'xlsx', rows: 0,
        };
        // `audited` flips BEFORE the insert is awaited: one attempt per export,
        // so the catch below never logs a second row for a failed audit.
        let audited = false;
        const audit = async (aborted) => {
            if (audited) return;
            audited = true;
            const d = aborted ? { ...diff, aborted: true } : diff;
            await dataRoomRepository.logExport(orgId, userId, d, { ip: meta.ip, userAgent: meta.userAgent });
        };
        const wb = openWorkbook(stream);
        // exceljs resolves commit() on the destination's 'finish' event, which
        // NEVER fires once a disconnected response has been destroyed — awaiting
        // it unguarded pins the request handler forever. So: skip the flush for
        // an already-dead stream, otherwise race it against 'close' (a
        // disconnect during the final flush). Errors are swallowed; the audit
        // row is always written before any call to this.
        const dead = () => stream.destroyed || stream.writableEnded;
        const flush = async () => {
            if (dead()) return;
            try {
                await Promise.race([wb.finish(), once(stream, 'close')]);
            } catch { /* stream died mid-flush — nothing left to salvage */ }
        };
        try {
            for (const sheet of plan.sheets) {
                const ws = wb.addSheet(sheet.name, typed);
                if (sheet.derived) {
                    for (const row of plan.derived) ws.addRow(row);
                    diff.rows += plan.derived.length;
                } else if (!plan.empty) {
                    const { aborted } = await eachBatch(orgId, ds, sheet.filters, cols, meta.isAborted, (batch) => {
                        for (const row of batch) ws.addRow(row);
                        diff.rows += batch.length;
                    });
                    if (aborted) {
                        await audit(true); // before the flush: the client is already gone
                        if (!dead()) { ws.commit(); await flush(); }
                        return { rows: diff.rows };
                    }
                }
                ws.commit();
            }
            await audit(false);
        } catch (err) {
            await audit(true);
            throw err;
        }
        await flush();
        return { rows: diff.rows };
    },

    async freshness(user) {
        const { integrations, accounts } = await dataRoomRepository.freshness(user.organisation_id);
        const PROVIDER_TO_SOURCE = { dentally: 'dentally', google_ads: 'google-ads', meta_ads: 'meta-ads', gohighlevel: 'gohighlevel', emergent: 'emergent' };
        const sources = {};
        for (const key of ['dentally', 'google-ads', 'meta-ads', 'gohighlevel', 'emergent']) sources[key] = { last_sync_at: null, status: null };
        for (const i of integrations) {
            const key = PROVIDER_TO_SOURCE[i.provider];
            if (!key) continue;
            sources[key] = { last_sync_at: i.last_sync_at ?? null, status: i.status ?? null };
        }
        const ghlAccounts = accounts.filter((a) => a.provider === 'gohighlevel')
            .map((a) => ({ label: a.label ?? null, status: a.status ?? null, last_sync_at: a.last_sync_at ?? null }));
        if (ghlAccounts.length) {
            const latest = ghlAccounts.map((a) => a.last_sync_at).filter(Boolean).sort().at(-1) ?? null;
            sources.gohighlevel = { ...sources.gohighlevel, last_sync_at: latest ?? sources.gohighlevel.last_sync_at, accounts: ghlAccounts };
        }
        const all = Object.values(sources).map((s) => s.last_sync_at).filter(Boolean).sort();
        const asOf = all.at(-1) ?? null;
        sources.summaries = { last_sync_at: asOf, status: asOf ? 'active' : null };
        return { sources, as_of: asOf };
    },
};
