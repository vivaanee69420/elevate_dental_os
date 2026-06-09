import BoardReportScreen from '@/features/intelligence/components/BoardReportScreen';

// /board-report — Board Report Generator (DentaCFO gap module, Phase 2). Gated
// finance.view in the nav (lib/permissions ROUTE_PERMISSION) and server-side on
// the route (board pack exposes group financials).
export default function BoardReportPage() {
  return <BoardReportScreen />;
}
