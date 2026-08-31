// Pure extractors for GoHighLevel ad attribution. No I/O, so the poll path and
// the webhook path map identically — the precedent set by contactRow.
//
// FIELD NAMES MATTER: the /contacts/ LIST response uses utm-prefixed keys
// (utmCampaignId, utmAdId, utmGclid); the single-contact GET uses bare
// campaignId/adId for the same values. The sync reads the list, so we read the
// list shape. A reader written against the single-GET shape silently finds
// nothing on every contact.

// Google Paid Search leads carry no campaign id, only a click id — but the
// campaign id is present in the landing page URL that Google built:
//   .../orthodontist-lp/?gad_source=1&gad_campaignid=22794584316&gclid=...
// Only a numeric id is accepted: unexpanded ValueTrack templates arrive
// literally as "{campaignid}" and must never be stored as a campaign.
export function parseGadCampaignId(url) {
    if (!url) return null;
    let parsed;
    try { parsed = new URL(String(url)); } catch { return null; }
    const raw = parsed.searchParams.get('gad_campaignid');
    return raw && /^\d+$/.test(raw) ? raw : null;
}

const EMPTY = {
    ad_campaign_id: null, ad_id: null, ad_set_id: null, gclid: null,
    landing_page_url: null, attribution_source: null, attribution_medium: null,
    attribution_campaign_name: null, utm_source: null, utm_medium: null, utm_campaign: null,
};

const clean = (v) => (v === undefined || v === '' ? null : v ?? null);

// Pick the first-touch attribution row. A contact accumulates several — GHL
// flags them isFirst/isLast — and first touch is the project-wide rule
// (cockpit_accepted_lead_source does the same): otherwise a patient later moved
// into an "Open Day" pipeline steals credit from the ad that won them.
export function extractAttribution(contact) {
    const rows = contact?.attributions;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const a = rows.find((r) => r?.isFirst === true) ?? rows[0];
    if (!a) return null;
    const landing = clean(a.pageUrl ?? a.url);
    return {
        ...EMPTY,
        // Meta supplies the campaign id directly; Google only via the URL.
        ad_campaign_id: clean(a.utmCampaignId) ?? parseGadCampaignId(landing),
        ad_id: clean(a.utmAdId),
        ad_set_id: clean(a.adSetId),
        gclid: clean(a.utmGclid),
        landing_page_url: landing,
        attribution_source: clean(a.utmSessionSource),
        attribution_medium: clean(a.medium),
        attribution_campaign_name: clean(a.utmCampaign),
        utm_source: clean(a.utmSource),
        utm_medium: clean(a.utmMedium),
        utm_campaign: clean(a.utmCampaign),
    };
}
