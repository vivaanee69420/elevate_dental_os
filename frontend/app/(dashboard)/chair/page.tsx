import { ChairEfficiencyScreen } from '@/features/operations/components/ChairEfficiencyScreen';
import ChairScreen from '@/features/operations/components/ChairScreen';

// /chair maps to the Intelligence OS Chair Efficiency view (occupancy, cost of
// empty chairs, recovery) on top, with the existing manual chair-booking grid
// retained below it.
export default function ChairPage() {
  return (
    <div className="flex flex-col gap-10">
      <ChairEfficiencyScreen />
      <ChairScreen />
    </div>
  );
}
