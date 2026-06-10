'use client';
// Loyalty & Membership — recurring membership plans, a 4-up KPI strip,
// membership-tier cards, an automated-rewards list, and a top-campaign panel.
//
// Data flow:
//   GET /api/growth/loyalty (useLoyalty) ──┬─► active/total members + MRR ──► KPI strip
//                                           ├─► one tier card per plan (real member counts)
//                                           ├─► rewards[] ──► automated-rewards list
//                                           └─► campaigns[] ──► campaign panel
//
// Everything is real, org-scoped data (membership_plans + memberships — manual/
// seeded, NOT from Google Ads / Meta / Dentally). Rewards & campaigns have no
// DB source yet, so the endpoint returns [] and the UI shows empty states — no
// fabricated rows.

import { Card, KpiTile, Skeleton } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { useLoyalty } from '../loyalty-hooks';
import RetentionPanel from './RetentionPanel';

/** Loyalty & Membership screen. */
export default function LoyaltyScreen() {
  const { data, isLoading, error } = useLoyalty();

  const tiers = data?.tiers ?? [];
  const rewards = data?.rewards ?? [];
  const campaigns = data?.campaigns ?? [];
  const activeMembers = data?.active ?? 0;
  const totalMembers = data?.total ?? 0;
  const mrrPence = data?.mrr_pence ?? 0;
  const arrPence = mrrPence * 12;

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

      {error ? (
        <Card className="mb-4">
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>
            Failed to load membership data: {(error as Error).message}
          </div>
        </Card>
      ) : isLoading ? (
        <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <KpiTile label="Active members" value={activeMembers.toLocaleString('en-GB')} />
          <KpiTile
            label="Monthly recurring revenue"
            value={formatPence(mrrPence)}
            delta={`${formatPence(arrPence)} ARR`}
            deltaTone="up"
          />
          <KpiTile label="Total members" value={totalMembers.toLocaleString('en-GB')} />
          <KpiTile label="Membership tiers" value={tiers.length.toLocaleString('en-GB')} />
        </div>
      )}

      {/* Live patient attrition & reactivation (DentaCFO Phase 6) — real Dentally
          cohorts, distinct from the membership KPIs above. */}
      <RetentionPanel />

      <Card className="mb-4">
        <h2 className="display font-semibold mb-4" style={{ fontSize: 17 }}>
          Membership tiers
        </h2>
        {isLoading ? (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
          </div>
        ) : tiers.length === 0 ? (
          <div className="text-ink-muted" style={{ fontSize: 13 }}>
            No membership plans yet. Add a plan to start tracking recurring members.
          </div>
        ) : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {tiers.map((p) => (
              <div
                key={p.id}
                style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}
              >
                <h3 className="display font-semibold" style={{ fontSize: 16 }}>
                  {p.name}
                </h3>
                <div
                  className="display font-bold"
                  style={{ fontSize: 28, color: 'var(--brand)', margin: '8px 0' }}
                >
                  {formatPence(p.monthly_price_pence)}
                  <span className="text-ink-muted" style={{ fontSize: 13, fontWeight: 400 }}>
                    /mo
                  </span>
                </div>
                <div className="text-xs text-ink-muted mb-3">
                  {p.description || p.benefits.join(' · ')}
                </div>
                <div
                  style={{ fontSize: 11, paddingTop: 10, borderTop: '1px solid var(--border)' }}
                >
                  <strong>{p.members.toLocaleString('en-GB')}</strong> members ·{' '}
                  {formatPence(p.mrr_pence)}/mo
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <h2 className="display font-semibold mb-3" style={{ fontSize: 17 }}>
            Automated rewards (active)
          </h2>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
            </div>
          ) : rewards.length === 0 ? (
            <div className="text-ink-muted" style={{ fontSize: 13 }}>
              No automated rewards configured yet.
            </div>
          ) : (
            <ul className="text-sm" style={{ listStyle: 'none', padding: 0 }}>
              {rewards.map((r, i) => (
                <li
                  key={r.id}
                  style={{
                    padding: '10px 0',
                    borderBottom: i < rewards.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <strong>{r.title}</strong>
                  <div className="text-ink-muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {r.detail}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="display font-semibold mb-3" style={{ fontSize: 17 }}>
            Campaign performance
          </h2>
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : campaigns.length === 0 ? (
            <div className="text-ink-muted" style={{ fontSize: 13 }}>
              No campaigns yet.
            </div>
          ) : (
            <div
              style={{
                background: 'var(--brand-50)',
                borderRadius: 8,
                padding: 14,
              }}
            >
              <div className="uppercase" style={{ fontSize: 11, color: 'var(--brand)' }}>
                {campaigns[0].window}
              </div>
              <div className="font-semibold" style={{ marginTop: 4 }}>
                {campaigns[0].name}
              </div>
              <div className="text-ink-muted text-xs" style={{ marginTop: 4 }}>
                {campaigns[0].detail}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
