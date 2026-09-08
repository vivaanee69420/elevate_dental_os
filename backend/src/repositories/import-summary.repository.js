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
// WHY `notNull` EXISTS, and why `source` is wrong for a shared table.
//
// `source` records which system CREATED a row, not which systems it belongs to.
// A contact is routinely written by one integration and later matched by
// another: the GoHighLevel sync stamps `ghl_contact_id` on a patient Dentally
// created, and the Dentally sync stamps `pms_external_id` on a contact
// GoHighLevel created. `source` keeps whichever wrote it first, so counting by
// it under-reports BOTH providers on any org that runs both. Measured on live
// data before this changed:
//
//                       contacts by `source`   by actual link
//   GM Dental Group  GHL      30,083            30,112
//                    Dentally 19,641            22,922
//   gm dental Roch.  GHL       9,422             9,837
//                    Dentally  3,854             4,526
//   developer        Dentally 28,437            30,431
//
// The owner noticed this as "GoHighLevel says 9,487 contacts, our app says
// 9,422". The app was not missing contacts — it was declining to count 415 it
// already held, because Dentally happened to create them first.
//
// A resource in a table that only ONE provider ever writes keeps using
// `source`/`provider`; the link column is only correct where the row can
// legitimately belong to both.
//
// Labels are what the OWNER calls the thing, not the table name: a Dentally
// contact is a patient, a GoHighLevel contact is a contact.
export const PROVIDER_RESOURCES = {
    dentally: [
        { table: 'practices', label: 'Practices' },
        { table: 'contacts', label: 'Patients', notNull: 'pms_external_id' },
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
        { table: 'contacts', label: 'Contacts', notNull: 'ghl_contact_id' },
        { table: 'leads', label: 'Opportunities', notNull: 'ghl_opportunity_id' },
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
    gohighlevel: { table: 'leads', column: 'created_at', notNull: 'ghl_opportunity_id', label: 'Opportunities' },
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
