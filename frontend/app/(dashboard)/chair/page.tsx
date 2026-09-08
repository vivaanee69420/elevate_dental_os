import { ChairEfficiencyScreen } from '@/features/operations/components/ChairEfficiencyScreen';

// /chair is the Chair Efficiency read-only view (occupancy, cost of empty
// chairs, recovery). Data entry moved to its own page, /chair-utilisation:
// this screen is gated on finance.view and that one on operations.view, so
// stacking them left a practice manager without finance access looking at a
// half-broken page.
export default function ChairPage() {
  return <ChairEfficiencyScreen />;
}
