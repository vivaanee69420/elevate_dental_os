import { useState } from 'react';
import { useEmergentPractices, useSetEmergentPractice } from '@/features/integrations/hooks';
import { useMe, isAgencyActor } from '@/hooks/useMe';

export default function EmergentPracticeMapping() {
  const { data: me } = useMe();
  const { data, isLoading, error } = useEmergentPractices();
  const setMapping = useSetEmergentPractice();
  const [saving, setSaving] = useState<string | null>(null); // business_id

  // Practice mapping is an agency-actor power (A2) — hide the whole panel.
  if (!isAgencyActor(me)) return null;
  if (isLoading) return null;
  if (error || !data) return null;
  if (!data.connected) return null; // Only show if Emergent is connected
  if (data.businesses.length === 0) return null; // Only show if we've discovered businesses

  async function handleMap(businessId: string, practiceId: string) {
    setSaving(businessId);
    try {
      await setMapping.mutateAsync({ businessId, practiceId: practiceId || null });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="card-padded" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Emergent Practice Mapping</h2>
          <p className="text-ink-muted" style={{ fontSize: 13, marginTop: 4 }}>
            Map Emergent businesses to your Elevate practices so accepted treatments sync to the correct dashboard.
          </p>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--ink-muted)' }}>
            <th style={{ padding: '8px 0', fontWeight: 600 }}>Emergent Business</th>
            <th style={{ padding: '8px 0', fontWeight: 600, width: '40%' }}>Elevate Practice</th>
          </tr>
        </thead>
        <tbody>
          {data.businesses.map((biz) => {
            const isSaving = saving === biz.business_id;
            return (
              <tr key={biz.business_id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td style={{ padding: '12px 0' }}>
                  <div style={{ fontWeight: 600 }}>{biz.business_name || 'Unknown Business'}</div>
                  <div className="text-ink-muted" style={{ fontSize: 11 }}>ID: {biz.business_id}</div>
                </td>
                <td style={{ padding: '12px 0' }}>
                  <select
                    className="input-base"
                    style={{
                      width: '100%', padding: '6px 10px', fontSize: 13,
                      opacity: isSaving ? 0.5 : 1, pointerEvents: isSaving ? 'none' : 'auto',
                    }}
                    value={biz.practice_id || ''}
                    onChange={(e) => handleMap(biz.business_id, e.target.value)}
                  >
                    <option value="">-- Do not sync --</option>
                    {data.practices.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
