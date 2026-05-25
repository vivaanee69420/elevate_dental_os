import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

const { authenticate } = await import('../src/middleware/auth.js');

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function dispatch(routes) {
  return (q) => {
    const handler = routes[`${q.table}:${q.op}`];
    return handler ? handler(q) : { data: [], error: null };
  };
}

const BEARER = { headers: { authorization: 'Bearer tok' } };

beforeEach(() => {
  supaRec.authUser = null;
  supaRec.rpcProvider = undefined;
  supaRec.rpcCalls = [];
  supaRec.resultProvider = () => ({ data: [], error: null });
});

describe('authenticate', () => {
  it('401s when the Authorization header is missing', async () => {
    const res = mockRes();
    const next = vi.fn();
    await authenticate({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s when the token does not resolve a user', async () => {
    supaRec.authUser = null; // getUser -> error
    const res = mockRes();
    const next = vi.fn();
    await authenticate({ ...BEARER }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('FAST PATH: uses auth_bootstrap RPC and resolves permissions from its rows', async () => {
    supaRec.authUser = { id: 'u1' };
    // reception's code default for finance.view is FALSE; the RPC row flips it
    // to TRUE. Asserting it proves the RPC path (not the fallback) was taken.
    supaRec.rpcProvider = (fn) =>
      fn === 'auth_bootstrap'
        ? {
            data: {
              user: { id: 'u1', email: 'r@x', organisation_id: 'o1', role: 'reception', permissions: {} },
              role_permissions: [{ permission_key: 'finance.view', allowed: true }],
            },
            error: null,
          }
        : { data: null, error: null };

    const req = { ...BEARER };
    const next = vi.fn();
    await authenticate(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user.id).toBe('u1');
    expect(req.user.permissions['finance.view']).toBe(true); // from RPC row
    expect(req.user.permissions['crm.view']).toBe(true);     // reception default
    expect(supaRec.rpcCalls.some((c) => c.fn === 'auth_bootstrap')).toBe(true);
  });

  it('FALLBACK: when the RPC errors, loads the user via queries + code defaults', async () => {
    supaRec.authUser = { id: 'u2' };
    supaRec.rpcProvider = undefined; // default -> error result -> fallback
    supaRec.resultProvider = dispatch({
      'users:select': () => ({
        data: { id: 'u2', email: 'p@x', organisation_id: 'o1', role: 'practice_manager', permissions: {} },
        error: null,
      }),
      'role_permissions:select': () => ({ data: [], error: null }),
    });

    const req = { ...BEARER };
    const next = vi.fn();
    await authenticate(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user.id).toBe('u2');
    // practice_manager code defaults: crm.view true, finance.view false.
    expect(req.user.permissions['crm.view']).toBe(true);
    expect(req.user.permissions['finance.view']).toBe(false);
  });

  it('403s when the RPC succeeds but no users row exists', async () => {
    supaRec.authUser = { id: 'ghost' };
    supaRec.rpcProvider = () => ({ data: { user: null, role_permissions: [] }, error: null });
    const res = mockRes();
    const next = vi.fn();
    await authenticate({ ...BEARER }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
