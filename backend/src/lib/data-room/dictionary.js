// backend/src/lib/data-room/dictionary.js
// ============================================================================
// Data Room column dictionary — the human-readable meaning + unit of every
// column the analyst can see. Pure data. The registry merges these into its
// column entries at load; validateRegistry() fails the suite if any listed
// column has no description, so a new column cannot ship undocumented.
//
//   inferUnit(col)          unit from the naming convention (pence/_at/_on…)
//   COLUMN_DOCS             global doc per column name (shared across datasets)
//   DATASET_COLUMN_DOCS     '<source>/<key>' -> col -> doc, overrides the global
//   docFor(ds, col)         { unit, description } ('' description when unknown)
// ============================================================================

const COUNT_COLS = new Set([
    'quantity', 'impressions', 'clicks', 'conversions', 'reach', 'appointments', 'occurred', 'dna',
    'cancelled', 'new_patients', 'treatment_items', 'leads_new', 'leads_won', 'treatments_accepted',
    'tx_plans_given', 'num_bookings', 'num_new_leads', 'num_follow_ups', 'num_attended', 'total_chairs',
    'chairs_used', 'reviews_collected', 'before_after_pictures', 'video_testimonials',
    'practice_plan_signups', 'refunds', 'detail_patient_rows_count', 'period_reach', 'period_impressions',
    'period_clicks', 'period_conversions', 'source_google', 'source_facebook', 'source_walk_in',
    'source_friends_family', 'source_wl_website', 'source_dentist_referral', 'source_instagram',
    'source_youtube', 'source_other', 'uda_target', 'uoa_target',
]);
const FLAG_COLS = new Set([
    'marketing_consent', 'sms_consent', 'paid', 'nhs_charge', 'invoice_paid', 'completed', 'base_chart',
    'charged', 'appear_on_invoice', 'active', 'is_selected', 'occurred', 'dna', 'cancelled',
    'counts_as_activity',
]);
const DATE_COLS = new Set(['day', 'month', 'period_month', 'metric_date', 'period_window_start', 'period_window_end']);

export function inferUnit(col) {
    if (col === 'id' || col.endsWith('_id')) return 'id';
    if (col.endsWith('_key')) return 'hash';
    if (col.endsWith('_pence')) return 'pence';
    if (col.endsWith('_pct')) return 'percent';
    if (col.endsWith('_at')) return 'timestamptz';
    if (col.endsWith('_on') || col.endsWith('_date') || DATE_COLS.has(col)) return 'date';
    if (col.startsWith('is_') || FLAG_COLS.has(col)) return 'flag';
    if (COUNT_COLS.has(col)) return 'count';
    return 'text';
}

const d = (description, unit) => (unit ? { description, unit } : { description });

export const COLUMN_DOCS = {
    // identifiers
    id: d('Elevate row id (UUID). Stable across syncs.'),
    practice_id: d('Elevate practice the row is attributed to. Null = not attributed to a site.'),
    primary_practice_id: d('Home practice of the practitioner (Dentally site).'),
    contact_id: d('Elevate contact (patient or lead) the row belongs to. Join to Patients / Contacts.'),
    associate_id: d('Elevate practitioner row. Join to Practitioners.'),
    lead_id: d('Elevate opportunity the message belongs to. Join to Opportunities.'),
    integration_account_id: d('Connected sub-account (GoHighLevel location) the row came from. Join to Subaccounts.'),
    pms_external_id: d('The record id in Dentally (practice management system).'),
    pms_patient_id: d('Dentally patient id. Null on diary blocks (lunch, admin) — not a patient appointment.'),
    pms_practitioner_id: d('Dentally practitioner (user) id who delivered the item. Join Practitioners.pms_external_id.'),
    pms_user_id: d('Dentally login user id of the practitioner.'),
    pms_invoice_id: d('Dentally invoice id the line sits on.'),
    external_id: d('Record id in the source system.'),
    external_account_id: d('GoHighLevel location id of the sub-account.'),
    treatment_plan_id: d('Dentally treatment plan id the item belongs to.'),
    treatment_appointment_id: d('Dentally appointment id the item was delivered in.'),
    customer_id: d('Ads account id (Google Ads customer id / Meta ad account id).'),
    campaign_id: d('Ads campaign id in the provider.'),
    ghl_contact_id: d('GoHighLevel contact id.'),
    ghl_opportunity_id: d('GoHighLevel opportunity id.'),
    ghl_pipeline_id: d('GoHighLevel pipeline id. Join Pipelines.pipeline_id for the name.'),
    ghl_pipeline_stage_id: d('GoHighLevel stage id within the pipeline.'),
    ghl_event_id: d('GoHighLevel calendar event id.'),
    ghl_calendar_id: d('GoHighLevel calendar id.'),
    pipeline_id: d('GoHighLevel pipeline id.'),
    stage_id: d('GoHighLevel stage id.'),
    business_id: d('Emergent business (site) id. Mapped to practice_id by the owner.'),
    // hashes / derived keys
    patient_key: d('Pseudonymous patient key: SHA-256 of organisation + Dentally patient id. Same patient = same key; not reversible.', 'hash'),
    contact_key: d('Pseudonymous contact key: SHA-256 of organisation + GoHighLevel contact id.', 'hash'),
    // people (PII-gated where flagged in the registry)
    first_name: d('Patient / contact first name. PII — owner only.'),
    last_name: d('Patient / contact last name. PII — owner only.'),
    email: d('Email address. PII — owner only (staff contact details are not gated).'),
    phone: d('Telephone number. PII — owner only (staff contact details are not gated).'),
    date_of_birth: d('Date of birth. PII — owner only.', 'date'),
    address: d('Postal address. PII — owner only.'),
    postcode: d('Full postcode. PII — owner only.'),
    patient_name: d('Patient name as printed on the invoice / record. PII — owner only.'),
    full_name: d('Full name (staff / practitioner — business contact, not patient data).'),
    birth_year: d('Year of birth (derived from date of birth). Use for age bands.', 'number'),
    postcode_district: d('Outward postcode (e.g. DA6) derived from the full postcode.'),
    // patients
    marketing_consent: d('Patient has consented to marketing contact.'),
    sms_consent: d('Patient has consented to SMS.'),
    next_recall_date: d('Next recall due date in Dentally.'),
    last_visit_date: d('Date of the last attended visit in Dentally.'),
    pms_registered_at: d('When the patient registered in Dentally. The dashboard\'s "new patient" date.'),
    type: d('Contact type: patient | lead.'),
    source: d('System the row was synced from (dentally, gohighlevel, xero, quickbooks, manual…).'),
    // appointments
    starts_at: d('Appointment start (UTC instant; shown in London time in the UI).'),
    ends_at: d('Appointment end.'),
    status: d('Row status in the source system.'),
    appointment_type: d('Dentally appointment reason / type.'),
    is_patient_appointment: d('True when a patient is attached (Dentally "With patients" view). Diary blocks are false.'),
    occurred: d('Patient appointment with status completed — the dashboard\'s "Appointments occurred".'),
    dna: d('Patient appointment marked did-not-attend (no_show).'),
    cancelled: d('Appointment cancelled.'),
    duration_mins: d('Booked length in minutes (ends_at − starts_at).', 'minutes'),
    practitioner_name: d('Practitioner name resolved from pms_practitioner_id.'),
    // money / invoices
    amount_pence: d('Amount in pence (£ = pence ÷ 100).'),
    amount_outstanding_pence: d('Unpaid balance on the invoice in pence.'),
    method: d('Payment method (card, cash, bank transfer, finance…).'),
    processed_at: d('When the payment was taken.'),
    is_settled: d('Payment status settled — counted as cash collected.'),
    dated_on: d('Invoice date.'),
    due_on: d('Invoice due date.'),
    paid: d('Invoice fully paid.'),
    treatment: d('Treatment name / category.'),
    treatment_name: d('Treatment or item name as recorded.'),
    unit_price_pence: d('Unit price of the invoice line in pence.'),
    fee_pence: d('Line fee in pence (per unit).'),
    fee_total_pence: d('fee_pence × quantity — the billed value of the line.'),
    quantity: d('Units on the line.'),
    nhs_charge: d('Line is an NHS patient charge.'),
    invoiced_on: d('Date the line was invoiced. The dashboard\'s "billed" date.'),
    invoice_paid: d('The invoice this line sits on is fully paid.'),
    // treatment plans / items
    private_value_pence: d('Private fee value of the plan in pence.'),
    nhs_uda_value: d('NHS UDAs on the plan.', 'number'),
    nhs_completed_uda_value: d('NHS UDAs completed on the plan.', 'number'),
    completed: d('Plan / item marked completed.'),
    completed_at: d('When the item was completed — the Practitioner Activity date.'),
    start_date: d('Plan start date.'),
    end_date: d('Plan end date.'),
    price_pence: d('Item price in pence.'),
    duration: d('Item duration in minutes.', 'minutes'),
    base_chart: d('Charting-only item (existing condition), excluded from activity.'),
    charged: d('Item has been charged.'),
    appear_on_invoice: d('Item appears on an invoice.'),
    counts_as_activity: d('completed and not base_chart — the Practitioner Activity rule.'),
    // practitioners / staff
    gdc_number: d('GDC registration number.'),
    nhs_number: d('NHS performer number.'),
    dentally_role: d('Role in Dentally (dentist, hygienist, therapist…).'),
    specialty: d('Clinical specialty.'),
    active: d('Currently active in the source system.'),
    uda_target: d('Annual UDA target.'),
    uoa_target: d('Annual UOA target.'),
    role: d('Elevate role.'),
    pms_role: d('Role in Dentally.'),
    title: d('Title / job title.'),
    last_login_at: d('Last login in Dentally.'),
    // ads
    name: d('Display name.'),
    currency: d('Account currency (ISO code).'),
    is_selected: d('Account included in Elevate reporting.'),
    campaign_name: d('Campaign name in the provider.'),
    metric_date: d('Reporting day (provider account timezone).'),
    spend_pence: d('Spend in pence.'),
    impressions: d('Impressions.'),
    clicks: d('Clicks.'),
    conversions: d('Provider-reported conversions (leads). No individual lead records are supplied.'),
    campaign_status: d('Campaign status in the provider.'),
    objective: d('Campaign objective.'),
    reach: d('Unique people reached (Meta).'),
    frequency: d('Average impressions per person (Meta).', 'number'),
    practice_name: d('Practice name resolved from practice_id (ads: via the ad account mapping). "Group / unassigned" on summary rows not attributed to a site.'),
    cpl_pence: d('Cost per platform-reported conversion in pence: spend ÷ conversions (null when no conversions). Ads only.'),
    cost_per_lead_pence: d('Cost per CRM lead in pence: ad_spend_pence ÷ leads_new (null when no leads). Not the same as ad cpl_pence.'),
    period_reach: d('Reach over the account\'s synced window (Meta).'),
    period_frequency: d('Frequency over the synced window (Meta).', 'number'),
    period_impressions: d('Impressions over the synced window.'),
    period_clicks: d('Clicks over the synced window.'),
    period_spend_pence: d('Spend over the synced window in pence.'),
    period_conversions: d('Conversions over the synced window.'),
    period_window_start: d('Start of the synced window.'),
    period_window_end: d('End of the synced window.'),
    period_synced_at: d('When the window figures were last pulled.'),
    // gohighlevel
    label: d('Owner-given label of the sub-account.'),
    last_sync_at: d('Last successful sync of this sub-account.'),
    pipeline_name: d('GoHighLevel pipeline name.'),
    stage_name: d('GoHighLevel stage name.'),
    ghl_stage_name: d('Stage name at sync time.'),
    estimated_value_pence: d('Opportunity value in pence.'),
    outcome: d('won (treatment started/completed) | lost (not proceeding / failed to attend) | open.'),
    channel: d('Message channel (sms, email, call, whatsapp…).'),
    direction: d('inbound | outbound.'),
    delivery_status: d('Provider delivery status.'),
    subject: d('Message subject. PII — owner only.'),
    body: d('Message text. PII — owner only.'),
    calendar_name: d('GoHighLevel calendar name.'),
    // emergent
    accepted_date: d('Date the treatment was accepted.'),
    value_pence: d('Accepted treatment value in pence.'),
    ext_source: d('Lead source recorded in Emergent.'),
    ext_campaign: d('Campaign recorded in Emergent.'),
    business_name: d('Emergent business (site) name.'),
    cashup_date: d('Cash-up day.'),
    treatments_accepted: d('Treatments accepted that day (count).'),
    tx_plans_given: d('Treatment plans given (count).'),
    tx_plan_given_value_pence: d('Value of treatment plans given in pence.'),
    cash_up_money_taken_pence: d('Money taken per the manager cash-up in pence.'),
    num_bookings: d('Bookings made.'),
    num_new_leads: d('New leads.'),
    num_follow_ups: d('Follow-ups made.'),
    num_attended: d('Patients attended.'),
    total_chairs: d('Chairs available.'),
    chairs_used: d('Chairs used.'),
    chair_utilisation: d('Chairs used ÷ chairs available, per cent.', 'percent'),
    reviews_collected: d('Reviews collected.'),
    before_after_pictures: d('Before/after photo sets taken.'),
    video_testimonials: d('Video testimonials recorded.'),
    practice_plan_signups: d('Practice plan sign-ups.'),
    total_refunds_pence: d('Refunds in pence.'),
    source_google: d('Leads from Google (count).'),
    source_facebook: d('Leads from Facebook (count).'),
    source_walk_in: d('Walk-in leads (count).'),
    source_friends_family: d('Friends & family referrals (count).'),
    source_wl_website: d('Website leads (count).'),
    source_dentist_referral: d('Dentist referrals (count).'),
    source_instagram: d('Instagram leads (count).'),
    source_youtube: d('YouTube leads (count).'),
    source_other: d('Other-source leads (count).'),
    custom_sources: d('Additional sources as JSON.'),
    refunds: d('Refund count.'),
    appointment_booked_for: d('Appointments booked for (free text from the cash-up).'),
    detail_patient_rows_count: d('Patient rows on the detailed cash-up.'),
    detail_patient_money_total_pence: d('Sum of the detailed patient rows in pence.'),
    variance_manager_vs_detail: d('Manager total minus detailed rows total, pence.', 'number'),
    emergent_created_at: d('Created in Emergent.'),
    emergent_created_by: d('Created by (Emergent user).'),
    period_month: d('Accounting month.'),
    revenue_pence: d('Revenue in pence.'),
    gross_profit_pence: d('Gross profit in pence.'),
    net_profit_pence: d('Net profit in pence.'),
    total_cost_of_sales_pence: d('Cost of sales in pence.'),
    total_operating_expenses_pence: d('Operating expenses in pence.'),
    cash_collected_pence: d('Cash collected in pence.'),
    tx_accepted_amount_pence: d('Treatment accepted amount in pence.'),
    bank_balance_pence: d('Bank balance at month end in pence.'),
    average_wait_time: d('Average wait time (as reported).', 'number'),
    principal_fees_pence: d('Principal fees in pence.'),
    hygienist_therapist_pence: d('Hygienist / therapist cost in pence.'),
    lab_fees_pence: d('Lab fees in pence.'),
    materials_pence: d('Materials in pence.'),
    sedation_services_pence: d('Sedation services in pence.'),
    advertising_marketing_pence: d('Advertising and marketing in pence.'),
    bank_charges_pence: d('Bank charges in pence.'),
    business_rates_rent_pence: d('Business rates and rent in pence.'),
    salaries_staff_cost_pence: d('Salaries and staff cost in pence.'),
    telephone_wifi_pence: d('Telephone and wifi in pence.'),
    utilities_pence: d('Utilities in pence.'),
    insurance_pence: d('Insurance in pence.'),
    management_fees_pence: d('Management fees in pence.'),
    subscriptions_pence: d('Subscriptions in pence.'),
    it_expenses_pence: d('IT expenses in pence.'),
    card_machine_charges_pence: d('Card machine charges in pence.'),
    custom_lines: d('Additional P&L lines as JSON.'),
    last_updated_at: d('Last updated in Emergent.'),
    last_updated_by: d('Last updated by (Emergent user).'),
    created_at: d('When the row was created in Elevate.'),
    updated_at: d('When the row was last updated in Elevate.'),
    // summaries
    day: d('Calendar day (Europe/London).'),
    month: d('Calendar month (first day, Europe/London).'),
    appointments: d('Patient appointments in the period (any status).'),
    new_patients: d('Patients whose Dentally registration date falls in the period.'),
    treatment_items: d('Completed treatment items (Practitioner Activity rule).'),
    treatment_items_pence: d('Value of completed treatment items in pence.'),
    billed_pence: d('Invoice lines billed in pence (fee × quantity).'),
    settled_pence: d('Settled payments in pence — cash collected.'),
    leads_new: d('GoHighLevel opportunities created in the period.'),
    leads_won: d('Of those, opportunities now at treatment started/completed.'),
    ad_spend_pence: d('Google + Meta spend attributed to the practice in pence.'),
    dna_pct: d('DNA ÷ (occurred + DNA) × 100.'),
    avg_fee_pence: d('treatment_items_pence ÷ treatment_items.'),
    financial_revenue_pence: d('Accounting revenue (Xero/QuickBooks, accrual) for the month; manual rows only where no synced row exists. Null when the accounting feed is not mapped to this practice — group-level figures sit on the "Group / unassigned" row.'),
    financial_costs_pence: d('Accounting costs (associates, staff, lab, materials, overhead, other; tax excluded) for the month. Null when not mapped to this practice — see financial_revenue_pence.'),
};

export const DATASET_COLUMN_DOCS = {
    'dentally/appointments': {
        status: d('scheduled | confirmed | in_progress | completed | cancelled | no_show (Dentally state mapped).'),
    },
    'dentally/payments': {
        status: d('settled | pending | failed | refunded. Only settled counts as cash collected.'),
    },
    'dentally/practitioners': {
        email: d('Work email (staff contact, not patient data).'),
    },
    'dentally/staff': {
        email: d('Work email (staff contact, not patient data).'),
        phone: d('Work phone (staff contact, not patient data).'),
    },
    'gohighlevel/opportunities': {
        status: d('Elevate pipeline stage mapped from the GoHighLevel stage (new_lead … treatment_started, not_proceeding…).'),
    },
    'gohighlevel/subaccounts': {
        status: d('active | failed | disconnected — sync health of the sub-account.'),
    },
    'gohighlevel/appointments': {
        status: d('GoHighLevel booking status (confirmed, cancelled, showed, noshow…).'),
        title: d('Booking title.'),
    },
    'google-ads/accounts': { status: d('Account status in Google Ads.') },
    'meta-ads/accounts': { status: d('Account status in Meta.') },
    'emergent/treatments_accepted': {
        status: d('Emergent record status.'),
        practitioner_name: d('Practitioner as recorded in Emergent.'),
    },
    'summaries/practice_day': {
        practice_id: d('Practice the day\'s figures belong to. Null = rows not attributed to a site.'),
    },
    'summaries/practice_month': {
        practice_id: d('Practice the month\'s figures belong to. Null = org-level accounting rows / unattributed.'),
    },
};

export function docFor(ds, col) {
    const override = DATASET_COLUMN_DOCS[`${ds.source}/${ds.key}`]?.[col];
    const base = COLUMN_DOCS[col];
    const doc = override ?? base;
    return { unit: doc?.unit ?? inferUnit(col), description: doc?.description ?? '' };
}
