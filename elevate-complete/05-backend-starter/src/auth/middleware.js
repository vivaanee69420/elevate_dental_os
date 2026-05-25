/**
 * Auth + RBAC middleware.
 *
 * Layered enforcement:
 *   1. requireAuth        — valid session
 *   2. requireMfa         — session has MFA verified within the last 12h
 *   3. requirePermission  — role can access this page
 *   4. requireOwner       — owner role only (for Wealth + Launch Control)
 */
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const audit = require('../lib/audit');

const permissionsCache = new Map();
const CACHE_TTL = 60_000;

async function loadPermissions(roleId) {
  const cached = permissionsCache.get(roleId);
  if (cached && cached.expires > Date.now()) return cached.map;
  const { rows } = await pool.query(
    'SELECT page_id, can_view, can_edit FROM permissions WHERE role_id = $1',
    [roleId]
  );
  const map = new Map(rows.map(r => [r.page_id, r]));
  permissionsCache.set(roleId, { map, expires: Date.now() + CACHE_TTL });
  return map;
}

function requireAuth(req, res, next) {
  const token = req.cookies[process.env.SESSION_COOKIE_NAME] || req.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: { code: 'unauthenticated' } });

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    req.user = claims;
    return next();
  } catch (err) {
    return res.status(401).json({ error: { code: 'session_invalid' } });
  }
}

function requireMfa(req, res, next) {
  if (!req.user?.mfa_verified) {
    return res.status(401).json({ error: { code: 'mfa_required' } });
  }
  if (req.user.mfa_verified_at && Date.now() - req.user.mfa_verified_at > 12 * 60 * 60_000) {
    return res.status(401).json({ error: { code: 'mfa_reverification_required' } });
  }
  return next();
}

function requirePermission(pageId) {
  return async (req, res, next) => {
    const perms = await loadPermissions(req.user.role_id);
    const p = perms.get(pageId);
    if (!p?.can_view) {
      await audit.log({
        organization_id: req.user.organization_id,
        actor_id: req.user.id,
        action: 'access_denied',
        object_type: 'page',
        metadata: { page_id: pageId },
        outcome: 'failure',
        ip: req.ip,
        user_agent: req.get('User-Agent')
      });
      return res.status(403).json({ error: { code: 'forbidden', message: 'Access denied' } });
    }
    return next();
  };
}

function requireOwner(req, res, next) {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ error: { code: 'owner_only' } });
  }
  return next();
}

module.exports = { requireAuth, requireMfa, requirePermission, requireOwner };
