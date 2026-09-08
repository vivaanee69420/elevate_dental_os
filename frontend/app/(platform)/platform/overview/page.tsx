'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader, KpiTile } from '@/components/ui';
import { usePlatformOverview } from '@/features/platform/hooks';

export default function PlatformOverviewPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ink-muted">Loading…</div>}>
      <OverviewBody />
    </Suspense>
  );
}

function OverviewBody() {
  const params = useSearchParams();
  const forceChange = params.get('force_change') === '1';
  const { data, error } = usePlatformOverview(30);

  return (
    <div className="space-y-4">
      <PageHeader title="Overview" subtitle="Cross-tenant platform metrics, 30-day window." />

      {forceChange && (
        <div className="card-padded border-amber-400 bg-amber-50 text-amber-900 text-sm">
          You signed in with a bootstrap password. Change it now via your own
          credentials store; password-rotation UI ships with Phase 6.
        </div>
      )}

      {error && <div className="text-sm text-danger">{(error as Error).message}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiTile label="Organisations"   value={data ? String(data.total_orgs)        : '—'} delta="all tenants" />
        <KpiTile label="Users"           value={data ? String(data.total_users)       : '—'} delta="all tenants" />
        <KpiTile label="New orgs (30d)"  value={data ? String(data.new_orgs_window)   : '—'} delta="last 30 days" deltaTone="up" />
        <KpiTile label="New users (30d)" value={data ? String(data.new_users_window) : '—'} delta="last 30 days" deltaTone="up" />
      </div>
    </div>
  );
}
