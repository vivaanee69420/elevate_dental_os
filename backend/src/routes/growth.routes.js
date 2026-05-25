// ============================================================================
// Growth routes — patient acquisition, loyalty, booking, benchmarks,
// marketing. Read-only aggregator on top of existing tables. Mounted at
// /api/growth.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as supabase_1 from "../lib/supabase.js";
const router = (0, express_1.Router)();

async function aggregate(orgId, since) {
    const [leadsR, paymentsR, contactsR] = await Promise.all([
        supabase_1.serviceClient.from('leads')
            .select('source, source_provider, status, estimated_value_pence, created_at')
            .eq('organisation_id', orgId)
            .gte('created_at', since),
        supabase_1.serviceClient.from('payments')
            .select('amount_pence, source, paid_at, status')
            .eq('organisation_id', orgId)
            .gte('paid_at', since),
        supabase_1.serviceClient.from('contacts')
            .select('id, source, created_at')
            .eq('organisation_id', orgId)
            .gte('created_at', since),
    ]);
    return { leads: leadsR.data ?? [], payments: paymentsR.data ?? [], contacts: contactsR.data ?? [] };
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
    const revenue = payments.filter((p) => p.status === 'succeeded').reduce((s, p) => s + (p.amount_pence ?? 0), 0);
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

router.get('/booking', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data } = await supabase_1.serviceClient
        .from('appointments')
        .select('id, status, starts_at')
        .eq('organisation_id', req.user.organisation_id)
        .gte('starts_at', since);
    const rows = data ?? [];
    res.json({
        booked_30d: rows.length,
        completed_30d: rows.filter((a) => a.status === 'completed').length,
        no_show_30d: rows.filter((a) => a.status === 'no_show').length,
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
