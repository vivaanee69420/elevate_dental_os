import { adAttributionService } from "../services/ad-attribution.service.js";
import {
    setPipelineChannelSchema, setPracticeSchema,
    performanceQuerySchema, adLeadsQuerySchema, spendQuerySchema,
} from "../models/ad-attribution.model.js";

export const adAttributionController = {
    async config(req, res) {
        res.json(await adAttributionService.getConfig(req.user.organisation_id));
    },
    async mappingHealth(req, res) {
        res.json(await adAttributionService.getMappingHealth(req.user.organisation_id));
    },
    async setPipelineChannel(req, res) {
        const { channel } = setPipelineChannelSchema.parse(req.body);
        res.json(await adAttributionService.setPipelineChannel(
            req.user.organisation_id, req.params.accountId, req.params.pipelineId, channel,
        ));
    },
    async setSubaccountPractice(req, res) {
        const { practice_id } = setPracticeSchema.parse(req.body);
        res.json(await adAttributionService.setSubaccountPractice(
            req.user.organisation_id, req.params.id, practice_id,
        ));
    },
    async setAdAccountPractice(req, res) {
        const { practice_id } = setPracticeSchema.parse(req.body);
        res.json(await adAttributionService.setAdAccountPractice(
            req.user.organisation_id, req.params.id, practice_id,
        ));
    },
    async performance(req, res) {
        const q = performanceQuerySchema.parse(req.query);
        res.json(await adAttributionService.getPerformance(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId: q.practice_id,
        }));
    },
    async leads(req, res) {
        const q = adLeadsQuerySchema.parse(req.query);
        res.json(await adAttributionService.getLeads(req.user.organisation_id, {
            since: q.since, until: q.until, channel: q.channel,
            practiceId: q.practice_id, limit: q.limit,
        }));
    },
    async spend(req, res) {
        const q = spendQuerySchema.parse(req.query);
        res.json(await adAttributionService.getSpend(req.user.organisation_id, {
            since: q.since, until: q.until, practiceId: q.practice_id,
        }));
    },
};
