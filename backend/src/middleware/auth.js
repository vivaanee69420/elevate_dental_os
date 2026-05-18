"use strict";
// ============================================================================
// Auth middleware — validates JWT and attaches user context (Express)
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireRole = requireRole;
const supabase_1 = require("../lib/supabase");
async function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing token' });
    }
    const token = auth.slice(7);
    try {
        const authUser = await (0, supabase_1.verifyToken)(token);
        // Load the matching users row (org + role)
        const { data: user, error } = await supabase_1.serviceClient
            .from('users')
            .select('id, email, organisation_id, role')
            .eq('id', authUser.id)
            .single();
        if (error || !user) {
            return res.status(403).json({ error: 'User not found in any organisation' });
        }
        req.user = {
            id: user.id,
            email: user.email,
            organisation_id: user.organisation_id,
            role: user.role,
            access_token: token,
        };
        // Attach a tenant-scoped client for queries
        req.db = (0, supabase_1.tenantClient)(token);
        // Update last_active_at (fire-and-forget)
        supabase_1.serviceClient
            .from('users')
            .update({ last_active_at: new Date().toISOString() })
            .eq('id', user.id)
            .then(() => { });
        next();
    }
    catch (err) {
        req.log?.warn({ err }, 'Auth failed');
        return res.status(401).json({ error: 'Invalid token' });
    }
}
// Role gate helper — use as route middleware: requireRole('owner')
function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}
