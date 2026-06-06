'use client';
// Training — Module Library. Pixel-faithful port of
// preview/elevate-dental-os-v2.html PAGES['training-library], now wired to the
// REAL published catalogue (useLibrary -> /api/training/library). Mentorship
// gating comes from the org's mentorship_active flag. Cards navigate to the
// course detail view. Per-module PROGRESS is still pending (always "not
// started" for now — see MODULE-LIBRARY.md).
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui';
import { useLibrary, type LibModule } from '../useLibrary';

const PURPLE = '#9333EA';
const PURPLE_DARK = '#6D28D9';

/** Filter keys that are not tracks. */
type SpecialFilter = 'all' | 'free' | 'mentorship';
type Filter = SpecialFilter | string;

/** Short uppercase label shown on a module's cover tile (no emojis). */
function trackTag(track: string): string {
  switch (track) {
    case 'implants':
      return 'IMPLANTS';
    case 'sales':
      return 'SALES';
    case 'marketing':
      return 'MARKETING';
    case 'business-health':
      return 'NUMBERS';
    case 'foundations':
      return 'FOUNDATIONS';
    default:
      return 'BUSINESS';
  }
}

/** Module Library screen. */
export default function ModuleLibraryScreen() {
  const router = useRouter();
  const { data, isLoading, error } = useLibrary();
  const modules: LibModule[] = data?.modules ?? [];
  const mentorshipActive = data?.mentorship_active ?? false;
  const status = { active: mentorshipActive };

  const [filter, setFilter] = useState<Filter>('all');

  // Distinct tracks, in first-seen order (mirrors [...new Set(...)]).
  const tracks = useMemo(
    () => [...new Set(modules.map((m) => m.track))],
    [modules],
  );

  const freeCount = modules.filter((m) => m.access === 'free').length;
  const mentorshipCount = modules.filter((m) => m.access === 'mentorship').length;

  // Apply the active filter.
  const filtered = useMemo(() => {
    if (filter === 'all') return modules;
    if (filter === 'free') return modules.filter((m) => m.access === 'free');
    if (filter === 'mentorship')
      return modules.filter((m) => m.access === 'mentorship');
    return modules.filter((m) => m.track === filter);
  }, [filter, modules]);

  // Filter buttons: the three specials, then one per track.
  const filterButtons: { v: Filter; l: string; n: number }[] = [
    { v: 'all', l: 'All', n: modules.length },
    { v: 'free', l: 'Free', n: freeCount },
    { v: 'mentorship', l: 'Mentorship', n: mentorshipCount },
    ...tracks.map((t) => ({
      v: t,
      l: t.replace('-', ' '),
      n: modules.filter((m) => m.track === t).length,
    })),
  ];

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Plan4Growth Module Library
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {modules.length} modules · {freeCount} free, {mentorshipCount}{' '}
          mentorship-only
        </p>
      </div>

      {error && (
        <div className="text-sm text-danger mb-4">
          {(error as Error).message}
        </div>
      )}

      {/* Mentorship status banner */}
      <div
        className="card-padded"
        style={{
          background: status.active
            ? `linear-gradient(135deg, ${PURPLE} 0%, ${PURPLE_DARK} 100%)`
            : 'linear-gradient(135deg, var(--ink-muted) 0%, #4B5563 100%)',
          color: 'white',
          border: 'none',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <div style={{ flex: 1 }}>
          <div className="display font-bold" style={{ fontSize: 18 }}>
            {status.active ? 'Mentorship active' : 'Mentorship inactive'}
          </div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
            {status.active
              ? `All ${mentorshipCount} mentorship modules unlocked`
              : `Upgrade to unlock ${mentorshipCount} mentorship modules + monthly group calls`}
          </div>
        </div>
        <button
          style={{
            background: 'white',
            color: PURPLE_DARK,
            border: 'none',
            padding: '10px 18px',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {status.active ? 'Book a call' : 'Upgrade — £497/mo'}
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'var(--ink-muted)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginRight: 6,
          }}
        >
          Filter:
        </span>
        {filterButtons.map((f) => {
          const active = filter === f.v;
          return (
            <button
              key={String(f.v)}
              onClick={() => setFilter(f.v)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid var(--border)',
                textTransform: 'capitalize',
                background: active ? PURPLE : 'white',
                color: active ? 'white' : 'var(--ink)',
                borderColor: active ? PURPLE : 'var(--border)',
              }}
            >
              {f.l} <span style={{ opacity: 0.7 }}>·{f.n}</span>
            </button>
          );
        })}
      </div>

      {/* Loading skeleton grid */}
      {isLoading && modules.length === 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 14,
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card-padded">
              <Skeleton className="w-full mb-3" style={{ height: 140 }} />
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && modules.length === 0 && (
        <div
          className="card-padded text-ink-muted"
          style={{ textAlign: 'center', padding: 40, fontSize: 13 }}
        >
          No published courses yet.
        </div>
      )}

      {/* Module grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 14,
        }}
      >
        {filtered.map((m) => {
          const locked = m.access === 'mentorship' && !status.active;
          return (
            <div
              key={m.id}
              className="card"
              onClick={() => router.push(`/training-library/${m.id}`)}
              style={{
                overflow: 'hidden',
                cursor: 'pointer',
                border: m.featured ? `2px solid ${PURPLE}` : undefined,
                position: locked ? 'relative' : undefined,
              }}
            >
              {/* Cover */}
              <div
                style={{
                  height: 100,
                  background:
                    m.access === 'free'
                      ? 'linear-gradient(135deg, var(--success), #059669)'
                      : `linear-gradient(135deg, ${PURPLE}, ${PURPLE_DARK})`,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span
                  className="display font-bold"
                  style={{
                    fontSize: 18,
                    color: 'white',
                    letterSpacing: '0.08em',
                    opacity: locked ? 0.5 : 1,
                  }}
                >
                  {trackTag(m.track)}
                </span>
                {m.featured && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      background: 'white',
                      color: PURPLE,
                      fontSize: 10,
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Featured
                  </div>
                )}
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    background: 'rgba(0,0,0,0.4)',
                    color: 'white',
                    fontSize: 10,
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {m.access === 'free' ? 'Free' : 'Mentorship'}
                </div>
                {locked && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 8,
                      left: 8,
                      background: 'rgba(0,0,0,0.6)',
                      color: 'white',
                      fontSize: 10,
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontWeight: 700,
                    }}
                  >
                    Preview available
                  </div>
                )}
              </div>

              {/* Body */}
              <div style={{ padding: 14 }}>
                <div
                  className="display font-bold"
                  style={{ fontSize: 15, lineHeight: 1.3, marginBottom: 6 }}
                >
                  {m.title}
                </div>
                <div
                  className="text-ink-muted"
                  style={{
                    fontSize: 12,
                    lineHeight: 1.4,
                    marginBottom: 10,
                    minHeight: 34,
                  }}
                >
                  {m.desc}
                </div>
                <div
                  className="text-ink-muted"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    marginBottom: 10,
                  }}
                >
                  <span>{m.instructor}</span>
                  <span>{m.duration}</span>
                </div>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 11, marginBottom: 8 }}
                >
                  {m.lessons.length} lesson
                  {m.lessons.length === 1 ? '' : 's'} · Level: {m.level}
                </div>
                {/* Progress (enrolled, unlocked courses only) */}
                {!locked && m.enrolled && m.total_lessons > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div
                      className="text-ink-muted"
                      style={{ fontSize: 10, marginBottom: 4 }}
                    >
                      {m.completed_lessons}/{m.total_lessons} complete ·{' '}
                      {m.progress_pct}%
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 3,
                        background: 'var(--border)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${m.progress_pct}%`,
                          background: PURPLE,
                        }}
                      />
                    </div>
                  </div>
                )}
                <button
                  style={{
                    width: '100%',
                    padding: 8,
                    background: locked
                      ? `linear-gradient(135deg, ${PURPLE}, ${PURPLE_DARK})`
                      : PURPLE,
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginTop: 4,
                  }}
                >
                  {locked
                    ? 'Preview & unlock'
                    : !m.enrolled
                      ? 'Start module'
                      : m.progress_pct === 100
                        ? 'Review module'
                        : 'Continue module'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
