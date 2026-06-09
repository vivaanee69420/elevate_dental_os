
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

import { serviceClient, tenantClient, verifyToken } from '../lib/supabase.js';
import { permissionsService } from '../services/permissions.service.js';
import { defaultPermissionsForRole, resolveEffectivePermissions } from '../lib/permissions.js';

// Load the users row + that user's (org, role) role_permissions in ONE DB
// round trip via the auth_bootstrap RPC. Falls back to the original
// two-query path if the RPC is not deployed yet (migration …000010) or
// errors — so the hot path never hard-breaks on infra state. Returns
// { user, permissions } or null if no users row exists for this id.
async function loadAuthContext(authUserId, log) {
  try {
    const { data, error } = await serviceClient.rpc('auth_bootstrap', { p_uid: authUserId });
    if (error) throw error;
    const user = data?.user;
    if (!user) return null; // RPC worked, user genuinely absent.
    const permissions = resolveEffectivePermissions(
      data.role_permissions || [],
      user.permissions,
      user.role,
    );
    return { user, permissions };
  } catch (rpcErr) {
    // Fallback: RPC unavailable (pre-migration / transient). Original path.
    log?.warn({ err: rpcErr }, 'auth_bootstrap RPC unavailable; using fallback queries');
    const { data: user, error } = await serviceClient
      .from('users')
      .select('id, email, organisation_id, role, permissions, status')
      .eq('id', authUserId)
      .single();
    if (error || !user) return null;
    let permissions;
    try {
      permissions = await permissionsService.getEffectiveForUser(
        user.organisation_id,
        user.role,
        user.permissions,
      );
    } catch (permErr) {
      // Fail SAFE to code role-defaults (not empty): a DB/infra failure must
      // not silently lock an owner out of their own product. DB only ever
      // *widens or narrows* on top of these known-good code defaults.
      log?.warn({ err: permErr }, 'Permission resolution failed; using code role defaults');
      permissions = defaultPermissionsForRole(user.role, user.permissions);
    }
    return { user, permissions };
  }
}

export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = header.slice(7);

  try {
    const authUser = await verifyToken(token);

    const ctx = await loadAuthContext(authUser.id, req.log);
    if (!ctx) {
      return res.status(403).json({ error: 'User not found in any organisation' });
    }
    const { user, permissions } = ctx;

    // Approval gate (defence in depth). /auth/login already blocks these, but a
    // user could obtain a Supabase session another way (e.g. signing in against
    // Supabase directly with the anon key). Block them here too so a session
    // alone never grants /api access. Only explicit pending/rejected are
    // blocked — active, invited and any legacy NULL status pass, so this never
    // locks out existing users. (status is absent on a stale auth_bootstrap RPC
    // → undefined → falls through and allows, which is the safe default.)
    if (user.status === 'pending' || user.status === 'rejected') {
      return res.status(403).json({
        error: user.status === 'pending'
          ? 'Your account is awaiting approval.'
          : 'Your account access has been declined.',
        status: user.status,
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      organisation_id: user.organisation_id,
      role: user.role,
      permissions,
      access_token: token,
    };

    // RLS-scoped client for per-request queries. Lazy: repos use serviceClient
    // (manual org filters), so req.db is read by almost no handler — only build
    // the tenantClient if something actually touches it, saving a client
    // allocation on every request.
    let _db;
    Object.defineProperty(req, 'db', {
      configurable: true,
      enumerable: true,
      get() {
        if (!_db) _db = tenantClient(token);
        return _db;
      },
    });

    // Touch last_active_at (fire-and-forget).
    serviceClient
      .from('users')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', user.id)
      .then(
        () => {},
        (err) => req.log?.warn({ err }, 'last_active_at update failed'),
      );

    next();
  } catch (err) {
    req.log?.warn({ err }, 'Auth failed');
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Coarse built-in-role gate. Use only where a permission key is meaningless
// (e.g. "must literally be the owner"). Prefer requirePermission otherwise.
export function requireRole(...roles) {
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
export function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.user || req.user.permissions?.[permissionKey] !== true) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

