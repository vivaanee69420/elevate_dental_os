// ============================================================================
// platformAuthenticate — verifies the platform JWT (signed with
// PLATFORM_ADMIN_JWT_SECRET, NOT Supabase). Loads req.platformAdmin.
// requirePlatformRole(...roles) — RBAC gate for platform-side routes.
//
// IMPORTANT: a tenant Supabase JWT MUST NOT verify here (different secret),
// and a platform JWT MUST NOT verify under the tenant authenticate
// middleware (different signing key entirely). Hard auth isolation.
// ============================================================================

import jwt from 'jsonwebtoken';
import { serviceClient } from '../lib/supabase.js';
import { AppError } from './errors.js';

const JWT_ISSUER = 'elevate-platform';

function getSecret() {
  const s = process.env.PLATFORM_ADMIN_JWT_SECRET;
  if (!s || s.length < 32) {
    throw new AppError('PLATFORM_ADMIN_JWT_SECRET missing or too short', 500);
  }
  return s;
}

export async function platformAuthenticate(req, _res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return next(new AppError('Missing platform token', 401));
    }
    const token = auth.slice(7);

    let payload;
    try {
      payload = jwt.verify(token, getSecret(), { issuer: JWT_ISSUER });
    } catch {
      return next(new AppError('Invalid or expired platform token', 401));
    }

    if (payload.typ !== 'platform') {
      return next(new AppError('Wrong token type', 401));
    }

    const { data: admin, error } = await serviceClient
      .from('platform_admins')
      .select('id, email, role, must_change_password')
      .eq('id', payload.sub)
      .maybeSingle();

    if (error || !admin) return next(new AppError('Platform admin not found', 401));

    req.platformAdmin = admin;
    req.platformIp = req.ip;
    req.platformUserAgent = req.headers['user-agent'] || null;

    // Forced password reset: an admin flagged must_change_password may only
    // reach /me (to read its own state) and /change-password. Block every
    // other route server-side so a scripted call cannot skip the reset that
    // the UI enforces visually.
    if (
      admin.must_change_password &&
      !req.path.endsWith('/me') &&
      !req.path.endsWith('/change-password')
    ) {
      return next(new AppError('Password change required', 403));
    }

    next();
  } catch (err) {
    next(err);
  }
}

export function requirePlatformRole(...roles) {
  return (req, _res, next) => {
    if (!req.platformAdmin) return next(new AppError('Unauthenticated', 401));
    if (!roles.includes(req.platformAdmin.role)) {
      return next(new AppError('Forbidden', 403));
    }
    next();
  };
}
