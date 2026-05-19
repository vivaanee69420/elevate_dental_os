'use client';
// Net Worth — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES['wealth-net']). Personal balance sheet: hero net-worth banner plus
// side-by-side assets/liabilities tables.
//
// Data flow:
//   totalAssets = sum(ASSETS.value)
//   totalLiab   = sum(LIABILITIES.value)
//   netWorth    = totalAssets - totalLiab
//
// Fed by ../data ASSETS / LIABILITIES; swap to a real /wealth endpoint when
// it exists. Owner-only screen.
import { useMemo } from 'react';
import { ASSETS, LIABILITIES, formatPoundsCompact } from '../data';

/** Net Worth dashboard screen. */
export default function NetWorthScreen() {
  // Roll up the balance sheet (prototype arithmetic).
  const { totalAssets, totalLiab, netWorth } = useMemo(() => {
    const a = ASSETS.reduce((s, x) => s + x.value, 0);
    const l = LIABILITIES.reduce((s, x) => s + x.value, 0);
    return { totalAssets: a, totalLiab: l, netWorth: a - l };
  }, []);

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Net Worth
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Personal balance sheet across business, property, pensions, and
          investments
        </p>
      </div>

      {/* Hero net-worth banner */}
      <div
        className="card-padded"
        style={{
          background: 'linear-gradient(135deg, #0E7C7B 0%, #085857 100%)',
          color: 'white',
          border: 'none',
          textAlign: 'center',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 11,
            opacity: 0.8,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Total net worth
        </div>
        <div
          className="display font-bold"
          style={{ fontSize: 56, margin: '8px 0' }}
        >
          {formatPoundsCompact(netWorth)}
        </div>
        <div
          className="flex justify-center"
          style={{ gap: 24, fontSize: 13 }}
        >
          <div>
            <span style={{ opacity: 0.7 }}>Assets:</span>{' '}
            {formatPoundsCompact(totalAssets)}
          </div>
          <div>
            <span style={{ opacity: 0.7 }}>Liabilities:</span>{' '}
            {formatPoundsCompact(totalLiab)}
          </div>
        </div>
      </div>

      {/* Assets / Liabilities */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Assets */}
        <div className="card-padded">
          <h2
            className="display font-bold"
            style={{ fontSize: 17, marginBottom: 16 }}
          >
            Assets
          </h2>
          <table className="w-full" style={{ fontSize: 13 }}>
            <tbody>
              {ASSETS.map((a) => (
                <tr
                  key={a.name}
                  style={{ borderBottom: '1px solid #E5E7EB' }}
                >
                  <td style={{ padding: '10px 0' }}>
                    <strong>{a.name}</strong>
                    <div className="text-ink-muted" style={{ fontSize: 11 }}>
                      {a.type} · {a.growth}% growth p.a.
                    </div>
                  </td>
                  <td
                    className="text-right"
                    style={{ padding: '10px 0', fontWeight: 600 }}
                  >
                    {formatPoundsCompact(a.value)}
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td style={{ padding: '12px 0' }}>Total assets</td>
                <td
                  className="text-right text-success"
                  style={{ padding: '12px 0' }}
                >
                  {formatPoundsCompact(totalAssets)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Liabilities */}
        <div className="card-padded">
          <h2
            className="display font-bold"
            style={{ fontSize: 17, marginBottom: 16 }}
          >
            Liabilities
          </h2>
          <table className="w-full" style={{ fontSize: 13 }}>
            <tbody>
              {LIABILITIES.map((l) => (
                <tr
                  key={l.name}
                  style={{ borderBottom: '1px solid #E5E7EB' }}
                >
                  <td style={{ padding: '10px 0' }}>
                    <strong>{l.name}</strong>
                    <div className="text-ink-muted" style={{ fontSize: 11 }}>
                      {l.rate}% rate
                    </div>
                  </td>
                  <td
                    className="text-right"
                    style={{ padding: '10px 0', fontWeight: 600 }}
                  >
                    {formatPoundsCompact(l.value)}
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td style={{ padding: '12px 0' }}>Total liabilities</td>
                <td
                  className="text-right text-danger"
                  style={{ padding: '12px 0' }}
                >
                  {formatPoundsCompact(totalLiab)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
