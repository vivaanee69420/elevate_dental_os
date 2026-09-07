// ============================================================================
// Paid marketing summary — one set of ad numbers, computed where the Facebook
// and Google report pages compute theirs.
//
// THE BUG. The Command Centre / Business Hub cards were built by
// /growth/marketing/roi, which counted "ad leads" like this:
//
//     const adLeadProxy = adLeads || totals.conversions;
//
// `adLeads` comes from attributeProvider(), a UTM/source regex over CRM leads —
// and this org's GoHighLevel leads carry no UTMs at all, so it is structurally
// 0 for every tenant on that path. The fallback is then a sum of
// `ad_metrics.conversions`: the AD PLATFORMS' own conversion counts, which are
// modelled, fractional, and count events rather than people.
//
// Measured live (Ashford, Jun-Aug 2026): the card read "4,692.66 ad leads" —
// a fractional lead count, which is the tell — and a cost per lead of GBP 7.33
// against GBP 34,419.64 of spend. The real figure from the ledgers the Facebook
// and Google pages already use is 735 leads (155 Google + 580 Meta), i.e.
// GBP 46.83 per lead. The card was ~6.4x too cheap and could never be
// reconciled against either report page.
//
// THE FIX is composition, not a fourth definition: ask the two report services
// for the numbers they already publish, and sum them with the SAME
// withLeadCosts()/sumPracticeRows() the pages use. A lead is whatever those
// pages say it is, so the Command Centre cannot drift from them.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const googleLeadPerformance = vi.fn();
const facebookLeadPerformance = vi.fn();
vi.mock('../src/services/google-report.service.js', () => ({
    googleReportService: { leadPerformance: (...a) => googleLeadPerformance(...a) },
}));
vi.mock('../src/services/facebook-report.service.js', () => ({
    facebookReportService: { leadPerformance: (...a) => facebookLeadPerformance(...a) },
}));

const { paidMarketingSummary } = await import('../src/services/paid-marketing.service.js');

const ORG = 'org-paid';
const WIN = { since: '2026-05-31T23:00:00.000Z', until: '2026-08-31T23:00:00.000Z' };

// practice rows in the shape both report services return them.
const row = (o) => ({
    practiceId: 'p-ash', practiceName: 'Ashford',
    spendPence: 0, impressions: 0, clicks: 0, leads: 0, booked: 0, accepted: 0,
    ...o,
});
const ok = (practices) => ({ state: 'ok', practices, total: {}, campaigns: [], leads: [] });
const notConnected = () => ({ state: 'not_connected', practices: [], total: null });

beforeEach(() => {
    googleLeadPerformance.mockReset();
    facebookLeadPerformance.mockReset();
});

describe('paidMarketingSummary', () => {
    it('sums both platforms into one lead count and one cost per lead', async () => {
        // The live Ashford figures the broken card got wrong.
        googleLeadPerformance.mockResolvedValue(ok([row({ spendPence: 926571, leads: 155, booked: 34, accepted: 27, clicks: 12536 })]));
        facebookLeadPerformance.mockResolvedValue(ok([row({ spendPence: 2515393, leads: 580, booked: 87, accepted: 9, clicks: 44483 })]));

        const s = await paidMarketingSummary(ORG, WIN);

        expect(s.connected).toBe(true);
        expect(s.total.spendPence).toBe(926571 + 2515393);
        expect(s.total.leads).toBe(735);
        expect(s.total.clicks).toBe(12536 + 44483);
        // GBP 34,419.64 / 735 = GBP 46.83 — not the GBP 7.33 the card showed.
        expect(s.total.cplPence).toBe(Math.round(3441964 / 735));
    });

    it('reports each platform separately, so a card can be read per channel', async () => {
        googleLeadPerformance.mockResolvedValue(ok([row({ spendPence: 926571, leads: 155 })]));
        facebookLeadPerformance.mockResolvedValue(ok([row({ spendPence: 2515393, leads: 580 })]));

        const s = await paidMarketingSummary(ORG, WIN);

        const g = s.providers.find((p) => p.provider === 'google_ads');
        const m = s.providers.find((p) => p.provider === 'meta_ads');
        expect(g).toMatchObject({ state: 'ok', spendPence: 926571, leads: 155 });
        expect(m).toMatchObject({ state: 'ok', spendPence: 2515393, leads: 580 });
    });

    it('a platform that is not connected contributes nothing and says so', async () => {
        // Not the same as a platform that spent nothing. Zeroing it silently
        // would make "we do not run Google" indistinguishable from "Google had
        // a quiet quarter", and the blended CPL would be right for the wrong
        // reason.
        googleLeadPerformance.mockResolvedValue(notConnected());
        facebookLeadPerformance.mockResolvedValue(ok([row({ spendPence: 2515393, leads: 580 })]));

        const s = await paidMarketingSummary(ORG, WIN);

        expect(s.connected).toBe(true);
        expect(s.total.spendPence).toBe(2515393);
        expect(s.total.leads).toBe(580);
        expect(s.providers.find((p) => p.provider === 'google_ads')).toMatchObject({ state: 'not_connected', spendPence: 0, leads: 0 });
    });

    it('is not connected at all when neither platform is', async () => {
        googleLeadPerformance.mockResolvedValue(notConnected());
        facebookLeadPerformance.mockResolvedValue(notConnected());

        const s = await paidMarketingSummary(ORG, WIN);

        expect(s.connected).toBe(false);
        expect(s.total.leads).toBe(0);
        // A cost per nothing is unknowable, not free.
        expect(s.total.cplPence).toBeNull();
    });

    it('prices a lead at null, never GBP 0.00, when there are no leads', async () => {
        // formatPence renders null as an em dash and 0 as a confident "£0.00".
        // Spend with no attributed leads is the single most misleading thing
        // this card could say.
        googleLeadPerformance.mockResolvedValue(ok([row({ spendPence: 500000, leads: 0 })]));
        facebookLeadPerformance.mockResolvedValue(notConnected());

        const s = await paidMarketingSummary(ORG, WIN);

        expect(s.total.spendPence).toBe(500000);
        expect(s.total.cplPence).toBeNull();
        expect(s.total.cpbPence).toBeNull();
        expect(s.total.cpaPence).toBeNull();
    });

    it('leaves spend that belongs to no practice out of the total, and states it', async () => {
        // ad_metrics rows whose account is unmapped land in a practiceId=null
        // bucket. On the report pages that is a visible "Unmapped" ROW the
        // reader can see; on a single card it would be invisible, and on this
        // org it is GBP 18,596.74 of a manager account's other businesses that
        // produced ZERO leads in this tenant's ledger — folding it in would
        // inflate group cost per lead by ~18% for no lead at all. Excluded from
        // the total, reported alongside it, never silently dropped.
        googleLeadPerformance.mockResolvedValue(ok([
            row({ spendPence: 926571, leads: 155 }),
            row({ practiceId: null, practiceName: null, spendPence: 1859674, leads: 0 }),
        ]));
        facebookLeadPerformance.mockResolvedValue(notConnected());

        const s = await paidMarketingSummary(ORG, WIN);

        expect(s.total.spendPence).toBe(926571);
        expect(s.unmappedSpendPence).toBe(1859674);
        expect(s.total.cplPence).toBe(Math.round(926571 / 155));
    });

    it('passes the window and practice scope through to both platforms unchanged', async () => {
        // Two report pages asked for different windows would disagree with each
        // other and with the card that sums them.
        googleLeadPerformance.mockResolvedValue(ok([]));
        facebookLeadPerformance.mockResolvedValue(ok([]));

        await paidMarketingSummary(ORG, { ...WIN, practiceId: 'p-ash' });

        const expected = [ORG, { since: WIN.since, until: WIN.until, practiceId: 'p-ash' }];
        expect(googleLeadPerformance).toHaveBeenCalledWith(...expected);
        expect(facebookLeadPerformance).toHaveBeenCalledWith(...expected);
    });

    it('survives one platform failing rather than losing the other', async () => {
        // Meta's API being down must not blank the Google numbers we do have.
        googleLeadPerformance.mockResolvedValue(ok([row({ spendPence: 926571, leads: 155 })]));
        facebookLeadPerformance.mockRejectedValue(new Error('meta exploded'));

        const s = await paidMarketingSummary(ORG, WIN);

        expect(s.total.spendPence).toBe(926571);
        expect(s.total.leads).toBe(155);
        expect(s.providers.find((p) => p.provider === 'meta_ads')).toMatchObject({ state: 'error' });
    });
});
