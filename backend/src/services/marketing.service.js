// Marketing business logic: campaign performance from ad spend joined to leads.
// Money is integer pence throughout (rule 2) — never floats.
import { marketingRepository } from '../repositories/marketing.repository.js';
import { readDashboardCache, writeDashboardCache } from '../lib/dashboard-cache.js';

// Every row this service emits is campaign-tier: it is built from a campaign
// that has measured spend in the window. The channel tier (pipeline -> channel
// via ad_channel_pipelines) belongs to a later phase and is deliberately absent
// rather than stubbed — a blended number must never masquerade as a measured
// one, and a resolver that reads a field no data shape carries is worse than
// no resolver at all.

// Integer-pence division that refuses to invent a number. A campaign with
// spend and no leads has NO cost per lead — null, never Infinity or 0.
function perUnitPence(totalPence, units) {
    return units > 0 ? Math.round(totalPence / units) : null;
}

function joinSpendToLeads(spendRows, leadRows) {
    // Count PEOPLE, not lead rows: one contact sitting in several pipelines is
    // one lead. This is the same correction made in the Cockpit's matchBreakdown.
    const peopleByCampaign = new Map();   // campaign_id -> Map<contact_id, converted>
    const allPeople = new Set();

    for (const l of leadRows) {
        allPeople.add(l.contact_id);
        if (!l.ad_campaign_id) continue;
        if (!peopleByCampaign.has(l.ad_campaign_id)) peopleByCampaign.set(l.ad_campaign_id, new Map());
        const m = peopleByCampaign.get(l.ad_campaign_id);
        m.set(l.contact_id, (m.get(l.contact_id) ?? false) || l.converted);
    }

    // People the table can actually account for. A lead is attributed only if
    // its campaign id produced a ROW — carrying a campaign id whose spend falls
    // outside the window is not enough, or the person would appear in neither
    // the rows nor the unattributed count and the table would not reconcile to
    // the tiles. Invariant: sum(rows.leads) + unattributedLeads === totals.leads.
    const attributedPeople = new Set();
    const rows = spendRows.map((s) => {
        const people = peopleByCampaign.get(s.campaign_id) ?? new Map();
        const leads = people.size;
        const patients = [...people.values()].filter(Boolean).length;
        for (const contactId of people.keys()) attributedPeople.add(contactId);
        return {
            provider: s.provider,
            campaignId: s.campaign_id,
            campaignName: s.campaign_name,
            spendPence: s.spend_pence,
            impressions: s.impressions,
            clicks: s.clicks,
            platformConversions: s.conversions,
            leads,
            patients,
            costPerLeadPence: perUnitPence(s.spend_pence, leads),
            costPerPatientPence: perUnitPence(s.spend_pence, patients),
            tier: 'campaign',
        };
    }).sort((a, b) => b.spendPence - a.spendPence);

    const totals = {
        spendPence: rows.reduce((n, r) => n + r.spendPence, 0),
        impressions: rows.reduce((n, r) => n + r.impressions, 0),
        clicks: rows.reduce((n, r) => n + r.clicks, 0),
        platformConversions: rows.reduce((n, r) => n + r.platformConversions, 0),
        // Every person in the window, organic and unattributed included. Honest
        // and shown on the screen — but NOT a denominator for paid spend.
        leads: allPeople.size,
        // The people the spend actually bought, and the ones the table shows.
        attributedLeads: attributedPeople.size,
        patients: rows.reduce((n, r) => n + r.patients, 0),
        unattributedLeads: allPeople.size - attributedPeople.size,
    };
    // Both cost figures divide paid spend by the population that spend can be
    // measured against. Dividing by `leads` would charge paid spend against
    // organic enquiries and quietly understate the cost per lead, while cost per
    // patient used the attributed denominator — two different populations
    // presented side by side as if they were one.
    totals.costPerLeadPence = perUnitPence(totals.spendPence, totals.attributedLeads);
    totals.costPerPatientPence = perUnitPence(totals.spendPence, totals.patients);
    return { rows, totals };
}

// Cached for 10 minutes per org + window + practice. Ad spend is imported by
// a nightly sync and leads arrive through the GoHighLevel sync, so this payload
// simply cannot change minute to minute — and BOTH marketing screens request
// the same window, as does every practice-filter toggle the user clicks back
// and forth between. The durable (Postgres) tier is what makes the cache
// survive a deploy and be shared across instances; an in-process TTL alone
// would recompute on every restart. Cache failures log and fall through to a
// live read — a cache must never be able to break the page.
const CACHE_TTL_MS = 10 * 60 * 1000;

function cacheKey(since, until, practiceId) {
    return `marketing:perf:${since}|${until}|${practiceId ?? 'all'}`;
}

export const marketingService = {
    async campaignPerformance(orgId, { since, until, practiceId = null, refresh = false } = {}) {
        const key = cacheKey(since, until, practiceId);
        if (!refresh) {
            const cached = await readDashboardCache(orgId, key).catch(() => undefined);
            if (cached) return cached;
        }
        const [spend, leads] = await Promise.all([
            marketingRepository.campaignSpend(orgId, since, until, practiceId),
            marketingRepository.leadsByCampaign(orgId, since, until, practiceId),
        ]);
        const payload = joinSpendToLeads(spend, leads);
        await writeDashboardCache(orgId, key, payload, CACHE_TTL_MS).catch(() => {});
        return payload;
    },
};

export const __test = { joinSpendToLeads, perUnitPence, cacheKey };
