'use client';
// Net Worth — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES['wealth-net']). Personal balance sheet: hero net-worth banner plus
// side-by-side assets/liabilities tables.
//
// Data flow (LIVE — GET /api/wealth/net, owner-only):
//   assets / liabilities / net_worth come back as RAW WHOLE POUNDS from the
//   business_health.baseline jsonb. The backend only stores the aggregate
//   totals (no per-line breakdown), so the two cards render the single rolled-up
//   figure each. formatPoundsCompact expects whole pounds, so the values feed in
//   directly. Thin/empty baselines come back as 0 and display cleanly as £0.
import { useNetWorth } from '../hooks';
import { formatPoundsCompact } from '../data';

/** Net Worth dashboard screen. */
export default function NetWorthScreen() {
  const { data, isLoading, isError } = useNetWorth();

  const totalAssets = data?.assets ?? 0;
  const totalLiab = data?.liabilities ?? 0;
  const netWorth = data?.net_worth ?? totalAssets - totalLiab;

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

      {isError && (
        <div
          className="card-padded"
          style={{ marginBottom: 16, fontSize: 13 }}
        >
          <span className="text-danger">
            Could not load net-worth data. Please try again.
          </span>
        </div>
      )}

      {/* Hero net-worth banner */}
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
          {isLoading ? '—' : formatPoundsCompact(netWorth)}
        </div>
        <div className="flex justify-center" style={{ gap: 24, fontSize: 13 }}>
          <div>
            <span style={{ opacity: 0.7 }}>Assets:</span>{' '}
            {isLoading ? '—' : formatPoundsCompact(totalAssets)}
          </div>
          <div>
            <span style={{ opacity: 0.7 }}>Liabilities:</span>{' '}
            {isLoading ? '—' : formatPoundsCompact(totalLiab)}
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
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 0' }}>
                  <strong>All assets</strong>
                  <div className="text-ink-muted" style={{ fontSize: 11 }}>
                    Business, property, pensions and investments
                  </div>
                </td>
                <td
                  className="text-right"
                  style={{ padding: '10px 0', fontWeight: 600 }}
                >
                  {isLoading ? '—' : formatPoundsCompact(totalAssets)}
                </td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td style={{ padding: '12px 0' }}>Total assets</td>
                <td
                  className="text-right text-success"
                  style={{ padding: '12px 0' }}
                >
                  {isLoading ? '—' : formatPoundsCompact(totalAssets)}
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
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 0' }}>
                  <strong>All liabilities</strong>
                  <div className="text-ink-muted" style={{ fontSize: 11 }}>
                    Mortgages and business loans
                  </div>
                </td>
                <td
                  className="text-right"
                  style={{ padding: '10px 0', fontWeight: 600 }}
                >
                  {isLoading ? '—' : formatPoundsCompact(totalLiab)}
                </td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td style={{ padding: '12px 0' }}>Total liabilities</td>
                <td
                  className="text-right text-danger"
                  style={{ padding: '12px 0' }}
                >
                  {isLoading ? '—' : formatPoundsCompact(totalLiab)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
