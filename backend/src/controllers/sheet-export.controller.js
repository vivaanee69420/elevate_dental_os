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
    async activity(req, res) {
        res.json(await sheetExportService.activity(req.user.organisation_id));
    },
    async setDestination(req, res) {
        const { url } = destinationSchema.parse(req.body);
        res.json(await sheetExportService.setDestination(req.user.organisation_id, url));
    },
    async drain(req, res) {
        // Manual "Export now": re-check EVERYTHING immediately — pending rows
        // regardless of retry backoff, no_match rows regardless of the 4h gate
        // — then refresh the Status/Invoiced/Collected cells of existing rows.
        const orgId = req.user.organisation_id;
        const result = await sheetExportService.drainOrg(orgId,
            { includeNoMatch: true, ignoreBackoff: true });
        let refresh = null;
        try { refresh = await sheetExportService.refreshOrg(orgId); } catch { /* best-effort */ }
        res.json({ ...result, refreshed: refresh?.refreshed ?? 0 });
    },
    async disconnect(req, res) {
        res.json(await sheetExportService.disconnect(req.user.organisation_id));
    },
};
