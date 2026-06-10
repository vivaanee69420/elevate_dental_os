// Google Places API client (reviews source for the Reviews screen).
//
// Places needs NO OAuth and no business ownership — a single operator API key
// (GOOGLE_PLACES_API_KEY) reads PUBLIC reviews for any listing by place_id. This
// is the pragmatic path vs the Business Profile / My Business API, which would
// need every GCP project allowlisted (0→300 QPM, a 3–10 day approval). The
// trade-off: Places returns at most ~5 reviews per location and is READ-ONLY
// (replies cannot be posted back to Google), but the overall rating + true total
// review count ARE returned and drive the dashboard aggregates.
//
//   search  → maps.googleapis.com/maps/api/place/textsearch/json   (place picker)
//   details → maps.googleapis.com/maps/api/place/details/json       (the reviews)
//
// One key serves every org; nothing here is per-tenant. The place_id↔practice
// mapping (review_sources) is the tenant data.

const PLACES_BASE = process.env.GOOGLE_PLACES_API_BASE || 'https://maps.googleapis.com/maps/api/place';

function apiKey() {
    const k = process.env.GOOGLE_PLACES_API_KEY;
    if (!k) throw new Error('GOOGLE_PLACES_API_KEY is not configured');
    return k;
}

// Places returns its own status string (separate from the HTTP status). ZERO_RESULTS
// is a normal empty answer; everything else non-OK is a real error to surface.
function assertPlacesOk(body, ctx) {
    const status = body?.status;
    if (status === 'OK' || status === 'ZERO_RESULTS') return;
    const msg = body?.error_message || status || 'unknown error';
    throw new Error(`Google Places ${ctx}: ${msg}`);
}

// Text Search — drives the "search-as-you-type" place picker. Returns the
// candidate listings (place_id + name + address + current rating/total) so the
// owner can pick the right practice location.
export async function searchPlaces(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const url = new URL(`${PLACES_BASE}/textsearch/json`);
    url.searchParams.set('query', q);
    url.searchParams.set('key', apiKey());
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google Places textsearch HTTP ${res.status}`);
    assertPlacesOk(body, 'textsearch');
    return (body.results ?? []).map((r) => ({
        place_id: r.place_id,
        name: r.name ?? null,
        address: r.formatted_address ?? null,
        rating: r.rating ?? null,
        total_count: r.user_ratings_total ?? null,
    })).filter((r) => r.place_id);
}

// Place Details — the actual reviews for one location. Google caps `reviews` at
// ~5 (most relevant), but `rating` + `user_ratings_total` reflect ALL reviews.
// Each review object has no stable id, so we synthesise one from place_id+time
// (an author posts at most once per place; `time` is a unix second timestamp).
export async function getPlaceReviews(placeId) {
    const id = String(placeId || '').trim();
    if (!id) throw new Error('place_id is required');
    const url = new URL(`${PLACES_BASE}/details/json`);
    url.searchParams.set('place_id', id);
    url.searchParams.set('fields', 'name,rating,user_ratings_total,reviews,formatted_address');
    // Newest first so the ≤5 we get are the most recent (default is "most relevant").
    url.searchParams.set('reviews_sort', 'newest');
    url.searchParams.set('key', apiKey());
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google Places details HTTP ${res.status}`);
    assertPlacesOk(body, 'details');
    const result = body.result ?? {};
    const reviews = (result.reviews ?? [])
        .filter((rv) => rv && rv.rating)
        .map((rv) => ({
            external_id: `${id}:${rv.time}`,
            author_name: rv.author_name ?? 'Google user',
            rating: Math.round(rv.rating),
            body: rv.text ?? '',
            // `time` is unix SECONDS; reviews.published_at is timestamptz.
            published_at: rv.time ? new Date(rv.time * 1000).toISOString() : null,
        }));
    return {
        name: result.name ?? null,
        address: result.formatted_address ?? null,
        rating: result.rating ?? null,
        total_count: result.user_ratings_total ?? null,
        reviews,
    };
}

export function isPlacesConfigured() {
    return !!process.env.GOOGLE_PLACES_API_KEY;
}
