import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analystLock, __test } from '../src/middleware/analyst-lock.js';

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

// The analyst's code default. data.export is the only key the role holds
// before an owner grants anything in the Team Permissions matrix.
const BASE = { 'data.export': true };
const analyst = (permissions, method, path) => ({ user: { role: 'analyst', permissions }, method, path });

describe('allowed()', () => {
  const { allowed } = __test;

  it('permits the Data Room for any method when the analyst holds data.export', () => {
    expect(allowed('GET', '/data-room/datasets', BASE)).toBe(true);
    expect(allowed('GET', '/data-room/dentally/appointments/export.csv', BASE)).toBe(true);
    expect(allowed('POST', '/data-room/anything', BASE)).toBe(true);
  });

  // The lock is a permission gate now, not a path allowlist: revoking the key
  // has to actually close the door, or "revoke" is a lie.
  it('closes the Data Room when data.export has been revoked', () => {
    expect(allowed('GET', '/data-room/datasets', { 'data.export': false })).toBe(false);
    expect(allowed('GET', '/data-room/datasets', {})).toBe(false);
  });

  it('permits GET practices and notifications unconditionally (shell infrastructure)', () => {
    expect(allowed('GET', '/practices', {})).toBe(true);
    expect(allowed('GET', '/practices/abc', {})).toBe(true);
    expect(allowed('GET', '/notifications/unread', {})).toBe(true);
    expect(allowed('POST', '/practices', {})).toBe(false);
    expect(allowed('DELETE', '/notifications/1', {})).toBe(false);
  });

  // The regression this middleware caused: an owner granted operations.view,
  // the tab appeared, and every request behind it still 403'd here because the
  // lock never looked at permissions.
  it('opens Operations once the owner grants operations.view', () => {
    const granted = { ...BASE, 'operations.view': true };
    for (const p of ['/appointments', '/associates', '/staff', '/chair-utilisation', '/treatments']) {
      expect(allowed('GET', p, BASE)).toBe(false);
      expect(allowed('GET', p, granted)).toBe(true);
    }
  });

  it('keeps payroll on its own key, so operations.view does not open pay runs', () => {
    expect(allowed('GET', '/pay-runs', { ...BASE, 'operations.view': true })).toBe(false);
    expect(allowed('GET', '/pay-runs', { ...BASE, 'payrun.manage': true })).toBe(true);
  });

  it('opens the Overview surfaces on their own keys', () => {
    expect(allowed('GET', '/tasks', BASE)).toBe(false);
    expect(allowed('GET', '/tasks', { 'overview.view': true })).toBe(true);
    expect(allowed('POST', '/p4g-ai/chat', { 'overview.view': true })).toBe(true);
    expect(allowed('GET', '/analytics/business-hub', BASE)).toBe(false);
    expect(allowed('GET', '/analytics/business-hub', { 'finance.view': true })).toBe(true);
    expect(allowed('GET', '/cockpit', { 'finance.view': true })).toBe(true);
  });

  // Deny-by-default is the whole point: a router with no gate of its own must
  // stay unreachable no matter what the analyst has been granted.
  it('still denies unlisted prefixes even with broad permissions', () => {
    const broad = { 'data.export': true, 'operations.view': true, 'finance.view': true, 'crm.view': true, 'system.manage': true };
    expect(allowed('GET', '/contacts', broad)).toBe(false);
    expect(allowed('GET', '/leads', broad)).toBe(false);
    expect(allowed('GET', '/integrations', broad)).toBe(false);
    expect(allowed('GET', '/comms', broad)).toBe(false);
  });

  it('does not match prefix look-alikes', () => {
    expect(allowed('GET', '/data-roomx', BASE)).toBe(false);
    expect(allowed('GET', '/practicesx', {})).toBe(false);
    expect(allowed('GET', '/appointmentsx', { 'operations.view': true })).toBe(false);
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
    analystLock(analyst(BASE, 'GET', '/data-room/datasets'), res, next);
    analystLock(analyst(BASE, 'GET', '/practices'), res, next);
    expect(next).toHaveBeenCalledTimes(2);
    analystLock(analyst(BASE, 'GET', '/contacts'), res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
  });

  it('lets a granted analyst reach Appointments — the reported bug', () => {
    analystLock(analyst({ ...BASE, 'operations.view': true }, 'GET', '/appointments'), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
