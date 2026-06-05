import { TreatmentWorkbench } from '@/features/finance/components/TreatmentWorkbench';
import ProfitScreen from '@/features/finance/components/ProfitScreen';
import ProfitBenchmarkScreen from '@/features/finance/components/ProfitBenchmarkScreen';

// /profit leads with the Intelligence OS Treatment Economics Workbench, then the
// existing profit screen, then Profit Benchmarking (CoA→P&L, actual ratios vs the
// UK dental 45/18/15/12/10 benchmarks).
export default function ProfitPage() {
  return (
    <div className="flex flex-col gap-10">
      <TreatmentWorkbench />
      <ProfitScreen />
      <ProfitBenchmarkScreen />
    </div>
  );
}
