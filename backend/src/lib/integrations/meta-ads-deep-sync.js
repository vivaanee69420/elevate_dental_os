// ============================================================================
// Meta Ads deep-grain sync — ad set and ad, per day. Separate from
// meta-ads-sync.js, which owns campaign grain.
//
//   GET {graph}/{ver}/act_{accountId}/insights
//       ?level=adset|ad&time_increment=1&time_range={since,until}
//       &fields=...
//
// Meta returns spend as a decimal STRING in the account currency ("12.34"),
// unlike Google's integer micros. Guarded by ad-currency.js.
//
// Retention (changed 12 January 2026): spend/impressions/clicks are kept for
// 37 months, reach and other unique-count fields for 13, frequency breakdowns
// for 6. The 92-day window sits inside all three, so nothing here is
// unavailable.
// ============================================================================
import { adGrainRepository } from "../../repositories/ad-grain.repository.js";

// ONE FIELD LIST PER LEVEL, not a single list shared by both requests.
//
// A single list meant the level=adset request also asked for ad_id and
// ad_name — fields that do not exist at ad-set level. Meta is documented to
// ignore out-of-level fields, but it is not guaranteed to, and it is not
// something we can verify from here. If it were ever to reject them instead,
// the ad-set pull would 400 EVERY NIGHT, land silently in `skipped` (the pull
// is deliberately non-fatal), and ad_meta_adsets would simply never receive a
// row — a table that is empty for a reason nobody is told. Asking each level
// only for its own fields removes the question entirely.
//
// The ad level DOES legitimately ask for adset_id: that is the ad's parent,
// and it is a real ad-level field.
const COMMON_FIELDS = 'campaign_id,campaign_name,spend,impressions,clicks,reach,frequency';
export const ADSET_FIELDS = `${COMMON_FIELDS},adset_id,adset_name`;
export const AD_FIELDS = `${COMMON_FIELDS},adset_id,ad_id,ad_name`;

// Keyed by the level string the insights edge takes, so the caller looks the
// list up rather than choosing between two constants.
export const LEVEL_FIELDS = Object.freeze({ adset: ADSET_FIELDS, ad: AD_FIELDS });

function spendToPence(spend) {
    const n = Number(spend);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function numOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// level 'adset': entity = ad set, parent = campaign.
// level 'ad':    entity = ad,     parent = AD SET.
const SHAPE = {
    adset: { idKey: 'adset_id', nameKey: 'adset_name', parentKey: 'campaign_id' },
    ad:    { idKey: 'ad_id',    nameKey: 'ad_name',    parentKey: 'adset_id' },
};

export function parseMetaLevel(rows, level, { orgId, customerId }) {
    const shape = SHAPE[level];
    if (!shape) throw new Error(`parseMetaLevel: unknown level '${level}'`);
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
        const id = r?.[shape.idKey];
        const parent = r?.[shape.parentKey];
        if (!id || !parent || !r?.campaign_id || !r?.date_start) continue;
        out.push({
            organisation_id: orgId,
            practice_id: null,          // stamped in the replace RPC
            provider: 'meta_ads',
            customer_id: customerId,
            campaign_id: String(r.campaign_id),
            campaign_name: r.campaign_name ?? null,
            parent_id: String(parent),
            entity_id: String(id),
            entity_name: r[shape.nameKey] ?? null,
            entity_status: null,        // insights carries no status; the campaign edge does
            metric_date: r.date_start,
            spend_pence: spendToPence(r.spend),
            impressions: Number(r.impressions ?? 0),
            clicks: Number(r.clicks ?? 0),
            conversions: 0,             // Meta actions are handled at campaign grain
            reach: numOrNull(r.reach),
            frequency: numOrNull(r.frequency),
        });
    }
    return out;
}

const LEVELS = [
    { level: 'adset', grain: 'meta_adset' },
    { level: 'ad',    grain: 'meta_ad' },
];

export async function syncMetaDeep(orgId, { accessToken, accountIds, since, until, fetchLevel }) {
    const collected = new Map(LEVELS.map((l) => [l.grain, []]));
    const withRows = new Map(LEVELS.map((l) => [l.grain, new Set()]));
    const skipped = [];

    for (const accountId of accountIds ?? []) {
        for (const { level, grain } of LEVELS) {
            try {
                const rows = await fetchLevel(accountId, accessToken, level, since, until);
                const parsed = parseMetaLevel(rows, level, { orgId, customerId: accountId });
                if (parsed.length) {
                    collected.get(grain).push(...parsed);
                    withRows.get(grain).add(accountId);
                }
            } catch (err) {
                // NOT deduplicated by account or by error — one entry per failing
                // (account, level) pair, on purpose: knowing WHICH level failed
                // tells the owner whether their ad-level page is stale while ad
                // sets are fine (Meta throttles harder at ad level).
                skipped.push({ accountId, level, error: String(err.message).slice(0, 200) });
            }
        }
    }

    const counts = {};
    for (const { grain } of LEVELS) {
        const rows = collected.get(grain);
        // Replace ONLY for accounts that returned rows — an empty 200 must not
        // trigger a destructive delete of good history.
        counts[grain] = rows.length
            ? await adGrainRepository.replaceWindow(orgId, grain, [...withRows.get(grain)], rows)
            : 0;
    }
    return { counts, skipped };
}

export const __test = { spendToPence, parseMetaLevel, ADSET_FIELDS, AD_FIELDS, LEVEL_FIELDS };
