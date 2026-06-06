'use client';
// Training — My Modules ("My Learning"). Pixel-faithful port of
// preview/elevate-dental-os-v2.html PAGES['training-my'], now wired to REAL
// data: useMyTraining (/api/training/my — enrolled courses + per-course
// progress) for the in-progress/completed buckets, and useLibrary
// (/api/training/library) for "recommended" (published, not yet enrolled).
//
// Emoji glyphs from the prototype are replaced with text/colour treatments
// (project rule 7).
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMyTraining, useLibrary, type MyEnrolment } from '../useLibrary';

const PURPLE = '#9333EA';
const PURPLE_DARK = '#6D28D9';
const GREEN = 'var(--success)';

/** Short uppercase tag for a module's track tile (no emojis). */
function trackTag(track: string): string {
  switch (track) {
    case 'implants':
      return 'IMP';
    case 'sales':
      return 'SAL';
    case 'marketing':
      return 'MKT';
    case 'business-health':
      return 'NUM';
    case 'foundations':
      return 'FND';
    default:
      return 'BIZ';
  }
}

/** My Modules screen. */
export default function MyModulesScreen() {
  const router = useRouter();
  const { data: my, isLoading } = useMyTraining();
  const { data: lib } = useLibrary();

  const enrolments: MyEnrolment[] = my?.enrolments ?? [];
  const mentorshipActive = lib?.mentorship_active ?? false;
  const modules = lib?.modules ?? [];

  const { inProgress, completed, recommended, availableCount } = useMemo(() => {
    const inProg = enrolments.filter(
      (e) => e.completed_lessons < e.total_lessons || e.total_lessons === 0,
    );
    const done = enrolments.filter(
      (e) => e.total_lessons > 0 && e.completed_lessons >= e.total_lessons,
    );
    const enrolledIds = new Set(enrolments.map((e) => e.course_id));
    const rec = modules
      .filter(
        (m) =>
          !enrolledIds.has(m.id) &&
          (m.access === 'free' || mentorshipActive),
      )
      .slice(0, 4);
    const avail = modules.filter(
      (m) => m.access === 'free' || mentorshipActive,
    ).length;
    return {
      inProgress: inProg,
      completed: done,
      recommended: rec,
      availableCount: avail,
    };
  }, [enrolments, modules, mentorshipActive]);

  /** Section heading style (Fraunces display, prototype sizing). */
  const h2: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    margin: '20px 0 10px',
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          My Learning
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Track your progress across the Plan4Growth Academy
        </p>
      </div>

      {/* Stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[
          { l: 'In progress', v: String(inProgress.length), c: PURPLE },
          { l: 'Completed', v: String(completed.length), c: GREEN },
          { l: 'Enrolled', v: String(enrolments.length) },
          { l: 'Available to you', v: String(availableCount) },
        ].map((s) => (
          <div key={s.l} className="card-padded">
            <div
              className="text-ink-muted"
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 700,
              }}
            >
              {s.l}
            </div>
            <div
              className="display font-bold"
              style={{
                fontSize: 28,
                marginTop: 4,
                color: s.c ?? 'var(--ink)',
              }}
            >
              {s.v}
            </div>
          </div>
        ))}
      </div>

      {/* Pick up where you left off */}
      {inProgress.length > 0 && (
        <>
          <h2 className="display" style={h2}>
            Pick up where you left off
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            {inProgress.map((e) => (
              <div
                key={e.course_id}
                className="card-padded"
                style={{ cursor: 'pointer' }}
                onClick={() => router.push(`/training-library/${e.course_id}`)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    className="display font-bold"
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 8,
                      background: `linear-gradient(135deg, ${PURPLE}, ${PURPLE_DARK})`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      letterSpacing: '0.04em',
                      color: 'white',
                      flexShrink: 0,
                    }}
                  >
                    {trackTag(e.track)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="display font-bold" style={{ fontSize: 14 }}>
                      {e.title}
                    </div>
                    <div
                      className="text-ink-muted"
                      style={{ fontSize: 11, margin: '4px 0' }}
                    >
                      {e.completed_lessons} of {e.total_lessons} lessons
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
                          width: `${e.progress_pct}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div
                    className="display font-bold"
                    style={{ fontSize: 18, color: PURPLE }}
                  >
                    {e.progress_pct}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <>
          <h2 className="display" style={h2}>
            Completed
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 10,
              marginBottom: 20,
            }}
          >
            {completed.map((e) => (
              <div
                key={e.course_id}
                className="card"
                style={{
                  padding: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                }}
                onClick={() => router.push(`/training-library/${e.course_id}`)}
              >
                <div
                  className="font-bold"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 6,
                    background: GREEN,
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                  }}
                >
                  &#10003;
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{e.title}</div>
                  <div className="text-ink-muted" style={{ fontSize: 11 }}>
                    {e.total_lessons} lessons · Level: {e.level}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Recommended */}
      {recommended.length > 0 && (
        <>
          <h2 className="display" style={h2}>
            Recommended for you
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 10,
            }}
          >
            {recommended.map((m) => (
              <div
                key={m.id}
                className="card-padded"
                style={{ cursor: 'pointer' }}
                onClick={() => router.push(`/training-library/${m.id}`)}
              >
                <div style={{ display: 'flex', gap: 10 }}>
                  <div
                    className="display font-bold"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 6,
                      background:
                        m.access === 'free'
                          ? 'linear-gradient(135deg, var(--success), #059669)'
                          : `linear-gradient(135deg, ${PURPLE}, ${PURPLE_DARK})`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      letterSpacing: '0.04em',
                      color: 'white',
                    }}
                  >
                    {trackTag(m.track)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>
                      {m.title}
                    </div>
                    <div
                      className="text-ink-muted"
                      style={{ fontSize: 10, marginTop: 2 }}
                    >
                      {m.lessons.length} lessons · Level: {m.level}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Empty-state nudge (nothing enrolled yet) */}
      {!isLoading && enrolments.length === 0 && (
        <div
          className="card-padded"
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            background: 'var(--brand-50)',
            marginTop: 20,
          }}
        >
          <h3
            className="display font-bold"
            style={{ fontSize: 18, margin: '8px 0' }}
          >
            Start your first module
          </h3>
          <p className="text-ink-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Browse the Module Library and enrol to start tracking progress.
          </p>
          <button
            onClick={() => router.push('/training-library')}
            style={{
              padding: '10px 18px',
              background: PURPLE,
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Browse the library
          </button>
        </div>
      )}
    </div>
  );
}
