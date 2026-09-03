// ============================================================================
// Deep-grain ad repository — Meta ad set/ad and Google ad group/ad/keyword.
//
// RPC-ONLY BY DESIGN. There is no method here that selects from the five
// tables, and none should be added: PostgREST caps a response at 1000 rows
// server-side and says nothing about it, and one practice-month of keyword
// rows is comfortably past that. Every read goes through a rollup RPC that
// aggregates in SQL.
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

export const adGrainRepository = {
    async replaceWindow(orgId, grain, customerIds, rows) {
        assertGrain(grain);
        // An empty pull must never reach the RPC: it would delete the window
        // and write nothing back, wiping good history on a transient glitch.
        if (!Array.isArray(rows) || rows.length === 0) return 0;
        if (!Array.isArray(customerIds) || customerIds.length === 0) return 0;
        const { data, error } = await supabase_1.serviceClient.rpc('ad_grain_replace_window', {
            p_org: orgId, p_grain: grain, p_customer_ids: customerIds, p_rows: rows,
        });
        if (error) throw new Error(`ad_grain_replace_window: ${error.message}`);
        return Number(data ?? 0);
    },

    async rollup(orgId, grain, { since, until, ...filters } = {}) {
        assertGrain(grain);
        const { data, error } = await supabase_1.serviceClient.rpc('ad_grain_rollup', {
            p_org: orgId, p_grain: grain, p_since: since, p_until: until, ...filterParams(filters),
        });
        if (error) throw new Error(`ad_grain_rollup: ${error.message}`);
        return Array.isArray(data) ? data : [];
    },

    async keywordRollup(orgId, { since, until, ...filters } = {}) {
        const { data, error } = await supabase_1.serviceClient.rpc('ad_keyword_rollup', {
            p_org: orgId, p_since: since, p_until: until, ...filterParams(filters),
        });
        if (error) throw new Error(`ad_keyword_rollup: ${error.message}`);
        return Array.isArray(data) ? data : [];
    },

    async restampPractices(orgId) {
        const { data, error } = await supabase_1.serviceClient.rpc('ad_grain_restamp_practices', { p_org: orgId });
        if (error) throw new Error(`ad_grain_restamp_practices: ${error.message}`);
        return Number(data ?? 0);
    },
};
