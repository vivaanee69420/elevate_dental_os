'use client';

import { useState } from 'react';
import { LeadFunnelScreen } from '@/features/leads/components/LeadFunnelScreen';
import LeadsScreen from '@/features/leads/components/LeadsScreen';
import { useGhlAccounts } from '@/features/integrations/hooks';
import { SubaccountFilterBar } from '@/features/ghl/components/SubaccountFilterBar';

// /leads leads with the Intelligence OS Lead Funnel (drop-off analytics), with
// the existing leads list retained below.
export default function LeadsPage() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data: ghlData } = useGhlAccounts();

  return (
    <div className="flex flex-col gap-10">
      {ghlData && ghlData.accounts.length > 0 && (
        <div className="mb-2">
          <SubaccountFilterBar
            accounts={ghlData.accounts.map((a) => ({
              accountId: a.id,
              label: a.label || 'GoHighLevel',
              practiceId: a.practice_id ?? null,
            })) as any}
            selected={accountId}
            onSelect={setAccountId}
          />
        </div>
      )}
      <LeadFunnelScreen overrideAccountId={accountId} />
      <LeadsScreen overrideAccountId={accountId} />
    </div>
  );
}
