import DataRoomScreen from '@/features/data-room/components/DataRoomScreen';
import { FeatureGate } from '@/components/FeatureGate';

export default function Page() {
  return (
    <FeatureGate feature="data_room">
      <DataRoomScreen source="summaries" />
    </FeatureGate>
  );
}
