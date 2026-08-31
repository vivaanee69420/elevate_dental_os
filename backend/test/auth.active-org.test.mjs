// Multi-org membership: authenticate honours x-active-org ONLY when the caller
// actually holds a membership for it. Unlike the agency switch (which grants
// access to an org you are NOT a member of, and so needs a signed token), this
// is authorised by the membership table itself — but that means the table must
// be consulted on every request and the header never trusted on its own.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn(async () => null), getAgencyOrgId: vi.fn(async () => null) },
}));

const { authenticate } = await import('../src/middleware/auth.js');

const AUTH_UID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const HOME = 'a0000000-0000-0000-0000-000000000001';
const OTHER = 'a0000000-0000-0000-0000-000000000002';
const STRANGER = 'a0000000-0000-0000-0000-0000000000ff';

function stub({ memberships }) {
  supaRec.authUser = { id: AUTH_UID };
  supaRec.rpcProvider = (fn) =>
    fn === 'auth_bootstrap'
      ? {
          data: {
            user: {
              id: AUTH_UID, email: 'o@a.dev', organisation_id: HOME, role: 'owner',
              permissions: {}, status: 'active', is_agency_admin: false,
            },
            role_permissions: [],
            memberships,
          },
          error: null,
        }
      : { data: null, error: { message: 'not stubbed' } };
}

function run(headers = {}) {
  const req = { headers: { authorization: 'Bearer t', ...headers }, log: { warn: vi.fn(), debug: vi.fn() } };
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  return new Promise((resolve) => authenticate(req, res, () => resolve({ req, res })));
}

beforeEach(() => {
  supaRec.resultProvider = () => ({ data: [], error: null });
  stub({
    memberships: [
      { organisation_id: HOME, name: 'Home', role: 'owner', permissions: {} },
      { organisation_id: OTHER, name: 'Other', role: 'practice_manager', permissions: { 'crm.view': true } },
    ],
  });
});

describe('authenticate active-org', () => {
  it('acts in the home org with no header', async () => {
    const { req } = await run();
    expect(req.user.organisation_id).toBe(HOME);
    expect(req.user.role).toBe('owner');
  });

  it('switches to another account the login is a MEMBER of', async () => {
    const { req } = await run({ 'x-active-org': OTHER });
    expect(req.user.organisation_id).toBe(OTHER);
    // The membership's own role applies there — not the home role.
    expect(req.user.role).toBe('practice_manager');
  });

  it('ignores an org the login is NOT a member of', async () => {
    const { req } = await run({ 'x-active-org': STRANGER });
    expect(req.user.organisation_id).toBe(HOME);
    expect(req.user.role).toBe('owner');
  });

  it('ignores a malformed header rather than failing the request', async () => {
    const { req } = await run({ 'x-active-org': 'not-a-uuid' });
    expect(req.user.organisation_id).toBe(HOME);
  });

  it('exposes the reachable accounts for the picker', async () => {
    const { req } = await run();
    expect(req.user.accounts).toEqual([
      { id: HOME, name: 'Home', role: 'owner' },
      { id: OTHER, name: 'Other', role: 'practice_manager' },
    ]);
  });

  it('falls back to the home org when the login has no memberships at all', async () => {
    stub({ memberships: [] });
    const { req } = await run({ 'x-active-org': OTHER });
    expect(req.user.organisation_id).toBe(HOME);
  });
});
