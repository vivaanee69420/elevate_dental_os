// backend/src/lib/data-room/registry.js
// ============================================================================
// Data Room dataset registry — the single declarative description of what
// the analyst can see and export per source. Pure data + validators.
//
// One entry per dataset (a "pill" on a source page):
//   source    page key ('dentally' | 'google-ads' | 'meta-ads' | 'gohighlevel' | 'emergent' | 'summaries')
//   key       dataset key (URL-safe, snake_case)
//   table     Postgres table the repository reads
//   where     static predicates: { col: value } (eq) | { col: { not: null } } (is not null)
//             a 'json->>key' column targets a jsonb text field
//   practice  { col } — filter directly on that column
//             { via: { table, key, col } } — resolve `key` values from `table`
//             (org-scoped, practice_id = scope) and filter `col IN (keys)`
//   dateCol   event datasets: the column the period window + keyset order use
//             null: roster dataset (ignores the period, ordered by id)
//   dateType  'date' | 'timestamptz' (default 'timestamptz') — how the window
//             bounds are formatted for the column
//   derived   'ghl_pipelines': rows are flattened in memory from
//             integration_accounts.config.pipelines, not read from a table.
//             'rpc': rows come from a Postgres function, not a table — `rpc`
//             names the function and `table` equals that name (the validator
//             needs a string; the repository calls .rpc(d.rpc, …) instead of
//             .from(d.table)).
//   rpc       function name for a `derived: 'rpc'` dataset.
//   columns   ordered allowlist [{ col, pii?: true, derived?: true, unit,
//             description }]. organisation_id is never listed — the
//             repository always applies it. unit/description are merged in
//             from dictionary.js at load time (docFor(ds, col.col)).
//
// Never list: raw, notes, pms_patient, secrets, webhook_token, pay/HR columns.
// Patient identifiers carry pii: true and are omitted unless the caller is an
// owner who explicitly asked for them (service enforces).
//
// `table` may name a `data_room_*` view (public schema, security_invoker)
// instead of a base table — the views add derived columns (rule-computed
// flags, resolved names, pseudonymous keys) alongside the raw row; those
// columns carry derived: true here.
// ============================================================================

import { docFor } from './dictionary.js';

export const FORBIDDEN_COLUMNS = new Set([
    'raw', 'notes', 'pms_patient', 'secrets', 'webhook_token', 'hourly_rate_pence',
    'weekly_hours', 'pay_pct', 'lab_split_pct', 'crm_system_notes', 'line_notes',
]);

export const PII_COLUMNS = new Set([
    'first_name', 'last_name', 'email', 'phone', 'date_of_birth', 'address', 'postcode',
    'patient_name', 'subject', 'body', 'from_address', 'to_address',
]);

export const SOURCES = [
    { key: 'dentally', label: 'Dentally', description: 'Practice management data synced nightly and via webhooks: patients, appointments, invoices, payments, treatment plans and completed treatment items.' },
    { key: 'google-ads', label: 'Google Ads', description: 'Per-campaign daily spend, impressions, clicks and conversion counts. Google does not supply individual leads.' },
    { key: 'meta-ads', label: 'Meta Ads', description: 'Per-campaign daily spend, impressions, clicks, reach and conversion counts from Facebook/Instagram ads. Meta does not supply individual leads.' },
    { key: 'gohighlevel', label: 'GoHighLevel', description: 'CRM data per connected subaccount: contacts, pipeline opportunities, conversations and calendar bookings. Pipelines maps pipeline ids to names.' },
    { key: 'emergent', label: 'Emergent', description: 'Treatments accepted per patient, manager-reported daily cash-ups and the monthly P&L sheet.' },
    { key: 'summaries', label: 'Summaries', description: 'Practice-level KPIs per day and per month, computed with the same rules as the dashboard cards: patient appointments, occurred, DNA, new patients, treatment activity, billed and settled money, leads, ad spend and (monthly) accounting revenue and costs.' },
];

const c = (col) => ({ col });
const pii = (col) => ({ col, pii: true });
const dv = (col) => ({ col, pii: undefined, derived: true }); // computed in the data_room_* view / RPC — not pii unless wrapped in pii()
const cols = (...names) => names.map((n) => (typeof n === 'string' ? c(n) : n));

export const DATASETS = [
    // ---------------------------------------------------------------- Dentally
    {
        // Dated on created_at (when the patient record landed in Elevate) so the
        // Data Room's universal date filter applies; the initial Dentally backfill
        // stamps the whole historic roster on the connect day.
        source: 'dentally', key: 'patients', label: 'Patients', table: 'data_room_dentally_patients',
        where: { source: 'dentally' }, practice: { col: 'practice_id' }, dateCol: 'created_at',
        columns: cols('id', 'practice_id', 'pms_external_id', pii('first_name'), pii('last_name'),
            pii('email'), pii('phone'), pii('date_of_birth'), pii('address'), pii('postcode'),
            'marketing_consent', 'sms_consent', 'next_recall_date', 'last_visit_date',
            'pms_registered_at', 'created_at', dv('patient_key'), dv('birth_year'), dv('postcode_district')),
    },
    {
        source: 'dentally', key: 'appointments', label: 'Appointments', table: 'data_room_dentally_appointments',
        where: { source: 'dentally' }, practice: { col: 'practice_id' }, dateCol: 'starts_at',
        columns: cols('id', 'practice_id', 'contact_id', 'associate_id', 'pms_external_id',
            'pms_patient_id', 'pms_practitioner_id', 'starts_at', 'ends_at', 'status', 'appointment_type',
            dv('is_patient_appointment'), dv('occurred'), dv('dna'), dv('cancelled'), dv('duration_mins'), dv('practitioner_name')),
    },
    {
        source: 'dentally', key: 'payments', label: 'Payments', table: 'data_room_dentally_payments',
        where: { source: 'dentally' }, practice: { col: 'practice_id' }, dateCol: 'processed_at',
        columns: cols('id', 'practice_id', 'contact_id', 'external_id', 'amount_pence', 'method',
            'status', 'processed_at', dv('is_settled')),
    },
    {
        source: 'dentally', key: 'invoices', label: 'Invoices', table: 'invoices',
        where: { source: 'dentally' }, practice: { col: 'practice_id' }, dateCol: 'dated_on', dateType: 'date',
        columns: cols('id', 'practice_id', 'contact_id', 'external_id', 'amount_pence',
            'amount_outstanding_pence', 'dated_on', 'due_on', 'paid', 'treatment', pii('patient_name')),
    },
    {
        source: 'dentally', key: 'invoice_items', label: 'Invoice items', table: 'data_room_dentally_invoice_items',
        where: { source: 'dentally' }, practice: { col: 'practice_id' }, dateCol: 'invoiced_on', dateType: 'date',
        columns: cols('id', 'practice_id', 'contact_id', 'associate_id', 'pms_external_id',
            'pms_invoice_id', 'pms_practitioner_id', 'treatment_plan_id', 'treatment_name',
            'unit_price_pence', 'fee_pence', 'quantity', 'nhs_charge', 'invoiced_on', 'invoice_paid',
            dv('fee_total_pence'), dv('practitioner_name')),
    },
    {
        source: 'dentally', key: 'treatment_plans', label: 'Treatment plans', table: 'treatment_plans',
        where: { source: 'dentally' }, practice: { col: 'practice_id' }, dateCol: 'start_date', dateType: 'date',
        columns: cols('id', 'practice_id', 'contact_id', 'associate_id', 'pms_external_id',
            'pms_patient_id', 'pms_practitioner_id', 'private_value_pence', 'nhs_uda_value',
            'nhs_completed_uda_value', 'completed', 'completed_at', 'start_date', 'end_date'),
    },
    {
        source: 'dentally', key: 'treatment_items', label: 'Treatment items', table: 'data_room_dentally_treatment_items',
        practice: { col: 'practice_id' }, dateCol: 'completed_at',
        columns: cols('id', 'practice_id', 'contact_id', 'associate_id', 'pms_external_id',
            'pms_patient_id', 'pms_practitioner_id', 'treatment_plan_id', 'treatment_appointment_id',
            'pms_invoice_id', 'treatment_name', 'price_pence', 'duration', 'completed', 'completed_at',
            'base_chart', 'charged', 'appear_on_invoice', dv('counts_as_activity'), dv('practitioner_name')),
    },
    {
        source: 'dentally', key: 'practitioners', label: 'Practitioners', table: 'associates',
        where: { pms_external_id: { not: null } }, practice: { col: 'primary_practice_id' }, dateCol: null,
        columns: cols('id', 'primary_practice_id', 'pms_external_id', 'pms_user_id', 'full_name', 'email',
            'gdc_number', 'nhs_number', 'dentally_role', 'specialty', 'active', 'uda_target', 'uoa_target'),
    },
    {
        source: 'dentally', key: 'staff', label: 'Staff', table: 'staff',
        where: { source: 'dentally' }, practice: { col: 'practice_id' }, dateCol: null,
        columns: cols('id', 'practice_id', 'pms_external_id', 'full_name', 'role', 'pms_role', 'title',
            'email', 'phone', 'active', 'last_login_at'),
    },
    // -------------------------------------------------------------- Google Ads
    {
        source: 'google-ads', key: 'accounts', label: 'Accounts', table: 'ad_accounts',
        where: { provider: 'google_ads' }, practice: { col: 'practice_id' }, dateCol: null,
        columns: cols('id', 'customer_id', 'name', 'currency', 'status', 'practice_id', 'is_selected'),
    },
    {
        source: 'google-ads', key: 'campaign_daily', label: 'Campaign daily', table: 'data_room_ad_metrics',
        where: { provider: 'google_ads' },
        practice: { via: { table: 'ad_accounts', key: 'customer_id', col: 'customer_id', where: { provider: 'google_ads' } } },
        dateCol: 'metric_date', dateType: 'date',
        columns: cols('id', 'customer_id', 'campaign_id', 'campaign_name', 'metric_date', 'spend_pence',
            'impressions', 'clicks', 'conversions', 'campaign_status', 'objective', dv('practice_name'), dv('cpl_pence')),
    },
    // ---------------------------------------------------------------- Meta Ads
    {
        source: 'meta-ads', key: 'accounts', label: 'Accounts', table: 'ad_accounts',
        where: { provider: 'meta_ads' }, practice: { col: 'practice_id' }, dateCol: null,
        columns: cols('id', 'customer_id', 'name', 'currency', 'status', 'practice_id', 'is_selected',
            'period_reach', 'period_frequency', 'period_impressions', 'period_clicks', 'period_spend_pence',
            'period_conversions', 'period_window_start', 'period_window_end', 'period_synced_at'),
    },
    {
        source: 'meta-ads', key: 'campaign_daily', label: 'Campaign daily', table: 'data_room_ad_metrics',
        where: { provider: 'meta_ads' },
        practice: { via: { table: 'ad_accounts', key: 'customer_id', col: 'customer_id', where: { provider: 'meta_ads' } } },
        dateCol: 'metric_date', dateType: 'date',
        columns: cols('id', 'customer_id', 'campaign_id', 'campaign_name', 'metric_date', 'spend_pence',
            'impressions', 'clicks', 'conversions', 'reach', 'frequency', 'campaign_status', 'objective', dv('practice_name'), dv('cpl_pence')),
    },
    // ------------------------------------------------------------- GoHighLevel
    {
        source: 'gohighlevel', key: 'subaccounts', label: 'Subaccounts', table: 'integration_accounts',
        where: { provider: 'gohighlevel' }, practice: { col: 'practice_id' }, dateCol: null,
        columns: cols('id', 'external_account_id', 'label', 'practice_id', 'status', 'last_sync_at'),
    },
    {
        source: 'gohighlevel', key: 'pipelines', label: 'Pipelines', table: 'integration_accounts',
        where: { provider: 'gohighlevel' }, practice: { col: 'practice_id' }, dateCol: null,
        derived: 'ghl_pipelines',
        columns: cols('integration_account_id', 'practice_id', 'pipeline_id', 'pipeline_name', 'stage_id', 'stage_name'),
    },
    {
        source: 'gohighlevel', key: 'contacts', label: 'Contacts', table: 'data_room_gohighlevel_contacts',
        where: { source: 'gohighlevel' }, practice: { col: 'practice_id' }, dateCol: 'created_at',
        columns: cols('id', 'practice_id', 'integration_account_id', 'ghl_contact_id', pii('first_name'),
            pii('last_name'), pii('email'), pii('phone'), 'created_at', dv('contact_key')),
    },
    {
        source: 'gohighlevel', key: 'opportunities', label: 'Opportunities', table: 'data_room_gohighlevel_opportunities',
        where: { source: 'gohighlevel' }, practice: { col: 'practice_id' }, dateCol: 'created_at',
        columns: cols('id', 'practice_id', 'integration_account_id', 'contact_id', 'ghl_opportunity_id',
            'ghl_pipeline_id', 'ghl_pipeline_stage_id', 'ghl_stage_name', 'treatment', 'estimated_value_pence',
            'status', 'created_at', 'updated_at', dv('pipeline_name'), dv('outcome')),
    },
    {
        source: 'gohighlevel', key: 'conversations', label: 'Conversations', table: 'communications',
        where: { 'metadata->>provider': 'gohighlevel' },
        practice: { via: { table: 'integration_accounts', key: 'id', col: 'integration_account_id', where: { provider: 'gohighlevel' } } },
        dateCol: 'created_at',
        columns: cols('id', 'integration_account_id', 'contact_id', 'lead_id', 'channel', 'direction',
            'delivery_status', 'external_id', 'created_at', pii('subject'), pii('body')),
    },
    {
        source: 'gohighlevel', key: 'appointments', label: 'Appointments', table: 'ghl_appointments',
        practice: { col: 'practice_id' }, dateCol: 'starts_at',
        columns: cols('id', 'practice_id', 'integration_account_id', 'contact_id', 'ghl_event_id',
            'ghl_calendar_id', 'calendar_name', 'title', 'status', 'starts_at', 'ends_at'),
    },
    // ---------------------------------------------------------------- Emergent
    {
        source: 'emergent', key: 'treatments_accepted', label: 'Treatments accepted', table: 'treatment_accepted',
        where: { source: 'emergent' }, practice: { col: 'practice_id' }, dateCol: 'accepted_date', dateType: 'date',
        columns: cols('id', 'practice_id', 'business_id', 'external_id', 'accepted_date', 'treatment_name',
            'practitioner_name', 'value_pence', 'quantity', 'status', 'ext_source', 'ext_campaign',
            pii('patient_name'), pii('phone'), pii('email')),
    },
    {
        source: 'emergent', key: 'daily_cashups', label: 'Daily cash-ups', table: 'emergent_daily_cashup',
        practice: { col: 'practice_id' }, dateCol: 'cashup_date', dateType: 'date',
        columns: cols('id', 'practice_id', 'business_id', 'business_name', 'cashup_date', 'treatments_accepted',
            'tx_plans_given', 'tx_plan_given_value_pence', 'cash_up_money_taken_pence', 'num_bookings',
            'num_new_leads', 'num_follow_ups', 'num_attended', 'total_chairs', 'chairs_used', 'chair_utilisation',
            'reviews_collected', 'before_after_pictures', 'video_testimonials', 'practice_plan_signups',
            'total_refunds_pence', 'source_google', 'source_facebook', 'source_walk_in', 'source_friends_family',
            'source_wl_website', 'source_dentist_referral', 'source_instagram', 'source_youtube', 'source_other',
            'custom_sources', 'refunds', 'appointment_booked_for', 'detail_patient_rows_count',
            'detail_patient_money_total_pence', 'variance_manager_vs_detail', 'emergent_created_at',
            'emergent_created_by'),
    },
    {
        source: 'emergent', key: 'monthly_pl', label: 'Monthly P&L', table: 'emergent_monthly_pl',
        practice: { col: 'practice_id' }, dateCol: 'period_month', dateType: 'date',
        columns: cols('id', 'practice_id', 'business_id', 'business_name', 'period_month', 'revenue_pence',
            'gross_profit_pence', 'net_profit_pence', 'total_cost_of_sales_pence', 'total_operating_expenses_pence',
            'cash_collected_pence', 'tx_accepted_amount_pence', 'bank_balance_pence', 'average_wait_time',
            'principal_fees_pence', 'hygienist_therapist_pence', 'lab_fees_pence', 'materials_pence',
            'sedation_services_pence', 'advertising_marketing_pence', 'bank_charges_pence',
            'business_rates_rent_pence', 'salaries_staff_cost_pence', 'telephone_wifi_pence', 'utilities_pence',
            'insurance_pence', 'management_fees_pence', 'subscriptions_pence', 'it_expenses_pence',
            'card_machine_charges_pence', 'custom_lines', 'emergent_created_at', 'last_updated_at',
            'last_updated_by'),
    },
    // --------------------------------------------------------------- Summaries
    {
        source: 'summaries', key: 'practice_day', label: 'Practice by day', table: 'data_room_practice_day',
        derived: 'rpc', rpc: 'data_room_practice_day',
        practice: { col: 'practice_id' }, dateCol: 'day', dateType: 'date',
        columns: cols('id', 'practice_id', 'practice_name', 'day', 'appointments', 'occurred', 'dna', 'cancelled',
            'new_patients', 'treatment_items', 'treatment_items_pence', 'billed_pence', 'settled_pence',
            'leads_new', 'leads_won', 'ad_spend_pence'),
    },
    {
        source: 'summaries', key: 'practice_month', label: 'Practice by month', table: 'data_room_practice_month',
        derived: 'rpc', rpc: 'data_room_practice_month',
        practice: { col: 'practice_id' }, dateCol: 'month', dateType: 'date',
        columns: cols('id', 'practice_id', 'practice_name', 'month', 'appointments', 'occurred', 'dna', 'cancelled',
            'new_patients', 'treatment_items', 'treatment_items_pence', 'billed_pence', 'settled_pence',
            'leads_new', 'leads_won', 'ad_spend_pence', 'dna_pct', 'avg_fee_pence', 'cost_per_lead_pence',
            'financial_revenue_pence', 'financial_costs_pence'),
    },
];

// Merge unit + description into every column entry once, at load.
for (const ds of DATASETS) {
    ds.columns = ds.columns.map((col) => ({ ...col, ...docFor(ds, col.col) }));
}

export function getDataset(source, key) {
    return DATASETS.find((d) => d.source === source && d.key === key);
}

/** Column names only (in registry order). includePii=false drops pii columns. */
export function columnNames(ds, includePii) {
    return ds.columns.filter((c) => includePii || !c.pii).map((c) => c.col);
}

/** Shape returned by GET /api/data-room/datasets. Nothing internal leaks. */
export function registryForClient() {
    return {
        sources: SOURCES.map((s) => ({
            key: s.key,
            label: s.label,
            description: s.description,
            datasets: DATASETS.filter((d) => d.source === s.key).map((d) => ({
                key: d.key,
                label: d.label,
                roster: d.dateCol === null,
                summary: d.derived === 'rpc',
                columns: d.columns.map((c) => ({
                    col: c.col, pii: c.pii === true, derived: c.derived === true, unit: c.unit, description: c.description,
                })),
            })),
        })),
    };
}

const STAFF_TABLES = new Set(['associates', 'staff']);
const VIA_TABLES = new Set(['ad_accounts', 'integration_accounts']);

/** Returns [] when the registry is well-formed; otherwise human-readable problems. */
export function validateRegistry() {
    const problems = [];
    const seen = new Set();
    for (const d of DATASETS) {
        const id = `${d.source}/${d.key}`;
        if (!SOURCES.some((s) => s.key === d.source)) problems.push(`${id}: unknown source`);
        if (seen.has(id)) problems.push(`${id}: duplicate`);
        seen.add(id);
        if (typeof d.table !== 'string' || !d.table) problems.push(`${id}: missing table`);
        if (!Array.isArray(d.columns) || d.columns.length === 0) problems.push(`${id}: no columns`);
        const hasCol = !!d.practice?.col;
        const hasVia = !!d.practice?.via && VIA_TABLES.has(d.practice.via.table)
            && !!d.practice.via.key && !!d.practice.via.col;
        if (!hasCol && !hasVia) problems.push(`${id}: practice strategy missing/invalid`);
        const names = (d.columns || []).map((c) => c.col);
        if (d.dateCol && !names.includes(d.dateCol)) problems.push(`${id}: dateCol ${d.dateCol} not in columns`);
        for (const col of names) {
            if (FORBIDDEN_COLUMNS.has(col)) problems.push(`${id}: forbidden column ${col}`);
            if (col === 'organisation_id') problems.push(`${id}: organisation_id must not be listed`);
        }
        if (d.derived === 'rpc' && typeof d.rpc !== 'string') problems.push(`${id}: rpc dataset must name its function`);
        for (const col of d.columns || []) {
            if (!col.description) problems.push(`${id}: undocumented column ${col.col}`);
        }
        for (const c of d.columns || []) {
            if (!PII_COLUMNS.has(c.col)) continue;
            const staffContact = STAFF_TABLES.has(d.table) && (c.col === 'email' || c.col === 'phone');
            if (staffContact && c.pii) problems.push(`${id}: ${c.col} is staff contact, must not be pii`);
            if (!staffContact && c.pii !== true) problems.push(`${id}: ${c.col} must be flagged pii`);
        }
    }
    return problems;
}
