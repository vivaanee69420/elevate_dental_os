// Google Places + Meta recommendations parsing — the external-data shaping the
// reviews sync depends on (synthetic ids, unix→ISO time, recommendation→rating).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OLD_ENV = { ...process.env };

function mockFetch(json, ok = true, status = 200) {
    return vi.fn(async () => ({ ok, status, json: async () => json }));
}

describe('google-places', () => {
    beforeEach(() => { process.env.GOOGLE_PLACES_API_KEY = 'test-key'; });
    afterEach(() => { vi.unstubAllGlobals(); process.env = { ...OLD_ENV }; });

    it('searchPlaces maps text-search results', async () => {
        vi.stubGlobal('fetch', mockFetch({
            status: 'OK',
            results: [
                { place_id: 'p1', name: 'Ashford Dental', formatted_address: '1 High St', rating: 4.7, user_ratings_total: 1240 },
                { name: 'no place id — dropped' },
            ],
        }));
        const { searchPlaces } = await import('../src/lib/integrations/google-places.js');
        const out = await searchPlaces('ashford dental');
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ place_id: 'p1', name: 'Ashford Dental', rating: 4.7, total_count: 1240 });
    });

    it('getPlaceReviews synthesises a stable external_id and ISO date', async () => {
        vi.stubGlobal('fetch', mockFetch({
            status: 'OK',
            result: {
                name: 'Ashford Dental', rating: 4.7, user_ratings_total: 1240,
                reviews: [
                    { author_name: 'Sarah J.', rating: 5, text: 'Great', time: 1700000000 },
                    { author_name: 'No rating', text: 'dropped' },
                ],
            },
        }));
        const { getPlaceReviews } = await import('../src/lib/integrations/google-places.js');
        const out = await getPlaceReviews('p1');
        expect(out.total_count).toBe(1240);
        expect(out.reviews).toHaveLength(1);
        expect(out.reviews[0].external_id).toBe('p1:1700000000');
        expect(out.reviews[0].published_at).toBe(new Date(1700000000 * 1000).toISOString());
        expect(out.reviews[0].rating).toBe(5);
    });

    it('throws a clear error when the key is missing', async () => {
        delete process.env.GOOGLE_PLACES_API_KEY;
        const { getPlaceReviews } = await import('../src/lib/integrations/google-places.js');
        await expect(getPlaceReviews('p1')).rejects.toThrow(/GOOGLE_PLACES_API_KEY/);
    });
});

describe('meta-reviews', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('maps recommendation_type to a 5/1 rating and derives an overall', async () => {
        vi.stubGlobal('fetch', mockFetch({
            data: [
                { created_time: '2026-01-01T10:00:00+0000', recommendation_type: 'positive', review_text: 'Loved it', reviewer: { name: 'Tom' } },
                { created_time: '2026-01-02T10:00:00+0000', recommendation_type: 'negative', review_text: 'Meh', reviewer: { name: 'Sam' } },
            ],
        }));
        const { getPageRatings } = await import('../src/lib/integrations/meta-reviews.js');
        const out = await getPageRatings('page1', 'page-token');
        expect(out.reviews).toHaveLength(2);
        expect(out.reviews[0].rating).toBe(5);
        expect(out.reviews[1].rating).toBe(1);
        expect(out.reviews[0].external_id).toBe('page1:2026-01-01T10:00:00+0000');
        expect(out.rating).toBe(2.5); // 1 of 2 positive → (0.5)*5
    });
});
