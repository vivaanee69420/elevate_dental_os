import { describe, it, expect, vi } from 'vitest';
import { runDailyWhatsappReports } from '../src/services/daily-report.service.js';

const NOW = new Date('2026-07-21T17:00:00.000Z');

describe('runDailyWhatsappReports', () => {
    it('sends for every enabled organisation', async () => {
        const send = vi.fn().mockResolvedValue({ sent: true, status: 'ok' });
        const repo = { listEnabled: vi.fn().mockResolvedValue([
            { organisationId: 'org-a', webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null },
            { organisationId: 'org-b', webhookUrl: 'https://b.test/h', enabled: true, lastSentAt: null },
        ]) };

        const res = await runDailyWhatsappReports({ now: NOW, deps: { repo, send } });

        expect(res.sent).toBe(2);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('isolates a failing organisation so the others still send', async () => {
        const send = vi.fn()
            .mockRejectedValueOnce(new Error('exploded'))
            .mockResolvedValueOnce({ sent: true, status: 'ok' });
        const repo = { listEnabled: vi.fn().mockResolvedValue([
            { organisationId: 'org-a', webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null },
            { organisationId: 'org-b', webhookUrl: 'https://b.test/h', enabled: true, lastSentAt: null },
        ]) };

        const res = await runDailyWhatsappReports({ now: NOW, deps: { repo, send } });

        expect(res.failed).toBe(1);
        expect(res.sent).toBe(1);
    });

    it('counts skips separately from failures', async () => {
        const send = vi.fn().mockResolvedValue({ sent: false, status: 'skipped', reason: 'no data' });
        const repo = { listEnabled: vi.fn().mockResolvedValue([
            { organisationId: 'org-a', webhookUrl: 'https://a.test/h', enabled: true, lastSentAt: null },
        ]) };

        const res = await runDailyWhatsappReports({ now: NOW, deps: { repo, send } });

        expect(res).toEqual({ sent: 0, skipped: 1, failed: 0 });
    });
});
