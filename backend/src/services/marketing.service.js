import { summariseAccepted } from '../lib/marketing/accepted-ledger.js';
import { ACCEPTANCE_MIN_PAID_PENCE } from '../lib/marketing/lead-performance.js';
import { londonYmd } from '../lib/tz.js';
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
// The Marketing section's OUTCOME counts (booked / became a patient) come from
// the same per-platform lead ledgers the Facebook and Google report pages read,
// not from ad_campaign_funnel. Those two disagreed about what a patient is —
// "matches some Dentally record" against "has paid more than the acceptance
// floor" — and were 8.5x apart on live data (729 against 86, group, Jun-Aug
// 2026) in the same section of the same app. LEADS are deliberately untouched:
// the Overview counts every enquiry however it arrived and says so on screen.
function channelSplit(spendRows, funnelRows, campaignProvider, accepted, mappedSpendByProvider = null) {
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
        // Paid leads are REPLACED below from the ledgers; this accumulation is
        // what gives the 'other' (organic) channel its count, and what the
        // channel totals fall back to when no ledger row exists at all.
        e.leads += g.leads;
        e.attended += g.attended;
    }
    // A PAID channel card is the same claim the Facebook or Google report page
    // makes, so it is built from the same rows: leads, bookings and patients
    // all from that platform's ledger. Taking only the OUTCOMES from the ledger
    // while leaving leads on the funnel's attribution would put two different
    // populations in one card — live, that read 170 Google leads beside 45
    // ledger patients and priced a lead at GBP 285.95 against the Google page's
    // own GBP 56.85.
    //
    // Spend likewise comes from the mapped-practice figure the report pages
    // divide by, so the card and the page cannot differ.
    for (const c of ['google_ads', 'meta_ads']) {
        const e = by.get(c);
        if (!e) continue;
        e.leads = accepted.byChannel[c].leads;
        e.booked = accepted.byChannel[c].booked;
        e.patients = accepted.byChannel[c].accepted;
        if (mappedSpendByProvider) e.spendPence = mappedSpendByProvider.get(c) ?? 0;
    }
    // The 'other' channel is everyone who arrived without ad attribution, so it
    // has no ledger by definition. Its outcomes are UNKNOWABLE on a money rule
    // rather than zero — null renders as an em dash, where 0 would be a claim
    // about the practice ("no organic enquiry ever became a patient") rather
    // than about our data.
    const other = by.get('other');
    if (other) { other.booked = null; other.patients = null; }

    return CHANNEL_ORDER
        .map((c) => by.get(c))
        // Facebook and Google only. The organic bucket is not an advertising
        // channel and counting it here made the cards sum to more than the tile
        // above them. Its leads are still reported as totals.unattributedLeads
        // and listed on the Leads page.
        .filter((e) => e.channel !== 'other')
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
                costPerBookingPence: costed && e.booked != null ? perUnitPence(e.spendPence, e.booked) : null,
                costPerPatientPence: costed && e.patients != null ? perUnitPence(e.spendPence, e.patients) : null,
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
function practiceSplit(spendByPractice, funnelRows, campaignProvider, accepted) {
    const by = new Map();
    const row = (id) => {
        if (!by.has(id)) {
            by.set(id, {
                practiceId: id, spendPence: 0, leads: 0, attributedLeads: 0, booked: 0, patients: 0, newPatients: 0,
                channels: { meta_ads: 0, google_ads: 0, other: 0 },
            });
        }
        return by.get(id);
    };

    for (const [practiceId, spendPence] of spendByPractice) row(practiceId).spendPence += spendPence;

    for (const g of funnelRows) {
        const e = row(g.practice_id ?? null);
        e.leads += g.leads;
        // newPatients stays on the funnel's basis — it counts first-ever
        // Dentally attendance, which is a clinical fact rather than a money
        // rule, so the ledgers have no better answer for it.
        e.newPatients += g.newPatients;
        e.channels[resolveLeadChannel(g, campaignProvider)] += g.leads;
    }
    // Outcomes and the cost DENOMINATOR come from the ledgers. `e.leads` above
    // is every enquiry at this practice including organic, and dividing paid
    // spend by that population is the exact defect this function's own comment
    // warned about below — it just had no attributed figure to use instead
    // until now.
    for (const [practiceId, a] of accepted.byPractice) {
        const e = row(practiceId);
        e.attributedLeads = a.leads;
        e.booked = a.booked;
        e.patients = a.accepted;
    }

    return [...by.values()]
        .map((e) => ({
            ...e,
            // Every cost here divides by an ATTRIBUTED figure. It used to
            // divide by e.leads — every enquiry at the practice, organic
            // included — which understated cost per lead by whatever share
            // arrived without ad tracking. The ledgers give the attributed
            // population, so the note that once said "does not exist yet" is
            // now simply done.
            costPerLeadPence: e.spendPence > 0 ? perUnitPence(e.spendPence, e.attributedLeads) : null,
            costPerBookingPence: e.spendPence > 0 ? perUnitPence(e.spendPence, e.booked) : null,
            costPerPatientPence: e.spendPence > 0 ? perUnitPence(e.spendPence, e.patients) : null,
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
function joinSpendToLeads(spendRows, funnelRows, accepted, spendTotals, campaignProvider) {
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
        // Per-campaign LEADS and OUTCOMES come from the ledgers, so a campaign
        // row here shows the same numbers as the same campaign on the Facebook
        // or Google page. Mixing the two sources per row would be worse than
        // either: funnel leads with ledger bookings can make a campaign report
        // more bookings than leads.
        const a = accepted.byCampaign.get(s.campaign_id) ?? { leads: 0, booked: 0, accepted: 0 };
        attributed.leads += a.leads;
        attributed.booked += a.booked;
        attributed.patients += a.accepted;
        attributed.newPatients += f.newPatients;
        return {
            provider: s.provider,
            campaignId: s.campaign_id,
            campaignName: s.campaign_name,
            spendPence: s.spend_pence,
            impressions: s.impressions,
            clicks: s.clicks,
            platformConversions: s.conversions,
            leads: a.leads,
            booked: a.booked,
            // `attended` has no ledger equivalent — it is a Dentally
            // appointment state, not a money rule — so it stays as the funnel
            // reports it and is the one column here on the older basis.
            attended: f.attended,
            patients: a.accepted,
            newPatients: f.newPatients,
            costPerLeadPence: perUnitPence(s.spend_pence, a.leads),
            costPerBookingPence: perUnitPence(s.spend_pence, a.booked),
            costPerPatientPence: perUnitPence(s.spend_pence, a.accepted),
            costPerNewPatientPence: perUnitPence(s.spend_pence, f.newPatients),
            tier: 'campaign',
        };
    }).sort((a, b) => b.spendPence - a.spendPence);

    // Organic, referral, direct, walk-in — the only part of the lead population
    // ad_campaign_funnel is the better source for, since the ad ledgers cannot
    // see it by definition.
    //
    // Counted through resolveLeadChannel, the SAME function the channel cards
    // use, not by "has no campaign id". They are not the same set: a lead whose
    // attribution_source says Paid Social but that carries no campaign id is
    // paid, not organic. Defining it independently here put 90 in the tile
    // against 88 on the card, and the tile stopped being the sum of the cards
    // by two leads.
    const organicLeads = funnelRows
        .filter((g) => resolveLeadChannel(g, campaignProvider) === 'other')
        .reduce((n, g) => n + g.leads, 0);

    // The whole population, organic and unattributed included.
    const all = funnelRows.reduce((n, g) => ({
        leads: n.leads + g.leads,
        booked: n.booked + g.booked,
        attended: n.attended + g.attended,
        patients: n.patients + g.patients,
        newPatients: n.newPatients + g.newPatients,
    }), blank());

    const totals = {
        // MAPPED-PRACTICE spend, not the sum of the campaign rows below.
        // Spend on an account mapped to no practice can be charged against no
        // practice's leads, so including it here would price every lead and
        // patient against money that produced none of them — and the tile would
        // contradict the channel cards and practice rows on its own page
        // (live: GBP 122,649.08 in the tile against GBP 104,052.34 in the cards
        // beneath it). The excluded amount is not hidden: coverage.
        // unmappedSpendPence carries it and the page names it.
        spendPence: spendTotals.spendPence,
        impressions: spendTotals.impressions,
        clicks: spendTotals.clicks,
        platformConversions: rows.reduce((n, r) => n + r.platformConversions, 0),
        // FACEBOOK AND GOOGLE ONLY. This section reports paid advertising, so
        // every figure on it is what the two ad platforms bought — the same
        // people the Facebook and Google report pages count, and nobody else.
        //
        // It used to add the funnel's organic enquiries in, which made the tile
        // answer a different question from every card beneath it and from the
        // two pages it is supposed to agree with. Organic enquiries are real and
        // are not hidden: `unattributedLeads` still reports them and the Leads
        // page lists them. They are simply not an advertising result.
        leads: accepted.total.leads,
        attended: all.attended,
        newPatients: all.newPatients,
        // Outcomes on the report pages' rule: settled payments above the
        // acceptance floor, counted for new patients only. This was
        // ad_campaign_funnel's "matched a Dentally record", which read 729
        // against the report pages' 86 for the same window.
        booked: accepted.total.booked,
        patients: accepted.total.accepted,
        // The cost denominators: the population the spend can be measured
        // against. Dividing paid spend by organic enquiries understates every
        // cost per unit.
        //
        // This is EVERY ledger lead, not only those that resolve to a campaign
        // with spend in the window. A lead sitting in an ad ledger came from an
        // ad whether or not we can name which one — the campaign may have spent
        // in an earlier window, or the click may predate the deep tables' rolling
        // 92-day window. Charging spend only against the nameable subset
        // OVERSTATES every cost: on live data that is 1,876 rather than 2,484
        // leads, i.e. GBP 68.79 per lead instead of GBP 49.38, and it would not
        // match the per-practice cost the Facebook and Google pages show for the
        // same people.
        attributedLeads: accepted.total.leads,
        attributedBooked: accepted.total.booked,
        attributedPatients: accepted.total.accepted,
        attributedNewPatients: attributed.newPatients,
        // The narrower subset that the per-campaign TABLE below sums to, kept
        // so the screen can reconcile the table against the tiles without
        // implying the difference is unattributed.
        campaignMatchedLeads: attributed.leads,
        campaignMatchedPatients: attributed.patients,
        // Reported, NOT counted in `leads` above: enquiries that reached the
        // practice without any ad attribution. Kept so the page can say how many
        // it is leaving out rather than leave the reader wondering where they
        // went.
        unattributedLeads: organicLeads,
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
// The scope window's `until` is an EXCLUSIVE instant, while
// ad_provider_spend_by_practice takes an INCLUSIVE London date — the same
// convention the report pages call it with. Converting here rather than
// slicing: 2026-08-31T23:00:00Z is the start of 1 September under BST, so the
// last day to include is 31 August. Handing the raw London date across would
// silently add a day of the next month's spend to every channel card.
function lastLondonDay(untilISO) {
    return londonYmd(new Date(Date.parse(untilISO) - 1));
}

const CACHE_TTL_MS = 10 * 60 * 1000;

// BUMP THIS whenever the payload SHAPE changes. A cache entry written before a
// deploy is read after it, so a new field added to the payload would be absent
// on every hit for the whole TTL — the screen would render against a shape that
// no longer exists (an undefined series is a crash, not a blank chart). The
// version makes old entries unreachable rather than merely stale.
const PAYLOAD_VERSION = 7;   // v7: outcomes from the lead ledgers, not ad_campaign_funnel

function cacheKey(since, until, practiceId) {
    return `marketing:perf:v${PAYLOAD_VERSION}:${since}|${until}|${practiceId ?? 'all'}`;
}

// The trend and the leads list get their own cache keys: they answer different
// windows (a year) and different page slices from the performance payload, and
// sharing one key would evict on every page change.
function trendKey(since, until, practiceId) {
    return `marketing:trend:v${PAYLOAD_VERSION}:${since}|${until}|${practiceId ?? 'all'}`;
}

// leadList's own key. Deliberately built from ONLY the inputs that change
// what gets FETCHED — org (implicit: readDashboardCache/writeDashboardCache
// are org-scoped), since, until, practiceId. page/size/channel/converted/
// campaignId are filters applied client-side of the cache, all against the
// same cached arrays, so folding any of them in here would turn one cached
// fetch into a cache entry per filter combination and defeat the point.
function leadListKey(since, until, practiceId) {
    return `marketing:leads:v${PAYLOAD_VERSION}:${since}|${until}|${practiceId ?? 'all'}`;
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
        // This is now a PER-CAMPAIGN entry point — the campaign detail screen
        // calls it on every click and every Previous/Next press — so the
        // expensive inputs (spend + the full per-person funnel for the window)
        // are cached, the same as trend/campaignPerformance. Filtering, sorting
        // and paging stay below, operating on the cached arrays, so one cached
        // fetch serves every page and every filter combination.
        const key = leadListKey(since, until, practiceId);
        const cached = await readDashboardCache(orgId, key).catch(() => undefined);
        let spend;
        let leads;
        if (cached) {
            ({ spend, leads } = cached);
        } else {
            [spend, leads] = await Promise.all([
                marketingRepository.campaignSpend(orgId, since, until, practiceId),
                marketingRepository.leadsByCampaign(orgId, since, until, practiceId),
            ]);
            // A year-wide window on the largest org runs to ~10,000 person
            // rows — too large to push into the cache table, so that case is
            // simply served live on every page/filter change rather than
            // skipped from being returned. Every smaller window (the common
            // case, since the campaign detail screen defaults to a month) is
            // still cached.
            if (leads.length <= 5000) {
                await writeDashboardCache(orgId, key, { spend, leads }, CACHE_TTL_MS).catch(() => {});
            }
        }
        const campaignProvider = new Map(spend.campaigns.map((c) => [c.campaign_id, c.provider]));
        const campaignName = new Map(spend.campaigns.map((c) => [c.campaign_id, c.campaign_name]));

        // Where the person actually came in. For the 'other' channel this is
        // the ONLY origin we hold: most of those leads carry no attribution
        // source at all, so the row would otherwise say nothing beyond "not
        // paid". Deliberately NOT cached with the leads above — pipelines are
        // renamed in GoHighLevel far more often than a window's leads change,
        // and this read is one small row per subaccount.
        const pipelineName = await marketingRepository.pipelineNames(orgId).catch(() => new Map());

        let rows = leads.map((l) => ({
            contactId: l.contact_id,
            practiceId: l.practice_id,
            channel: resolveLeadChannel(l, campaignProvider),
            campaignId: l.ad_campaign_id,
            campaignName: l.ad_campaign_id ? campaignName.get(l.ad_campaign_id) ?? null : null,
            attributionSource: l.attribution_source,
            pipelineId: l.ghl_pipeline_id ?? null,
            // Null when the id resolves to no synced definition — an archived
            // or since-deleted pipeline. The screen falls back to the
            // attribution source rather than showing a raw id.
            pipelineName: l.ghl_pipeline_id
                ? pipelineName.get(String(l.ghl_pipeline_id)) ?? null
                : null,
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
        const [spend, funnel, accounts, googleLedger, metaLedger, googleSpend, metaSpend] = await Promise.all([
            marketingRepository.campaignSpend(orgId, since, until, practiceId),
            marketingRepository.campaignFunnel(orgId, since, until, practiceId),
            marketingRepository.adAccounts(orgId),
            // The SAME reads the Facebook and Google report pages make, with the
            // same acceptance floor. Passed explicitly rather than left to the
            // RPC default: the caller owns the tenant's fee, and a silent
            // server-side default is how the two would drift apart.
            marketingRepository.googleLeadLedger(orgId, since, until, ACCEPTANCE_MIN_PAID_PENCE),
            marketingRepository.metaLeadLedger(orgId, since, until, ACCEPTANCE_MIN_PAID_PENCE),
            // The SAME per-practice spend the report pages divide by, so a
            // channel card and its report page cannot state different costs for
            // the same platform and window.
            marketingRepository.adSpendByPractice(orgId, 'google_ads', londonYmd(since), lastLondonDay(until)),
            marketingRepository.adSpendByPractice(orgId, 'meta_ads', londonYmd(since), lastLondonDay(until)),
        ]);
        // Scoped to the requested practice here rather than in SQL: the two
        // ledger RPCs take no practice parameter (the report pages narrow in JS
        // for the same reason — one org-wide fetch serves every practice toggle
        // without re-running a ~1s query).
        const inScope = (r) => practiceId == null || r.practice_id === practiceId;
        const accepted = summariseAccepted(
            googleLedger.filter(inScope), metaLedger.filter(inScope),
        );
        // Mapped practices only, and inside the requested practice scope. The
        // report pages divide by exactly this, so a card here and a card there
        // cannot state different costs for the same platform and window.
        const mappedRows = (rows) => rows.filter((r) => r.practice_id != null
            && (practiceId == null || r.practice_id === practiceId));
        const sumField = (rows, f) => rows.reduce((n, r) => n + Number(r[f] ?? 0), 0);
        const allMapped = [...mappedRows(googleSpend), ...mappedRows(metaSpend)];
        const spendTotals = {
            spendPence: sumField(allMapped, 'spend_pence'),
            impressions: sumField(allMapped, 'impressions'),
            clicks: sumField(allMapped, 'clicks'),
        };
        const mappedSpendByProvider = new Map([
            ['google_ads', sumField(mappedRows(googleSpend), 'spend_pence')],
            ['meta_ads', sumField(mappedRows(metaSpend), 'spend_pence')],
        ]);
        // Built before the join, not after: the lead totals now need it to count
        // the organic channel the same way the channel cards do.
        const campaignProvider = new Map(
            spend.campaigns.map((c) => [c.campaign_id, c.provider]),
        );
        const payload = joinSpendToLeads(spend.campaigns, funnel, accepted, spendTotals, campaignProvider);
        payload.byChannel = channelSplit(payload.rows, funnel, campaignProvider, accepted, mappedSpendByProvider);
        payload.byPractice = practiceSplit(spend.spendByPractice, funnel, campaignProvider, accepted);
        // The threshold the patient counts were computed against, so the screen
        // can state it instead of leaving the reader to guess what "became a
        // patient" means. GBP 43 and GBP 4,300 are both "Yes" without it.
        payload.acceptanceMinPaidPence = ACCEPTANCE_MIN_PAID_PENCE;
        payload.series = spend.series;
        payload.coverage = buildCoverage(accounts, practiceId, spend.unmappedSpendPence);
        await writeDashboardCache(orgId, key, payload, CACHE_TTL_MS).catch(() => {});
        return payload;
    },
};

export const __test = {
    joinSpendToLeads, perUnitPence, cacheKey, channelSplit, buildCoverage, resolveLeadChannel,
    practiceSplit, leadStage, leadListKey,
};
