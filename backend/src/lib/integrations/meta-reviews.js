// Meta (Facebook) Page reviews/recommendations client for the Reviews screen.
//
// Facebook removed star reviews; a Page now carries "recommendations" (a binary
// positive/negative) exposed on the Graph `/{page-id}/ratings` edge. Reading
// them needs a PAGE access token with `pages_read_engagement` (+ `pages_show_list`
// to enumerate the admin's pages) — both gated behind Meta App Review. Until
// that's granted the Graph calls return an OAuthException; the sync catches it
// per-source and stamps last_error, so this stays INERT (zero reviews) rather
// than breaking the connection.
//
// We reuse the existing meta_ads connection's long-lived USER token (folded into
// one Meta connection) and exchange it per-page via /me/accounts, which returns
// each page's own access_token alongside name + rating_count.
//
//   pages   → graph.facebook.com/<v>/me/accounts        (page list + page tokens)
//   ratings → graph.facebook.com/<v>/{page-id}/ratings  (the recommendations)

import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { decryptSecret } from '../crypto.js';

function graphBase() {
    return process.env.META_GRAPH_BASE || 'https://graph.facebook.com';
}
function apiVersion() {
    return process.env.META_API_VERSION || 'v21.0';
}

// Pull the stored long-lived user token from the org's meta_ads integration.
// Returns null when Meta isn't connected (so reviews-sync can skip Facebook).
export async function getUserToken(orgId) {
    const integration = await integrationsRepository.getByProvider(orgId, 'meta_ads');
    if (!integration || integration.status === 'revoked' || !integration.secrets) return null;
    try {
        const { access_token } = JSON.parse(decryptSecret(integration.secrets));
        return access_token || null;
    } catch {
        return null;
    }
}

// Pages the connected user administers, each with its own page access_token and
// current rating_count. Drives the Facebook side of the source picker AND the
// sync (page token per location). Throws on a scope/permission error so the
// caller can surface "reconnect Meta with page permissions".
export async function listPages(userToken) {
    if (!userToken) throw new Error('Meta is not connected');
    let url = `${graphBase()}/${apiVersion()}/me/accounts`
        + `?fields=id,name,access_token,rating_count,overall_star_rating,link&limit=100`
        + `&access_token=${encodeURIComponent(userToken)}`;
    const pages = [];
    let guard = 0;
    while (url && guard < 20) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = body?.error?.message || `me/accounts HTTP ${res.status}`;
            throw new Error(msg);
        }
        for (const p of body.data ?? []) {
            if (!p.id) continue;
            pages.push({
                place_id: String(p.id),          // page id is the source external_id
                name: p.name ?? null,
                address: p.link ?? null,
                page_token: p.access_token ?? null,
                rating: p.overall_star_rating || null,
                total_count: p.rating_count ?? null,
            });
        }
        url = body.paging?.next || null;
        guard++;
    }
    return pages;
}

const RECOMMENDATION_RATING = { positive: 5, negative: 1 };

// Recommendations for one page. `recommendation_type` is positive|negative
// (stars are gone) — map to a 5/1 rating so it fits reviews.rating (1..5).
// external_id = "<pageId>:<created_time>" (the edge objects have no stable id).
export async function getPageRatings(pageId, pageToken) {
    const id = String(pageId || '').trim();
    if (!id) throw new Error('page id is required');
    if (!pageToken) throw new Error('no page access token (reconnect Meta with page permissions)');
    let url = `${graphBase()}/${apiVersion()}/${id}/ratings`
        + `?fields=created_time,recommendation_type,review_text,reviewer{name},rating&limit=100`
        + `&access_token=${encodeURIComponent(pageToken)}`;
    const reviews = [];
    let pos = 0;
    let guard = 0;
    while (url && guard < 20) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = body?.error?.message || `ratings HTTP ${res.status}`;
            throw new Error(msg);
        }
        for (const r of body.data ?? []) {
            const rating = r.rating
                ? Math.round(r.rating)
                : (RECOMMENDATION_RATING[r.recommendation_type] ?? null);
            if (!rating) continue;
            if (rating >= 4) pos++;
            reviews.push({
                external_id: `${id}:${r.created_time || reviews.length}`,
                author_name: r.reviewer?.name ?? 'Facebook user',
                rating,
                body: r.review_text ?? '',
                published_at: r.created_time ? new Date(r.created_time).toISOString() : null,
            });
        }
        url = body.paging?.next || null;
        guard++;
    }
    // No star average from recommendations; approximate from the positive ratio.
    const rating = reviews.length ? Number(((pos / reviews.length) * 5).toFixed(1)) : null;
    return { reviews, rating, total_count: reviews.length };
}
