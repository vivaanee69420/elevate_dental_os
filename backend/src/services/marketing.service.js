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
function channelSplit(spendRows, funnelRows, campaignProvider) {
    const blank = () => ({
        spendPence: 0, impressions: 0, clicks: 0, platformConversions: 0,
        campaigns: 0, leads: 0, booked: 0, attended: 0, patients: 0,
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

    for (const g of funnelRows) {
        const e = by.get(resolveLeadChannel(g, campaignProvider));
        e.leads += g.leads;
        e.booked += g.booked;
        e.attended += g.attended;
        e.patients += g.patients;
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
                costPerBookingPence: costed ? perUnitPence(e.spendPence, e.booked) : null,
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

// Per-practice performance, for the comparison screen.
//
// Spend comes from the campaign rows, which are already scoped to the requested
// practice when one is selected — so this is only meaningful on the group view,
// where every practice's rows are present. Leads carry the practice they first
// enquired at, and the RPC emits one row per person, so the practices sum to
// the group total instead of double-counting somebody who enquired at two.
function practiceSplit(spendByPractice, funnelRows, campaignProvider) {
    const by = new Map();
    const row = (id) => {
        if (!by.has(id)) {
            by.set(id, {
                practiceId: id, spendPence: 0, leads: 0, booked: 0, patients: 0, newPatients: 0,
                channels: { meta_ads: 0, google_ads: 0, other: 0 },
            });
        }
        return by.get(id);
    };

    for (const [practiceId, spendPence] of spendByPractice) row(practiceId).spendPence += spendPence;

    for (const g of funnelRows) {
        const e = row(g.practice_id ?? null);
        e.leads += g.leads;
        e.booked += g.booked;
        e.patients += g.patients;
        e.newPatients += g.newPatients;
        e.channels[resolveLeadChannel(g, campaignProvider)] += g.leads;
    }

    return [...by.values()]
        .map((e) => ({
            ...e,
            costPerLeadPence: e.spendPence > 0 ? perUnitPence(e.spendPence, e.leads) : null,
            costPerBookingPence: e.spendPence > 0 && e.booked > 0
                ? perUnitPence(e.spendPence, e.booked)
                : null,
            costPerNewPatientPence: e.spendPence > 0 && e.newPatients > 0
                ? perUnitPence(e.spendPence, e.newPatients)
                : null,
        }))
        .sort((a, b) => b.spendPence - a.spendPence || b.leads - a.leads);
}

// Campaign rows and window totals, from SPEND joined to FUNNEL GROUPS.
//
// The second argument is one row per (campaign, source, practice) — NOT one row
// per person. ad_lead_conversions emits exactly one row per contact, so every
// person lands in exactly one group and summing group counts is exact. That is
// what lets this stop paging ten thousand rows in order to count them.
function joinSpendToLeads(spendRows, funnelRows) {
    // Collapse the groups to campaign for the table.
    const byCampaign = new Map();
    const blank = () => ({ leads: 0, booked: 0, attended: 0, patients: 0, newPatients: 0 });
    for (const g of funnelRows) {
        if (!g.ad_campaign_id) continue;
        const e = byCampaign.get(g.ad_campaign_id) ?? blank();
        e.leads += g.leads;
        e.booked += g.booked;
        e.attended += g.attended;
        e.patients += g.patients;
        e.newPatients += g.newPatients;
        byCampaign.set(g.ad_campaign_id, e);
    }

    // A lead is attributed only if its campaign produced a ROW — carrying a
    // campaign id whose spend falls outside the window is not enough, or the
    // person appears in neither the rows nor the unattributed count and the
    // table stops reconciling to the tiles.
    const attributed = blank();
    const rows = spendRows.map((s) => {
        const f = byCampaign.get(s.campaign_id) ?? blank();
        attributed.leads += f.leads;
        attributed.booked += f.booked;
        attributed.attended += f.attended;
        attributed.patients += f.patients;
        attributed.newPatients += f.newPatients;
        return {
            provider: s.provider,
            campaignId: s.campaign_id,
            campaignName: s.campaign_name,
            spendPence: s.spend_pence,
            impressions: s.impressions,
            clicks: s.clicks,
            platformConversions: s.conversions,
            leads: f.leads,
            booked: f.booked,
            attended: f.attended,
            patients: f.patients,
            newPatients: f.newPatients,
            costPerLeadPence: perUnitPence(s.spend_pence, f.leads),
            costPerBookingPence: perUnitPence(s.spend_pence, f.booked),
            costPerPatientPence: perUnitPence(s.spend_pence, f.patients),
            costPerNewPatientPence: perUnitPence(s.spend_pence, f.newPatients),
            tier: 'campaign',
        };
    }).sort((a, b) => b.spendPence - a.spendPence);

    // The whole population, organic and unattributed included.
    const all = funnelRows.reduce((n, g) => ({
        leads: n.leads + g.leads,
        booked: n.booked + g.booked,
        attended: n.attended + g.attended,
        patients: n.patients + g.patients,
        newPatients: n.newPatients + g.newPatients,
    }), blank());

    const totals = {
        spendPence: rows.reduce((n, r) => n + r.spendPence, 0),
        impressions: rows.reduce((n, r) => n + r.impressions, 0),
        clicks: rows.reduce((n, r) => n + r.clicks, 0),
        platformConversions: rows.reduce((n, r) => n + r.platformConversions, 0),
        // Honest and shown on the screen — but NOT a denominator for paid spend.
        leads: all.leads,
        booked: all.booked,
        attended: all.attended,
        patients: all.patients,
        newPatients: all.newPatients,
        // The cost denominators: the population the spend can be measured
        // against. Dividing paid spend by organic enquiries understates every
        // cost per unit.
        attributedLeads: attributed.leads,
        attributedBooked: attributed.booked,
        attributedPatients: attributed.patients,
        attributedNewPatients: attributed.newPatients,
        unattributedLeads: all.leads - attributed.leads,
    };
    totals.costPerLeadPence = perUnitPence(totals.spendPence, totals.attributedLeads);
    totals.costPerBookingPence = perUnitPence(totals.spendPence, totals.attributedBooked);
    totals.costPerPatientPence = perUnitPence(totals.spendPence, totals.attributedPatients);
    totals.costPerNewPatientPence = perUnitPence(totals.spendPence, totals.attributedNewPatients);
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
const PAYLOAD_VERSION = 6;   // v6: booked, attended, CPB, cost per new patient

function cacheKey(since, until, practiceId) {
    return `marketing:perf:v${PAYLOAD_VERSION}:${since}|${until}|${practiceId ?? 'all'}`;
}

// The trend and the leads list get their own cache keys: they answer different
// windows (a year) and different page slices from the performance payload, and
// sharing one key would evict on every page change.
function trendKey(since, until, practiceId) {
    return `marketing:trend:v${PAYLOAD_VERSION}:${since}|${until}|${practiceId ?? 'all'}`;
}

// Where a person stopped. Computed once, server-side, so the leads table and
// anything else that reports the funnel can never disagree about a person.
//
// attended is Dentally-only: false means UNKNOWN for someone whose only booking
// is a GoHighLevel one, so a person never falls BELOW 'booked' on its account.
function leadStage(lead) {
    if (lead.is_new_patient) return 'new_patient';
    if (lead.attended) return 'attended';
    if (lead.booked_at) return 'booked';
    return 'enquired';
}

export const marketingService = {
    // Month-by-month per channel. Served by a SQL aggregate rather than the
    // row-level function — see marketingRepository.monthlyRollup.
    async trend(orgId, { since, until, practiceId = null, refresh = false } = {}) {
        const key = trendKey(since, until, practiceId);
        if (!refresh) {
            const cached = await readDashboardCache(orgId, key).catch(() => undefined);
            if (cached) return cached;
        }
        const rows = await marketingRepository.monthlyRollup(orgId, since, until, practiceId);

        // Pivot to one entry per month so the chart has a single row per x
        // position, with every channel present even when it did nothing that
        // month — a missing key would break the line rather than flatten it.
        const byMonth = new Map();
        for (const r of rows) {
            if (!byMonth.has(r.month)) {
                byMonth.set(r.month, {
                    month: r.month,
                    spendPence: 0, leads: 0, patients: 0, newPatients: 0,
                    channels: {
                        meta_ads: { spendPence: 0, leads: 0, patients: 0, newPatients: 0 },
                        google_ads: { spendPence: 0, leads: 0, patients: 0, newPatients: 0 },
                        other: { spendPence: 0, leads: 0, patients: 0, newPatients: 0 },
                    },
                });
            }
            const m = byMonth.get(r.month);
            const c = m.channels[r.channel];
            if (!c) continue;                       // a provider we do not chart
            c.spendPence += r.spendPence;
            c.leads += r.leads;
            c.patients += r.patients;
            c.newPatients += r.newPatients;
            m.spendPence += r.spendPence;
            m.leads += r.leads;
            m.patients += r.patients;
            m.newPatients += r.newPatients;
        }

        // Cost per lead per channel per month. Null, never zero, when that
        // channel spent nothing that month — a gap in the line reads as "not
        // measured", a zero reads as "free".
        const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
        for (const m of months) {
            for (const c of Object.values(m.channels)) {
                c.costPerLeadPence = c.spendPence > 0 ? perUnitPence(c.spendPence, c.leads) : null;
            }
        }
        const payload = { months };
        await writeDashboardCache(orgId, key, payload, CACHE_TTL_MS).catch(() => {});
        return payload;
    },

    // One page of the named people behind the counts.
    //
    // Reuses the same classification as every other screen, then fetches
    // display fields for the visible page ONLY — the window can hold thousands
    // of people and a table of 50 needs 50 names.
    async leadList(orgId, {
        since, until, practiceId = null, channel = null, converted = null,
        campaignId = null, page = 1, size = 50,
    } = {}) {
        const [spend, leads] = await Promise.all([
            marketingRepository.campaignSpend(orgId, since, until, practiceId),
            marketingRepository.leadsByCampaign(orgId, since, until, practiceId),
        ]);
        const campaignProvider = new Map(spend.campaigns.map((c) => [c.campaign_id, c.provider]));
        const campaignName = new Map(spend.campaigns.map((c) => [c.campaign_id, c.campaign_name]));

        let rows = leads.map((l) => ({
            contactId: l.contact_id,
            practiceId: l.practice_id,
            channel: resolveLeadChannel(l, campaignProvider),
            campaignId: l.ad_campaign_id,
            campaignName: l.ad_campaign_id ? campaignName.get(l.ad_campaign_id) ?? null : null,
            attributionSource: l.attribution_source,
            enquiredAt: l.first_lead_at,
            bookedAt: l.booked_at,
            attended: l.attended,
            stage: leadStage(l),
            converted: l.converted,
            isNewPatient: l.is_new_patient,
            matchedBy: l.matched_by,
        }));
        if (campaignId) rows = rows.filter((r) => r.campaignId === campaignId);
        if (channel) rows = rows.filter((r) => r.channel === channel);
        if (converted === true) rows = rows.filter((r) => r.converted);
        if (converted === false) rows = rows.filter((r) => !r.converted);

        // Newest enquiry first. contactId breaks ties so paging is stable when
        // several people enquired in the same second.
        rows.sort((a, b) => String(b.enquiredAt ?? '').localeCompare(String(a.enquiredAt ?? ''))
            || String(a.contactId).localeCompare(String(b.contactId)));

        const total = rows.length;
        const start = Math.max(0, (page - 1) * size);
        const pageRows = rows.slice(start, start + size);
        const people = await marketingRepository.contactsByIds(
            orgId, pageRows.map((r) => r.contactId),
        );
        const person = new Map(people.map((c) => [c.id, c]));

        return {
            total,
            page,
            size,
            rows: pageRows.map((r) => {
                const c = person.get(r.contactId);
                const name = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim();
                return {
                    ...r,
                    name: name || null,
                    email: c?.email ?? null,
                    phone: c?.phone ?? null,
                };
            }),
        };
    },

    async campaignPerformance(orgId, { since, until, practiceId = null, refresh = false } = {}) {
        const key = cacheKey(since, until, practiceId);
        if (!refresh) {
            const cached = await readDashboardCache(orgId, key).catch(() => undefined);
            if (cached) return cached;
        }
        const [spend, funnel, accounts] = await Promise.all([
            marketingRepository.campaignSpend(orgId, since, until, practiceId),
            marketingRepository.campaignFunnel(orgId, since, until, practiceId),
            marketingRepository.adAccounts(orgId),
        ]);
        const payload = joinSpendToLeads(spend.campaigns, funnel);
        // campaign id -> provider, from the campaigns we hold spend for. This is
        // the definitive arm of channel resolution, so it is built from the same
        // spend rows the table is built from.
        const campaignProvider = new Map(
            spend.campaigns.map((c) => [c.campaign_id, c.provider]),
        );
        payload.byChannel = channelSplit(payload.rows, funnel, campaignProvider);
        payload.byPractice = practiceSplit(spend.spendByPractice, funnel, campaignProvider);
        payload.series = spend.series;
        payload.coverage = buildCoverage(accounts, practiceId, spend.unmappedSpendPence);
        await writeDashboardCache(orgId, key, payload, CACHE_TTL_MS).catch(() => {});
        return payload;
    },
};

export const __test = {
    joinSpendToLeads, perUnitPence, cacheKey, channelSplit, buildCoverage, resolveLeadChannel,
    practiceSplit, leadStage,
};
