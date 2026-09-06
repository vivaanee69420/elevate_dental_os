// Switched mutations are audited with the ACTING org (organisation_id),
// the REAL actor (user_id) and a via_agency marker in diff.
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const insert = vi.hoisted(() => vi.fn(() => ({ then: (ok) => ok({ error: null }) })));
vi.mock('../src/lib/supabase.js', () => ({
  serviceClient: { from: vi.fn(() => ({ insert })) },
}));
const { audit } = await import('../src/middleware/audit.js');

function fire(reqExtra = {}) {
  const res = new EventEmitter();
  res.statusCode = 200;
  const req = {
    method: 'POST',
    originalUrl: '/api/practices/11111111-1111-1111-1111-111111111111',
    ip: '1.2.3.4',
    headers: {},
    user: { id: 'actor-1', organisation_id: 'sub-1' },
    ...reqExtra,
  };
  audit(req, res, () => {});
  res.emit('finish');
  return insert.mock.calls.at(-1)[0];
}

describe('audit agency context', () => {
  it('stamps via_agency when switched', () => {
    const row = fire({ agencyContext: { actorUserId: 'actor-1', homeOrgId: 'agency-1' } });
    expect(row.organisation_id).toBe('sub-1');
    expect(row.user_id).toBe('actor-1');
    expect(row.diff).toEqual({ via_agency: { home_organisation_id: 'agency-1', actor_user_id: 'actor-1' } });
  });

  it('leaves diff absent when not switched', () => {
    const row = fire();
    expect(row.diff).toBeUndefined();
  });
});

// An agency admin acting AT HOME writes rows belonging to a sub-account (the
// Team admin endpoints do exactly that). req.agencyContext is set only while
// SWITCHED, so those writes used to land in the agency's own log, unmarked —
// the sub-account owner reviewing their log never saw their user change.
describe('audit handler-stamped org and marker', () => {
  it('files the row against the stamped org, marked via_agency', () => {
    const row = fire({
      user: { id: 'actor-1', organisation_id: 'agency-1' },
      auditOrgId: 'sub-9',
      auditVia: { home_organisation_id: 'agency-1', actor_user_id: 'actor-1' },
    });
    expect(row.organisation_id).toBe('sub-9');
    expect(row.user_id).toBe('actor-1');
    expect(row.diff).toEqual({
      via_agency: { home_organisation_id: 'agency-1', actor_user_id: 'actor-1' },
    });
  });

  it('a stamped marker wins over the switched-context one', () => {
    const row = fire({
      agencyContext: { actorUserId: 'actor-1', homeOrgId: 'agency-1' },
      auditOrgId: 'sub-9',
      auditVia: { home_organisation_id: 'agency-2', actor_user_id: 'actor-2' },
    });
    expect(row.organisation_id).toBe('sub-9');
    expect(row.diff).toEqual({
      via_agency: { home_organisation_id: 'agency-2', actor_user_id: 'actor-2' },
    });
  });

  it('behaves exactly as before for a caller that stamps nothing', () => {
    const row = fire();
    expect(row.organisation_id).toBe('sub-1');
    expect(row.user_id).toBe('actor-1');
    expect(row.diff).toBeUndefined();
  });
});
