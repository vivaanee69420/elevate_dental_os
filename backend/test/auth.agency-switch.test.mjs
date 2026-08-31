// authenticate + x-agency-switch: only a valid, user-bound token whose target
// is a child of the caller's agency org swaps the acting context. Every
// failure mode silently falls back to home context (never a 401/403 — the
// cookie may simply be stale).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supaRec } from './setup.js';

vi.mock('../src/services/org-meta.service.js', () => ({
  orgMetaService: { getOrgMeta: vi.fn(), getAgencyOrgId: vi.fn() },
}));

const { orgMetaService } = await import('../src/services/org-meta.service.js');
const { authenticate } = await import('../src/middleware/auth.js');
const { signSwitchToken } = await import('../src/lib/agency-switch.js');

const AUTH_UID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const HOME = 'a0000000-0000-0000-0000-000000000001';
const SUB = 'a0000000-0000-0000-0000-000000000002';

// HOME is the agency org; the acting user holds the per-user grant unless a
// test says otherwise.
function stubUser(role = 'owner', isAgencyAdmin = true) {
  supaRec.authUser = { id: AUTH_UID };
  supaRec.rpcProvider = (fn) =>
    fn === 'auth_bootstrap'
      ? {
          data: {
            user: {
              id: AUTH_UID, email: 'o@a.dev', organisation_id: HOME, role,
              permissions: {}, status: 'active', is_agency_admin: isAgencyAdmin,
            },
            role_permissions: [],
          },
          error: null,
        }
      : { data: null, error: { message: `rpc ${fn} not stubbed` } };
}

function run(headers = {}) {
  const req = { headers: { authorization: 'Bearer t', ...headers }, log: { warn: vi.fn(), debug: vi.fn() } };
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  return new Promise((resolve) => {
    authenticate(req, res, () => resolve({ req, res }));
  });
}

const metaFor = (rows) => (id) => Promise.resolve(rows[id] ?? null);

describe('authenticate agency switch', () => {
  beforeEach(() => {
    stubUser('owner');
    supaRec.resultProvider = () => ({ data: [], error: null }); // last_active_at touch
    orgMetaService.getOrgMeta.mockReset();
    orgMetaService.getOrgMeta.mockResolvedValue(null);
    orgMetaService.getAgencyOrgId.mockReset();
    orgMetaService.getAgencyOrgId.mockResolvedValue(HOME);
  });

  it('valid token + agency grant + child target -> acts as sub-account owner', async () => {
    orgMetaService.getOrgMeta.mockImplementation(metaFor({
      [SUB]: { id: SUB, name: 'Sub', is_agency: false, parent_organisation_id: HOME },
    }));
    const { req } = await run({ 'x-agency-switch': signSwitchToken(AUTH_UID, SUB) });
    expect(req.user.organisation_id).toBe(SUB);
    expect(req.user.role).toBe('owner');
    expect(req.user.permissions).toEqual(expect.objectContaining({}));
    expect(req.agencyContext).toEqual({ actorUserId: AUTH_UID, homeOrgId: HOME });
  });

  it('token bound to a DIFFERENT user is ignored', async () => {
    const { req } = await run({ 'x-agency-switch': signSwitchToken('someone-else', SUB) });
    expect(req.user.organisation_id).toBe(HOME);
    expect(req.agencyContext).toBeUndefined();
    expect(orgMetaService.getOrgMeta).not.toHaveBeenCalled();
  });

  it('target that is not a child of home is ignored', async () => {
    orgMetaService.getOrgMeta.mockImplementation(metaFor({
      [HOME]: { id: HOME, name: 'Agency', is_agency: true, parent_organisation_id: null },
      [SUB]: { id: SUB, name: 'Other', is_agency: false, parent_organisation_id: 'a0000000-0000-0000-0000-00000000000f' },
    }));
    const { req } = await run({ 'x-agency-switch': signSwitchToken(AUTH_UID, SUB) });
    expect(req.user.organisation_id).toBe(HOME);
    expect(req.agencyContext).toBeUndefined();
  });

  it('an OWNER WITHOUT the agency grant is ignored (no lookup at all)', async () => {
    // The regression this guards: a client owner inside the agency org.
    stubUser('owner', false);
    orgMetaService.getOrgMeta.mockImplementation(metaFor({
      [SUB]: { id: SUB, name: 'Sub', is_agency: false, parent_organisation_id: HOME },
    }));
    const { req } = await run({ 'x-agency-switch': signSwitchToken(AUTH_UID, SUB) });
    expect(req.user.organisation_id).toBe(HOME);
    expect(req.user.is_agency_admin).toBe(false);
    expect(req.agencyContext).toBeUndefined();
    expect(orgMetaService.getAgencyOrgId).not.toHaveBeenCalled();
  });

  it('a granted user acting from ANOTHER org still administers the agency org', async () => {
    // is_agency_admin is per user; the admin need not sit in the agency org.
    const ELSEWHERE = 'a0000000-0000-0000-0000-0000000000ff';
    orgMetaService.getAgencyOrgId.mockResolvedValue(ELSEWHERE);
    orgMetaService.getOrgMeta.mockImplementation(metaFor({
      [SUB]: { id: SUB, name: 'Sub', is_agency: false, parent_organisation_id: ELSEWHERE },
    }));
    const { req } = await run({ 'x-agency-switch': signSwitchToken(AUTH_UID, SUB) });
    expect(req.user.organisation_id).toBe(SUB);
    expect(req.agencyContext).toEqual({ actorUserId: AUTH_UID, homeOrgId: ELSEWHERE });
  });

  it('forged/garbage token -> ignored', async () => {
    const { req } = await run({ 'x-agency-switch': 'garbage.token' });
    expect(req.user.organisation_id).toBe(HOME);
    expect(req.agencyContext).toBeUndefined();
  });

  it('no header -> plain home context', async () => {
    const { req } = await run();
    expect(req.user.organisation_id).toBe(HOME);
    expect(req.agencyContext).toBeUndefined();
  });
});
