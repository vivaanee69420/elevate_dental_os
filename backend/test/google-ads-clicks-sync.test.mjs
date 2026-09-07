// Google click_view sync — the gclid -> ad-group/ad/keyword lookup that gives
// a lead its ad, not just its campaign (migrations 000177 + 000178).
//
// The fixtures here are REAL SHAPES, copied from a live probe of customers
// 6110644137 / 9010336897 / 6846708190 on 2026-08-31. The two that matter are
// the PMax row (ad_group.id === '0', no adGroupAd, no keyword) and the Search
// row (resource-name strings that carry the ids after a '~').
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/repositories/google-click.repository.js', () => ({
    googleClickRepository: {
        insertChunk: vi.fn(async (_org, rows) => rows.length),
        latestClickDate: vi.fn(async () => null),
    },
}));

const { syncGoogleClicks, __test } = await import('../src/lib/integrations/google-ads-clicks-sync.js');
const { googleClickRepository } = await import('../src/repositories/google-click.repository.js');

const ORG = '11111111-1111-1111-1111-111111111111';

// A Search click: campaign, ad group, ad and keyword all present.
const SEARCH_ROW = {
    campaign: {
        resourceName: 'customers/6110644137/campaigns/22794584328',
        advertisingChannelType: 'SEARCH',
        name: '.G GEO - Dental Implants - £1500 P/M',
        id: '22794584328',
    },
    adGroup: {
        resourceName: 'customers/6110644137/adGroups/182196461723',
        id: '182196461723',
        name: 'dental implants dentist',
    },
    segments: { date: '2026-08-31' },
    clickView: {
        gclid: 'EAIaIQobChMI6PeK3_vLlgMV-ZFQBh1A5yOMEAAYASAAEgI05_D_BwE',
        adGroupAd: 'customers/6110644137/adGroupAds/182196461723~764173219615',
        keyword: 'customers/6110644137/adGroupCriteria/182196461723~2933117426',
        keywordInfo: { text: 'dental implants dentist' },
    },
};

// A Performance Max click, exactly as the API returns it: ad_group present but
// carrying the sentinel id '0', and nothing below campaign.
const PMAX_ROW = {
    campaign: {
        advertisingChannelType: 'PERFORMANCE_MAX',
        name: '.G GEO Orthodontist PMAX - £750 P/M',
        id: '24132397853',
    },
    adGroup: { id: '0' },
    segments: { date: '2026-08-31' },
    clickView: {
        gclid: 'CjwKCAjwzNTUBhAjEiwA7zcvWgQ0Pd85qR6yPebnHyF3D0zlMV6bxHOyVsM7yZB_rJ5M7npMy07u6hoCpPEQAvD_BwE',
    },
};

const batches = (...rows) => [{ results: rows }];

beforeEach(() => {
    googleClickRepository.insertChunk.mockClear();
    googleClickRepository.latestClickDate.mockClear();
    googleClickRepository.latestClickDate.mockResolvedValue(null);
});

describe('parseClicks', () => {
    it('pulls campaign, ad group, ad and keyword off a Search click', () => {
        const [row] = __test.parseClicks(batches(SEARCH_ROW), { customerId: '6110644137' });
        expect(row).toMatchObject({
            customer_id: '6110644137',
            gclid: 'EAIaIQobChMI6PeK3_vLlgMV-ZFQBh1A5yOMEAAYASAAEgI05_D_BwE',
            click_date: '2026-08-31',
            campaign_id: '22794584328',
            channel_type: 'SEARCH',
            ad_group_id: '182196461723',
            keyword_text: 'dental implants dentist',
        });
    });

    // The id lives after the '~' in a resource name; the part before it is the
    // ad group repeated. Reading the whole string as an id would store
    // something that joins to nothing.
    it('takes the ad id from after the ~ in the adGroupAd resource name', () => {
        const [row] = __test.parseClicks(batches(SEARCH_ROW), { customerId: '6110644137' });
        expect(row.ad_id).toBe('764173219615');
        expect(row.keyword_id).toBe('2933117426');
    });

    // The trap this whole file exists to pin down.
    it('treats the PMax ad_group id of "0" as no ad group at all', () => {
        const [row] = __test.parseClicks(batches(PMAX_ROW), { customerId: '6110644137' });
        expect(row.ad_group_id).toBeNull();
        expect(row.ad_id).toBeNull();
        expect(row.keyword_id).toBeNull();
        expect(row.channel_type).toBe('PERFORMANCE_MAX');
        // The campaign IS known, and that is the whole value of a PMax row.
        expect(row.campaign_id).toBe('24132397853');
    });

    it('keeps a PMax click rather than dropping it — its campaign still counts', () => {
        const rows = __test.parseClicks(batches(SEARCH_ROW, PMAX_ROW), { customerId: 'c' });
        expect(rows).toHaveLength(2);
    });

    it('drops a row with no gclid — there is nothing to join it on', () => {
        const noGclid = { ...SEARCH_ROW, clickView: { adGroupAd: SEARCH_ROW.clickView.adGroupAd } };
        expect(__test.parseClicks(batches(noGclid), { customerId: 'c' })).toHaveLength(0);
    });

    it('drops a row with no date', () => {
        const noDate = { ...SEARCH_ROW, segments: {} };
        expect(__test.parseClicks(batches(noDate), { customerId: 'c' })).toHaveLength(0);
    });
});

describe('buildClickGaql', () => {
    it('queries exactly one day — the API accepts no range on click_view', () => {
        const q = __test.buildClickGaql('2026-08-31');
        expect(q).toContain("segments.date = '2026-08-31'");
        expect(q).not.toMatch(/BETWEEN|>=/);
    });

    it('selects only fields the live API accepts', () => {
        const q = __test.buildClickGaql('2026-08-31');
        expect(q).toContain('click_view.gclid');
        expect(q).toContain('click_view.ad_group_ad');
        expect(q).toContain('click_view.keyword_info.text');
        expect(q).toContain('campaign.advertising_channel_type');
        expect(q).toContain('FROM click_view');
        // Probed and REJECTED with UNRECOGNIZED_FIELD. Asking for either one
        // fails the whole query, so this is not a harmless extra.
        expect(q).not.toContain('gbraid');
        expect(q).not.toContain('wbraid');
    });
});

describe('daysToPull', () => {
    it('walks the full window when nothing has been captured yet', () => {
        const days = __test.daysToPull(null, '2026-09-08');
        expect(days).toHaveLength(__test.CLICK_WINDOW_DAYS);
        expect(days.at(-1)).toBe('2026-09-08');
    });

    // Resuming at exactly `latest` would be wrong, and this is the test that
    // says why: a click that lands late attaches to its ORIGINAL date, so a
    // click for the 3rd arriving after we last read through the 5th is one we
    // would never see again. The re-read costs nothing (ON CONFLICT DO
    // NOTHING); missing it is permanent once the day ages out.
    it('re-pulls a few days behind what is already held, not just the newest', () => {
        const days = __test.daysToPull('2026-09-05', '2026-09-08');
        expect(days[0]).toBe('2026-09-02');
        expect(days.at(-1)).toBe('2026-09-08');
        expect(days).toHaveLength(__test.CLICK_OVERLAP_DAYS + 4);
    });

    // click_view retains 90 days. Asking for day 91 is not a smaller answer,
    // it is an error, and one that would fail every night forever.
    it('never reaches past the 90-day retention floor, however stale the table', () => {
        const days = __test.daysToPull('2020-01-01', '2026-09-08');
        expect(days).toHaveLength(__test.CLICK_WINDOW_DAYS);
    });

    it('still re-reads the overlap when the table is already current', () => {
        expect(__test.daysToPull('2026-09-08', '2026-09-08')).toEqual([
            '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08',
        ]);
    });

    // Clock skew, or a row inserted by hand. A reversed range would loop
    // forever or query dates Google has never heard of.
    it('returns nothing when the held date is ahead of the window', () => {
        expect(__test.daysToPull('2026-09-20', '2026-09-08')).toEqual([]);
    });
});

describe('syncGoogleClicks', () => {
    it('queries each account once per day and writes what it finds', async () => {
        const queryCustomer = vi.fn(async () => batches(SEARCH_ROW));
        const r = await syncGoogleClicks(ORG, {
            accessToken: 't', customerIds: ['a', 'b'], until: '2026-09-08',
            days: 2, queryCustomer,
        });
        expect(queryCustomer).toHaveBeenCalledTimes(4); // 2 accounts x 2 days
        expect(r.clicks).toBe(4);
        expect(googleClickRepository.insertChunk).toHaveBeenCalled();
    });

    // One account losing its permission must not cost the other its clicks —
    // five of this org's ten accounts answer "user doesn't have permission",
    // and that is the steady state, not an incident.
    it('keeps going when one account fails, and reports it', async () => {
        const queryCustomer = vi.fn(async (cid) => {
            if (cid === 'bad') throw new Error("User doesn't have permission to access customer.");
            return batches(SEARCH_ROW);
        });
        const r = await syncGoogleClicks(ORG, {
            accessToken: 't', customerIds: ['good', 'bad'], until: '2026-09-08',
            days: 1, queryCustomer,
        });
        expect(r.clicks).toBe(1);
        expect(r.skipped).toHaveLength(1);
        expect(r.skipped[0].customerId).toBe('bad');
    });

    // A day that throws is one day, not the run. Ninety sequential queries with
    // no per-day guard means one blip costs the other eighty-nine.
    it('loses only the failing day, not the rest of the window', async () => {
        const queryCustomer = vi.fn(async (_cid, _tok, gaql) => {
            if (gaql.includes('2026-09-07')) throw new Error('RESOURCE_EXHAUSTED');
            return batches(SEARCH_ROW);
        });
        const r = await syncGoogleClicks(ORG, {
            accessToken: 't', customerIds: ['a'], until: '2026-09-08', days: 3, queryCustomer,
        });
        expect(r.clicks).toBe(2);
        expect(r.skipped).toHaveLength(1);
    });

    it('writes nothing and asks for nothing when there are no accounts', async () => {
        const queryCustomer = vi.fn();
        const r = await syncGoogleClicks(ORG, {
            accessToken: 't', customerIds: [], until: '2026-09-08', days: 5, queryCustomer,
        });
        expect(queryCustomer).not.toHaveBeenCalled();
        expect(googleClickRepository.insertChunk).not.toHaveBeenCalled();
        expect(r.clicks).toBe(0);
    });

    it('resumes from the newest click it already holds, per account', async () => {
        googleClickRepository.latestClickDate.mockResolvedValue('2026-09-07');
        const queryCustomer = vi.fn(async () => batches(SEARCH_ROW));
        await syncGoogleClicks(ORG, {
            accessToken: 't', customerIds: ['a'], until: '2026-09-08', queryCustomer,
        });
        // The overlap plus the days since — five, not the whole 90-day window.
        expect(queryCustomer).toHaveBeenCalledTimes(__test.CLICK_OVERLAP_DAYS + 2);
    });

    it('never lets a repository write take the org id from anywhere but the caller', async () => {
        const queryCustomer = vi.fn(async () => batches(SEARCH_ROW));
        await syncGoogleClicks(ORG, {
            accessToken: 't', customerIds: ['a'], until: '2026-09-08', days: 1, queryCustomer,
        });
        for (const call of googleClickRepository.insertChunk.mock.calls) {
            expect(call[0]).toBe(ORG);
        }
    });

    it('does not call the API at all for a window of zero days', async () => {
        googleClickRepository.latestClickDate.mockResolvedValue('2026-09-30');
        const queryCustomer = vi.fn();
        const r = await syncGoogleClicks(ORG, {
            accessToken: 't', customerIds: ['a'], until: '2026-09-08', queryCustomer,
        });
        expect(queryCustomer).not.toHaveBeenCalled();
        expect(r.clicks).toBe(0);
    });
});
