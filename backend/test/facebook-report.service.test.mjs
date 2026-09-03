// The Facebook report. Its job is to be honest for ANY tenant: the figures
// gathered while designing describe one organisation, and another tenant may
// have zero ad-id coverage, a non-GBP account, or none of Meta connected at
// all.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/repositories/marketing.repository.js', () => ({
    marketingRepository: {
        metaFunnel: vi.fn(),
        campaignSpendByProvider: vi.fn(),
        adAccountsForProvider: vi.fn(),
    },
}));
vi.mock('../src/repositories/ad-grain.repository.js', () => ({
    GRAINS: ['meta_adset', 'meta_ad', 'google_adgroup', 'google_ad', 'google_keyword'],
    adGrainRepository: { rollup: vi.fn() },
}));

const { facebookReportService } = await import('../src/services/facebook-report.service.js');
const { marketingRepository } = await import('../src/repositories/marketing.repository.js');
const { adGrainRepository } = await import('../src/repositories/ad-grain.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const WIN = { since: '2026-06-01', until: '2026-08-31', practiceId: null };

beforeEach(() => {
    // adAccountsForProvider(orgId, 'meta_ads') is already provider-scoped —
    // an empty array IS "no Meta account", with no extra filtering needed.
    marketingRepository.adAccountsForProvider.mockResolvedValue([
        { customer_id: 'act1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
    ]);
    marketingRepository.campaignSpendByProvider.mockResolvedValue([
        { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 100000, impressions: 5000, clicks: 250 },
    ]);
    marketingRepository.metaFunnel.mockResolvedValue([
        { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
          leads: 10, booked: 4, attended: 2, patients: 2, new_patients: 1 },
    ]);
    adGrainRepository.rollup.mockResolvedValue([]);
});

describe('multi-tenant states', () => {
    it('reports not_connected when the org has no Meta ad account', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('not_connected');
        expect(out.rows).toEqual([]);
        expect(out.excludedAccounts).toEqual([]);
    });

    it('reports never_synced when Meta is connected but no deep rows exist', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([]);
        adGrainRepository.rollup.mockResolvedValue([]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('never_synced');
    });

    // A tenant whose GoHighLevel never sends ad_id must not get a report whose
    // only row explains a problem. Platform metrics, and a stated reason.
    it('reports no_ad_id_coverage when no lead resolves to an ad', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 40, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('no_ad_id_coverage');
        expect(out.coverage).toEqual({ leadsTotal: 40, leadsWithAdSet: 0, pct: 0 });
        expect(out.rows[0].spendPence).toBe(100000);   // platform metrics still shown
    });

    it('reports ok and each tenant its OWN coverage figure', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 30, booked: 0, attended: 0, patients: 0, new_patients: 0 },
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 10, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.state).toBe('ok');
        expect(out.coverage).toEqual({ leadsTotal: 40, leadsWithAdSet: 30, pct: 75 });
        expect(out.excludedAccounts).toEqual([]);
    });
});

describe('derived costs', () => {
    it('divides spend by the funnel counts', async () => {
        const out = await facebookReportService.campaigns(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'CMP1');
        expect(row.leads).toBe(10);
        expect(row.cplPence).toBe(10000);   // 100000 / 10
        expect(row.cpbPence).toBe(25000);   // 100000 / 4
        expect(row.cpaPence).toBe(50000);   // 100000 / 2
    });

    // A cost per nothing is unknowable, not free. 0 here would read as
    // "this campaign acquires patients for free".
    it('returns null, not 0, on a zero denominator', async () => {
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 0, booked: 0, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'CMP1');
        expect(row.cplPence).toBeNull();
        expect(row.cpbPence).toBeNull();
        expect(row.cpaPence).toBeNull();
    });

    it('returns null CTR and CPC when there were no impressions or clicks', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'X', spend_pence: 5000, impressions: 0, clicks: 0 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        const row = out.rows.find((r) => r.id === 'CMP1');
        expect(row.ctr).toBeNull();
        expect(row.cpcPence).toBeNull();
    });
});

// RULING A: ad_metrics is campaign x DAY. campaignSpendByProvider returns one
// row per campaign per day, never one row per campaign — the service must
// collapse them itself before a "campaign row" means anything.
describe('campaign spend collapsing (campaign x day -> campaign)', () => {
    it('sums several day-rows for the same campaign into one row', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 60000, impressions: 3000, clicks: 150 },
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 40000, impressions: 2000, clicks: 100 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.rows).toHaveLength(1);
        const row = out.rows[0];
        expect(row.id).toBe('CMP1');
        expect(row.name).toBe('Implants');
        expect(row.spendPence).toBe(100000);
        expect(row.impressions).toBe(5000);
        expect(row.clicks).toBe(250);
    });

    it('keeps separate campaigns separate while collapsing each one', async () => {
        marketingRepository.campaignSpendByProvider.mockResolvedValue([
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 10000, impressions: 500, clicks: 25 },
            { campaign_id: 'CMP1', campaign_name: 'Implants', spend_pence: 10000, impressions: 500, clicks: 25 },
            { campaign_id: 'CMP2', campaign_name: 'Whitening', spend_pence: 5000, impressions: 200, clicks: 10 },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.rows.map((r) => r.id).sort()).toEqual(['CMP1', 'CMP2']);
        expect(out.rows.find((r) => r.id === 'CMP1').spendPence).toBe(20000);
        expect(out.rows.find((r) => r.id === 'CMP2').spendPence).toBe(5000);
    });
});

// RULING B: adAccounts() does not select currency, and a blanket [] for
// excludedAccounts silently drops the non-GBP tenant state. Use
// adAccountsForProvider (which does carry currency) and the same currency
// guard the sync itself uses.
describe('excluded accounts', () => {
    it('surfaces a non-GBP Meta account in excludedAccounts, using the sync\'s own currency guard', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'act1', name: 'Acct', currency: 'GBP', status: 'ACTIVE' },
            { customer_id: 'act2', name: 'US Account', currency: 'USD', status: 'ACTIVE' },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.excludedAccounts).toEqual([
            { customerId: 'act2', name: 'US Account', currency: 'USD', reason: 'unsupported_currency' },
        ]);
    });

    it('does not exclude an account with a null/absent currency (treated as GBP)', async () => {
        marketingRepository.adAccountsForProvider.mockResolvedValue([
            { customer_id: 'act1', name: 'Acct', currency: null, status: 'ACTIVE' },
        ]);
        const out = await facebookReportService.campaigns(ORG, WIN);
        expect(out.excludedAccounts).toEqual([]);
    });
});

describe('ad sets', () => {
    it('separates the unidentified bucket from real ad sets', async () => {
        adGrainRepository.rollup.mockResolvedValue([
            { entity_id: 'AS1', entity_name: 'Photos 35+', parent_id: 'CMP1',
              campaign_id: 'CMP1', entity_status: null,
              spend_pence: 60000, impressions: 3000, clicks: 150, conversions: 0 },
        ]);
        marketingRepository.metaFunnel.mockResolvedValue([
            { campaign_id: 'CMP1', ad_set_id: 'AS1', ad_id: 'AD1', practice_id: null,
              leads: 6, booked: 3, attended: 1, patients: 1, new_patients: 1 },
            { campaign_id: 'CMP1', ad_set_id: null, ad_id: null, practice_id: null,
              leads: 4, booked: 1, attended: 0, patients: 0, new_patients: 0 },
        ]);
        const out = await facebookReportService.adSets(ORG, 'CMP1', WIN);
        expect(out.rows.map((r) => r.id)).toEqual(['AS1']);
        // Leads we could not place: counted, but never given spend or a cost.
        expect(out.notIdentified).toEqual({ leads: 4, booked: 1, attended: 0, patients: 0, newPatients: 0 });
    });

    it('omits the unidentified bucket entirely when coverage is complete', async () => {
        const out = await facebookReportService.adSets(ORG, 'CMP1', WIN);
        expect(out.notIdentified).toBeNull();
    });
});

describe('tenant isolation', () => {
    it('never reads without an organisation id', async () => {
        await facebookReportService.campaigns(ORG, WIN);
        for (const c of marketingRepository.adAccountsForProvider.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of marketingRepository.metaFunnel.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of marketingRepository.campaignSpendByProvider.mock.calls) expect(c[0]).toBe(ORG);
        for (const c of adGrainRepository.rollup.mock.calls) expect(c[0]).toBe(ORG);
    });

    // M2: a CRM's own labels must never decide what counts as a Meta lead.
    it('contains no attribution_source string test', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync('src/services/facebook-report.service.js', 'utf8');
        expect(src).not.toMatch(/Paid Social/i);
        expect(src).not.toMatch(/attribution_source/);
    });
});
