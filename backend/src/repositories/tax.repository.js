// ============================================================================
// Tax data access. Queries in, rows out.
//
// MULTI-TENANCY. Every statement here carries an explicit
// .eq('organisation_id', orgId) — these repositories run on the service client,
// which bypasses RLS, so that filter IS the tenant boundary. Each sub-account
// is its own legal entity with its own entity type, VAT registration and
// treatment mapping, so there is no group-level fallback anywhere in this file:
// an org with no settings row gets nulls, never its parent's.
//
// The ONE exception is `rates()`, which reads tax_rates. That table is global
// on purpose — HMRC's rates are the same for every tenant, and giving each org
// its own copy would let two sub-accounts disagree about the law. It carries no
// organisation_id to filter on, and that absence is the design, not an
// oversight.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";
import { normaliseDescription } from "../lib/tax/vat.js";

const SETTINGS_COLS = 'organisation_id, entity_type, vat_registered, vat_number, vat_scheme, '
    + 'vat_stagger, prices_include_vat, year_end_day, year_end_month, associated_companies, updated_at';

export const taxRepository = {
    async settings(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('tax_settings')
            .select(SETTINGS_COLS)
            .eq('organisation_id', orgId)
            .maybeSingle();
        if (error) throw new Error(`tax_settings: ${error.message}`);
        return data ?? null;
    },

    async saveSettings(orgId, patch, userId) {
        // organisation_id is stamped from the authenticated caller, never read
        // off the request body — the cross-org write documented in
        // docs/ISOLATION_AUDIT.md.
        const row = { ...patch, organisation_id: orgId, updated_by: userId ?? null, updated_at: new Date().toISOString() };
        const { error } = await supabase_1.serviceClient
            .from('tax_settings')
            .upsert(row, { onConflict: 'organisation_id' });
        if (error) throw new Error(`tax_settings upsert: ${error.message}`);
        return this.settings(orgId);
    },

    // Global reference data: no org filter, because there is no org column.
    async rates(regime, onDate) {
        const { data, error } = await supabase_1.serviceClient
            .from('tax_rates')
            .select('regime, tax_year, starts_on, ends_on, rates, source_url')
            .eq('regime', regime)
            .lte('starts_on', onDate)
            .order('starts_on', { ascending: false })
            .limit(1);
        if (error) throw new Error(`tax_rates: ${error.message}`);
        const row = data?.[0] ?? null;
        // A rate that has ENDED before the date asked for must not be used: it
        // would quote last year's thresholds as if current. Returning null makes
        // the caller say "no rates for this period" instead.
        if (row?.ends_on && row.ends_on < onDate) return null;
        return row;
    },

    // description -> liability, for one org. Small by nature (one row per
    // mapped treatment), so read whole and joined in memory.
    async liabilityMap(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('vat_treatment_liability')
            .select('description, liability, note')
            .eq('organisation_id', orgId);
        if (error) throw new Error(`vat_treatment_liability: ${error.message}`);
        const map = {};
        for (const r of data ?? []) map[normaliseDescription(r.description)] = r.liability;
        return map;
    },

    async setLiability(orgId, { description, liability, note = null }, userId) {
        const key = normaliseDescription(description);
        // Clearing DELETES rather than writing a null liability: the column is
        // NOT NULL and "no row" already means unmapped, so a nullable liability
        // would give one state two spellings.
        if (!liability) {
            const { error } = await supabase_1.serviceClient
                .from('vat_treatment_liability')
                .delete()
                .eq('organisation_id', orgId)
                .eq('description', key);
            if (error) throw new Error(`vat_treatment_liability delete: ${error.message}`);
            return;
        }
        const { error } = await supabase_1.serviceClient
            .from('vat_treatment_liability')
            .upsert({
                organisation_id: orgId, description: key, liability, note,
                updated_by: userId ?? null, updated_at: new Date().toISOString(),
            }, { onConflict: 'organisation_id,description' });
        if (error) throw new Error(`vat_treatment_liability upsert: ${error.message}`);
    },

    // Revenue by treatment for a window, via the aggregate RPC.
    //
    // PAGED, stopping on a SHORT page. The RPC collapses 50k invoice lines to
    // one row per treatment name — 730 for the largest org today, comfortably
    // under PostgREST's 1000-row ceiling, which is exactly why an unpaged read
    // would look correct for years and then silently truncate the day a
    // practice adds its 271st treatment.
    async revenueByTreatment(orgId, { since, until, practiceId = null }) {
        const PAGE = 1000;
        const MAX_PAGES = 50;
        const rows = [];
        for (let page = 0; page < MAX_PAGES; page++) {
            const { data, error } = await supabase_1.serviceClient
                .rpc('tax_revenue_by_treatment', {
                    p_org: orgId, p_since: since, p_until: until, p_practice: practiceId,
                })
                .range(page * PAGE, page * PAGE + PAGE - 1);
            if (error) throw new Error(`tax_revenue_by_treatment: ${error.message}`);
            const batch = data ?? [];
            rows.push(...batch.map((r) => ({
                description: r.treatment_name ?? '',
                amountPence: Number(r.fee_pence) || 0,
                lineCount: Number(r.line_count) || 0,
            })));
            if (batch.length < PAGE) break;
        }
        return rows;
    },
};
