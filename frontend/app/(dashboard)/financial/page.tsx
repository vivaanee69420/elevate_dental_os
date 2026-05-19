import { Suspense } from 'react';
import FinancialScreen from '@/features/finance/components/FinancialScreen';

// FinancialScreen calls useSearchParams(); Next 14 requires a Suspense
// boundary around it or static export of /financial bails out (build fails).
export default function FinancialPage() {
  return (
    <Suspense fallback={null}>
      <FinancialScreen />
    </Suspense>
  );
}
