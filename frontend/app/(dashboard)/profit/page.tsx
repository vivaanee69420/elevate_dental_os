import { TreatmentWorkbench } from '@/features/finance/components/TreatmentWorkbench';
import ProfitScreen from '@/features/finance/components/ProfitScreen';

// /profit leads with the Intelligence OS Treatment Economics Workbench, with the
// existing profit screen retained below it.
export default function ProfitPage() {
  return (
    <div className="flex flex-col gap-10">
      <TreatmentWorkbench />
      <ProfitScreen />
    </div>
  );
}
