'use client';
// Reviews & Reputation — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES.reviews). 4-up KPI strip,
// by-source / by-practice rating breakdowns, and a recent-reviews feed
// with respond / recover actions. Now fed by the live reviews endpoint
// (GET /api/reviews) via useReviews(); aggregates (avg rating, awaiting
// response, by-source / by-practice) are derived client-side from the rows.
// Star glyphs (typography, not emoji) are kept as the rating is core to
// the design; prototype emoji on the action button is dropped per rule 7.
//
// Data flow:
//   useReviews() ──┬─► avgRating + total + awaiting ──► KPI strip
//                  ├─► by-source / by-practice breakdown panels (derived)
//                  └─► recent-reviews feed

import { useMemo } from 'react';
import { Card, KpiTile, Chip } from '@/components/ui';
import { useReviews } from '../hooks';
import type { Review } from '../reviews-loyalty-api';

/** Human-readable label for a review source. */
const SOURCE_LABEL: Record<string, string> = {
  google: 'Google',
  trustpilot: 'Trustpilot',
  facebook: 'Facebook',
  treatwell: 'Treatwell',
  direct: 'Direct',
};

/** Render a 0-5 star rating as filled/hollow glyphs. */
function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ color: rating >= 4 ? 'var(--warning)' : 'var(--ink-soft)' }}>
      {'★'.repeat(rating)}
      {'☆'.repeat(5 - rating)}
    </span>
  );
}

/** A derived rating-breakdown row (count + mean rating for a group). */
interface BreakdownRow {
  name: string;
  count: number;
  rating: number;
}

/** Group reviews by a key, returning count + mean rating per group, busiest first. */
function breakdown(reviews: Review[], keyFn: (r: Review) => string | null): BreakdownRow[] {
  const groups = new Map<string, { count: number; sum: number }>();
  for (const r of reviews) {
    const name = keyFn(r);
    if (!name) continue;
    const g = groups.get(name) ?? { count: 0, sum: 0 };
    g.count += 1;
    g.sum += r.rating;
    groups.set(name, g);
  }
  return Array.from(groups.entries())
    .map(([name, g]) => ({ name, count: g.count, rating: Math.round((g.sum / g.count) * 10) / 10 }))
    .sort((a, b) => b.count - a.count);
}

/** One rating-breakdown panel (used for both by-source and by-practice). */
function RatingPanel({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <Card>
      <h2 className="display font-semibold mb-3" style={{ fontSize: 17 }}>
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          No reviews yet.
        </p>
      ) : (
        rows.map((r, i) => (
          <div
            key={r.name}
            className="flex justify-between items-center"
            style={{
              padding: '10px 0',
              borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div>
              <strong>{r.name}</strong>
              <div className="text-ink-muted" style={{ fontSize: 11 }}>
                {r.count.toLocaleString('en-GB')} reviews
              </div>
            </div>
            <div className="display font-bold" style={{ fontSize: 18 }}>
              {r.rating} {'★'}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

/** Format an ISO timestamp as a short en-GB date. */
function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Reviews & Reputation screen. */
export default function ReviewsScreen() {
  const { data, isLoading, isError } = useReviews();
  const reviews = useMemo<Review[]>(() => data?.reviews ?? [], [data]);

  const { avgRating, total, awaiting } = useMemo(() => {
    const t = reviews.length;
    const avg = t ? reviews.reduce((s, r) => s + r.rating, 0) / t : 0;
    const a = reviews.filter((r) => !r.responded_at).length;
    return { avgRating: avg, total: t, awaiting: a };
  }, [reviews]);

  const bySource = useMemo(
    () => breakdown(reviews, (r) => SOURCE_LABEL[r.source] ?? r.source),
    [reviews],
  );
  const byPractice = useMemo(
    () => breakdown(reviews, (r) => r.practice_id),
    [reviews],
  );

  const hasReviews = reviews.length > 0;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="display text-3xl font-bold">Reviews &amp; Reputation</h1>
          <p className="text-sm text-ink-muted mt-1">
            Track and respond to reviews across all platforms · auto-recover unhappy
            reviewers
          </p>
        </div>
        <button className="btn btn-primary">Request reviews</button>
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile
          label="Avg rating (group)"
          value={hasReviews ? `${avgRating.toFixed(1)} ★` : '—'}
          delta="UK avg: 4.4"
          deltaTone="up"
        />
        <KpiTile
          label="Total reviews"
          value={total.toLocaleString('en-GB')}
        />
        <KpiTile
          label="Awaiting response"
          value={String(awaiting)}
          delta={awaiting > 0 ? 'Action needed' : 'All caught up'}
          deltaTone={awaiting > 0 ? 'down' : 'up'}
        />
        <KpiTile
          label="Responded"
          value={String(total - awaiting)}
          delta={total ? `${Math.round(((total - awaiting) / total) * 100)}% of reviews` : '—'}
          deltaTone="up"
        />
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <RatingPanel title="By source" rows={bySource} />
        <RatingPanel title="By practice" rows={byPractice} />
      </div>

      <Card padded={false}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 className="display font-semibold" style={{ fontSize: 17 }}>
            Recent reviews
          </h2>
        </div>
        {!hasReviews && (
          <div className="text-ink-muted" style={{ padding: '16px 20px', fontSize: 13 }}>
            {isLoading
              ? 'Loading reviews…'
              : isError
              ? 'Could not load reviews. Please try again.'
              : 'No reviews yet. Connect a review source to populate this.'}
          </div>
        )}
        {reviews.map((r, i) => (
          <div
            key={r.id}
            style={{
              padding: '16px 20px',
              borderBottom: i < reviews.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <strong>{r.author_name ?? 'Anonymous'}</strong>
                  <Chip colour="blue">{SOURCE_LABEL[r.source] ?? r.source}</Chip>
                  <span className="text-ink-muted" style={{ fontSize: 11 }}>
                    {fmtWhen(r.published_at)}
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>
                  <Stars rating={r.rating} />
                </div>
              </div>
              {r.responded_at ? (
                <Chip colour="emerald">Responded</Chip>
              ) : (
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  {r.rating <= 3 ? 'Recover' : 'Reply'}
                </button>
              )}
            </div>
            {r.body && (
              <div
                style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8, color: 'var(--ink)' }}
              >
                &quot;{r.body}&quot;
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
