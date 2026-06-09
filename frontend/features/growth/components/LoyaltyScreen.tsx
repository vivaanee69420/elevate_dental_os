'use client';
// Loyalty & Membership — pixel-faithful port of
// preview/elevate-dental-os-v2.html (PAGES.loyalty). Recurring membership
// plans, a 4-up KPI strip, membership-tier cards, an automated-rewards
// list, and a top-campaign panel. Fed by the growth mock-data layer; swap
// to a real membership-billing endpoint when one exists server-side.
// Prototype emoji removed per project rule 7 (no emojis in UI).
//
// Data flow:
//   LOYALTY_PROGRAMS ──┬─► totalMembers, monthlyRevenue ──► KPI strip
//                       └─► one tier card per programme
//   LOYALTY_REWARDS ───► active-rewards list

import { useMemo } from 'react';
import { Card, KpiTile } from '@/components/ui';
import { formatPoundsCompact } from '@/features/_mock';
import { LOYALTY_PROGRAMS, LOYALTY_REWARDS } from '../data';
import RetentionPanel from './RetentionPanel';

/** Loyalty & Membership screen. */
export default function LoyaltyScreen() {
  const { totalMembers, monthlyRevenue } = useMemo(() => {
    const m = LOYALTY_PROGRAMS.reduce((s, p) => s + p.members, 0);
    const r = LOYALTY_PROGRAMS.reduce((s, p) => s + p.members * p.price_month, 0);
    return { totalMembers: m, monthlyRevenue: r };
  }, []);

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
          value={totalMembers.toLocaleString('en-GB')}
          delta="+86 this month"
          deltaTone="up"
        />
        <KpiTile
          label="Monthly recurring revenue"
          value={formatPoundsCompact(monthlyRevenue)}
          delta={`£${((monthlyRevenue * 12) / 1000).toFixed(0)}k ARR`}
          deltaTone="up"
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

      {/* Live patient attrition & reactivation (DentaCFO Phase 6) — real Dentally
          cohorts, distinct from the membership KPIs above. */}
      <RetentionPanel />

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
