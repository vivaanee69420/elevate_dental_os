'use client';
// Reviews & Reputation — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES.reviews). 4-up KPI strip,
// by-source / by-practice rating breakdowns, and a recent-reviews feed
// with respond / recover actions. Fed by the growth mock-data layer; swap
// to a real review-aggregator endpoint when one exists server-side.
// Star glyphs (typography, not emoji) are kept as the rating is core to
// the design; prototype emoji on the action button is dropped per rule 7.
//
// Data flow:
//   REVIEWS ──┬─► avgRating ──► KPI strip (+ awaiting-response count)
//             └─► recent-reviews feed
//   REVIEWS_BY_SOURCE / REVIEWS_BY_PRACTICE ──► two breakdown panels

import { useMemo } from 'react';
import { Card, KpiTile, Chip } from '@/components/ui';
import {
  REVIEWS,
  REVIEWS_BY_SOURCE,
  REVIEWS_BY_PRACTICE,
  REVIEWS_TOTAL,
} from '../data';

/** Render a 0-5 star rating as filled/hollow glyphs. */
function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ color: rating >= 4 ? '#F59E0B' : '#94A3B8' }}>
      {'★'.repeat(rating)}
      {'☆'.repeat(5 - rating)}
    </span>
  );
}

/** One rating-breakdown panel (used for both by-source and by-practice). */
function RatingPanel({
  title,
  rows,
}: {
  title: string;
  rows: { name: string; count: number; rating: number }[];
}) {
  return (
    <Card>
      <h2 className="display font-semibold mb-3" style={{ fontSize: 17 }}>
        {title}
      </h2>
      {rows.map((r, i) => (
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
      ))}
    </Card>
  );
}

/** Reviews & Reputation screen. */
export default function ReviewsScreen() {
  const { avgRating, awaiting } = useMemo(() => {
    const avg = REVIEWS.reduce((s, r) => s + r.rating, 0) / REVIEWS.length;
    const a = REVIEWS.filter((r) => !r.responded).length;
    return { avgRating: avg, awaiting: a };
  }, []);

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
          value={`${avgRating.toFixed(1)} ★`}
          delta="UK avg: 4.4"
          deltaTone="up"
        />
        <KpiTile
          label="Total reviews"
          value={REVIEWS_TOTAL.toLocaleString('en-GB')}
          delta="+42 this month"
          deltaTone="up"
        />
        <KpiTile
          label="Awaiting response"
          value={String(awaiting)}
          delta="Action needed"
          deltaTone="down"
        />
        <KpiTile
          label="Recovery rate"
          value="68%"
          delta="Of negative reviews to 5 star"
          deltaTone="up"
        />
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <RatingPanel title="By source" rows={REVIEWS_BY_SOURCE} />
        <RatingPanel title="By practice" rows={REVIEWS_BY_PRACTICE} />
      </div>

      <Card padded={false}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 className="display font-semibold" style={{ fontSize: 17 }}>
            Recent reviews
          </h2>
        </div>
        {REVIEWS.map((r, i) => (
          <div
            key={`${r.author}-${i}`}
            style={{
              padding: '16px 20px',
              borderBottom: i < REVIEWS.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <strong>{r.author}</strong>
                  <Chip colour="blue">{r.source}</Chip>
                  <Chip colour="brand">{r.practice}</Chip>
                  <span className="text-ink-muted" style={{ fontSize: 11 }}>
                    {r.time}
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>
                  <Stars rating={r.rating} />
                </div>
              </div>
              {r.responded ? (
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
            <div
              style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8, color: 'var(--ink)' }}
            >
              &quot;{r.text}&quot;
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
