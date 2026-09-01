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

// Which paid channel a lead came from.
//
// Derived from live data rather than assumed (probe, 2026-09-01, 9,532
// attributed Plan4growth contacts):
//   - `gclid` and attribution_source 'Paid Search' are PERFECTLY coincident —
//     0 contacts carry one without the other — so the session source alone
//     identifies Google. That is why this needs no extra RPC column.
//   - 'Paid Social' is 3,420 contacts, of which only 2 carry a non-Meta medium.
//   - 103 contacts carry a campaign id while sitting OUTSIDE both paid buckets
//     (GoHighLevel files some booked Facebook traffic under 'Social media').
//     Rule 1 catches them, which is why it runs first.
//
// Rule 1 is definitive: a campaign id that matches a campaign we hold spend for
// names its own provider. The session source is the fallback, not the primary.
//
// Everything else — organic social, referral, direct, CRM workflows, and leads
// with no attribution at all — is 'other'. Organic Facebook traffic is NOT
// folded into paid Facebook: it cost nothing, and averaging it into the paid
// denominator would quietly flatter cost per lead.
export function resolveLeadChannel(lead, campaignProvider) {
    const viaCampaign = lead.ad_campaign_id
        ? campaignProvider.get(lead.ad_campaign_id) ?? null
        : null;
    if (viaCampaign) return viaCampaign;
    const src = (lead.attribution_source ?? '').toLowerCase();
    if (src === 'paid search') return 'google_ads';
    if (src === 'paid social') return 'meta_ads';
    return 'other';
}

const CHANNEL_ORDER = ['meta_ads', 'google_ads', 'other'];

// Per-channel performance, built LEADS-FIRST.
//
// The earlier version rolled up the campaign table, which meant a channel only
// existed if it had a campaign with spend in the window — so Barnet's 33 Google
// leads were invisible on a month where its Google account spent nothing, and
// the whole 315 read as though it were one Facebook number. Counting the leads
// themselves and attaching each channel's spend to them keeps every lead
// visible and every channel's cost honest.
//
// The 'other' row carries leads and patients but never a cost: dividing paid
// spend by organic enquiries is exactly the error the totals already avoid.
function channelSplit(spendRows, leadRows, campaignProvider) {
    const blank = () => ({
        spendPence: 0, impressions: 0, clicks: 0, platformConversions: 0,
        campaigns: 0, leads: 0, patients: 0,
    });
    const by = new Map(CHANNEL_ORDER.map((c) => [c, { channel: c, ...blank() }]));

    for (const s of spendRows) {
        const e = by.get(s.provider);
        if (!e) continue;                     // a provider we do not chart
        e.spendPence += s.spendPence;
        e.impressions += s.impressions;
        e.clicks += s.clicks;
        e.platformConversions += s.platformConversions;
        e.campaigns += 1;
    }

    for (const l of leadRows) {
        const e = by.get(resolveLeadChannel(l, campaignProvider));
        e.leads += 1;
        if (l.converted) e.patients += 1;
    }

    return CHANNEL_ORDER
        .map((c) => by.get(c))
        // Drop a channel that has neither spend nor leads — an empty Google row
        // on an account that has never run Google is noise, not information.
        .filter((e) => e.spendPence > 0 || e.leads > 0)
        .map((e) => {
            // No spend in this window means NO cost per lead — null, never
            // £0.00, which would read as "these leads were free". A channel can
            // legitimately have leads and no spend: the ads that won them ran
            // in an earlier window, or on an account nobody has mapped.
            const costed = e.channel !== 'other' && e.spendPence > 0;
            return {
                ...e,
                costPerLeadPence: costed ? perUnitPence(e.spendPence, e.leads) : null,
                costPerPatientPence: costed ? perUnitPence(e.spendPence, e.patients) : null,
            };
        });
}

// Why a practice can legitimately show no spend. £0.00 on its own is ambiguous
// — it reads as "this practice wasted no money" when the truth may be "no ad
// account is mapped to it, so none of the group's spend can be attributed
// here". The screen needs to tell those apart.
function buildCoverage(accounts, practiceId, unmappedSpendPence) {
    const mapped = accounts.filter((a) => a.practice_id);
    const unmapped = accounts.filter((a) => !a.practice_id);
    return {
        totalAccounts: accounts.length,
        mappedAccounts: mapped.length,
        unmappedAccounts: unmapped.length,
        unmappedAccountNames: unmapped.map((a) => a.name || a.customer_id),
        // Only meaningful on the group view: a practice-scoped query already
        // excludes unmapped rows, so reporting it there would be a number the
        // user cannot see in any tile.
        unmappedSpendPence: practiceId ? 0 : unmappedSpendPence,
        practiceHasMappedAccount: practiceId
            ? mapped.some((a) => a.practice_id === practiceId)
            : null,
    };
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
        // Everyone in that same population who became a patient. This MUST be
        // measured over the same people as `leads` — it previously counted only
        // campaign-matched patients while `leads` counted everybody, so the two
        // tiles sat side by side describing different populations and implied a
        // conversion rate roughly a third of the real one (Barnet, Aug 2026: 19
        // against 315 reads as 6%, when 30 of those 315 became patients).
        patients: leadRows.reduce((n, l) => n + (l.converted ? 1 : 0), 0),
        // The cost denominator: patients whose campaign we hold spend for.
        attributedPatients: rows.reduce((n, r) => n + r.patients, 0),
        unattributedLeads: allPeople.size - attributedPeople.size,
    };
    // Both cost figures divide paid spend by the population that spend can be
    // measured against. Dividing by `leads` would charge paid spend against
    // organic enquiries and quietly understate the cost per lead, while cost per
    // patient used the attributed denominator — two different populations
    // presented side by side as if they were one.
    totals.costPerLeadPence = perUnitPence(totals.spendPence, totals.attributedLeads);
    totals.costPerPatientPence = perUnitPence(totals.spendPence, totals.attributedPatients);
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

// BUMP THIS whenever the payload SHAPE changes. A cache entry written before a
// deploy is read after it, so a new field added to the payload would be absent
// on every hit for the whole TTL — the screen would render against a shape that
// no longer exists (an undefined series is a crash, not a blank chart). The
// version makes old entries unreachable rather than merely stale.
const PAYLOAD_VERSION = 3;   // v3: leads-first byChannel, totals.attributedPatients

function cacheKey(since, until, practiceId) {
    return `marketing:perf:v${PAYLOAD_VERSION}:${since}|${until}|${practiceId ?? 'all'}`;
}

export const marketingService = {
    async campaignPerformance(orgId, { since, until, practiceId = null, refresh = false } = {}) {
        const key = cacheKey(since, until, practiceId);
        if (!refresh) {
            const cached = await readDashboardCache(orgId, key).catch(() => undefined);
            if (cached) return cached;
        }
        const [spend, leads, accounts] = await Promise.all([
            marketingRepository.campaignSpend(orgId, since, until, practiceId),
            marketingRepository.leadsByCampaign(orgId, since, until, practiceId),
            marketingRepository.adAccounts(orgId),
        ]);
        const payload = joinSpendToLeads(spend.campaigns, leads);
        // campaign id -> provider, from the campaigns we hold spend for. This is
        // the definitive arm of channel resolution, so it is built from the same
        // spend rows the table is built from.
        const campaignProvider = new Map(
            spend.campaigns.map((c) => [c.campaign_id, c.provider]),
        );
        payload.byChannel = channelSplit(payload.rows, leads, campaignProvider);
        payload.series = spend.series;
        payload.coverage = buildCoverage(accounts, practiceId, spend.unmappedSpendPence);
        await writeDashboardCache(orgId, key, payload, CACHE_TTL_MS).catch(() => {});
        return payload;
    },
};

export const __test = {
    joinSpendToLeads, perUnitPence, cacheKey, channelSplit, buildCoverage, resolveLeadChannel,
};
