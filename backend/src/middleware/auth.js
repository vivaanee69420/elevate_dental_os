'use strict';

// ============================================================================
// Auth middleware — idiomatic Express (Phase A: new code, clean CJS).
//
//   authenticate         verify JWT -> load users row -> resolve effective
//                         permissions (one indexed query) -> attach req.user
//   requireRole(...r)     coarse built-in-role gate (kept for the 3 fixed
//                         roles where a permission key is meaningless)
//   requirePermission(k)  dynamic RBAC gate — checks req.user.permissions[k],
//                         the admin-configured effective map
//
// Request flow:
//
//   Bearer token ─ verifyToken ─ users row (org, role, permissions JSONB)
//        └─ permissionsService.getEffectiveForUser(org, role, overrides)
//              = catalog <- role_permissions[org,role] <- user overrides
//        └─ req.user = { id, email, organisation_id, role,
//                         permissions:{key:bool}, access_token }
//        └─ req.db = tenantClient(token)   (RLS-scoped)
//
// Org isolation is enforced by RLS (current_org_id()) + explicit
// organisation_id filters in repos; permissions never widen across orgs.
// ============================================================================

const { serviceClient, tenantClient, verifyToken } = require('../lib/supabase');
const { permissionsService } = require('../services/permissions.service');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = header.slice(7);

  try {
    const authUser = await verifyToken(token);

    // Load the matching users row (org + role + per-user overrides).
    const { data: user, error } = await serviceClient
      .from('users')
      .select('id, email, organisation_id, role, permissions')
      .eq('id', authUser.id)
      .single();

    if (error || !user) {
      return res.status(403).json({ error: 'User not found in any organisation' });
    }

    // Resolve effective permissions (one indexed query on role_permissions,
    // merged with the user's JSONB overrides). Always fresh — an owner's
    // change takes effect on this user's next request.
    let permissions = {};
    try {
      permissions = await permissionsService.getEffectiveForUser(
        user.organisation_id,
        user.role,
        user.permissions,
      );
    } catch (permErr) {
      // Fail closed: no permissions rather than accidental grant.
      req.log?.warn({ err: permErr }, 'Permission resolution failed');
      permissions = {};
    }

    req.user = {
      id: user.id,
      email: user.email,
      organisation_id: user.organisation_id,
      role: user.role,
      permissions,
      access_token: token,
    };

    // RLS-scoped client for per-request queries.
    req.db = tenantClient(token);

    // Touch last_active_at (fire-and-forget).
    serviceClient
      .from('users')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', user.id)
      .then(() => {});

    next();
  } catch (err) {
    req.log?.warn({ err }, 'Auth failed');
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Coarse built-in-role gate. Use only where a permission key is meaningless
// (e.g. "must literally be the owner"). Prefer requirePermission otherwise.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Dynamic RBAC gate. Denies unless the admin-configured effective map grants
// `permissionKey` for this user. This is the single enforcement path that
// matches the Team Permissions matrix.
function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.user || req.user.permissions?.[permissionKey] !== true) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, requirePermission };
