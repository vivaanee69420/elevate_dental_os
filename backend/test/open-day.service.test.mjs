// ============================================================================
// openDayService.setPipeline — the account-ownership guard.
//
// openDayId is already protected by the database: ad_open_day_pipelines
// carries FOREIGN KEY (organisation_id, open_day_id) referencing
// ad_open_days, so a cross-org id has no matching parent row and the insert
// fails on the constraint. integrationAccountId carries no such key, so it
// is guarded here, the same way ad-attribution.service.js's
// setPipelineChannel guards accountId.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDayRepository } from '../src/repositories/open-day.repository.js';
import { integrationAccountRepository } from '../src/repositories/integration-account.repository.js';
import { openDayService } from '../src/services/open-day.service.js';

vi.mock('../src/repositories/open-day.repository.js', () => ({
    openDayRepository: {
        setPipeline: vi.fn(),
    },
}));
vi.mock('../src/repositories/integration-account.repository.js', () => ({
    integrationAccountRepository: {
        getById: vi.fn(),
    },
}));
// Not exercised by setPipeline; mocked only so importing the service (which
// imports marketingRepository for .list()) can't reach a real client.
vi.mock('../src/repositories/marketing.repository.js', () => ({
    marketingRepository: { campaignCatalogue: vi.fn() },
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('openDayService.setPipeline', () => {
    it('refuses an integrationAccountId belonging to another org, before writing anything', async () => {
        // getById is org-scoped — a real repo call filters by organisation_id,
        // so an account from a different org simply doesn't come back.
        integrationAccountRepository.getById.mockResolvedValue(null);

        await expect(
            openDayService.setPipeline('org-a', {
                integrationAccountId: 'acc-belongs-to-org-b',
                ghlPipelineId: 'g1',
                openDayId: 'e1',
            }),
        ).rejects.toMatchObject({ statusCode: 404, message: 'Unknown subaccount' });

        expect(integrationAccountRepository.getById).toHaveBeenCalledWith('org-a', 'acc-belongs-to-org-b');
        expect(openDayRepository.setPipeline).not.toHaveBeenCalled();
    });

    it('writes the mapping once the account is confirmed to be the caller\'s own', async () => {
        integrationAccountRepository.getById.mockResolvedValue({ id: 'acc-1', organisation_id: 'org-a' });

        const args = { integrationAccountId: 'acc-1', ghlPipelineId: 'g1', openDayId: 'e1' };
        await expect(openDayService.setPipeline('org-a', args)).resolves.toEqual({ ok: true });

        expect(openDayRepository.setPipeline).toHaveBeenCalledWith('org-a', args);
    });
});
