import { adAttributionService } from "../services/ad-attribution.service.js";
import {
    setPipelineChannelSchema, setPracticeSchema,
    performanceQuerySchema, adLeadsQuerySchema, spendQuerySchema,
} from "../models/ad-attribution.model.js";
import { adPerformanceService, CHANNEL_IDS } from "../services/ad-performance.service.js";

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
    // One channel's figures, from the SAME service its marketing page uses, so
    // the two surfaces cannot report different numbers for the same window.
    // Each channel carries its own window and practice filter deliberately —
    // Meta's deep-grain tables hold a rolling 92 days and Google's do not, so a
    // single shared window either clamps Google needlessly or clamps Facebook
    // silently.
    async channelPerformance(req, res) {
        const channel = String(req.params.channel ?? '');
        if (!CHANNEL_IDS.includes(channel)) {
            return res.status(400).json({ error: `Unknown channel: ${channel}` });
        }
        const { since, until, practice_id: practiceId } = req.query;
        if (!since || !until) return res.status(400).json({ error: 'since and until are required' });
        res.json(await adPerformanceService.channelPerformance(req.user.organisation_id, {
            channel, since: String(since), until: String(until),
            practiceId: practiceId ? String(practiceId) : null,
        }));
    },

    // The deduped cross-channel total — the one figure neither per-channel
    // report can produce, because each knows only its own channel.
    async groupTotal(req, res) {
        const { since, until, practice_id: practiceId } = req.query;
        if (!since || !until) return res.status(400).json({ error: 'since and until are required' });
        res.json(await adPerformanceService.groupTotal(req.user.organisation_id, {
            since: String(since), until: String(until),
            practiceId: practiceId ? String(practiceId) : null,
        }));
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
