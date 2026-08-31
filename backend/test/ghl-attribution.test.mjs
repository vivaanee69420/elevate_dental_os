// GHL attribution extraction. The LIST endpoint (/contacts/?locationId=) uses
// utm-prefixed keys — utmCampaignId, utmAdId — while the single-contact GET
// uses bare campaignId/adId for the same values. We read the list shape,
// because that is the response the sync already has in hand.
import { describe, it, expect } from 'vitest';
import { extractAttribution, parseGadCampaignId } from '../src/lib/integrations/ghl-attribution.js';

describe('parseGadCampaignId', () => {
    it('pulls gad_campaignid out of a landing page URL', () => {
        expect(parseGadCampaignId('https://gmdentalbarnet.dentaloffers.co.uk/orthodontist-lp/?gad_source=1&gad_campaignid=22794584316&gclid=CjwKCAjw'))
            .toBe('22794584316');
    });
    it('returns null when the parameter is absent, malformed or the URL is junk', () => {
        expect(parseGadCampaignId('https://example.com/lp?gclid=abc')).toBeNull();
        expect(parseGadCampaignId('not a url')).toBeNull();
        expect(parseGadCampaignId(null)).toBeNull();
        expect(parseGadCampaignId('')).toBeNull();
    });
    it('ignores a non-numeric campaign id rather than trusting it', () => {
        expect(parseGadCampaignId('https://e.com/?gad_campaignid=%7Bcampaignid%7D')).toBeNull();
    });
});

describe('extractAttribution', () => {
    const metaContact = { attributions: [
        { utmSessionSource: 'Social media', medium: 'instagram', isFirst: false },
        { utmSessionSource: 'Paid Social', adSource: 'facebook', medium: 'facebook',
          utmSource: 'facebook', utmCampaign: 'Dental Implant Open Day Sept 26',
          utmCampaignId: '120249721894530517', utmAdId: '120249722055010517',
          utmMedium: 'Photos | 35+ | 258K | 03/08/26', utmContent: 'AD 2', isFirst: true },
    ] };

    it('takes the FIRST-touch row, not merely the first array element', () => {
        // First touch is deliberate: a person later moved into an "Open Day"
        // pipeline must not steal credit from the ad that actually won them.
        const a = extractAttribution(metaContact);
        expect(a.ad_campaign_id).toBe('120249721894530517');
        expect(a.ad_id).toBe('120249722055010517');
        expect(a.attribution_source).toBe('Paid Social');
        expect(a.attribution_campaign_name).toBe('Dental Implant Open Day Sept 26');
        expect(a.utm_source).toBe('facebook');
    });

    it('falls back to the first element when no row is flagged isFirst', () => {
        const a = extractAttribution({ attributions: [{ utmSessionSource: 'Paid Search', utmGclid: 'Cj0KCQ' }] });
        expect(a.gclid).toBe('Cj0KCQ');
        expect(a.attribution_source).toBe('Paid Search');
    });

    it('recovers a Google campaign id from the landing page URL', () => {
        // Google Paid Search carries NO utmCampaignId — 305/305 sampled contacts
        // carried only utmGclid. The campaign id lives in the landing page URL.
        const a = extractAttribution({ attributions: [{
            utmSessionSource: 'Paid Search', utmGclid: 'CjwKCAjw',
            pageUrl: 'https://gmdentalbarnet.dentaloffers.co.uk/orthodontist-lp/?gad_source=1&gad_campaignid=22794584316&gclid=CjwKCAjw',
        }] });
        expect(a.ad_campaign_id).toBe('22794584316');
        expect(a.gclid).toBe('CjwKCAjw');
        expect(a.landing_page_url).toContain('orthodontist-lp');
    });

    it('prefers an explicit utmCampaignId over the URL parse', () => {
        const a = extractAttribution({ attributions: [{
            utmCampaignId: '111', pageUrl: 'https://e.com/?gad_campaignid=999' }] });
        expect(a.ad_campaign_id).toBe('111');
    });

    it('returns null when there is nothing to attribute', () => {
        expect(extractAttribution({})).toBeNull();
        expect(extractAttribution({ attributions: [] })).toBeNull();
        expect(extractAttribution(null)).toBeNull();
    });

    it('always returns every key, null-filled, so callers never see undefined', () => {
        const a = extractAttribution({ attributions: [{ utmSessionSource: 'Direct traffic' }] });
        for (const k of ['ad_campaign_id','ad_id','ad_set_id','gclid','landing_page_url',
                         'attribution_source','attribution_medium','attribution_campaign_name',
                         'utm_source','utm_medium','utm_campaign']) {
            expect(a).toHaveProperty(k);
            expect(a[k]).not.toBeUndefined();
        }
    });
});
