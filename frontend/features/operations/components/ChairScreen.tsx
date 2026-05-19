'use client';
// Chair Utilisation — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.chair). Booked-vs-available chair time as a day x slot heatmap.
//
// Data flow:
//   avgUtil     = mean of every cell in CHAIR_UTIL
//   lostRevenue = round( 245000 * (100 - avgUtil)/100 * 0.5 )
//                 (idle-chair revenue at 50% recovery, prototype formula)
//
// Fed by ../data CHAIR_UTIL; swap to a real /chair-utilisation endpoint later.
import { useMemo } from 'react';
import {
  CHAIR_DAYS,
  CHAIR_SLOTS,
  CHAIR_UTIL,
  chairUtilColour,
  formatPoundsCompact,
} from '../data';

const POS = '#10B981';

// Static recommendation list (verbatim from the prototype).
const RECOMMENDATIONS = [
  {
    dot: 'var(--success)',
    title: 'Move Friday evening clinic to Tuesday evening',
    detail: 'Tue 88% vs Fri PM 50%. Est. uplift £6-8k/month.',
  },
  {
    dot: 'var(--brand)',
    title: 'Open Wednesday early-morning slots at Warwick Lodge',
    detail:
      'Implant consult demand exceeds capacity on Tue/Thu. Wed 8-10am closed.',
  },
  {
    dot: 'var(--brand)',
    title: 'Reduce Barnet Friday hours by 50%',
    detail:
      'Lowest utilised on Fridays. Save staff cost, reallocate clinician days.',
  },
];

// Heatmap colour legend (verbatim from the prototype).
const LEGEND = [
  { c: '#10B981', l: '≥90% Excellent' },
  { c: '#0E7C7B', l: '75-89% Good' },
  { c: '#F59E0B', l: '60-74% Underused' },
  { c: '#EF4444', l: '<60% Action' },
];

/** Chair Utilisation screen. */
export default function ChairScreen() {
  // Average utilisation + estimated lost revenue (prototype arithmetic).
  const { avgUtil, lostRevenue } = useMemo(() => {
    const flat = CHAIR_UTIL.flat();
    const avg = flat.reduce((s, n) => s + n, 0) / flat.length;
    return {
      avgUtil: avg,
      lostRevenue: Math.round((245000 * (100 - avg)) / 100 * 0.5),
    };
  }, []);

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Chair Utilisation
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Booked vs available chair time · last 30 days
        </p>
      </div>

      {/* 4 KPIs */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Avg utilisation
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {avgUtil.toFixed(0)}%
          </div>
          <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: POS }}>
            UK avg: 72%
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Peak slot
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            Tue AM
          </div>
          <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: POS }}>
            95% utilised
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Lowest slot
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            Fri PM
          </div>
          <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: '#EF4444' }}>
            50% utilised
          </div>
        </div>
        <div className="card-padded">
          <div className="text-ink-muted font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.05em' }}>
            Est. lost revenue
          </div>
          <div className="display font-bold" style={{ fontSize: 28, marginTop: 4 }}>
            {formatPoundsCompact(lostRevenue)}
          </div>
          <div className="font-bold" style={{ fontSize: 12, marginTop: 4, color: '#EF4444' }}>
            /month
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="card-padded mb-4">
        <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 16 }}>
          Group-wide heatmap
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '80px repeat(5, 1fr)',
            gap: 6,
            maxWidth: 700,
          }}
        >
          <div />
          {CHAIR_DAYS.map((d) => (
            <div
              key={d}
              className="text-center text-ink-muted font-bold"
              style={{ fontSize: 12 }}
            >
              {d}
            </div>
          ))}
          {CHAIR_SLOTS.map((slot, slotIdx) => (
            <FragmentRow key={slot} slot={slot} slotIdx={slotIdx} />
          ))}
        </div>
        <div
          className="flex text-ink-muted"
          style={{ gap: 14, marginTop: 16, fontSize: 11 }}
        >
          {LEGEND.map((x) => (
            <div key={x.l} className="flex items-center" style={{ gap: 4 }}>
              <div style={{ width: 12, height: 12, background: x.c, borderRadius: 3 }} />
              {x.l}
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      <div className="card-padded">
        <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 16 }}>
          Recommendations
        </h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {RECOMMENDATIONS.map((r, i) => (
            <li
              key={r.title}
              className="flex"
              style={{
                gap: 12,
                padding: '10px 0',
                borderBottom:
                  i < RECOMMENDATIONS.length - 1 ? '1px solid #E5E7EB' : 'none',
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  background: r.dot,
                  borderRadius: '50%',
                  marginTop: 8,
                  flexShrink: 0,
                }}
              />
              <div>
                <strong>{r.title}</strong>
                <div className="text-ink-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {r.detail}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * One heatmap row: the slot label cell plus a coloured cell per day.
 * Split out so the slot/day grid stays a flat CSS grid (matches prototype).
 */
function FragmentRow({ slot, slotIdx }: { slot: string; slotIdx: number }) {
  return (
    <>
      <div
        className="text-ink-muted text-right"
        style={{ fontSize: 11, paddingRight: 8, alignSelf: 'center' }}
      >
        {slot}
      </div>
      {CHAIR_DAYS.map((_, dayIdx) => {
        const pct = CHAIR_UTIL[dayIdx][slotIdx];
        return (
          <div
            key={dayIdx}
            className="text-center text-white font-bold"
            style={{
              background: chairUtilColour(pct),
              borderRadius: 6,
              padding: '14px 8px',
              fontSize: 13,
            }}
          >
            {pct}%
          </div>
        );
      })}
    </>
  );
}
