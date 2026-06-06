import TreatmentMatrixScreen from '@/features/operations/components/TreatmentMatrixScreen';
import TreatmentsScreen from '@/features/operations/components/TreatmentsScreen';

// /treatments leads with the Intelligence OS Treatment Mix heat matrix
// (type x practice volume, scope/period-driven), then the legacy whole-group
// volume/share breakdown below it as the detail table.
export default function TreatmentsPage() {
  return (
    <div className="flex flex-col gap-10">
      <TreatmentMatrixScreen />
      <TreatmentsScreen />
    </div>
  );
}
