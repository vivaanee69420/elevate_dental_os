import { GroupOverviewScreen } from '@/features/overview/components/GroupOverviewScreen';
import { GroupPerformanceScreen } from '@/features/overview/components/GroupPerformanceScreen';
import BusinessHubScreen from '@/features/overview/components/BusinessHubScreen';

// /business-hub leads with the Intelligence OS Group Overview (scope-aware,
// Decision Lens), then the Group Performance blocks (funnel KPIs, marketing
// snapshot, per-entity performance, revenue/profit by line), with the existing
// Business Hub screen retained below.
export default function BusinessHubPage() {
  return (
    <div className="flex flex-col gap-10">
      <GroupOverviewScreen />
      <GroupPerformanceScreen />
      <BusinessHubScreen />
    </div>
  );
}
