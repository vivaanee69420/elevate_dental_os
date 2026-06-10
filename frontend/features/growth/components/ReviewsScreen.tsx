'use client';
// Reviews & Reputation — LIVE data. Google reviews via the Places API, Facebook
// recommendations via the Graph API, pulled into the reviews table by the
// reviews sync and surfaced through /api/reviews. The 4-up KPI strip + the
// by-source / by-practice panels are computed server-side from the connected
// review_sources (true rating + total count); the recent-reviews feed is the
// individual reviews each provider returned (Google caps at ~5/location).
//
// Account filter: slice everything by source (Google/Facebook) and/or by
// practice. Owners manage the connected sources via the "Manage sources" panel.
// Star glyphs are typography (rule 7), not emoji.

import { useMemo, useState } from 'react';
import { Card, KpiTile, Chip } from '@/components/ui';
import { useMe } from '@/hooks/useMe';
import { useReviews, useRespondToReview } from '../reviewsHooks';
import type { ReviewProvider, ReviewRow, ReviewBreakdownRow } from '../reviewsApi';
import ReviewSourcesPanel from './ReviewSourcesPanel';

/** Render a 0-5 star rating as filled/hollow glyphs. */
function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ color: rating >= 4 ? 'var(--warning)' : 'var(--ink-soft)' }}>
      {'★'.repeat(rating)}
      {'☆'.repeat(5 - rating)}
    </span>
  );
}

/** One rating-breakdown panel (used for both by-source and by-practice). */
function RatingPanel({ title, rows }: { title: string; rows: ReviewBreakdownRow[] }) {
  return (
    <Card>
      <h2 className="display font-semibold mb-3" style={{ fontSize: 17 }}>{title}</h2>
      {rows.length === 0 ? (
        <p className="text-ink-muted" style={{ fontSize: 12 }}>No data yet.</p>
      ) : rows.map((r, i) => (
        <div
          key={r.name}
          className="flex justify-between items-center"
          style={{ padding: '10px 0', borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none' }}
        >
          <div>
            <strong>{r.name}</strong>
            <div className="text-ink-muted" style={{ fontSize: 11 }}>
              {r.count.toLocaleString('en-GB')} reviews
            </div>
          </div>
          <div className="display font-bold" style={{ fontSize: 18 }}>{r.rating} {'★'}</div>
        </div>
      ))}
    </Card>
  );
}

/** A relative "x ago" string from an ISO timestamp. */
function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

const SOURCE_CHIP: Record<string, string> = { google: 'Google', facebook: 'Facebook' };

export default function ReviewsScreen() {
  const { data: me } = useMe();
  const isOwner = me?.role === 'owner';

  const [source, setSource] = useState<ReviewProvider | null>(null);
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [manage, setManage] = useState(false);

  const { data, isLoading, isError, error } = useReviews({ source, practiceId });
  const respond = useRespondToReview();

  const reviews = data?.reviews ?? [];
  const summary = data?.summary;
  const sources = data?.sources ?? [];

  // Practice options for the filter — distinct practices that have a source.
  const practiceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sources) {
      if (s.practice_id && s.practice_name) map.set(s.practice_id, s.practice_name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [sources]);

  function onRespond(r: ReviewRow) {
    const text = window.prompt('Your response (recorded internally — Google/Facebook are read-only):');
    if (text && text.trim()) respond.mutate({ id: r.id, response: text.trim() });
  }

  const connected = summary?.connected ?? false;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="display text-3xl font-bold">Reviews &amp; Reputation</h1>
          <p className="text-sm text-ink-muted mt-1">
            Live Google &amp; Facebook reviews across your practices · respond and recover
          </p>
        </div>
        {isOwner && (
          <button className="btn btn-primary" onClick={() => setManage((m) => !m)}>
            {manage ? 'Done' : 'Manage sources'}
          </button>
        )}
      </div>

      {manage && isOwner && (
        <div className="mb-4">
          <ReviewSourcesPanel onClose={() => setManage(false)} />
        </div>
      )}

      {/* Account filter bar */}
      <div className="mb-4 flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
        <FilterChip label="All sources" active={source === null} onClick={() => setSource(null)} />
        <FilterChip label="Google" active={source === 'google'} onClick={() => setSource('google')} />
        <FilterChip label="Facebook" active={source === 'facebook'} onClick={() => setSource('facebook')} />
        {practiceOptions.length > 0 && (
          <select
            value={practiceId ?? ''}
            onChange={(e) => setPracticeId(e.target.value || null)}
            style={{ fontSize: 13, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, marginLeft: 8 }}
          >
            <option value="">All practices</option>
            {practiceOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {isError ? (
        <Card><p style={{ fontSize: 13, color: 'var(--danger, #c0392b)' }}>{(error as Error)?.message || 'Failed to load reviews'}</p></Card>
      ) : !connected && !isLoading ? (
        <Card>
          <h2 className="display font-semibold mb-2" style={{ fontSize: 17 }}>No review sources connected</h2>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            {isOwner
              ? 'Click “Manage sources” to connect your practices’ Google listings and Facebook pages, then sync to pull live reviews.'
              : 'Ask an owner to connect your Google and Facebook review sources.'}
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <KpiTile label="Avg rating" value={`${(summary?.avg_rating ?? 0).toFixed(1)} ★`} delta="UK avg: 4.4" deltaTone="up" />
            <KpiTile label="Total reviews" value={(summary?.total ?? 0).toLocaleString('en-GB')} delta="Across connected sources" deltaTone="muted" />
            <KpiTile label="Awaiting response" value={String(summary?.awaiting ?? 0)} delta={summary?.awaiting ? 'Action needed' : 'All caught up'} deltaTone={summary?.awaiting ? 'down' : 'up'} />
            <KpiTile label="Sources" value={String(sources.filter((s) => s.is_selected).length)} delta={`${sources.length} configured`} deltaTone="muted" />
          </div>

          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <RatingPanel title="By source" rows={summary?.by_source ?? []} />
            <RatingPanel title="By practice" rows={summary?.by_practice ?? []} />
          </div>

          <Card padded={false}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <h2 className="display font-semibold" style={{ fontSize: 17 }}>Recent reviews</h2>
            </div>
            {isLoading ? (
              <div style={{ padding: '16px 20px' }}><p className="text-ink-muted" style={{ fontSize: 13 }}>Loading…</p></div>
            ) : reviews.length === 0 ? (
              <div style={{ padding: '16px 20px' }}><p className="text-ink-muted" style={{ fontSize: 13 }}>No reviews synced yet.</p></div>
            ) : reviews.map((r, i) => (
              <div
                key={r.id}
                style={{ padding: '16px 20px', borderBottom: i < reviews.length - 1 ? '1px solid var(--border)' : 'none' }}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <strong>{r.author_name || 'Anonymous'}</strong>
                      <Chip colour="blue">{SOURCE_CHIP[r.source] || r.source}</Chip>
                      {r.practice_name && <Chip colour="brand">{r.practice_name}</Chip>}
                      <span className="text-ink-muted" style={{ fontSize: 11 }}>{timeAgo(r.published_at)}</span>
                    </div>
                    <div style={{ marginTop: 4 }}><Stars rating={r.rating} /></div>
                  </div>
                  {r.responded_at ? (
                    <Chip colour="emerald">Responded</Chip>
                  ) : (
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 12, padding: '6px 12px' }}
                      disabled={respond.isPending}
                      onClick={() => onRespond(r)}
                    >
                      {r.rating <= 3 ? 'Recover' : 'Reply'}
                    </button>
                  )}
                </div>
                {r.body && (
                  <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8, color: 'var(--ink)' }}>
                    &quot;{r.body}&quot;
                  </div>
                )}
                {r.response_body && (
                  <div style={{ fontSize: 12, marginTop: 8, padding: '8px 12px', background: 'var(--surface-2, #f6f7f9)', borderRadius: 6, color: 'var(--ink-muted)' }}>
                    <strong style={{ color: 'var(--ink)' }}>Your response:</strong> {r.response_body}
                  </div>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 13, padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
        border: '1px solid var(--border)',
        background: active ? 'var(--brand)' : 'white',
        color: active ? 'white' : 'var(--ink)',
        fontWeight: active ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}
