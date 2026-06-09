'use client';
// FIRE Plan — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES['wealth-fire']). Hero banner (current NW / FIRE number / years),
// progress bar, a multi-year path table, and exit-strategy options.
//
// Data flow (LIVE — GET /api/wealth/fire, owner-only):
//   fire_target_pence / current_savings_pence are INTEGER PENCE; we divide by
//   100 to whole pounds for formatPoundsCompact. years_to_fire is a plain count
//   (may be null on a thin baseline).
//   currentNW   = current_savings_pence / 100
//   fireNumber  = fire_target_pence / 100
//   progress%   = currentNW / fireNumber * 100   (0 when fireNumber is 0)
//   annualSavings = (fireNumber - currentNW) / years   (linear bridge; 0 when
//                   years unknown — no savings-rate field exists on the backend)
//   path[y].nw  = currentNW * 1.10^y + y * annualSavings
//
// Exit-strategy options stay on the static prototype copy (EXIT_OPTIONS) — there
// is no backend source for them. The prototype's target emoji is replaced by the
// text label "FIRE" (project rule 7 forbids emojis).
import { useMemo } from 'react';
import { useFire } from '../hooks';
import { EXIT_OPTIONS, formatPoundsCompact } from '../data';

/** FIRE Plan screen. */
export default function FirePlanScreen() {
  const { data, isLoading, isError } = useFire();

  const currentNW = (data?.current_savings_pence ?? 0) / 100;
  const fireNumber = (data?.fire_target_pence ?? 0) / 100;
  const yearsToFire = data?.years_to_fire ?? null;

  // Percentage of the way to the FIRE number (0 when the target is unset, to
  // avoid a divide-by-zero NaN on thin/empty baselines).
  const progressPct = fireNumber > 0 ? (currentNW / fireNumber) * 100 : 0;

  // No savings-rate field on the backend — derive a linear annual bridge from
  // the gap and the years horizon. Falls back to 0 when years is unknown/<=0.
  const annualSavings = useMemo(() => {
    if (!yearsToFire || yearsToFire <= 0) return 0;
    return Math.max(0, (fireNumber - currentNW) / yearsToFire);
  }, [fireNumber, currentNW, yearsToFire]);

  // Compounding path: 10% growth on net worth plus the flat annual bridge.
  // Length tracks years_to_fire (clamped 1..10); defaults to 7 rows when
  // unknown, matching the original prototype horizon.
  const pathYears = useMemo(() => {
    const n = yearsToFire && yearsToFire > 0 ? Math.min(yearsToFire, 10) : 7;
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [yearsToFire]);

  const path = useMemo(
    () =>
      pathYears.map((y) => {
        const nw = currentNW * Math.pow(1.1, y) + y * annualSavings;
        return { year: 2026 + y, nw, hitFire: fireNumber > 0 && nw >= fireNumber };
      }),
    [pathYears, currentNW, annualSavings, fireNumber]
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

      {isError && (
        <div className="card-padded" style={{ marginBottom: 16, fontSize: 13 }}>
          <span className="text-danger">
            Could not load FIRE-plan data. Please try again.
          </span>
        </div>
      )}

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
              {isLoading ? '—' : formatPoundsCompact(currentNW)}
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
              {isLoading ? '—' : formatPoundsCompact(fireNumber)}
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
              {isLoading ? '—' : yearsToFire ?? '—'}
            </div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              {yearsToFire ? `By ${2026 + yearsToFire}` : 'Set a target'}
            </div>
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
                width: `${Math.min(progressPct, 100).toFixed(1)}%`,
                borderRadius: 7,
              }}
            />
          </div>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            {progressPct.toFixed(1)}% of the way there ·{' '}
            {formatPoundsCompact(Math.max(0, fireNumber - currentNW))} to go
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
              {path.length === 0 && (
                <tr>
                  <td
                    className="text-ink-muted"
                    colSpan={3}
                    style={{ ...cellLeft, padding: 16, textAlign: 'center' }}
                  >
                    {isLoading ? 'Loading…' : 'No FIRE target set yet.'}
                  </td>
                </tr>
              )}
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
                    {formatPoundsCompact(annualSavings)}/yr
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
