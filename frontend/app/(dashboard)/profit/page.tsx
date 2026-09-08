import ProfitScreen from '@/features/finance/components/ProfitScreen';

// /profit — the P&L screen.
//
// Profit Benchmarking used to be stacked underneath this one. It answers a
// different question ("how do my cost ratios compare with the UK dental
// standard", not "what did I earn"), and it carries its own source, practice
// and period filters which read as belonging to this screen while the two
// shared a page. It now lives at /profit-benchmark with a nav entry.
export default function ProfitPage() {
  return (
    <div className="flex flex-col gap-10">
      <ProfitScreen />
    </div>
  );
}
