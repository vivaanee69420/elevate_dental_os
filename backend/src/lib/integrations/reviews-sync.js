// Reviews sync — pulls reviews for every SELECTED review_source into the shared
// `reviews` table, and stamps each source's current overall rating + total
// count. Google via the Places API (key-only); Facebook via the Graph ratings
// edge (reusing the meta_ads page tokens). Per-source failures are isolated:
// one bad place_id or a missing Meta scope stamps that source's last_error and
// the rest still sync. MULTI-TENANT: every write carries organisation_id.
//
//   syncOneOrg(orgId, onProgress)  — on-demand (Refresh button + first add)
//   syncAllOrgs()                   — nightly worker cron across all orgs

import * as supabase_1 from "../supabase.js";
import { reviewSourceRepository } from "../../repositories/reviewSource.repository.js";
import { reviewRepository } from "../../repositories/review.repository.js";
import { getPlaceReviews, isPlacesConfigured } from "./google-places.js";
import { getUserToken, listPages, getPageRatings } from "./meta-reviews.js";

// Map a synced review (provider shape) → a reviews-table row.
function toRow(orgId, source, practiceId, rv) {
    return {
        organisation_id: orgId,
        source,                       // 'google' | 'facebook'
        external_id: rv.external_id,
        author_name: rv.author_name,
        rating: rv.rating,
        body: rv.body,
        published_at: rv.published_at,
        practice_id: practiceId ?? null,
        flagged_for_recovery: rv.rating <= 3,
    };
}

export async function syncOneOrg(orgId, _integrationArg, onProgress = () => {}, _opts = {}) {
    const sources = await reviewSourceRepository.listSelected(orgId);
    if (sources.length === 0) {
        onProgress({ pct: 100, phase: 'no sources', count: 0 });
        return { sources: 0, reviews: 0 };
    }

    // Facebook page tokens are fetched once per org (one /me/accounts call),
    // keyed by page id, and reused for every selected facebook source.
    let pageTokens = null;
    async function ensurePageTokens() {
        if (pageTokens) return pageTokens;
        pageTokens = new Map();
        const userToken = await getUserToken(orgId);
        if (!userToken) return pageTokens;               // Meta not connected → no FB sync
        try {
            for (const p of await listPages(userToken)) {
                if (p.page_token) pageTokens.set(p.place_id, p.page_token);
            }
        } catch (err) {
            // Scope/permission error (app review pending) — leave the map empty;
            // each facebook source then records the error individually.
            pageTokens.__error = err.message;
        }
        return pageTokens;
    }

    let totalReviews = 0;
    let done = 0;
    for (const src of sources) {
        try {
            let result;
            if (src.provider === 'google') {
                if (!isPlacesConfigured()) throw new Error('GOOGLE_PLACES_API_KEY is not configured');
                result = await getPlaceReviews(src.external_id);
            } else if (src.provider === 'facebook') {
                const tokens = await ensurePageTokens();
                const pageToken = tokens.get(src.external_id);
                if (!pageToken) throw new Error(tokens.__error || 'no page access token (reconnect Meta with page permissions)');
                result = await getPageRatings(src.external_id, pageToken);
            } else {
                throw new Error(`unknown provider ${src.provider}`);
            }

            const rows = (result.reviews ?? []).map((rv) => toRow(orgId, src.provider, src.practice_id, rv));
            if (rows.length) totalReviews += await reviewRepository.upsertMany(rows);
            await reviewSourceRepository.updateSyncResult(orgId, src.id, {
                rating: result.rating,
                total_count: result.total_count,
                last_error: null,
            });
        } catch (err) {
            await reviewSourceRepository.updateSyncResult(orgId, src.id, { last_error: err.message });
            console.error(`[reviews-sync] org=${orgId} source=${src.id} (${src.provider}) failed: ${err.message}`);
        }
        done++;
        onProgress({ pct: Math.round((done / sources.length) * 100), phase: 'pulling reviews', count: totalReviews });
    }
    return { sources: sources.length, reviews: totalReviews };
}

// Nightly: every org that has at least one review_source.
export async function syncAllOrgs() {
    const { data: rows } = await supabase_1.serviceClient
        .from('review_sources')
        .select('organisation_id')
        .eq('is_selected', true);
    const orgIds = [...new Set((rows ?? []).map((r) => r.organisation_id))];
    const results = [];
    for (const orgId of orgIds) {
        try {
            results.push({ orgId, ...(await syncOneOrg(orgId)) });
        } catch (err) {
            console.error(`[reviews-sync] org=${orgId} failed:`, err.message);
        }
    }
    return results;
}
