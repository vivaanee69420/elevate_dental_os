import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analystLock, __test } from '../src/middleware/analyst-lock.js';

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('allowed()', () => {
  const { allowed } = __test;
  it('permits the Data Room for any method', () => {
    expect(allowed('GET', '/data-room/datasets')).toBe(true);
    expect(allowed('GET', '/data-room/dentally/appointments/export.csv')).toBe(true);
    expect(allowed('POST', '/data-room/anything')).toBe(true);
  });
  it('permits GET practices and notifications only', () => {
    expect(allowed('GET', '/practices')).toBe(true);
    expect(allowed('GET', '/practices/abc')).toBe(true);
    expect(allowed('GET', '/notifications/unread')).toBe(true);
    expect(allowed('POST', '/practices')).toBe(false);
    expect(allowed('DELETE', '/notifications/1')).toBe(false);
  });
  it('denies everything else, including prefix look-alikes', () => {
    expect(allowed('GET', '/contacts')).toBe(false);
    expect(allowed('GET', '/leads')).toBe(false);
    expect(allowed('GET', '/analytics/business-hub')).toBe(false);
    expect(allowed('GET', '/data-roomx')).toBe(false);
    expect(allowed('GET', '/practicesx')).toBe(false);
  });
});

describe('analystLock middleware', () => {
  let res; let next;
  beforeEach(() => { res = mockRes(); next = vi.fn(); });

  it('passes non-analyst roles straight through, whatever the path', () => {
    for (const role of ['owner', 'practice_manager', 'reception']) {
      analystLock({ user: { role }, method: 'GET', path: '/contacts' }, res, next);
    }
    expect(next).toHaveBeenCalledTimes(3);
    expect(res.status).not.toHaveBeenCalled();
  });
  it('passes when there is no req.user (authenticate already handled it)', () => {
    analystLock({ method: 'GET', path: '/contacts' }, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
  it('lets an analyst into the Data Room and practices, 403s the rest', () => {
    analystLock({ user: { role: 'analyst' }, method: 'GET', path: '/data-room/datasets' }, res, next);
    analystLock({ user: { role: 'analyst' }, method: 'GET', path: '/practices' }, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    analystLock({ user: { role: 'analyst' }, method: 'GET', path: '/contacts' }, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
  });
});
