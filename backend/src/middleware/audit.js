// ============================================================================
// Audit middleware — logs all mutations to audit_log table (Express)
// Fires on res 'finish' to capture the completed response.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export function audit(req, res, next) {
    res.on('finish', () => {
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method))
            return;
        if (!req.user)
            return;
        if (res.statusCode >= 400)
            return; // don't log failures
        if (req.originalUrl.includes('/webhooks/'))
            return; // webhooks audit themselves
        // Pure-compute endpoints persist nothing — exempt so debounced slider
        // recompute (Arch #3) doesn't spam audit_log. Mark with /compute/.
        if (req.originalUrl.includes('/analytics/compute/'))
            return;
        const action = req.method === 'POST' ? 'create' :
            req.method === 'DELETE' ? 'delete' :
                'update';
        // Extract entity type from URL (e.g., /api/leads/123 -> 'lead')
        const match = req.originalUrl.match(/\/api\/([a-z_-]+)/);
        const entityType = match ? match[1].replace(/s$/, '') : 'unknown';
        // Extract entity ID if in URL
        const idMatch = req.originalUrl.match(/\/([0-9a-f-]{36})/i);
        const entityId = idMatch?.[1];
        // A handler may stamp the org the write actually LANDED in, plus the
        // marker naming who reached across to make it. An agency admin acting
        // AT HOME writes rows belonging to a sub-account (Team admin), and
        // req.agencyContext is set only while SWITCHED — so without this the
        // row files under the agency and the sub-account's own log never shows
        // that its user changed. Both fields are optional: a handler that
        // stamps nothing gets exactly the previous behaviour.
        const via = req.auditVia
            ?? (req.agencyContext
                ? {
                    home_organisation_id: req.agencyContext.homeOrgId,
                    actor_user_id: req.agencyContext.actorUserId,
                }
                : null);
        supabase_1.serviceClient
            .from('audit_log')
            .insert({
            organisation_id: req.auditOrgId ?? req.user.organisation_id,
            user_id: req.user.id,
            action,
            entity_type: entityType,
            entity_id: entityId,
            // Agency switch (A2): keep the acting org as organisation_id and
            // the real human as user_id, and mark the row so "who did this"
            // is answerable from the log alone.
            diff: via ? { via_agency: via } : undefined,
            ip_address: req.ip,
            user_agent: req.headers['user-agent'],
        })
            .then(({ error }) => {
            if (error)
                req.log?.error({ err: error }, 'Failed to write audit log');
        });
    });
    next();
}
