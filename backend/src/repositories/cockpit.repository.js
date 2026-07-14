// Daily Command Cockpit repository — GHL pipeline->channel map, ad leads,
// Emergent accepted conversions, and ad spend, all org-scoped. serviceClient
// bypasses RLS so the explicit .eq('organisation_id', orgId) IS the tenant
// guard on every query (see CLAUDE.md).
import * as supabase_1 from "../lib/supabase.js";

export const cockpitRepository = {
    // Flattens each GHL integration_accounts row's config.pipelines into
    // { pipeline_id, name, practice_id, practice_label }.
    async pipelineChannelMap(orgId, practiceId) {
        let q = supabase_1.serviceClient
            .from('integration_accounts')
            .select('practice_id, label, config')
            .eq('organisation_id', orgId)
            .eq('provider', 'gohighlevel');
        if (practiceId) q = q.eq('practice_id', practiceId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = data || [];
        const flat = [];
        for (const row of rows) {
            const pipelines = row.config?.pipelines || [];
            for (const p of pipelines) {
                flat.push({
                    pipeline_id: p.id,
                    name: p.name,
                    practice_id: row.practice_id,
                    practice_label: row.label,
                });
            }
        }
        return flat;
    },

    // leads join contacts, windowed on created_at, only leads attributed to a
    // GHL pipeline. Optional practiceId restricts to that practice (l.practice_id).
    async adLeadsInWindow(orgId, sinceISO, untilISO, practiceId) {
        let q = supabase_1.serviceClient
            .from('leads')
            .select('id, ghl_pipeline_id, practice_id, integration_account_id, created_at, contacts(phone,email)')
            .eq('organisation_id', orgId)
            .not('ghl_pipeline_id', 'is', null)
            .gte('created_at', sinceISO)
            .lt('created_at', untilISO);
        if (practiceId) q = q.eq('practice_id', practiceId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data || [];
    },

    // Emergent-accepted conversions in the window (accepted_date is a DATE).
    async acceptedContactsInWindow(orgId, sinceDate, untilDate, practiceId) {
        let q = supabase_1.serviceClient
            .from('treatment_accepted')
            .select('practice_id, value_pence, phone, email, raw, accepted_date')
            .eq('organisation_id', orgId)
            .eq('status', 'accepted')
            .gte('accepted_date', sinceDate)
            .lt('accepted_date', untilDate);
        if (practiceId) q = q.eq('practice_id', practiceId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data || [];
    },

    // Daily Command Cockpit drill-down — paginated leads windowed on
    // created_at, only leads attributed to a GHL pipeline (mirrors
    // adLeadsInWindow's filters), newest-first. Embeds the contact's
    // name/phone/email for the detail line. offset/limit are the caller's
    // already-clamped (<=500) values.
    async leadsDetailRows(orgId, sinceISO, untilISO, practiceId, limit, offset) {
        let q = supabase_1.serviceClient
            .from('leads')
            .select('id, ghl_pipeline_id, practice_id, created_at, contacts(first_name,last_name,phone,email)')
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

    // Daily Command Cockpit drill-down — paginated emergent_daily_cashup rows
    // windowed on cashup_date (half-open), newest-first, joined to the
    // practice name (falls back to business_name in the service when a row
    // isn't yet mapped to a practice).
    async cashupDaysDetailRows(orgId, since, until, practiceId, limit, offset) {
        let q = supabase_1.serviceClient
            .from('emergent_daily_cashup')
            .select('cashup_date, practice_id, business_name, cash_up_money_taken_pence, ' +
                'detail_patient_money_total_pence, refunds, practices(name)')
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
        const { data, error } = await supabase_1.serviceClient
            .from('ad_metrics')
            .select('provider, spend_pence, metric_date')
            .eq('organisation_id', orgId)
            .gte('metric_date', fromDate)
            .lt('metric_date', toDate);
        if (error) throw new Error(error.message);
        const totals = { google_ads: 0, meta_ads: 0 };
        for (const row of data || []) {
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
        let q = supabase_1.serviceClient
            .from('emergent_daily_cashup')
            .select('practice_id, business_name, cashup_date, cash_up_money_taken_pence, treatments_accepted, ' +
                'tx_plans_given, tx_plan_given_value_pence, num_new_leads, num_attended, detail_patient_money_total_pence')
            .eq('organisation_id', orgId);
        if (since) q = q.gte('cashup_date', since);
        if (until) q = q.lt('cashup_date', until);
        if (practiceId) q = q.eq('practice_id', practiceId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data || [];
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
