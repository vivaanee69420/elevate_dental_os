import { describe, it, expect, vi, beforeEach } from 'vitest';

// auth.js builds Supabase clients at import time; test/setup.js installs a
// fake @supabase/supabase-js in the require cache so this is inert/offline.
// We exercise only the two pure route gates here.
const { requireRole, requirePermission } = await import(
  '../src/middleware/auth.js'
);

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('requirePermission', () => {
  let res;
  let next;
  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it('calls next() when the effective map grants the key', () => {
    const req = { user: { permissions: { 'finance.view': true } } };
    requirePermission('finance.view')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('403s when the key is explicitly false', () => {
    const req = { user: { permissions: { 'finance.view': false } } };
    requirePermission('finance.view')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('403s when the key is missing from the map', () => {
    const req = { user: { permissions: {} } };
    requirePermission('finance.view')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403s when there is no req.user at all', () => {
    const req = {};
    requirePermission('finance.view')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403s on a truthy-but-not-true value (strict === true)', () => {
    const req = { user: { permissions: { 'finance.view': 1 } } };
    requirePermission('finance.view')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireRole', () => {
  let res;
  let next;
  beforeEach(() => {
    res = mockRes();
    next = vi.fn();
  });

  it('allows a user whose role is in the list', () => {
    const req = { user: { role: 'owner' } };
    requireRole('owner', 'practice_manager')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('denies a user whose role is not in the list', () => {
    const req = { user: { role: 'reception' } };
    requireRole('owner')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('denies when there is no req.user', () => {
    requireRole('owner')({}, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
