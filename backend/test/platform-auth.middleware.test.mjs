import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { supaRec } from './setup.js';

process.env.PLATFORM_ADMIN_JWT_SECRET ||= 'a'.repeat(48);

const { platformAuthenticate, requirePlatformRole } = await import(
  '../src/middleware/platform-auth.js'
);

function mockReq(headers = {}) {
  return { headers, ip: '127.0.0.1' };
}

function mockNext() {
  return vi.fn();
}

describe('platformAuthenticate', () => {
  beforeEach(() => {
    supaRec.resultProvider = () => ({ data: null, error: null });
  });

  it('401s when Authorization header missing', async () => {
    const next = mockNext();
    await platformAuthenticate(mockReq(), {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('401s on an invalid token', async () => {
    const next = mockNext();
    await platformAuthenticate(
      mockReq({ authorization: 'Bearer not-a-jwt' }),
      {},
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('401s when token typ is not platform (rejects tenant JWTs by construction)', async () => {
    const tok = jwt.sign(
      { sub: 'u1', typ: 'tenant' },
      process.env.PLATFORM_ADMIN_JWT_SECRET,
      { issuer: 'elevate-platform' },
    );
    const next = mockNext();
    await platformAuthenticate(
      mockReq({ authorization: `Bearer ${tok}` }),
      {},
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('401s when the admin no longer exists', async () => {
    supaRec.resultProvider = () => ({ data: null, error: null });
    const tok = jwt.sign(
      { sub: 'a1', typ: 'platform' },
      process.env.PLATFORM_ADMIN_JWT_SECRET,
      { issuer: 'elevate-platform' },
    );
    const next = mockNext();
    await platformAuthenticate(
      mockReq({ authorization: `Bearer ${tok}` }),
      {},
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('attaches req.platformAdmin on success', async () => {
    supaRec.resultProvider = () => ({
      data: { id: 'a1', email: 'admin@x', role: 'superadmin', must_change_password: false },
      error: null,
    });
    const tok = jwt.sign(
      { sub: 'a1', typ: 'platform' },
      process.env.PLATFORM_ADMIN_JWT_SECRET,
      { issuer: 'elevate-platform' },
    );
    const req = mockReq({ authorization: `Bearer ${tok}` });
    req.path = '/api/platform/me';
    const next = mockNext();
    await platformAuthenticate(req, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.platformAdmin).toMatchObject({ id: 'a1', role: 'superadmin' });
  });
});

describe('platformAuthenticate — must_change_password gate', () => {
  beforeEach(() => {
    supaRec.resultProvider = () => ({
      data: { id: 'a1', email: 'admin@x', role: 'superadmin', must_change_password: true },
      error: null,
    });
  });

  function tokenReq(path) {
    const tok = jwt.sign(
      { sub: 'a1', typ: 'platform' },
      process.env.PLATFORM_ADMIN_JWT_SECRET,
      { issuer: 'elevate-platform' },
    );
    const req = mockReq({ authorization: `Bearer ${tok}` });
    req.path = path;
    return req;
  }

  it('403s a forced-reset admin on a normal route', async () => {
    const next = mockNext();
    await platformAuthenticate(tokenReq('/api/platform/orgs'), {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('allows /change-password while forced reset is pending', async () => {
    const req = tokenReq('/api/platform/change-password');
    const next = mockNext();
    await platformAuthenticate(req, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.platformAdmin).toMatchObject({ id: 'a1' });
  });

  it('allows /me so the UI can read the must_change_password flag', async () => {
    const next = mockNext();
    await platformAuthenticate(tokenReq('/api/platform/me'), {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requirePlatformRole', () => {
  it('passes when role is in the list', () => {
    const next = vi.fn();
    requirePlatformRole('superadmin')(
      { platformAdmin: { role: 'superadmin' } },
      {},
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('403s when role is not in the list', () => {
    const next = vi.fn();
    requirePlatformRole('superadmin')(
      { platformAdmin: { role: 'support' } },
      {},
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('401s when there is no platformAdmin', () => {
    const next = vi.fn();
    requirePlatformRole('superadmin')({}, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
