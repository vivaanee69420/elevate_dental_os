'use client';
// Training — My Modules ("My Learning"). Pixel-faithful port of
// preview/elevate-dental-os-v2.html PAGES['training-my'].
//
// Derivation pipeline (off the static MODULE_PROGRESS snapshot):
//   modules + progress
//     -> inProgress  (started, not all lessons done)
//     -> completed   (all lessons done)
//     -> recommended (not started, accessible)  [first 4]
//     -> timeInvested = sum(pct(module) * module minutes)
//
// Emoji glyphs from the prototype are replaced with text/colour
// treatments (project rule 7).
import { useMemo } from 'react';
import {
  TRAINING_MODULES,
  MENTORSHIP_STATUS,
  getModuleProgress,
} from '../data';

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
  const status = MENTORSHIP_STATUS;

  // Bucket modules and compute time invested.
  const { inProgress, completed, recommended, totalMinutesWatched } =
    useMemo(() => {
      const inProg = TRAINING_MODULES.filter((m) => {
        const p = getModuleProgress(m.id);
        return p.started && p.completedLessons < m.lessons.length;
      });
      const done = TRAINING_MODULES.filter((m) => {
        const p = getModuleProgress(m.id);
        return p.completedLessons >= m.lessons.length && m.lessons.length > 0;
      });
      const rec = TRAINING_MODULES.filter((m) => {
        const p = getModuleProgress(m.id);
        return !p.started && (m.access === 'free' || status.active);
      }).slice(0, 4);
      const mins = TRAINING_MODULES.reduce((sum, m) => {
        const p = getModuleProgress(m.id);
        if (!p.started) return sum;
        const totalMin = parseInt(m.duration, 10) || 30;
        return (
          sum + Math.round((p.completedLessons / m.lessons.length) * totalMin)
        );
      }, 0);
      return {
        inProgress: inProg,
        completed: done,
        recommended: rec,
        totalMinutesWatched: mins,
      };
    }, [status.active]);

  const availableCount = TRAINING_MODULES.filter(
    (m) => m.access === 'free' || status.active,
  ).length;

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
          {
            l: 'In progress',
            v: String(inProgress.length),
            c: PURPLE,
          },
          {
            l: 'Completed',
            v: String(completed.length),
            c: GREEN,
          },
          {
            l: 'Time invested',
            v: `${Math.floor(totalMinutesWatched / 60)}h ${
              totalMinutesWatched % 60
            }m`,
          },
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
            {inProgress.map((m) => {
              const p = getModuleProgress(m.id);
              const pct = Math.round(
                (p.completedLessons / m.lessons.length) * 100,
              );
              return (
                <div
                  key={m.id}
                  className="card-padded"
                  style={{ cursor: 'pointer' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
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
                      {trackTag(m.track)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="display font-bold"
                        style={{ fontSize: 14 }}
                      >
                        {m.title}
                      </div>
                      <div
                        className="text-ink-muted"
                        style={{ fontSize: 11, margin: '4px 0' }}
                      >
                        Lesson {p.completedLessons + 1} of {m.lessons.length}
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
                    <div
                      className="display font-bold"
                      style={{ fontSize: 18, color: PURPLE }}
                    >
                      {pct}%
                    </div>
                  </div>
                </div>
              );
            })}
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
            {completed.map((m) => (
              <div
                key={m.id}
                className="card"
                style={{
                  padding: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
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
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {m.title}
                  </div>
                  <div
                    className="text-ink-muted"
                    style={{ fontSize: 11 }}
                  >
                    {m.duration} · {m.instructor}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Recommended */}
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
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: 1.3,
                  }}
                >
                  {m.title}
                </div>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 10, marginTop: 2 }}
                >
                  {m.duration} · {m.lessons.length} lessons
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty-state nudge (only if nothing started) */}
      {TRAINING_MODULES.filter((m) => getModuleProgress(m.id).started)
        .length === 0 && (
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
          <p
            className="text-ink-muted"
            style={{ fontSize: 13, marginBottom: 12 }}
          >
            Most owners start with &quot;CEO Mindset Reset&quot; or
            &quot;Reading Your Numbers&quot;.
          </p>
          <button
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
