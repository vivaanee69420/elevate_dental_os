// Daily Command Cockpit repository — GHL pipeline->channel map, ad leads,
// Emergent accepted conversions, and ad spend, all org-scoped. serviceClient
// bypasses RLS so the explicit .eq('organisation_id', orgId) IS the tenant
// guard on every query (see CLAUDE.md).
import * as supabase_1 from "../lib/supabase.js";

// PostgREST caps a single response at db-max-rows (1000) and does it
// SILENTLY — a 12-month window of leads or cash-up rows would come back
// truncated and every total downstream would quietly undercount. Every
// unbounded read below goes through this pager (ordered by id so the pages
// are stable). See the monthly_financials truncation incident.
const PAGE = 1000;
async function fetchAllPages(buildQuery) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await buildQuery().range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = data || [];
        out.push(...rows);
        if (rows.length < PAGE) return out;
    }
}

export const cockpitRepository = {
    // Flattens each GHL integration_accounts row's config.pipelines into
    // { pipeline_id, name, practice_id, practice_label, account_id,
    // account_label }. A subaccount with practice_id null is NOT a dental
    // practice feed (the Plan4Growth academy / accounting locations live here
    // too) — callers bucket those separately rather than folding them into a
    // practice's lead counts.
    async pipelineChannelMap(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('integration_accounts')
            .select('id, practice_id, label, config')
            .eq('organisation_id', orgId)
            .eq('provider', 'gohighlevel');
        if (error) throw new Error(error.message);
        const flat = [];
        for (const row of data || []) {
            for (const p of row.config?.pipelines || []) {
                flat.push({
                    pipeline_id: p.id,
                    name: p.name,
                    practice_id: row.practice_id,
                    practice_label: row.label,
                    account_id: row.id,
                    account_label: row.label,
                });
            }
        }
        return flat;
    },

    // leads join contacts, windowed on created_at, only leads attributed to a
    // GHL pipeline. Always org-wide: the cockpit filters by practice AFTER
    // matching so that scoping the view can't change the group total.
    // contact_id comes back so callers can count PEOPLE, not opportunity rows
    // (one contact often sits in several pipelines).
    async adLeadsInWindow(orgId, sinceISO, untilISO) {
        return fetchAllPages(() => supabase_1.serviceClient
            .from('leads')
            .select('id, contact_id, ghl_pipeline_id, practice_id, integration_account_id, created_at, contacts(phone,email,first_name,last_name)')
            .eq('organisation_id', orgId)
            .not('ghl_pipeline_id', 'is', null)
            .gte('created_at', sinceISO)
            .lt('created_at', untilISO)
            .order('id', { ascending: true }));
    },

    // Emergent-accepted conversions in the window (accepted_date is a DATE).
    // Used for the treatment rollup, which IS strictly windowed.
    async acceptedContactsInWindow(orgId, sinceDate, untilDate, practiceId) {
        return fetchAllPages(() => {
            let q = supabase_1.serviceClient
                .from('treatment_accepted')
                .select('practice_id, value_pence, phone, email, raw, accepted_date, patient_name, treatment_name')
                .eq('organisation_id', orgId)
                .eq('status', 'accepted')
                .gte('accepted_date', sinceDate)
                .lt('accepted_date', untilDate)
                .order('id', { ascending: true });
            if (practiceId) q = q.eq('practice_id', practiceId);
            return q;
        });
    },

    // Accepted conversions for LEAD MATCHING — open-ended on purpose. A lead
    // created in the window typically converts weeks later, so bounding the
    // accepted side by the same window would report a lead as unconverted
    // just because it closed after the window ended. "Converted" here means
    // "this lead has been accepted by now", not "accepted inside the window".
    async acceptedForMatching(orgId, sinceDate) {
        return fetchAllPages(() => supabase_1.serviceClient
            .from('treatment_accepted')
            .select('practice_id, value_pence, phone, email, raw, accepted_date, patient_name, treatment_name')
            .eq('organisation_id', orgId)
            .eq('status', 'accepted')
            .gte('accepted_date', sinceDate)
            .order('id', { ascending: true }));
    },

    // Daily Command Cockpit drill-down — paginated leads windowed on
    // created_at, only leads attributed to a GHL pipeline (mirrors
    // adLeadsInWindow's filters), newest-first. Embeds the contact's
    // name/phone/email for the detail line. offset/limit are the caller's
    // already-clamped (<=500) values.
    async leadsDetailRows(orgId, sinceISO, untilISO, practiceId, limit, offset) {
        let q = supabase_1.serviceClient
            .from('leads')
            .select('id, contact_id, ghl_pipeline_id, practice_id, created_at, contacts(first_name,last_name,phone,email)')
            .eq('organisation_id', orgId)
            .not('ghl_pipeline_id', 'is', null)
            .gte('created_at', sinceISO)
            .lt('created_at', untilISO)
            .order('created_at', { ascending: false });
        if (practiceId) q = q.eq('practice_id', practiceId);
        q = q.range(offset, offset + limit - 1);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data || [];
    },

    // Daily Command Cockpit drill-down — paginated treatment_accepted rows
    // windowed on accepted_date (half-open), newest-first, joined to the
    // practice name.
    async treatmentsDetailRows(orgId, sinceDate, untilDate, practiceId, limit, offset) {
        let q = supabase_1.serviceClient
            .from('treatment_accepted')
            .select('id, accepted_date, practice_id, patient_name, treatment_name, value_pence, ext_source, raw, practices(name)')
            .eq('organisation_id', orgId)
            .eq('status', 'accepted')
            .gte('accepted_date', sinceDate)
            .lt('accepted_date', untilDate)
            .order('accepted_date', { ascending: false });
        if (practiceId) q = q.eq('practice_id', practiceId);
        q = q.range(offset, offset + limit - 1);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data || [];
    },

    // Which GHL pipeline each accepted treatment originally came from, so an
    // Emergent conversion can be tagged with the ad that produced it. Matching
    // (normalised phone -> email -> practice-scoped name, most recent lead
    // wins) runs in SQL because it has to look across EVERY pipeline lead for
    // the org, not just the ones in the window — see migration
    // 20260101000112. Returns [{ accepted_id, ghl_pipeline_id, lead_created_at }].
    async acceptedLeadSource(orgId, sinceDate, untilDate, practiceId) {
        const { data, error } = await supabase_1.serviceClient.rpc('cockpit_accepted_lead_source', {
            p_org: orgId,
            p_since: sinceDate,
            p_until: untilDate,
            p_practice: practiceId ?? null,
        });
        if (error) throw new Error(error.message);
        return data || [];
    },

    // Daily Command Cockpit drill-down — paginated emergent_daily_cashup rows
    // windowed on cashup_date (half-open), newest-first, joined to the
    // practice name (falls back to business_name in the service when a row
    // isn't yet mapped to a practice). Carries the manager-keyed daily counts
    // (tx plans given, new leads, attended) — they are the ONLY detail behind
    // those headline numbers, since Emergent sends a count per day and no
    // per-plan or per-lead records.
    async cashupDaysDetailRows(orgId, since, until, practiceId, limit, offset) {
        let q = supabase_1.serviceClient
            .from('emergent_daily_cashup')
            .select('cashup_date, practice_id, business_name, cash_up_money_taken_pence, ' +
                'detail_patient_money_total_pence, tx_plans_given, tx_plan_given_value_pence, ' +
                'num_new_leads, num_attended, refunds, practices(name)')
            .eq('organisation_id', orgId)
            .order('cashup_date', { ascending: false });
        if (since) q = q.gte('cashup_date', since);
        if (until) q = q.lt('cashup_date', until);
        if (practiceId) q = q.eq('practice_id', practiceId);
        q = q.range(offset, offset + limit - 1);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data || [];
    },

    // Sum ad spend by provider over [fromDate, toDate) — YYYY-MM-DD strings.
    async adSpendByProvider(orgId, fromDate, toDate) {
        const rows = await fetchAllPages(() => supabase_1.serviceClient
            .from('ad_metrics')
            .select('id, provider, spend_pence, metric_date')
            .eq('organisation_id', orgId)
            .gte('metric_date', fromDate)
            .lt('metric_date', toDate)
            .order('id', { ascending: true }));
        const totals = { google_ads: 0, meta_ads: 0 };
        for (const row of rows) {
            if (row.provider === 'google_ads') totals.google_ads += row.spend_pence || 0;
            else if (row.provider === 'meta_ads') totals.meta_ads += row.spend_pence || 0;
        }
        return totals;
    },

    // Daily Command Cockpit — raw emergent_daily_cashup rows in the window
    // [since, until) (half-open, cashup_date is a DATE). Aggregation (sum +
    // group-by practice/business) happens in cockpitService, matching the
    // repo-returns-rows / service-aggregates idiom used elsewhere in this file.
    async cashupRollup(orgId, since, until, practiceId) {
        return fetchAllPages(() => {
            let q = supabase_1.serviceClient
                .from('emergent_daily_cashup')
                .select('id, practice_id, business_name, cashup_date, cash_up_money_taken_pence, treatments_accepted, ' +
                    'tx_plans_given, tx_plan_given_value_pence, num_new_leads, num_attended, detail_patient_money_total_pence')
                .eq('organisation_id', orgId)
                .order('id', { ascending: true });
            if (since) q = q.gte('cashup_date', since);
            if (until) q = q.lt('cashup_date', until);
            if (practiceId) q = q.eq('practice_id', practiceId);
            return q;
        });
    },

    // Daily Command Cockpit — emergent_monthly_pl rows for one calendar month
    // (monthStart is the exact period_month DATE, e.g. '2026-07-01'). Includes
    // the typed cost/opex line columns + custom_lines/line_notes for the
    // cockpit's monthly P&L line-item breakdown.
    async monthlyPl(orgId, monthStart, practiceId) {
        let q = supabase_1.serviceClient
            .from('emergent_monthly_pl')
            .select('practice_id, business_name, period_month, revenue_pence, net_profit_pence, ' +
                'principal_fees_pence, hygienist_therapist_pence, lab_fees_pence, materials_pence, sedation_services_pence, ' +
                'advertising_marketing_pence, bank_charges_pence, business_rates_rent_pence, salaries_staff_cost_pence, ' +
                'telephone_wifi_pence, utilities_pence, insurance_pence, management_fees_pence, subscriptions_pence, ' +
                'it_expenses_pence, card_machine_charges_pence, custom_lines, line_notes')
            .eq('organisation_id', orgId)
            .eq('period_month', monthStart);
        if (practiceId) q = q.eq('practice_id', practiceId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data || [];
    },

    // Daily Command Cockpit fallback — Emergent may not have sent the current
    // calendar month's P&L yet, which would otherwise show £0. Returns the
    // rows for whichever period_month is most recent for this org (all rows
    // sharing that max period_month, i.e. one per business).
    async latestMonthlyPl(orgId) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_monthly_pl')
            .select('practice_id, business_name, period_month, revenue_pence, net_profit_pence, ' +
                'principal_fees_pence, hygienist_therapist_pence, lab_fees_pence, materials_pence, sedation_services_pence, ' +
                'advertising_marketing_pence, bank_charges_pence, business_rates_rent_pence, salaries_staff_cost_pence, ' +
                'telephone_wifi_pence, utilities_pence, insurance_pence, management_fees_pence, subscriptions_pence, ' +
                'it_expenses_pence, card_machine_charges_pence, custom_lines, line_notes')
            .eq('organisation_id', orgId)
            .order('period_month', { ascending: false })
            .limit(50);
        if (error) throw new Error(error.message);
        const rows = data || [];
        if (rows.length === 0) return { periodMonth: null, rows: [] };
        const latest = rows[0].period_month;
        return { periodMonth: latest, rows: rows.filter(r => r.period_month === latest) };
    },
};
