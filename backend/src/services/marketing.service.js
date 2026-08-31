// Marketing business logic: attribution tiers + campaign performance.
// Money is integer pence throughout (rule 2) — never floats.
import { marketingRepository } from '../repositories/marketing.repository.js';

// Tiers are STRICTLY ORDERED. A lead that carries a campaign id never consults
// the pipeline map; the map exists only for the residue. Every figure the UI
// renders declares its tier so a blended number can never masquerade as a
// measured one.
function resolveTier(lead) {
    if (lead?.ad_campaign_id) return 'campaign';
    if (lead?.channel) return 'channel';
    return 'unattributed';
}

// Integer-pence division that refuses to invent a number. A campaign with
// spend and no leads has NO cost per lead — null, never Infinity or 0.
function perUnitPence(totalPence, units) {
    return units > 0 ? Math.round(totalPence / units) : null;
}

function joinSpendToLeads(spendRows, leadRows) {
    // Count PEOPLE, not lead rows: one contact sitting in several pipelines is
    // one lead. This is the same correction made in the Cockpit's matchBreakdown.
    const peopleByCampaign = new Map();   // campaign_id -> Map<contact_id, converted>
    let unattributedPeople = new Set();
    const allPeople = new Set();

    for (const l of leadRows) {
        allPeople.add(l.contact_id);
        if (!l.ad_campaign_id) { unattributedPeople.add(l.contact_id); continue; }
        if (!peopleByCampaign.has(l.ad_campaign_id)) peopleByCampaign.set(l.ad_campaign_id, new Map());
        const m = peopleByCampaign.get(l.ad_campaign_id);
        m.set(l.contact_id, (m.get(l.contact_id) ?? false) || l.converted);
    }

    const rows = spendRows.map((s) => {
        const people = peopleByCampaign.get(s.campaign_id) ?? new Map();
        const leads = people.size;
        const patients = [...people.values()].filter(Boolean).length;
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
        leads: allPeople.size,
        patients: rows.reduce((n, r) => n + r.patients, 0),
        unattributedLeads: unattributedPeople.size,
    };
    totals.costPerLeadPence = perUnitPence(totals.spendPence, totals.leads);
    totals.costPerPatientPence = perUnitPence(totals.spendPence, totals.patients);
    return { rows, totals };
}

export const marketingService = {
    async campaignPerformance(orgId, { since, until, practiceId = null } = {}) {
        const [spend, leads] = await Promise.all([
            marketingRepository.campaignSpend(orgId, since, until, practiceId),
            marketingRepository.leadsByCampaign(orgId, since, until, practiceId),
        ]);
        return joinSpendToLeads(spend, leads);
    },
};

export const __test = { resolveTier, joinSpendToLeads, perUnitPence };
