// ============================================================================
// Deep-grain ad repository — Meta ad set/ad and Google ad group/ad/keyword.
//
// RPC-ONLY BY DESIGN. There is no method here that selects from the five
// tables, and none should be added: PostgREST caps a response at 1000 rows
// server-side and says nothing about it, and one practice-month of keyword
// rows is comfortably past that. Every read goes through a rollup RPC that
// aggregates in SQL.
//
// Aggregating in SQL is NOT on its own a defence against that cap — the cap
// applies to a set-returning function exactly as it does to a table, and the
// rollups' own ENTITY count runs to thousands. So every read here is also
// PAGED; see pagedRpc below.
//
// MULTI-TENANT: serviceClient bypasses RLS, so p_org IS the isolation.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const GRAINS = Object.freeze([
    'meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword',
]);

// Fail here rather than at the database. The RPC also validates, but a bad
// grain caught in JS gives a stack trace pointing at the caller.
function assertGrain(grain) {
    if (!GRAINS.includes(grain)) {
        throw new Error(`ad-grain: unknown grain '${grain}' (expected one of ${GRAINS.join(', ')})`);
    }
}

// Absent filters are sent as explicit nulls. Omitting a key would make
// PostgREST fall back to the function's DEFAULT, which happens to be null
// today — relying on that couples this file to the RPC's signature.
function filterParams({ practiceId = null, campaignId = null, parentId = null } = {}) {
    return { p_practice: practiceId ?? null, p_campaign: campaignId ?? null, p_parent: parentId ?? null };
}

const PAGE = 1000;

// Read a set-returning RPC in full.
//
// PostgREST caps a response at 1000 rows server-side and reports NOTHING, and
// that cap applies to a set-returning FUNCTION exactly as it does to a table —
// the result is exposed as a relation, so calling an RPC is no escape from it.
// Aggregating in SQL does not help here either: ad_grain_rollup collapses day
// rows into ENTITY rows, and the entity count is itself what blows past 1000.
// One Google account's keyword/ad-group pairs over 92 days run to thousands.
//
// The failure this prevents is not a visibly missing table row: the
// reconciliation service SUMS these rows, so a truncated read renders as a
// fabricated spend gap — an 80% shortfall on ~5,000 keyword pairs against
// £176,795 of real spend — and, because the keyword grain is whitelisted as an
// expected shortfall, that invented gap is explained to the owner in calm
// prose. At ad/ad-group grain the same truncation reads as a red "does not
// reconcile" for a discrepancy that never existed.
//
// Same idiom as leadsByCampaign in marketing.repository.js: advance by what the
// server actually RETURNED and stop only on an EMPTY page, never a short one —
// the cap is the server's own setting, and treating a short page as the last
// would reintroduce the identical truncation at whatever number that happens
// to be.
//
// The sort key is (entity_id, parent_id), both ascending, and BOTH are
// required. entity_id alone is NOT unique — that is precisely why parent_id
// sits in the tables' unique key: Google reuses a keyword's criterion id
// across ad groups, and the rollup groups by (entity_id, parent_id). OFFSET
// paging on a non-unique sort key duplicates and skips rows at every page
// boundary.
async function pagedRpc(fn, params) {
    const rows = [];
    for (let from = 0; ;) {
        const { data, error } = await supabase_1.serviceClient
            .rpc(fn, params)
            .order('entity_id', { ascending: true })
            .order('parent_id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw new Error(`${fn}: ${error.message}`);
        const page = Array.isArray(data) ? data : [];
        rows.push(...page);
        if (page.length === 0) break;
        from += page.length;
    }
    return rows;
}

export const adGrainRepository = {
    // Rows per upsert statement.
    //
    // The ceiling is a statement timeout, not memory. PostgREST connects as
    // `authenticator`, whose statement_timeout is 8s, and only SET ROLEs to
    // service_role — role GUCs apply at session start, so service_role's own
    // setting never binds and neither does a `SET LOCAL` inside the function
    // (its deadline is fixed before the body runs). Measured on live data:
    // 2,404 keyword rows wrote in about 5s and 9,341 rows blew the limit. 2,000
    // keeps each statement in the low seconds with room for a slower night.
    CHUNK_ROWS: 2000,

    // Replace one window: delete what is there for these accounts, then write
    // the pull back in chunks.
    //
    // This USED to be a single RPC doing both halves in one statement, which
    // made the cost scale with the account's row count against a fixed
    // timeout — it worked for a small account and silently failed for a large
    // one, and since the deep sync is wrapped so it can never fail the campaign
    // sync, a failure showed up only as deep tabs serving stale rows.
    //
    // The trade this makes: the replace is no longer one transaction, so a
    // failure between chunks leaves a partially refreshed window. That is worse
    // than an atomic replace and better than the write never landing at all,
    // and it is not silent — the reconciliation endpoint compares deep-grain
    // spend to the campaign-grain total, where a short window reads as a gap.
    // The next nightly run replaces the window outright.
    async replaceWindow(orgId, grain, customerIds, rows) {
        assertGrain(grain);
        // An empty pull must never reach the RPC: it would delete the window
        // and write nothing back, wiping good history on a transient glitch.
        if (!Array.isArray(rows) || rows.length === 0) return 0;
        if (!Array.isArray(customerIds) || customerIds.length === 0) return 0;

        const del = await supabase_1.serviceClient.rpc('ad_grain_delete_window', {
            p_org: orgId, p_grain: grain, p_customer_ids: customerIds,
        });
        if (del.error) throw new Error(`ad_grain_delete_window: ${del.error.message}`);

        let written = 0;
        for (let i = 0; i < rows.length; i += this.CHUNK_ROWS) {
            const chunk = rows.slice(i, i + this.CHUNK_ROWS);
            const { data, error } = await supabase_1.serviceClient.rpc('ad_grain_upsert_chunk', {
                p_org: orgId, p_grain: grain, p_rows: chunk,
            });
            if (error) {
                throw new Error(`ad_grain_upsert_chunk (rows ${i}-${i + chunk.length} of ${rows.length}): ${error.message}`);
            }
            written += Number(data ?? 0);
        }

        // Stamp practice_id from the account mapping. The single RPC this
        // replaced did it as its own last step, and splitting the write left
        // it with no caller: 39,830 deep-grain rows landed with a NULL
        // practice, so every practice-filtered Ad groups / Ads / Keywords tab
        // read "no spend in the selected period" while the Campaigns tab —
        // which reads ad_metrics, stamped inline by its own RPC — showed the
        // same period's spend perfectly. The failure looked like a per-practice
        // sync problem and was neither.
        //
        // It belongs HERE, not in the sync that calls this, precisely because
        // it was forgettable once. A caller cannot write these rows without
        // stamping them. It is idempotent (the RPC updates only rows whose
        // practice differs), so the repeat calls across grains settle to
        // no-ops after the first.
        await this.restampPractices(orgId);
        return written;
    },

    async rollup(orgId, grain, { since, until, ...filters } = {}) {
        assertGrain(grain);
        return pagedRpc('ad_grain_rollup', {
            p_org: orgId, p_grain: grain, p_since: since, p_until: until, ...filterParams(filters),
        });
    },

    async keywordRollup(orgId, { since, until, ...filters } = {}) {
        return pagedRpc('ad_keyword_rollup', {
            p_org: orgId, p_since: since, p_until: until, ...filterParams(filters),
        });
    },

    async restampPractices(orgId) {
        const { data, error } = await supabase_1.serviceClient.rpc('ad_grain_restamp_practices', { p_org: orgId });
        if (error) throw new Error(`ad_grain_restamp_practices: ${error.message}`);
        return Number(data ?? 0);
    },
};
