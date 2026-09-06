// ============================================================================
// Open-day controller — parse, delegate, shape. No business logic.
//
// The organisation is ALWAYS req.user.organisation_id and is never read from
// the body or query: these routes are reachable by a tenant owner rather than
// only an agency admin, so an org taken from the request would be an org the
// caller chose.
// ============================================================================
import * as zod_1 from "zod";
import { openDayService } from "../services/open-day.service.js";

const nameSchema = zod_1.z.string().trim().min(1).max(120);
// A plain YYYY-MM-DD, or explicitly cleared. Not coerced through Date: a
// timezone has no business in a calendar date the owner typed.
const dateSchema = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const createSchema = zod_1.z.object({ name: nameSchema, eventDate: dateSchema });
const updateSchema = zod_1.z.object({ name: nameSchema.optional(), eventDate: dateSchema })
    .refine((v) => v.name !== undefined || v.eventDate !== undefined, {
        message: 'Nothing to update',
    });
const campaignsSchema = zod_1.z.object({
    campaigns: zod_1.z.array(zod_1.z.object({
        campaign_id: zod_1.z.string().min(1),
        customer_id: zod_1.z.string().min(1).nullable().optional(),
    })),
});
// One campaign at a time, from the always-visible campaign list — unlike
// campaignsSchema above, which replaces a whole event's set.
const setCampaignSchema = zod_1.z.object({
    campaignId: zod_1.z.string().min(1),
    customerId: zod_1.z.string().min(1).nullable(),
    // null clears the mapping — "always-on" has exactly one representation.
    openDayId: zod_1.z.string().uuid().nullable(),
});
const pipelineSchema = zod_1.z.object({
    integrationAccountId: zod_1.z.string().uuid(),
    ghlPipelineId: zod_1.z.string().min(1),
    // null clears the mapping — "always-on" has exactly one representation.
    openDayId: zod_1.z.string().uuid().nullable(),
});

export const openDayController = {
    async list(req, res, next) {
        try {
            res.json(await openDayService.list(req.user.organisation_id));
        } catch (err) { next(err); }
    },

    async create(req, res, next) {
        try {
            const body = createSchema.parse(req.body);
            res.json(await openDayService.create(req.user.organisation_id, body));
        } catch (err) { next(err); }
    },

    async update(req, res, next) {
        try {
            const body = updateSchema.parse(req.body);
            res.json(await openDayService.update(req.user.organisation_id, req.params.id, body));
        } catch (err) { next(err); }
    },

    async remove(req, res, next) {
        try {
            res.json(await openDayService.remove(req.user.organisation_id, req.params.id));
        } catch (err) { next(err); }
    },

    async setCampaigns(req, res, next) {
        try {
            // An empty array is a valid instruction ("this event has no
            // campaigns"); a non-array is a malformed request and must fail
            // loudly rather than quietly mapping nothing.
            const { campaigns } = campaignsSchema.parse(req.body);
            res.json(await openDayService.setCampaigns(
                req.user.organisation_id, req.params.id, campaigns,
            ));
        } catch (err) { next(err); }
    },

    async setCampaign(req, res, next) {
        try {
            const body = setCampaignSchema.parse(req.body);
            res.json(await openDayService.setCampaign(req.user.organisation_id, body));
        } catch (err) { next(err); }
    },

    async setPipeline(req, res, next) {
        try {
            const body = pipelineSchema.parse(req.body);
            res.json(await openDayService.setPipeline(req.user.organisation_id, body));
        } catch (err) { next(err); }
    },
};
