'use client';
// Step 3 of ad attribution: connect each ad account to a practice, so spend —
// and therefore cost per lead — can be reported below group level. Until this
// is done, per-practice cost per lead is reported as unknown rather than zero.
import { useState } from 'react';
import { Card } from '@/components/ui';
import { useSetAdAccountPractice } from '../hooks';
import type { AdAttributionConfig } from '../api';

const PROVIDER_LABEL: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Facebook Ads',
};

export default function AdAccountPracticeStep({ config }: { config: AdAttributionConfig }) {
  const setPractice = useSetAdAccountPractice();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(id: string, practiceId: string) {
    setSaving(id);
    setError(null);
    try {
      await setPractice.mutateAsync({ id, practiceId: practiceId || null });
    } catch (e) {
      setError((e as Error).message || 'Could not save that change. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-[15px] font-semibold text-slate-900">
        Step 3 — Connect ad accounts to practices
      </h2>
      <p className="mb-3 text-[13px] text-slate-600">
        Spend from an unconnected ad account is still counted for the group, but it cannot be
        split by practice — those practices show cost per lead as unknown.
      </p>
      {error && (
        <p className="mb-3 text-[13px] text-danger">{error}</p>
      )}
      {config.adAccounts.length === 0 ? (
        <p className="py-3 text-sm text-slate-500">
          No ad accounts connected yet. Connect Google Ads or Facebook Ads on the Integrations page first.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-3 font-medium">Ad account</th>
                <th className="py-2 pr-3 font-medium">Channel</th>
                <th className="py-2 pr-3 font-medium" style={{ width: '32%' }}>Practice</th>
              </tr>
            </thead>
            <tbody>
              {config.adAccounts.map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-900">{a.name ?? a.customerId}</div>
                    <div className="text-[11px] text-slate-400">{a.customerId}</div>
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{PROVIDER_LABEL[a.provider] ?? a.provider}</td>
                  <td className="py-2 pr-3">
                    <select
                      className="w-full rounded border border-slate-300 px-2 py-1 text-[13px]"
                      disabled={saving === a.id}
                      value={a.practiceId ?? ''}
                      onChange={(e) => handle(a.id, e.target.value)}
                    >
                      <option value="">Group only — do not split by practice</option>
                      {config.practices.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
