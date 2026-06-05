'use client';
// FIRE Plan — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES['wealth-fire']). Hero banner (current NW / FIRE number / years),
// progress bar, a 7-year path table, and exit-strategy options.
//
// Data flow:
//   FIRE_NUMBER = targetMonthlyIncome * 12 * 25   (25x annual expenses)
//   progress%   = currentNW / FIRE_NUMBER * 100
//   path[y].nw  = currentNW * 1.10^y + y * annualSavings   (y = 1..7)
//
// The prototype marks years reaching the FIRE number with a target emoji;
// project rule 7 forbids emojis, so we use the text label "FIRE" instead.
//
// Fed by ../data FIRE / FIRE_NUMBER / EXIT_OPTIONS; swap to a real
// /wealth/fire endpoint when it exists. Owner-only screen.
import { useMemo } from 'react';
import { FIRE, FIRE_NUMBER, EXIT_OPTIONS, formatPoundsCompact } from '../data';

/** FIRE Plan screen. */
export default function FirePlanScreen() {
  const { currentNW, yearsToFire, annualSavings } = FIRE;

  // Percentage of the way to the FIRE number (clamped at the prototype's
  // raw value — no clamping in the original).
  const progressPct = (currentNW / FIRE_NUMBER) * 100;

  // 7-year compounding path: 10% growth on net worth plus flat annual
  // savings, matching the prototype formula exactly.
  const path = useMemo(
    () =>
      [1, 2, 3, 4, 5, 6, 7].map((y) => {
        const nw = currentNW * Math.pow(1.1, y) + y * annualSavings;
        return { year: 2026 + y, nw, hitFire: nw >= FIRE_NUMBER };
      }),
    [currentNW, annualSavings]
  );

  const cellLeft: React.CSSProperties = { padding: 8 };
  const cellRight: React.CSSProperties = { padding: 8, textAlign: 'right' };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          FIRE Plan
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Financial Independence · Retire Early
        </p>
      </div>

      {/* Hero banner */}
      <div
        className="card-padded"
        style={{
          background: 'linear-gradient(135deg, var(--brand) 0%, #085857 100%)',
          color: 'white',
          border: 'none',
          textAlign: 'center',
          marginBottom: 16,
        }}
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                opacity: 0.8,
                textTransform: 'uppercase',
              }}
            >
              Current net worth
            </div>
            <div
              className="display font-bold"
              style={{ fontSize: 32, margin: '6px 0' }}
            >
              {formatPoundsCompact(currentNW)}
            </div>
          </div>
          <div
            style={{
              borderLeft: '1px solid rgba(255,255,255,0.15)',
              borderRight: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                opacity: 0.8,
                textTransform: 'uppercase',
              }}
            >
              FIRE number
            </div>
            <div
              className="display font-bold"
              style={{ fontSize: 32, margin: '6px 0', color: 'var(--accent)' }}
            >
              {formatPoundsCompact(FIRE_NUMBER)}
            </div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              25× annual expenses
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                opacity: 0.8,
                textTransform: 'uppercase',
              }}
            >
              Years to FIRE
            </div>
            <div
              className="display font-bold"
              style={{ fontSize: 32, margin: '6px 0' }}
            >
              {yearsToFire}
            </div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>By 2033</div>
          </div>
        </div>
        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          <div
            style={{
              height: 14,
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 7,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                background: 'var(--accent)',
                width: `${progressPct.toFixed(1)}%`,
                borderRadius: 7,
              }}
            />
          </div>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            {progressPct.toFixed(1)}% of the way there ·{' '}
            {formatPoundsCompact(FIRE_NUMBER - currentNW)} to go
          </div>
        </div>
      </div>

      {/* Path + exit options */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Path to FIRE */}
        <div className="card-padded">
          <h2
            className="display font-bold"
            style={{ fontSize: 17, marginBottom: 12 }}
          >
            Path to FIRE
          </h2>
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="bg-bg">
                <th style={{ ...cellLeft, textAlign: 'left' }}>Year</th>
                <th style={cellRight}>Net worth</th>
                <th style={cellRight}>Required savings</th>
              </tr>
            </thead>
            <tbody>
              {path.map((r, i) => (
                <tr key={r.year}>
                  <td style={cellLeft}>
                    2026 + {i + 1} = {r.year}
                    {r.hitFire && (
                      <span
                        className="chip chip-amber"
                        style={{ marginLeft: 8 }}
                      >
                        FIRE
                      </span>
                    )}
                  </td>
                  <td style={cellRight}>{formatPoundsCompact(r.nw)}</td>
                  <td className="text-ink-muted" style={cellRight}>
                    £280k/yr
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Exit strategy options */}
        <div className="card-padded">
          <h2
            className="display font-bold"
            style={{ fontSize: 17, marginBottom: 12 }}
          >
            Exit strategy options
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, fontSize: 13 }}>
            {EXIT_OPTIONS.map((o, i) => (
              <li
                key={o.title}
                style={{
                  padding: '10px 0',
                  borderBottom:
                    i < EXIT_OPTIONS.length - 1
                      ? '1px solid var(--border)'
                      : 'none',
                }}
              >
                <strong>{o.title}</strong>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 12, marginTop: 2 }}
                >
                  {o.detail}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
