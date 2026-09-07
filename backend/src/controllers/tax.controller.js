// ============================================================================
// Tax controller. Parse, call, shape. The organisation is ALWAYS
// req.user.organisation_id and never a parameter — each sub-account sees only
// its own entity type, mapping and figures.
// ============================================================================
import { taxService } from "../services/tax.service.js";
import { taxSettingsSchema, liabilitySchema, taxQuerySchema } from "../models/tax.model.js";
import { londonYmd, londonDaysAgo } from "../lib/tz.js";

export const taxController = {
    async overview(req, res) {
        const q = taxQuerySchema.parse(req.query);
        res.json(await taxService.overview(req.user.organisation_id, {
            onDate: q.on ?? londonYmd(),
            practiceId: q.practice_id ?? null,
        }));
    },

    async settings(req, res) {
        res.json(await taxService.settings(req.user.organisation_id));
    },

    async saveSettings(req, res) {
        const patch = taxSettingsSchema.parse(req.body);
        res.json(await taxService.saveSettings(req.user.organisation_id, patch, req.user.id));
    },

    // The mapping list, richest first. Defaults to a rolling 12 months so the
    // owner maps what actually earns rather than what happened this week.
    async treatments(req, res) {
        const q = taxQuerySchema.parse(req.query);
        res.json(await taxService.treatments(req.user.organisation_id, {
            since: q.since ?? londonDaysAgo(365),
            until: q.until ?? londonYmd(),
            practiceId: q.practice_id ?? null,
        }));
    },

    async setLiability(req, res) {
        const body = liabilitySchema.parse(req.body);
        res.json(await taxService.setLiability(req.user.organisation_id, body, req.user.id));
    },
};
