import ProfitScreen from '@/features/finance/components/ProfitScreen';
import ProfitBenchmarkScreen from '@/features/finance/components/ProfitBenchmarkScreen';

// /profit — the profit screen, then Profit Benchmarking (CoA→P&L, actual ratios
// vs the UK dental 45/18/15/12/10 benchmarks). The Treatment Economics Workbench
// now lives in its own tab at /workbench.
export default function ProfitPage() {
  return (
    <div className="flex flex-col gap-10">
      <ProfitScreen />
      <ProfitBenchmarkScreen />
    </div>
  );
}
