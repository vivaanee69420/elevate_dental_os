import CallReportingScreen from '@/features/call-reporting/components/CallReportingScreen';
import { FeatureGate } from '@/components/FeatureGate';

export default function Page() {
  return (
    <FeatureGate feature="call_reporting">
      <CallReportingScreen />
    </FeatureGate>
  );
}
