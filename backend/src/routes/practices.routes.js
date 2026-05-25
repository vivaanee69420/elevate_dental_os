// ============================================================================
// Practices routes — list-only endpoint so UIs can pick a practice when
// recording per-practice data (payments, leads). Read-only here; creation
// happens in setup wizard.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as supabase_1 from "../lib/supabase.js";
const router = (0, express_1.Router)();

router.get('/', (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { data, error } = await supabase_1.serviceClient
        .from('practices')
        .select('id, name, chairs, address_postcode')
        .eq('organisation_id', req.user.organisation_id)
        .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    res.json({ practices: data ?? [] });
}));

export default router;
