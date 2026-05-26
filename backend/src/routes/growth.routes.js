// ============================================================================
// Growth routes — patient acquisition, loyalty, booking, benchmarks,
// marketing. Read-only aggregator on top of existing tables. Mounted at
// /api/growth.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as supabase_1 from "../lib/supabase.js";
import { AppError } from "../middleware/errors.js";
const router = (0, express_1.Router)();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

router.get('/loyalty', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { data } = await supabase_1.serviceClient
        .from('memberships')
        .select('id, plan_id, status, started_at')
        .eq('organisation_id', req.user.organisation_id);
    res.json({
        active: (data ?? []).filter((m) => m.status === 'active').length,
        total: (data ?? []).length,
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

export default router;
