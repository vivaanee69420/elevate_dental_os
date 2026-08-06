// ============================================================================
// Sheet-export controller — GHL→Dentally conversion export (owner routes).
// Thin: parse/validate, call sheetExportService, shape the response. No
// business logic. Never surfaces the integration's `secrets` field — the
// service's status()/drainOrg()/disconnect() responses already omit it.
// ============================================================================
import { z } from 'zod';
import { sheetExportService } from '../services/sheet-export.service.js';

const destinationSchema = z.object({ url: z.string().min(1) });

export const sheetExportController = {
    async status(req, res) {
        res.json(await sheetExportService.status(req.user.organisation_id));
    },
    async setDestination(req, res) {
        const { url } = destinationSchema.parse(req.body);
        res.json(await sheetExportService.setDestination(req.user.organisation_id, url));
    },
    async drain(req, res) {
        res.json(await sheetExportService.drainOrg(req.user.organisation_id, { includeNoMatch: true }));
    },
    async disconnect(req, res) {
        res.json(await sheetExportService.disconnect(req.user.organisation_id));
    },
};
