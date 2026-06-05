import { LeadFunnelScreen } from '@/features/leads/components/LeadFunnelScreen';
import LeadsScreen from '@/features/leads/components/LeadsScreen';

// /leads leads with the Intelligence OS Lead Funnel (drop-off analytics), with
// the existing leads list retained below.
export default function LeadsPage() {
  return (
    <div className="flex flex-col gap-10">
      <LeadFunnelScreen />
      <LeadsScreen />
    </div>
  );
}
