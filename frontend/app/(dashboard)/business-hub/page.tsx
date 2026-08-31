import { GroupOverviewScreen } from '@/features/overview/components/GroupOverviewScreen';
import { GroupPerformanceScreen } from '@/features/overview/components/GroupPerformanceScreen';
import BusinessHubScreen from '@/features/overview/components/BusinessHubScreen';
import { DeferUntilVisible } from '@/components/DeferUntilVisible';

// /business-hub leads with the Intelligence OS Group Overview (scope-aware,
// Decision Lens), then the Group Performance blocks (funnel KPIs, marketing
// snapshot, per-entity performance, revenue/profit by line), with the existing
// Business Hub screen retained below.
//
// Only the first screen is above the fold, but all three used to fire their
// aggregates on mount — three screens competing for one database, which is
// what pushed individual statements past the 8s timeout. The lower two now
// mount on approach.
export default function BusinessHubPage() {
  return (
    <div className="flex flex-col gap-10">
      <GroupOverviewScreen />
      <DeferUntilVisible minHeight={420}>
        <GroupPerformanceScreen />
      </DeferUntilVisible>
      <DeferUntilVisible minHeight={420}>
        <BusinessHubScreen />
      </DeferUntilVisible>
    </div>
  );
}
