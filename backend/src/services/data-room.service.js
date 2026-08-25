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
//   - keyset pagination via opaque cursors; derived (in-memory) datasets page
//     by offset
//   - CSV streaming in 1000-row batches through a sink (Express res in prod,
//     a recorder in tests); every export is audited (rows, aborted flag)
//
// orgId always comes from req.user, never from the request.
// ============================================================================
import { AppError } from '../middleware/errors.js';
import { dataRoomRepository } from '../repositories/data-room.repository.js';
import { getDataset, columnNames, registryForClient } from '../lib/data-room/registry.js';
import { encodeCursor, decodeCursor } from '../lib/data-room/cursor.js';
import { BOM, csvLine, rowsToCsv } from '../lib/data-room/csv.js';

const EXPORT_BATCH = 1000; // PostgREST hard cap per request

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

/** Derived datasets live in memory; page them by numeric offset. */
async function derivedRows(orgId, ds, query) {
    if (ds.derived === 'ghl_pipelines') {
        const practiceId = query.scope === 'all' ? null : query.scope;
        return dataRoomRepository.pipelineRows(orgId, practiceId);
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
        const after = query.cursor ? decodeCursor(query.cursor) : null;

        if (ds.derived) {
            const all = await derivedRows(orgId, ds, query);
            const start = after ? Number(after.id) : 0;
            const rows = all.slice(start, start + query.limit);
            const next = start + rows.length < all.length ? encodeCursor({ d: null, id: start + rows.length }) : null;
            return { rows: project(rows, cols), next_cursor: next, total: all.length };
        }

        const { filters, empty } = await buildFilters(orgId, ds, query);
        if (empty) return { rows: [], next_cursor: null, total: 0 };
        const [rows, total] = await Promise.all([
            dataRoomRepository.page(orgId, ds, filters, { after, limit: query.limit, columns: cols }),
            dataRoomRepository.count(orgId, ds, filters),
        ]);
        const next = rows.length === query.limit ? lastCursor(ds, rows) : null;
        return { rows: project(rows, cols), next_cursor: next, total };
    },

    exportFilename(ds, query) {
        const base = `${ds.source}-${ds.key}`;
        if (!ds.dateCol) return `${base}_${londonDate(new Date().toISOString())}.csv`;
        // until is exclusive: show the last INCLUDED London day.
        const lastDay = londonDate(new Date(new Date(query.until).getTime() - 1).toISOString());
        return `${base}_${londonDate(query.since)}_${lastDay}.csv`;
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
        const diff = {
            source: ds.source, dataset: ds.key, scope: query.scope,
            since: ds.dateCol ? new Date(query.since).toISOString() : null,
            until: ds.dateCol ? new Date(query.until).toISOString() : null,
            pii: includePii, rows: 0,
        };
        // Validate BEFORE the first byte so errors still map to a JSON status.
        const prepared = ds.derived
            ? { derived: await derivedRows(orgId, ds, query) }
            : await buildFilters(orgId, ds, query);

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
                let after = null;
                for (;;) {
                    if (meta.isAborted()) { await audit(true); sink.end(); return { rows: diff.rows }; }
                    const batch = await dataRoomRepository.page(orgId, ds, prepared.filters,
                        { after, limit: EXPORT_BATCH, columns: cols });
                    if (batch.length === 0) break;
                    sink.write(rowsToCsv(cols, batch));
                    diff.rows += batch.length;
                    if (batch.length < EXPORT_BATCH) break;
                    after = decodeCursor(lastCursor(ds, batch));
                }
            }
        } catch (err) {
            await audit(true);
            throw err;
        }
        await audit(false);
        sink.end();
        return { rows: diff.rows };
    },
};
