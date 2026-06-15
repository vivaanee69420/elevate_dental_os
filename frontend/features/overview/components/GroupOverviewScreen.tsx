'use client';

// Group Overview header — the page title + the Scope/Period bar that drives the
// whole Business Hub. The KPI cards themselves live in GroupPerformanceScreen,
// grouped by data source (Dentally / Emergent / Marketing / QuickBooks /
// GoHighLevel), so each source has a single section (no duplicate groups).

import { PageHeader, AlertRow } from '@/components/ui';
import { ScopePeriodBar } from '@/features/_shared/ScopePeriodBar';
import { useScopePeriod } from '@/features/_shared/scope-context';
import { useBusinessHub } from '../business-hub-api';

export function GroupOverviewScreen() {
  const { scope } = useScopePeriod();
  const { data, isError } = useBusinessHub();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Group Overview"
        subtitle="Group finances at a glance — takings, margin, demand and conversion across the practices."
      />
      <ScopePeriodBar />

      {isError && <AlertRow tone="bad" title="Couldn't load the overview" />}

      {data && (scope === 'academy' || scope === 'lab') && (
        <AlertRow tone="info" title="The Business Hub covers clinical practices"
          body="Academy and Lab roll into the P&L and Valuation views — switch scope to the group or a practice here." />
      )}
    </div>
  );
}
