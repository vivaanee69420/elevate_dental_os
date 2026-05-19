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
        const action = req.method === 'POST' ? 'create' :
            req.method === 'DELETE' ? 'delete' :
                'update';
        // Extract entity type from URL (e.g., /api/leads/123 -> 'lead')
        const match = req.originalUrl.match(/\/api\/([a-z_-]+)/);
        const entityType = match ? match[1].replace(/s$/, '') : 'unknown';
        // Extract entity ID if in URL
        const idMatch = req.originalUrl.match(/\/([0-9a-f-]{36})/i);
        const entityId = idMatch?.[1];
        supabase_1.serviceClient
            .from('audit_log')
            .insert({
            organisation_id: req.user.organisation_id,
            user_id: req.user.id,
            action,
            entity_type: entityType,
            entity_id: entityId,
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
