// Choosing practices must not hold the HTTP response open for the pull.
//
// The bootstrap is a full sync that runs for minutes. The first version of
// dentallySelectSites awaited it, so the POST never came back, the button sat
// on "Starting…", and the progress overlay — which the frontend only starts
// once the POST resolves — never appeared at all. The connect path already
// carries a comment about exactly this ("UI stuck on Saving…. Fire-and-forget");
// this pins the same contract for the selection path.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/integration.repository.js', () => ({
    integrationRepository: {
        getByProvider: vi.fn(async () => ({
            provider: 'dentally',
            status: 'active',
            secrets: 'enc',
            config: {
                detected_sites: [
                    { site_id: 'S1', name: 'Rochester', count: 40 },
                    { site_id: 'S2', name: 'Ashford', count: 12 },
                ],
            },
        })),
        mergeConfig: vi.fn(),
        upsert: vi.fn(),
        markFailed: vi.fn(),
    },
}));

const { integrationService } = await import('../src/services/integration.service.js');
const { integrationRepository } = await import('../src/repositories/integration.repository.js');

beforeEach(() => {
    integrationRepository.mergeConfig.mockClear();
});

describe('dentallySelectSites', () => {
    it('returns while the pull is still running, never after it', async () => {
        // A bootstrap that never settles stands in for one that takes minutes.
        // If the service awaits it, this test times out — which is precisely
        // what the UI experienced.
        let released;
        const hanging = new Promise((r) => { released = r; });
        const spy = vi.spyOn(integrationService, 'bootstrapDentally').mockReturnValue(hanging);

        const res = await integrationService.dentallySelectSites('org-1', ['S1']);

        expect(res.started).toBe(true);
        expect(res.site_ids).toEqual(['S1']);
        expect(spy).toHaveBeenCalledWith('org-1');
        released({});
        spy.mockRestore();
    });

    it('records the choice BEFORE starting the pull, so the pull reads it', async () => {
        // Ordering matters: bootstrapOnConnect reads config.site_ids to decide
        // which practices to create. Starting the pull first would race it and
        // the run would see no selection — i.e. pull everything, the exact bug
        // this feature exists to prevent.
        const order = [];
        integrationRepository.mergeConfig.mockImplementation(async () => { order.push('config'); });
        const spy = vi.spyOn(integrationService, 'bootstrapDentally')
            .mockImplementation(async () => { order.push('pull'); });

        await integrationService.dentallySelectSites('org-1', ['S1']);

        expect(order).toEqual(['config', 'pull']);
        const patch = integrationRepository.mergeConfig.mock.calls.at(-1)[2];
        expect(patch).toEqual({ site_ids: ['S1'], awaiting_site_selection: false });
        spy.mockRestore();
    });

    it('refuses a site this Dentally login cannot see', async () => {
        const spy = vi.spyOn(integrationService, 'bootstrapDentally').mockResolvedValue({});
        await expect(integrationService.dentallySelectSites('org-1', ['S1', 'NOPE']))
            .rejects.toThrow(/Unknown Dentally site: NOPE/);
        expect(spy).not.toHaveBeenCalled();          // nothing started
        expect(integrationRepository.mergeConfig).not.toHaveBeenCalled(); // nothing recorded
        spy.mockRestore();
    });

    it('de-duplicates a repeated site rather than pulling it twice', async () => {
        const spy = vi.spyOn(integrationService, 'bootstrapDentally').mockResolvedValue({});
        const res = await integrationService.dentallySelectSites('org-1', ['S1', 'S1', 'S2']);
        expect(res.site_ids).toEqual(['S1', 'S2']);
        spy.mockRestore();
    });
});
