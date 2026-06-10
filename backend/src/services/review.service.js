// ============================================================================
// Review service — business logic for the reviews domain. Owns the live
// Reviews screen: the recent-review feed (from the `reviews` table), the volume
// aggregates (from review_sources, which hold each location's TRUE rating +
// total count), source management (the place/page picker), and the sync.
// ============================================================================
import * as review_repository_1 from "../repositories/review.repository.js";
import { reviewSourceRepository } from "../repositories/reviewSource.repository.js";
import * as review_model_1 from "../models/review.model.js";
import * as errors_1 from "../middleware/errors.js";
import { searchPlaces } from "../lib/integrations/google-places.js";
import { getUserToken, listPages } from "../lib/integrations/meta-reviews.js";
import { syncOneOrg } from "../lib/integrations/reviews-sync.js";
import { setProgress, getProgress } from "../lib/integrations/sync-progress.js";
import { isRevoked } from "../lib/integration-gating.js";

const SYNC_PROVIDER = 'reviews';
const SYNC_STALE_MS = 10 * 60 * 1000;

// Weighted-average rating over rows carrying { rating, total_count }. Falls back
// to a simple mean when no totals are present.
function weightedRating(rows) {
    let wsum = 0;
    let w = 0;
    for (const r of rows) {
        if (r.rating == null) continue;
        const weight = r.total_count || 1;
        wsum += Number(r.rating) * weight;
        w += weight;
    }
    return w ? Number((wsum / w).toFixed(1)) : 0;
}

// Group review_sources into { name, count, rating } breakdown rows for a panel.
function breakdown(sources, keyFn) {
    const groups = new Map();
    for (const s of sources) {
        const key = keyFn(s);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
    }
    return [...groups.entries()].map(([name, rows]) => ({
        name,
        count: rows.reduce((t, r) => t + (r.total_count || 0), 0),
        rating: weightedRating(rows),
    })).sort((a, b) => b.count - a.count);
}

const SOURCE_LABEL = { google: 'Google', facebook: 'Facebook' };

export const reviewService = {
    // The whole Reviews screen payload: feed + summary + the account list (so the
    // filter bar can render every source even before any review is synced).
    async list(orgId, filters = {}) {
        let [reviews, sources] = await Promise.all([
            review_repository_1.reviewRepository.list(orgId, filters),
            reviewSourceRepository.list(orgId),
        ]);
        // Facebook reviews ride on the Meta (meta_ads) connection; disconnecting
        // it hides them. Google reviews are key-only (no integration) and stay.
        if (await isRevoked(orgId, 'meta_ads')) {
            reviews = reviews.filter((r) => r.source !== 'facebook');
            sources = sources.filter((s) => s.provider !== 'facebook');
        }
        // Aggregates come from the SELECTED sources (true volume), narrowed to the
        // active filter so the KPIs track the filter bar.
        let active = sources.filter((s) => s.is_selected);
        if (filters.source) active = active.filter((s) => s.provider === filters.source);
        if (filters.practiceId) active = active.filter((s) => s.practice_id === filters.practiceId);

        const summary = {
            total: active.reduce((t, s) => t + (s.total_count || 0), 0),
            avg_rating: weightedRating(active),
            awaiting: reviews.filter((r) => !r.responded_at).length,
            by_source: breakdown(active, (s) => SOURCE_LABEL[s.provider] || s.provider),
            by_practice: breakdown(active, (s) => s.practice_name),
            connected: sources.length > 0,
        };
        return { reviews, summary, sources };
    },

    async respond(orgId, id, input) {
        const { data, error } = await review_repository_1.reviewRepository.respond(orgId, id, {
            response_body: input.response,
            responded_at: new Date().toISOString(),
        });
        if (error) throw new errors_1.AppError(error.message, 400);
        return data;
    },

    // ---- Source management (the "accounts") -------------------------------
    async sources(orgId) {
        return { sources: await reviewSourceRepository.list(orgId) };
    },

    // Picker. Google = free-text Places search; Facebook = the connected Meta
    // user's administered pages (no public page search exists).
    async searchSources(orgId, provider, query) {
        if (provider === 'google') {
            return { results: await searchPlaces(query) };
        }
        if (provider === 'facebook') {
            const userToken = await getUserToken(orgId);
            if (!userToken) throw new errors_1.AppError('Connect Meta (Facebook) first to list pages', 409);
            try {
                const pages = await listPages(userToken);
                const q = String(query || '').trim().toLowerCase();
                const results = q ? pages.filter((p) => (p.name || '').toLowerCase().includes(q)) : pages;
                return { results: results.map(({ page_token: _t, ...p }) => p) };
            } catch (err) {
                throw new errors_1.AppError(`Could not list Facebook pages: ${err.message}`, 400);
            }
        }
        throw new errors_1.AppError(`Unknown review provider: ${provider}`, 400);
    },

    async addSource(orgId, input) {
        const source = await reviewSourceRepository.add(orgId, input);
        // Pull this source immediately so the screen isn't empty after adding.
        this.syncNow(orgId).catch((err) => console.error('[reviews] add-source sync failed:', err?.message || err));
        return { source };
    },

    async removeSource(orgId, id) {
        await reviewSourceRepository.remove(orgId, id);
        return { ok: true };
    },

    async setSourcePractice(orgId, id, practiceId) {
        return { source: await reviewSourceRepository.setPractice(orgId, id, practiceId) };
    },

    async setSelection(orgId, selectedIds) {
        return { sources: await reviewSourceRepository.setSelection(orgId, selectedIds) };
    },

    // ---- Sync (fire-and-forget; UI polls syncProgress) --------------------
    async syncNow(orgId) {
        const active = getProgress(orgId, SYNC_PROVIDER);
        if (active?.running && active.at && Date.now() - active.at < SYNC_STALE_MS) {
            return { ok: true, alreadyRunning: true };
        }
        setProgress(orgId, SYNC_PROVIDER, { running: true, pct: 0, phase: 'starting', done: false, error: null });
        try {
            const result = await syncOneOrg(orgId, null, (p) => setProgress(orgId, SYNC_PROVIDER, { running: true, ...p }));
            setProgress(orgId, SYNC_PROVIDER, { running: false, pct: 100, done: true });
            return { ok: true, ...result };
        } catch (err) {
            setProgress(orgId, SYNC_PROVIDER, { running: false, done: true, error: err.message });
            throw err;
        }
    },

    syncProgress(orgId) {
        return getProgress(orgId, SYNC_PROVIDER) ?? { running: false, pct: 0, phase: 'idle' };
    },
};

// re-export so the controller can validate without a second import.
export const reviewSchemas = review_model_1;
