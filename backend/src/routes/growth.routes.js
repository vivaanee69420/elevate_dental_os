// ============================================================================
// Growth routes — patient acquisition, loyalty, booking, benchmarks,
// marketing. Read-only aggregator on top of existing tables. Mounted at
// /api/growth.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as supabase_1 from "../lib/supabase.js";
import * as formulas_1 from "../lib/formulas.js";
import { AppError } from "../middleware/errors.js";
import { integrationRepository } from "../repositories/integration.repository.js";
const router = (0, express_1.Router)();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve the ad-account filter for the marketing views. Precedence:
//   1. explicit ?account_ids=a,b,c  -> exactly those customer_ids
//   2. else the org's SELECTED ad_accounts (default = all selected)
//   3. else null -> no filter (org has no ad_accounts rows yet: pre-migration /
//      never synced; falls back to "all rows for the org", the old behaviour).
// Returns { ids: string[]|null }. An empty array means "selected none" -> the
// caller filters ad_metrics to nothing (the owner deselected every account).
async function resolveAdAccountFilter(orgId, query) {
    const raw = query.account_ids;
    if (typeof raw === 'string' && raw.trim()) {
        return { ids: raw.split(',').map((s) => s.trim()).filter(Boolean) };
    }
    const selected = await integrationRepository.selectedAdAccountIds(orgId, null);
    return { ids: selected }; // null when no ad_accounts rows yet
}

// Validate optional ?practice_id= as a UUID. Returns null when absent so the
// query stays org-wide; throws 400 (not a raw Postgres 500) on a malformed id.
function parsePracticeId(q) {
    const raw = q.practice_id;
    if (raw == null || raw === '') return null;
    if (!UUID_RE.test(String(raw))) throw new AppError('practice_id must be a UUID', 400);
    return String(raw);
}

async function aggregate(orgId, since) {
    const [leadsR, paymentsR, contactsR] = await Promise.all([
        supabase_1.serviceClient.from('leads')
            .select('source, source_provider, status, estimated_value_pence, created_at')
            .eq('organisation_id', orgId)
            .gte('created_at', since),
        supabase_1.serviceClient.from('payments')
            .select('amount_pence, source, processed_at, status')
            .eq('organisation_id', orgId)
            .gte('processed_at', since),
        supabase_1.serviceClient.from('contacts')
            .select('id, source, created_at')
            .eq('organisation_id', orgId)
            .gte('created_at', since),
    ]);
    return { leads: leadsR.data ?? [], payments: paymentsR.data ?? [], contacts: contactsR.data ?? [] };
}

// Resolve the query window from ?from=&to= (YYYY-MM-DD). Mirrors the finance
// section: from/to take effect ONLY when BOTH are set (to = inclusive end of
// that day); otherwise fall back to the 30-day rolling window. Returns ISO
// bounds (toISO null = open-ended rolling window).
function resolveWindow(q) {
    if (q.from && q.to) {
        const from = new Date(`${q.from}T00:00:00.000Z`);
        const to = new Date(`${q.to}T23:59:59.999Z`);
        // Guard malformed dates: an invalid Date.toISOString() throws RangeError,
        // which would surface as a raw 500. Return a clean 400 instead.
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
            throw new AppError('from/to must be valid YYYY-MM-DD dates', 400);
        }
        return { fromISO: from.toISOString(), toISO: to.toISOString() };
    }
    return { fromISO: new Date(Date.now() - 30 * 86400000).toISOString(), toISO: null };
}

router.get('/patients', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { contacts, leads } = await aggregate(req.user.organisation_id, since);
    res.json({
        new_patients_30d: contacts.length,
        new_leads_30d: leads.length,
        by_source: leads.reduce((acc, l) => { acc[l.source ?? 'unknown'] = (acc[l.source ?? 'unknown'] ?? 0) + 1; return acc; }, {}),
    });
}));

router.get('/marketing', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { leads, payments } = await aggregate(req.user.organisation_id, since);
    const revenue = payments.filter((p) => p.status === 'settled').reduce((s, p) => s + (p.amount_pence ?? 0), 0);
    res.json({
        leads_30d: leads.length,
        revenue_pence_30d: revenue,
        by_provider: leads.reduce((acc, l) => { const k = l.source_provider ?? 'manual'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
    });
}));

// Loyalty & membership summary — real data from membership_plans + memberships
// (manual/seeded, org-scoped). Returns active/total member counts, per-tier
// member breakdown, and MRR (sum of active members * plan monthly price).
// All money is integer PENCE. No external integration feeds this.
router.get('/loyalty', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const orgId = req.user.organisation_id;
    const [plansRes, membersRes] = await Promise.all([
        supabase_1.serviceClient
            .from('membership_plans')
            .select('id, name, description, monthly_price_pence, benefits, active')
            .eq('organisation_id', orgId),
        supabase_1.serviceClient
            .from('memberships')
            .select('id, plan_id, status, started_at')
            .eq('organisation_id', orgId),
    ]);
    const plans = plansRes.data ?? [];
    const members = membersRes.data ?? [];
    const activeMembers = members.filter((m) => m.status === 'active');
    const activeByPlan = activeMembers.reduce((acc, m) => {
        acc[m.plan_id] = (acc[m.plan_id] ?? 0) + 1;
        return acc;
    }, {});
    const tiers = plans
        .filter((p) => p.active !== false)
        .map((p) => {
            const count = activeByPlan[p.id] ?? 0;
            return {
                id: p.id,
                name: p.name,
                description: p.description ?? null,
                monthly_price_pence: p.monthly_price_pence,
                benefits: Array.isArray(p.benefits) ? p.benefits : [],
                members: count,
                mrr_pence: count * p.monthly_price_pence,
            };
        });
    const mrr_pence = tiers.reduce((s, t) => s + t.mrr_pence, 0);
    res.json({
        active: activeMembers.length,
        total: members.length,
        mrr_pence,
        tiers,
        // No automated-rewards or campaigns table exists yet — return empty so
        // the UI shows zero/empty states instead of fabricated rows. Wire these
        // once a loyalty_rewards / loyalty_campaigns source lands.
        rewards: [],
        campaigns: [],
    });
}));

// Per-practice performance over the window — sourced from Dentally (patients ->
// contacts, appointments, settled payments). Aggregated in Postgres via the
// growth_practice_performance RPC (GROUP BY) so counts are NOT truncated by
// PostgREST's 1000-row read cap. Fields Dentally does NOT carry (consults, lead
// conversion) are omitted — those are leads/CRM concepts, not PMS data.
router.get('/practice-performance', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const orgId = req.user.organisation_id;
    const { fromISO, toISO } = resolveWindow(req.query);
    const practiceId = parsePracticeId(req.query);
    const { data, error } = await supabase_1.serviceClient.rpc('growth_practice_performance', {
        p_org: orgId, p_since: fromISO, p_until: toISO, p_practice: practiceId,
    });
    if (error) throw new Error(error.message);
    res.json({
        practices: (data ?? []).map((r) => ({
            practice_id: r.practice_id,
            name: r.name,
            new_patients_30d: Number(r.new_patients) || 0,
            appts_30d: Number(r.appts) || 0,
            completed_30d: Number(r.completed) || 0,
            no_show_30d: Number(r.no_shows) || 0,
            revenue_pence_30d: Number(r.revenue_pence) || 0,
        })),
    });
}));

// Patient roster for one practice (contacts of type 'patient'), paginated.
// Backs the expandable patient list under each card on the Practices & Patients
// screen. Not window-scoped — this is the practice's full roster, not just
// in-window new patients. Optional ?search= matches name/email/phone.
router.get('/practice-patients', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const orgId = req.user.organisation_id;
    const practiceId = parsePracticeId(req.query);
    if (!practiceId) {
        res.json({ patients: [], total: 0, page: 1, per_page: 0 });
        return;
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 10));
    const offset = (page - 1) * perPage;
    // Strip PostgREST filter metacharacters so a search term can't inject extra
    // .or() sub-conditions or break the ilike pattern (org/practice .eq filters
    // are AND'd separately, so this is hardening, not a tenant-isolation fix).
    const search = String(req.query.search ?? '').trim().replace(/[,()*\\%]/g, '');
    let q = supabase_1.serviceClient
        .from('contacts')
        .select('id, first_name, last_name, email, phone, created_at', { count: 'exact' })
        .eq('organisation_id', orgId)
        .eq('type', 'patient')
        .eq('practice_id', practiceId)
        .order('created_at', { ascending: false });
    if (search) {
        q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    }
    const { data, count } = await q.range(offset, offset + perPage - 1);
    res.json({
        patients: (data ?? []).map((c) => ({
            id: c.id,
            name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
            email: c.email ?? null,
            phone: c.phone ?? null,
            created_at: c.created_at,
        })),
        total: count ?? 0,
        page,
        per_page: perPage,
    });
}));

router.get('/booking', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const orgId = req.user.organisation_id;
    const { fromISO, toISO } = resolveWindow(req.query);
    const practiceId = parsePracticeId(req.query);
    // Calendar bounds for the today / this-week tiles. These are bounded BOTH
    // ends (the old code only set a lower bound, so open-ended future appts
    // inflated "today" past "this week"). Week = current Mon–Sun (UK). Local
    // Date → toISOString() gives the UTC instant.
    const n = new Date();
    const startOfToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).toISOString();
    const endOfToday = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59, 999).toISOString();
    const dow = (n.getDay() + 6) % 7; // days since Monday
    const startOfWeek = new Date(n.getFullYear(), n.getMonth(), n.getDate() - dow).toISOString();
    const endOfWeek = new Date(n.getFullYear(), n.getMonth(), n.getDate() - dow + 6, 23, 59, 59, 999).toISOString();
    // head:true count queries return exact totals WITHOUT fetching rows, so the
    // 1000-row read cap can't truncate them (the bug the practice cards had).
    const count = (build) => {
        let q = supabase_1.serviceClient.from('appointments')
            .select('id', { count: 'exact', head: true })
            .eq('organisation_id', orgId)
            .gte('starts_at', fromISO);
        if (toISO) q = q.lte('starts_at', toISO);
        if (practiceId) q = q.eq('practice_id', practiceId);
        return build(q);
    };
    // today/this_week intersect the selected window with the calendar period
    // (multiple gte/lte on starts_at AND together: largest lower, smallest upper).
    const [bookedR, completedR, noShowR, todayR, weekR] = await Promise.all([
        count((q) => q),
        count((q) => q.eq('status', 'completed')),
        count((q) => q.eq('status', 'no_show')),
        count((q) => q.gte('starts_at', startOfToday).lte('starts_at', endOfToday)),
        count((q) => q.gte('starts_at', startOfWeek).lte('starts_at', endOfWeek)),
    ]);
    const booked = bookedR.count ?? 0;
    const noShow = noShowR.count ?? 0;
    res.json({
        booked_30d: booked,
        completed_30d: completedR.count ?? 0,
        no_show_30d: noShow,
        today: todayR.count ?? 0,
        this_week: weekR.count ?? 0,
        this_month: booked,
        no_show_rate: booked ? Math.round((noShow / booked) * 1000) / 10 : 0,
    });
}));

// Recent bookings list (most recent/upcoming first), paginated. service +
// deposit come from appointment_type/deposit_pence/deposit_paid — Dentally sync
// leaves those null/0/false, so the screen renders an em dash where the PMS
// gives nothing. patient is null when the appointment has no linked contact
// (pre-pms_patient_id rows) — the screen shows "Unknown".
router.get('/recent-bookings', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { fromISO, toISO } = resolveWindow(req.query);
    const practiceId = parsePracticeId(req.query);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 10));
    const offset = (page - 1) * perPage;
    let q = supabase_1.serviceClient
        .from('appointments')
        .select('id, starts_at, status, appointment_type, deposit_pence, deposit_paid, contact:contacts(first_name, last_name), practice:practices(name)', { count: 'exact' })
        .eq('organisation_id', req.user.organisation_id)
        .gte('starts_at', fromISO);
    if (toISO) q = q.lte('starts_at', toISO);
    if (practiceId) q = q.eq('practice_id', practiceId);
    const { data, count } = await q
        .order('starts_at', { ascending: false })
        .range(offset, offset + perPage - 1);
    res.json({
        bookings: (data ?? []).map((a) => ({
            id: a.id,
            starts_at: a.starts_at,
            status: a.status,
            service: a.appointment_type ?? null,
            deposit_pence: a.deposit_pence ?? 0,
            deposit_paid: !!a.deposit_paid,
            patient: [a.contact?.first_name, a.contact?.last_name].filter(Boolean).join(' ') || null,
            practice: a.practice?.name ?? null,
        })),
        total: count ?? 0,
        page,
        per_page: perPage,
    });
}));

router.get('/benchmark', (0, async_handler_1.asyncHandler)(async (req, res) => {
    res.json({
        // Placeholder until benchmarking partner integrates.
        industry_median_conversion: 18,
        industry_median_response_min: 30,
        org_id: req.user.organisation_id,
        note: 'Industry benchmarks placeholder — Phase 7 wires real provider',
    });
}));

// Live ad spend & performance from connected marketing providers (Google Ads
// now; Meta Ads next), read from ad_metrics. Org-scoped; window-aware via
// ?from=&to= (else 30-day rolling). NOTE: ad spend is account-level, not
// practice-attributed (ad_metrics.practice_id is null), so practice_id is
// intentionally ignored here. Returns per-provider totals, per-campaign rows,
// a daily spend series for charting, and overall totals. All money in pence.
router.get('/marketing/ad-spend', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { fromISO, toISO } = resolveWindow(req.query);
    const fromDate = fromISO.slice(0, 10);
    const toDate = (toISO ?? new Date().toISOString()).slice(0, 10);

    const orgId = req.user.organisation_id;
    const { ids: accountIds } = await resolveAdAccountFilter(orgId, req.query);

    let q = supabase_1.serviceClient.from('ad_metrics')
        .select('provider, customer_id, campaign_id, campaign_name, campaign_status, objective, metric_date, spend_pence, impressions, clicks, reach, frequency, leads, conversions')
        .eq('organisation_id', orgId)
        .gte('metric_date', fromDate)
        .lte('metric_date', toDate);
    // Dynamic, org-isolated account filter (selected accounts, or ?account_ids=).
    if (accountIds !== null) q = q.in('customer_id', accountIds);
    const { data: rows = [] } = await q;

    // Account dimension (names/currency/status) for labelling the breakdown +
    // the selector. Org-isolated.
    const adAccounts = await integrationRepository.listAdAccounts(orgId, null);
    const acctMeta = new Map(adAccounts.map((a) => [`${a.provider}::${a.customer_id}`, a]));

    const blank = () => ({ spend_pence: 0, impressions: 0, clicks: 0, reach: 0, leads: 0, conversions: 0 });
    const add = (acc, r) => {
        acc.spend_pence += r.spend_pence ?? 0;
        acc.impressions += r.impressions ?? 0;
        acc.clicks += r.clicks ?? 0;
        acc.reach += r.reach ?? 0;
        acc.leads += r.leads ?? 0;
        acc.conversions += r.conversions ?? 0;
        return acc;
    };
    // Derived rate fields. CPC/CPL/CPA/CPM in pence; CTR/conv-rate as percentages.
    // frequency = impressions / reach (avg times each person saw an ad).
    const withRates = (a) => ({
        ...a,
        ctr: a.impressions ? +(a.clicks / a.impressions * 100).toFixed(2) : 0,
        cpc_pence: a.clicks ? Math.round(a.spend_pence / a.clicks) : 0,
        cpl_pence: a.leads ? Math.round(a.spend_pence / a.leads) : 0,
        cpa_pence: a.conversions ? Math.round(a.spend_pence / a.conversions) : 0,
        cpm_pence: a.impressions ? Math.round(a.spend_pence / a.impressions * 1000) : 0,
        frequency: a.reach ? +(a.impressions / a.reach).toFixed(2) : 0,
        conversion_rate: a.clicks ? +(a.conversions / a.clicks * 100).toFixed(2) : 0,
    });

    const byProvider = new Map();
    const byAccount = new Map();
    const byCampaign = new Map();
    const byDate = new Map();
    const totals = blank();
    for (const r of rows) {
        add(totals, r);
        add(byProvider.get(r.provider) ?? byProvider.set(r.provider, blank()).get(r.provider), r);
        const ak = `${r.provider}::${r.customer_id ?? 'unknown'}`;
        if (!byAccount.has(ak)) {
            const m = acctMeta.get(ak);
            byAccount.set(ak, { provider: r.provider, customer_id: r.customer_id, name: m?.name ?? null, currency: m?.currency ?? null, status: m?.status ?? null, ...blank() });
        }
        add(byAccount.get(ak), r);
        const ck = `${r.provider}::${r.campaign_id ?? 'unknown'}`;
        if (!byCampaign.has(ck)) byCampaign.set(ck, { provider: r.provider, customer_id: r.customer_id, campaign_id: r.campaign_id, campaign_name: r.campaign_name, campaign_status: r.campaign_status, objective: r.objective, ...blank() });
        add(byCampaign.get(ck), r);
        const dk = r.metric_date;
        if (!byDate.has(dk)) byDate.set(dk, { date: dk, ...blank() });
        add(byDate.get(dk), r);
    }

    res.json({
        connected: rows.length > 0,
        window: { from: fromDate, to: toDate },
        account_filter: accountIds, // null = all; [] = none; [...] = explicit
        totals: withRates(totals),
        channels: Array.from(byProvider.entries())
            .map(([provider, a]) => ({ provider, ...withRates(a) }))
            .sort((x, y) => y.spend_pence - x.spend_pence),
        accounts: Array.from(byAccount.values())
            .map(withRates)
            .sort((x, y) => y.spend_pence - x.spend_pence),
        campaigns: Array.from(byCampaign.values())
            .map(withRates)
            .sort((x, y) => y.spend_pence - x.spend_pence),
        daily: Array.from(byDate.values()).sort((x, y) => x.date.localeCompare(y.date)),
    });
}));

// Marketing ROI — the cross-cut that turns raw ad spend into decisions. Joins
// ad_metrics (spend/impressions/clicks/conversions) with leads (attributed to a
// provider by utm_source/source), contacts (new patients) and settled payments
// (revenue) over the same window. Powers Dashboard tile, Business Hub ROAS,
// Valuation LTV:CAC and Leads CPL — one source so every screen agrees.
// Org-scoped, account-level (no practice_id). All money in pence.
//
// Attribution heuristic (no campaign-id on leads yet): a lead counts toward a
// provider when its utm_source/source matches the provider's keywords.
const AD_PROVIDER_MATCH = {
    google_ads: /google|adwords|gads/i,
    meta_ads: /facebook|meta|instagram|\bfb\b|\big\b/i,
};
function attributeProvider(lead) {
    const hay = `${lead.utm_source ?? ''} ${lead.utm_medium ?? ''} ${lead.source ?? ''}`;
    for (const [provider, re] of Object.entries(AD_PROVIDER_MATCH)) {
        if (re.test(hay)) return provider;
    }
    return null;
}
router.get('/marketing/roi', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const orgId = req.user.organisation_id;
    const { fromISO, toISO } = resolveWindow(req.query);
    const fromDate = fromISO.slice(0, 10);
    const toDate = (toISO ?? new Date().toISOString()).slice(0, 10);
    const toEndISO = toISO ?? new Date().toISOString();
    // Optional per-practice scope (Practice Deep Dive). ad_metrics/leads/contacts/
    // payments all carry practice_id; business_health is org-level (baseline).
    const pid = typeof req.query.practice_id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.query.practice_id)
        ? req.query.practice_id : null;
    const withPid = (q) => (pid ? q.eq('practice_id', pid) : q);
    const { ids: accountIds } = await resolveAdAccountFilter(orgId, req.query);
    const withAccts = (q) => (accountIds !== null ? q.in('customer_id', accountIds) : q);

    const [adR, leadsR, contactsR, paymentsR, healthR] = await Promise.all([
        withAccts(withPid(supabase_1.serviceClient.from('ad_metrics')
            .select('provider, customer_id, spend_pence, impressions, clicks, reach, conversions')
            .eq('organisation_id', orgId)
            .gte('metric_date', fromDate).lte('metric_date', toDate))),
        withPid(supabase_1.serviceClient.from('leads')
            .select('source, utm_source, utm_medium, created_at')
            .eq('organisation_id', orgId)
            .gte('created_at', fromISO).lte('created_at', toEndISO)),
        withPid(supabase_1.serviceClient.from('contacts')
            .select('id, created_at')
            .eq('organisation_id', orgId)
            .gte('created_at', fromISO).lte('created_at', toEndISO)),
        withPid(supabase_1.serviceClient.from('payments')
            .select('amount_pence, status, processed_at')
            .eq('organisation_id', orgId)
            .gte('processed_at', fromISO).lte('processed_at', toEndISO)),
        supabase_1.serviceClient.from('business_health')
            .select('baseline')
            .eq('organisation_id', orgId)
            .maybeSingle(),
    ]);
    const adRows = adR.data ?? [];
    const leads = leadsR.data ?? [];
    const newPatients = (contactsR.data ?? []).length;
    const revenue_pence = (paymentsR.data ?? [])
        .filter((p) => p.status === 'settled')
        .reduce((s, p) => s + (p.amount_pence ?? 0), 0);

    const blank = () => ({ spend_pence: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0, leads: 0 });
    const byProvider = new Map();
    const byAccount = new Map();
    const totals = blank();
    for (const r of adRows) {
        const p = byProvider.get(r.provider) ?? byProvider.set(r.provider, blank()).get(r.provider);
        const ak = `${r.provider}::${r.customer_id ?? 'unknown'}`;
        const acct = byAccount.get(ak) ?? byAccount.set(ak, { provider: r.provider, customer_id: r.customer_id, ...blank() }).get(ak);
        for (const acc of [p, acct, totals]) {
            acc.spend_pence += r.spend_pence ?? 0;
            acc.impressions += r.impressions ?? 0;
            acc.clicks += r.clicks ?? 0;
            acc.reach += r.reach ?? 0;
            acc.conversions += r.conversions ?? 0;
        }
    }
    // Attribute leads to providers (and a running total of all ad-attributed leads).
    let adLeads = 0;
    for (const l of leads) {
        const p = attributeProvider(l);
        if (!p) continue;
        adLeads += 1;
        const acc = byProvider.get(p) ?? byProvider.set(p, blank()).get(p);
        acc.leads += 1;
    }
    totals.leads = adLeads;

    // Derived ratios. roas/cac/cpl are business-level (revenue & new patients
    // are not split per provider), so they live on totals only.
    const ratios = (a) => ({
        cpl_pence: a.leads ? Math.round(a.spend_pence / a.leads) : 0,
        cpa_pence: a.conversions ? Math.round(a.spend_pence / a.conversions) : 0,
        cpc_pence: a.clicks ? Math.round(a.spend_pence / a.clicks) : 0,
    });

    // Patient LTV from the saved baseline → LTV:CAC (the headline acquisition-
    // quality ratio for the Valuation screen). 0 when no baseline / no patient
    // counts, in which case the UI hides the ratio.
    const ltv_pence = formulas_1.ltvFromBaseline(healthR.data?.baseline);
    const cac_pence = newPatients ? Math.round(totals.spend_pence / newPatients) : 0;

    res.json({
        connected: adRows.length > 0,
        window: { from: fromDate, to: toDate },
        spend_pence: totals.spend_pence,
        impressions: totals.impressions,
        clicks: totals.clicks,
        conversions: totals.conversions,
        leads_from_ads: adLeads,
        total_leads: leads.length,
        new_patients: newPatients,
        revenue_pence,
        roas: totals.spend_pence ? +(revenue_pence / totals.spend_pence).toFixed(2) : 0,
        cac_pence,
        ltv_pence,
        ltv_cac_ratio: ltv_pence && cac_pence ? +(ltv_pence / cac_pence).toFixed(2) : 0,
        ...ratios(totals),
        account_filter: accountIds, // null = all; [] = none; [...] = explicit
        by_provider: Array.from(byProvider.entries())
            .map(([provider, a]) => ({ provider, ...a, ...ratios(a) }))
            .sort((x, y) => y.spend_pence - x.spend_pence),
        by_account: await (async () => {
            if (byAccount.size === 0) return [];
            const meta = new Map((await integrationRepository.listAdAccounts(orgId, null))
                .map((a) => [`${a.provider}::${a.customer_id}`, a]));
            return Array.from(byAccount.entries())
                .map(([k, a]) => ({ ...a, name: meta.get(k)?.name ?? null, currency: meta.get(k)?.currency ?? null, status: meta.get(k)?.status ?? null, ...ratios(a) }))
                .sort((x, y) => y.spend_pence - x.spend_pence);
        })(),
    });
}));

export default router;
