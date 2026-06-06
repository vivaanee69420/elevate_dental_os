// ============================================================================
// Practices routes — list + Dentally site-id mapping.
//   GET  /                 list practices (incl. pms_site_id) for pickers
//   PATCH /:id/pms-site-id  set/clear the Dentally site id (owner only)
// Creation happens in the setup wizard; this stays otherwise read-only.
//
// pms_site_id maps a Dentally `site_id` -> this practice so synced
// appointments/payments resolve a practice_id (NOT NULL) instead of being
// skipped (see lib/integrations/dentally-sync.js loadSiteMap).
// ============================================================================
import * as express_1 from "express";
import * as zod_1 from "zod";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as auth_1 from "../middleware/auth.js";
import * as supabase_1 from "../lib/supabase.js";
import { idParamSchema } from "../models/common.model.js";
const router = (0, express_1.Router)();

router.get('/', (0, async_handler_1.asyncHandler)(async (req, res) => {
    // kind='practice' (T2): the clinical practice list (Dentally mapping, scope
    // dropdown). Academy/Lab are separate scope options, not practices here.
    const { data, error } = await supabase_1.serviceClient
        .from('practices')
        .select('id, name, chairs, postcode, pms_site_id')
        .eq('organisation_id', req.user.organisation_id)
        .eq('kind', 'practice')
        .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    res.json({ practices: data ?? [] });
}));

const createSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120),
    pms_site_id: zod_1.z.string().trim().max(64).optional(),
    chairs: zod_1.z.number().int().min(0).optional(),
});

// Create a practice (owner). Used by setup + the "create from Dentally sites"
// flow. Guards against duplicate pms_site_id within the org (one practice per
// Dentally site).
router.post('/', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const body = createSchema.parse(req.body);
    if (body.pms_site_id) {
        const { data: existing } = await supabase_1.serviceClient
            .from('practices')
            .select('id')
            .eq('organisation_id', req.user.organisation_id)
            .eq('pms_site_id', body.pms_site_id)
            .maybeSingle();
        if (existing) return res.status(409).json({ error: 'A practice is already mapped to that site id' });
    }
    const { data, error } = await supabase_1.serviceClient
        .from('practices')
        .insert({
            organisation_id: req.user.organisation_id,
            name: body.name,
            pms_site_id: body.pms_site_id ?? null,
            ...(body.chairs != null ? { chairs: body.chairs } : {}),
        })
        .select('id, name, chairs, postcode, pms_site_id')
        .single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
}));

const pmsSiteIdSchema = zod_1.z.object({
    // Dentally site ids are short numeric/string codes; empty string clears.
    pms_site_id: zod_1.z.string().trim().max(64).nullable(),
});

router.patch('/:id/pms-site-id', (0, auth_1.requireRole)('owner'), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { pms_site_id } = pmsSiteIdSchema.parse(req.body);
    const value = pms_site_id ? pms_site_id : null; // '' -> null (clears mapping)
    const { data, error } = await supabase_1.serviceClient
        .from('practices')
        .update({ pms_site_id: value })
        .eq('id', id)
        .eq('organisation_id', req.user.organisation_id) // tenant guard (serviceClient bypasses RLS)
        .select('id, name, pms_site_id')
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Practice not found' });
    res.json(data);
}));

export default router;
