// Finance > QuickBooks controller — parses the dashboard query and returns the
// per-company / summed payload. finance.view gated upstream in the route.
import { financeQuickbooksService } from "../services/finance-quickbooks.service.js";

export const financeQuickbooksController = {
    async overview(req, res) {
        const { accountId, period, from, to } = req.query;
        const payload = await financeQuickbooksService.getOverview(req.user.organisation_id, {
            accountId: accountId || null,
            period: period || null,
            from: from || null,
            to: to || null,
        });
        res.json(payload);
    },
};
