import { GroupOverviewScreen } from '@/features/overview/components/GroupOverviewScreen';
import BusinessHubScreen from '@/features/overview/components/BusinessHubScreen';

// /business-hub leads with the Intelligence OS Group Overview (scope-aware,
// Decision Lens), with the existing Business Hub screen retained below.
export default function BusinessHubPage() {
  return (
    <div className="flex flex-col gap-10">
      <GroupOverviewScreen />
      <BusinessHubScreen />
    </div>
  );
}
