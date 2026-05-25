// ============================================================================
// Wealth routes — net worth, FIRE projection, pensions, property snapshot.
// Owner-only. Data lives on business_health.baseline jsonb until a richer
// wealth schema arrives.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as supabase_1 from "../lib/supabase.js";
const router = (0, express_1.Router)();

router.get('/net', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { data } = await supabase_1.serviceClient
        .from('business_health')
        .select('baseline, targets')
        .eq('organisation_id', req.user.organisation_id)
        .maybeSingle();
    const b = data?.baseline ?? {};
    res.json({
        assets: b.assets ?? 0,
        liabilities: b.liabilities ?? 0,
        net_worth: (b.assets ?? 0) - (b.liabilities ?? 0),
    });
}));

router.get('/fire', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { data } = await supabase_1.serviceClient
        .from('business_health')
        .select('baseline, targets')
        .eq('organisation_id', req.user.organisation_id)
        .maybeSingle();
    const t = data?.targets ?? {};
    const b = data?.baseline ?? {};
    res.json({
        fire_target_pence: (t.fire_target ?? 0) * 100,
        current_savings_pence: (b.savings ?? 0) * 100,
        years_to_fire: t.years_to_fire ?? null,
    });
}));

router.get('/pension', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    res.json({ note: 'pension snapshot — wire pension provider OAuth in Phase 7' });
}));

router.get('/property', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    res.json({ note: 'property snapshot — wire property valuation provider in Phase 7' });
}));

export default router;
