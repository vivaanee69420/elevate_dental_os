// ============================================================================
// Sheets controller — Call Reporting (Google Sheets). Parse/validate with the
// sheet.model Zod schemas, call sheetService, shape the HTTP response. No
// business logic. Row values never appear in logs.
// ============================================================================
import { sheetService } from "../services/sheet.service.js";
import * as sheet_model_1 from "../models/sheet.model.js";

export const sheetsController = {
    async status(req, res) {
        res.json(await sheetService.status(req.user.organisation_id));
    },

    async addSource(req, res) {
        const body = sheet_model_1.sheetSourceCreateSchema.parse(req.body);
        console.log(`[sheets] addSource: orgId=${req.user.organisation_id}`);
        res.json(await sheetService.addSource(req.user.organisation_id, body));
    },

    async preview(req, res) {
        const query = sheet_model_1.sheetPreviewQuerySchema.parse(req.query);
        res.json(await sheetService.preview(req.user.organisation_id, query));
    },

    async saveMapping(req, res) {
        const body = sheet_model_1.sheetMappingSchema.parse(req.body);
        console.log(`[sheets] saveMapping: orgId=${req.user.organisation_id}, tab=${body.tab_name}`);
        res.json(await sheetService.saveMapping(req.user.organisation_id, body));
    },

    async practiceMap(req, res) {
        res.json(await sheetService.listPracticeMap(req.user.organisation_id));
    },

    async setPracticeMap(req, res) {
        const body = sheet_model_1.sheetPracticeMapSetSchema.parse(req.body);
        res.json(await sheetService.setPracticeMapping(req.user.organisation_id, body));
    },

    async sync(req, res) {
        console.log(`[sheets] manual sync: orgId=${req.user.organisation_id}`);
        res.json(await sheetService.syncNow(req.user.organisation_id));
    },

    async disconnect(req, res) {
        console.log(`[sheets] disconnect: orgId=${req.user.organisation_id}`);
        res.json(await sheetService.disconnect(req.user.organisation_id));
    },

    async dashboard(req, res) {
        const query = sheet_model_1.callReportingQuerySchema.parse(req.query);
        res.json(await sheetService.dashboard(req.user.organisation_id, {
            date: query.date,
            practiceId: query.practice_id ?? null,
        }));
    },
};
