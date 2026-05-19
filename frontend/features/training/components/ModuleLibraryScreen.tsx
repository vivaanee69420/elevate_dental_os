'use client';
// Training — Module Library. Pixel-faithful port of
// preview/elevate-dental-os-v2.html PAGES['training-library'].
//
// Filter pipeline:
//   filter ('all' | 'free' | 'mentorship' | <track>)
//     -> filtered modules
//       -> grid of module cards (progress / locked / start states)
//
// Mentorship status is the static MENTORSHIP_STATUS snapshot; in the
// prototype mentorship is active so every module unlocks. Emoji glyphs
// from the prototype are replaced with text labels (project rule 7).
import { useMemo, useState } from 'react';
import {
  TRAINING_MODULES,
  MENTORSHIP_STATUS,
  getModuleProgress,
} from '../data';

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
  const [filter, setFilter] = useState<Filter>('all');
  const status = MENTORSHIP_STATUS;

  // Distinct tracks, in first-seen order (mirrors [...new Set(...)]).
  const tracks = useMemo(
    () => [...new Set(TRAINING_MODULES.map((m) => m.track))],
    [],
  );

  const freeCount = TRAINING_MODULES.filter((m) => m.access === 'free').length;
  const mentorshipCount = TRAINING_MODULES.filter(
    (m) => m.access === 'mentorship',
  ).length;

  // Apply the active filter.
  const filtered = useMemo(() => {
    if (filter === 'all') return TRAINING_MODULES;
    if (filter === 'free')
      return TRAINING_MODULES.filter((m) => m.access === 'free');
    if (filter === 'mentorship')
      return TRAINING_MODULES.filter((m) => m.access === 'mentorship');
    return TRAINING_MODULES.filter((m) => m.track === filter);
  }, [filter]);

  // Filter buttons: the three specials, then one per track.
  const filterButtons: { v: Filter; l: string; n: number }[] = [
    { v: 'all', l: 'All', n: TRAINING_MODULES.length },
    { v: 'free', l: 'Free', n: freeCount },
    { v: 'mentorship', l: 'Mentorship', n: mentorshipCount },
    ...tracks.map((t) => ({
      v: t,
      l: t.replace('-', ' '),
      n: TRAINING_MODULES.filter((m) => m.track === t).length,
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
          {TRAINING_MODULES.length} modules · {freeCount} free,{' '}
          {mentorshipCount} mentorship-only
        </p>
      </div>

      {/* Mentorship status banner */}
      <div
        className="card-padded"
        style={{
          background: status.active
            ? `linear-gradient(135deg, ${PURPLE} 0%, ${PURPLE_DARK} 100%)`
            : 'linear-gradient(135deg, #6B7280 0%, #4B5563 100%)',
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
            {status.active
              ? `Mentorship active · ${status.tier}`
              : 'Mentorship inactive'}
          </div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
            {status.active
              ? `All ${mentorshipCount} mentorship modules unlocked · renews ${new Date(
                  status.renewsAt,
                ).toLocaleDateString('en-GB', {
                  month: 'long',
                  year: 'numeric',
                })}`
              : `Upgrade to Diploma Member to unlock ${mentorshipCount} mentorship modules + monthly group calls`}
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

      {/* Module grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 14,
        }}
      >
        {filtered.map((m) => {
          const progress = getModuleProgress(m.id);
          const locked = m.access === 'mentorship' && !status.active;
          const pct =
            m.lessons.length > 0
              ? Math.round(
                  (progress.completedLessons / m.lessons.length) * 100,
                )
              : 0;
          return (
            <div
              key={m.id}
              className="card"
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
                      ? 'linear-gradient(135deg, #10B981, #059669)'
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
                  {m.lessons.length > 1 ? 's' : ''} · Level: {m.level}
                </div>
                {!locked && progress.started ? (
                  <div style={{ marginTop: 8 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 10,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        className="text-ink-muted"
                        style={{ fontWeight: 600 }}
                      >
                        {progress.completedLessons}/{m.lessons.length} lessons
                      </span>
                      <span style={{ color: PURPLE, fontWeight: 700 }}>
                        {pct}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: 'var(--bg)',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          background: `linear-gradient(90deg, ${PURPLE}, ${PURPLE_DARK})`,
                          width: `${pct}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : !locked ? (
                  <button
                    style={{
                      width: '100%',
                      padding: 8,
                      background: PURPLE,
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      marginTop: 4,
                    }}
                  >
                    Start module
                  </button>
                ) : (
                  <button
                    style={{
                      width: '100%',
                      padding: 8,
                      background: `linear-gradient(135deg, ${PURPLE}, ${PURPLE_DARK})`,
                      color: 'white',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      marginTop: 4,
                    }}
                  >
                    Preview &amp; unlock
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
