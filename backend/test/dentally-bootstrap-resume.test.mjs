// The Dentally first pull must survive a restart.
//
// It is an in-process job, so a deploy, an OOM or a dyno recycle kills it with
// no record beyond the rows already written — last_sync_at is only stamped on
// completion. Observed live: a deploy killed a bootstrap at 4,060 patients and
// 14,463 appointments, with payments, invoices and treatment plans never
// reached and no error recorded anywhere. The tenant was left half-filled and
// nothing would ever have finished it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supaRec } from './setup.js';
import { encryptSecret } from '../src/lib/crypto.js';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: { upsert: vi.fn(), markFailed: vi.fn(), mergeConfig: vi.fn() },
}));

const { bootstrapOnConnect } = await import('../src/lib/integrations/dentally-sync.js');
// The sweep is provider-generic now — one implementation covers Dentally and
// GoHighLevel, the two providers with a first pull long enough to be worth
// resuming.
const { resumeInterruptedImports } = await import('../src/lib/integrations/bootstrap-recovery.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

const page = (body) => ({ ok: true, status: 200, json: async () => body });
const SECRETS = encryptSecret(JSON.stringify({ apiKey: 'k' }));
const MINUTE = 60_000;

/** One site, so the bootstrap runs straight through without asking. */
function oneSiteFixture() {
    const created = [];
    supaRec.resultProvider = (q) => {
        if (q.table === 'practices' && q.op === 'insert') {
            created.push(String(q.insertVals.pms_site_id));
            return { data: null, error: null };
        }
        if (q.table === 'practices' && q.op === 'select') {
            return { data: created.map((s) => ({ id: `prac-${s}`, pms_site_id: s })), error: null };
        }
        return { data: [], error: null };
    };
    global.fetch = vi.fn(async (url) => {
        if (url.toString().includes('/patients')) {
            return page({ patients: [{ id: 'P1', site_id: 'S1' }], meta: { total_pages: 1 } });
        }
        return page({});
    });
}

const configPatches = () =>
    integrationRepository.mergeConfig.mock.calls.map((c) => c[2]);

beforeEach(() => {
    integrationRepository.mergeConfig.mockReset();
    integrationRepository.upsert.mockReset();
    integrationRepository.markFailed.mockReset();
    supaRec.resultProvider = undefined;
});

describe('bootstrap in-flight marker', () => {
    it('records the pull as in flight before running it, and clears it on success', async () => {
        oneSiteFixture();
        await bootstrapOnConnect('org-1', { secrets: SECRETS, config: {}, status: 'active' });

        const patches = configPatches();
        const started = patches.find((p) => p.bootstrap && p.bootstrap.started_at);
        expect(started).toBeTruthy();
        expect(started.bootstrap.attempts).toBe(1);
        // Cleared last, so nothing sweeps a run that finished.
        expect(patches.at(-1)).toEqual({ bootstrap: null });
    });

    it('counts attempts up, so a repeatedly dying pull can be given up on', async () => {
        oneSiteFixture();
        await bootstrapOnConnect('org-1', {
            secrets: SECRETS, status: 'active', config: { bootstrap: { started_at: 'x', attempts: 2 } },
        });
        const started = configPatches().find((p) => p.bootstrap && p.bootstrap.started_at);
        expect(started.bootstrap.attempts).toBe(3);
    });

    it('leaves the marker in place when the pull fails, so it is retried', async () => {
        supaRec.resultProvider = () => ({ data: [], error: null });
        await bootstrapOnConnect('org-1', { secrets: 'garbage', config: {} }); // no_auth
        expect(configPatches()).not.toContainEqual({ bootstrap: null });
    });
});

describe('resumeInterruptedImports', () => {
    function rows(list) {
        supaRec.resultProvider = (q) =>
            q.table === 'integrations' ? { data: list, error: null } : { data: [], error: null };
    }

    it('does NOT touch a run whose marker is still fresh', async () => {
        // The whole point: never restart a live pull underneath itself.
        rows([{
            organisation_id: 'org-live', provider: 'dentally', status: 'active', secrets: SECRETS,
            config: { bootstrap: { started_at: new Date(Date.now() - MINUTE).toISOString(), attempts: 1 } },
        }]);
        const res = await resumeInterruptedImports({ providers: ['dentally'] });
        expect(res.resumed).toBe(0);
    });

    it('ignores an organisation with no bootstrap in flight', async () => {
        rows([{
            organisation_id: 'org-done', provider: 'dentally', status: 'active',
            secrets: SECRETS, config: { history_backfilled: true },
        }]);
        expect((await resumeInterruptedImports({ providers: ['dentally'] })).resumed).toBe(0);
    });

    it('gives up after too many attempts instead of restarting on every boot', async () => {
        // A process that crashes DURING the pull would otherwise relaunch it on
        // each restart, forever, and each attempt would crash it again.
        rows([{
            organisation_id: 'org-cursed', provider: 'dentally', status: 'active', secrets: SECRETS,
            config: { bootstrap: { started_at: new Date(Date.now() - 60 * MINUTE).toISOString(), attempts: 4 } },
        }]);
        expect((await resumeInterruptedImports({ providers: ['dentally'] })).resumed).toBe(0);
    });

    it('resumes a pull whose marker went stale — the restart case', async () => {
        const stale = new Date(Date.now() - 30 * MINUTE).toISOString();
        const created = [];
        supaRec.resultProvider = (q) => {
            if (q.table === 'integrations') {
                return {
                    data: [{
                        organisation_id: 'org-dead', provider: 'dentally', status: 'active',
                        secrets: SECRETS, config: { bootstrap: { started_at: stale, attempts: 1 } },
                    }],
                    error: null,
                };
            }
            if (q.table === 'practices' && q.op === 'insert') {
                created.push(String(q.insertVals.pms_site_id));
                return { data: null, error: null };
            }
            if (q.table === 'practices' && q.op === 'select') {
                return { data: created.map((s) => ({ id: `prac-${s}`, pms_site_id: s })), error: null };
            }
            return { data: [], error: null };
        };
        global.fetch = vi.fn(async (url) => {
            if (url.toString().includes('/patients')) {
                return page({ patients: [{ id: 'P1', site_id: 'S1' }], meta: { total_pages: 1 } });
            }
            return page({});
        });

        const res = await resumeInterruptedImports({ providers: ['dentally'] });
        expect(res.resumed).toBe(1);
        expect(res.details[0].orgId).toBe('org-dead');
        // It ran the pull rather than only rewriting bookkeeping.
        expect(created).toEqual(['S1']);
    });
});

describe('the sweep covers every provider with a resumable first pull', () => {
    it('lists Dentally and GoHighLevel — the two long first pulls', async () => {
        const { RESUMABLE_PROVIDERS } = await import('../src/lib/integrations/bootstrap-recovery.js');
        // The others sync in seconds: a restart during one costs the next
        // scheduled run, not a half-filled tenant, so a Resume button there
        // would be a control with nothing to control.
        expect([...RESUMABLE_PROVIDERS].sort()).toEqual(['dentally', 'gohighlevel']);
    });
});
