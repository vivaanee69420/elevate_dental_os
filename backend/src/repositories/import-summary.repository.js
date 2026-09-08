// ============================================================================
// How much data an organisation actually holds from each integration.
//
// The Integrations tiles could only read `last_sync_at`, which is stamped once,
// on completion. A pull several thousand rows in, a pull that never started,
// and a pull that died at 90% all rendered identically — "Synced never". These
// counts are what tells them apart, and they move while an import runs.
//
// Counts only: no row bodies are read, so nothing patient-identifying is loaded
// to render a number. Every query carries organisation_id — there is no RLS on
// the serviceClient path — and each resource carries the filter that separates
// its provider's rows from another's, so an org with both Dentally and
// GoHighLevel contacts sees the right figure on each tile rather than a
// combined total that matches neither.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

// What each provider writes, and how its rows are told apart from other
// providers' rows in the same table. `source`, `provider` and `notNull` are the
// discriminators in use (verified against live data); a resource with none is
// written by one provider only.
//
// COUNT EACH PROVIDER BY ITS OWN `source`. DO NOT COUNT BY THE LINK COLUMN.
//
// Dentally patients and GoHighLevel contacts are DIFFERENT POPULATIONS. Some
// rows carry both a `pms_external_id` and a `ghl_contact_id`, but that mapping
// exists to attribute CONVERSION — did this lead become a patient — and it does
// not make one population a member of the other. Owner's rule, and these tiles
// answer "how much has this integration pulled", which is a question about the
// provider's own rows.
//
// This was briefly changed to count by the link column (`ghl_contact_id is not
// null`) on the theory that `source` under-reports. It does differ — Rochester
// reads 9,422 by source against 9,837 by link — but the link count is not the
// same question, and using it here was actively harmful: GoHighLevel's own
// figure for that location is 9,487, so a link-based tile would have shown
// 9,837, turning a 65-row SHORTFALL into an apparent surplus and hiding the
// truncated-pagination bug the owner found by counting in GoHighLevel by hand.
//
// A count that flatters the number is worse than one that is merely narrow.
//
// `notNull` stays available as a discriminator for a resource that genuinely
// needs one; nothing uses it today.
//
// Labels are what the OWNER calls the thing, not the table name: a Dentally
// contact is a patient, a GoHighLevel contact is a contact.
export const PROVIDER_RESOURCES = {
    dentally: [
        { table: 'practices', label: 'Practices' },
        { table: 'contacts', label: 'Patients', source: 'dentally' },
        { table: 'appointments', label: 'Appointments', source: 'dentally' },
        { table: 'payments', label: 'Payments', source: 'dentally' },
        { table: 'invoices', label: 'Invoices', source: 'dentally' },
        { table: 'invoice_items', label: 'Invoice items', source: 'dentally' },
        { table: 'treatment_plans', label: 'Treatment plans', source: 'dentally' },
        { table: 'dentally_treatment_items', label: 'Treatment items', source: 'dentally' },
        { table: 'associates', label: 'Clinicians' },
        { table: 'staff', label: 'Staff' },
    ],
    gohighlevel: [
        { table: 'contacts', label: 'Contacts', source: 'gohighlevel' },
        { table: 'leads', label: 'Opportunities', source: 'gohighlevel' },
        { table: 'communications', label: 'Conversations' },
        { table: 'ghl_appointments', label: 'Calendar bookings' },
    ],
    quickbooks: [
        { table: 'monthly_financials', label: 'Financial rows', source: 'quickbooks' },
        { table: 'bank_accounts', label: 'Bank accounts', source: 'quickbooks' },
    ],
    xero: [
        { table: 'monthly_financials', label: 'Financial rows', source: 'xero' },
    ],
    google_ads: [
        { table: 'ad_accounts', label: 'Ad accounts', provider: 'google_ads' },
        { table: 'ad_metrics', label: 'Daily metrics', provider: 'google_ads' },
        { table: 'ad_google_adgroups', label: 'Ad groups', provider: 'google_ads' },
        { table: 'ad_google_ads', label: 'Ads', provider: 'google_ads' },
        { table: 'ad_google_keywords', label: 'Keywords', provider: 'google_ads' },
    ],
    meta_ads: [
        { table: 'ad_accounts', label: 'Ad accounts', provider: 'meta_ads' },
        { table: 'ad_metrics', label: 'Daily metrics', provider: 'meta_ads' },
        { table: 'ad_meta_adsets', label: 'Ad sets', provider: 'meta_ads' },
        { table: 'ad_meta_ads', label: 'Ads', provider: 'meta_ads' },
    ],
    callrail: [
        { table: 'callrail_calls', label: 'Calls' },
    ],
    emergent: [
        { table: 'treatment_accepted', label: 'Treatments accepted' },
    ],
    google_sheets: [
        { table: 'sheet_leads', label: 'Sheet rows' },
    ],
};

// The date range a provider's data covers, where one is meaningful. A bare
// total says a pull happened; the span says whether the history the owner
// expected actually arrived, which is the question they are really asking.
const PROVIDER_SPAN = {
    dentally: { table: 'appointments', column: 'starts_at', source: 'dentally', label: 'Appointments' },
    gohighlevel: { table: 'leads', column: 'created_at', source: 'gohighlevel', label: 'Opportunities' },
    quickbooks: { table: 'monthly_financials', column: 'period', source: 'quickbooks', label: 'Financials' },
    xero: { table: 'monthly_financials', column: 'period', source: 'xero', label: 'Financials' },
    google_ads: { table: 'ad_metrics', column: 'metric_date', provider: 'google_ads', label: 'Metrics' },
    meta_ads: { table: 'ad_metrics', column: 'metric_date', provider: 'meta_ads', label: 'Metrics' },
    callrail: { table: 'callrail_calls', column: 'started_at', label: 'Calls' },
    emergent: { table: 'treatment_accepted', column: 'accepted_date', label: 'Acceptances' },
};

export const importSummaryRepository = {
    _client() { return supabase_1.serviceClient; },

    async _count(orgId, res) {
        let q = this._client()
            .from(res.table)
            .select('id', { count: 'exact', head: true })
            .eq('organisation_id', orgId);
        if (res.source) q = q.eq('source', res.source);
        if (res.provider) q = q.eq('provider', res.provider);
        if (res.notNull) q = q.not(res.notNull, 'is', null);
        const { count, error } = await q;
        // A renamed column or a table this deployment does not have must not
        // blank the whole panel. Null reads as "not known" in the UI, where a 0
        // would be a confident lie.
        if (error) return null;
        return count ?? 0;
    },

    async _edge(orgId, span, ascending) {
        let q = this._client()
            .from(span.table)
            .select(span.column)
            .eq('organisation_id', orgId);
        if (span.source) q = q.eq('source', span.source);
        if (span.provider) q = q.eq('provider', span.provider);
        if (span.notNull) q = q.not(span.notNull, 'is', null);
        const { data, error } = await q
            .not(span.column, 'is', null)
            .order(span.column, { ascending })
            .limit(1)
            .maybeSingle();
        if (error) return null;
        return data?.[span.column] ?? null;
    },

    /** Row counts per resource for one provider, plus the range its data covers. */
    async summary(orgId, provider) {
        const resources = PROVIDER_RESOURCES[provider];
        // A provider with no registry entry is UNKNOWN, which is not the same
        // as empty. Reporting zero rows for it would state, confidently, that a
        // working integration has pulled nothing — which is exactly what the
        // Google tile did: its id is `google` (it fronts three separate Google
        // connections) while the registry key is `google_ads`, so the panel
        // said "Nothing pulled yet" over 2,961 metric rows.
        if (!resources) return { known: false, rows: [], span: null };
        const counts = await Promise.all(resources.map((r) => this._count(orgId, r)));
        const rows = resources.map((r, i) => ({ key: r.table, label: r.label, count: counts[i] }));

        const span = PROVIDER_SPAN[provider];
        let from = null;
        let to = null;
        if (span) {
            [from, to] = await Promise.all([
                this._edge(orgId, span, true),
                this._edge(orgId, span, false),
            ]);
        }
        return { known: true, rows, span: span ? { label: span.label, from, to } : null };
    },
};
