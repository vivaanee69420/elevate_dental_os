'use client';
// Loyalty & Membership — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES.loyalty). The KPI strip's member
// counts are now live (GET /api/growth/loyalty -> { active, total }). The
// membership-tier template cards, automated-rewards list and top-campaign
// panel stay static reference UI: the loyalty endpoint carries no per-plan
// pricing, MRR or reward breakdown, so those are not real data yet.
// Prototype emoji removed per project rule 7 (no emojis in UI).
//
// Data flow:
//   useLoyaltySummary() ──► active / total member counts ──► KPI strip
//   LOYALTY_PROGRAMS    ──► one tier-template card per programme (static)
//   LOYALTY_REWARDS     ──► active-rewards list (static)

import { Card, KpiTile } from '@/components/ui';
import { formatPoundsCompact } from '@/features/_mock';
import { useLoyaltySummary } from '../hooks';
import { LOYALTY_PROGRAMS, LOYALTY_REWARDS } from '../data';

/** Loyalty & Membership screen. */
export default function LoyaltyScreen() {
  const { data, isLoading } = useLoyaltySummary();
  const active = data?.active ?? 0;
  const total = data?.total ?? 0;
  const lapsed = Math.max(0, total - active);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="display text-3xl font-bold">Loyalty &amp; Membership</h1>
          <p className="text-sm text-ink-muted mt-1">
            Recurring patient membership plans · automated rewards · birthday &amp;
            lapsed visit nudges
          </p>
        </div>
        <button className="btn btn-primary">+ New campaign</button>
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile
          label="Active members"
          value={isLoading ? '…' : active.toLocaleString('en-GB')}
          delta={total ? `${total.toLocaleString('en-GB')} total memberships` : undefined}
          deltaTone="up"
        />
        <KpiTile
          label="Lapsed / paused"
          value={isLoading ? '…' : lapsed.toLocaleString('en-GB')}
          delta={total ? `${Math.round((active / total) * 100)}% active` : undefined}
          deltaTone={lapsed > 0 ? 'down' : 'up'}
        />
        <KpiTile
          label="Avg LTV (member)"
          value={formatPoundsCompact(3850)}
          delta="vs £1,850 non-member"
          deltaTone="up"
        />
        <KpiTile
          label="Retention rate"
          value="92%"
          delta="12-month"
          deltaTone="up"
        />
      </div>

      <Card className="mb-4">
        <h2 className="display font-semibold mb-4" style={{ fontSize: 17 }}>
          Membership tiers
        </h2>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {LOYALTY_PROGRAMS.map((p) => (
            <div
              key={p.name}
              style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}
            >
              <h3 className="display font-semibold" style={{ fontSize: 16 }}>
                {p.name}
              </h3>
              <div
                className="display font-bold"
                style={{ fontSize: 28, color: 'var(--brand)', margin: '8px 0' }}
              >
                £{p.price_month}
                <span
                  className="text-ink-muted"
                  style={{ fontSize: 13, fontWeight: 400 }}
                >
                  /mo
                </span>
              </div>
              <div className="text-xs text-ink-muted mb-3">{p.includes}</div>
              <div
                style={{ fontSize: 11, paddingTop: 10, borderTop: '1px solid var(--border)' }}
              >
                <strong>{p.members.toLocaleString('en-GB')}</strong> members ·{' '}
                {formatPoundsCompact(p.members * p.price_month)}/mo
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <h2 className="display font-semibold mb-3" style={{ fontSize: 17 }}>
            Automated rewards (active)
          </h2>
          <ul className="text-sm" style={{ listStyle: 'none', padding: 0 }}>
            {LOYALTY_REWARDS.map((r, i) => (
              <li
                key={r.title}
                style={{
                  padding: '10px 0',
                  borderBottom:
                    i < LOYALTY_REWARDS.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <strong>{r.title}</strong>
                <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {r.detail}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="display font-semibold mb-3" style={{ fontSize: 17 }}>
            Campaign performance
          </h2>
          <div
            style={{
              background: 'var(--brand-50)',
              borderRadius: 8,
              padding: 14,
              marginBottom: 12,
            }}
          >
            <div
              className="uppercase"
              style={{ fontSize: 11, color: 'var(--brand)' }}
            >
              Top campaign · last 30 days
            </div>
            <div className="font-semibold" style={{ marginTop: 4 }}>
              &quot;Refer a friend, both get £50 off&quot;
            </div>
            <div className="text-ink-muted text-xs" style={{ marginTop: 4 }}>
              12 successful referrals · ROI 11.7x
            </div>
          </div>
          <button className="btn btn-ghost" style={{ width: '100%' }}>
            Duplicate this campaign
          </button>
        </Card>
      </div>
    </div>
  );
}
