import PLMarginScreen from '@/features/intelligence/components/PLMarginScreen';
import { PlSheetsPanel } from '@/features/intelligence/components/PlSheetsPanel';

// /financial = the real P&L & Margin (actuals) on top, with editable scenario
// sheets (Phase 3 / T13) below it. The sheets are a planning overlay only — they
// never change the actuals above or the valuation.
export default function FinancialPage() {
  return (
    <div className="flex flex-col gap-10">
      <PLMarginScreen />
      <PlSheetsPanel />
    </div>
  );
}
