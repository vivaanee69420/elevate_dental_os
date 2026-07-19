'use client';
// Step 1 of ad attribution: connect each GoHighLevel subaccount to a practice.
//
// "No practice" is a legitimate, deliberate choice, not an error: the
// Plan4Growth academy and accounting Locations are connected here too, and
// their leads must be excluded from practice numbers rather than folded in.
// So an unmapped row is stated plainly, never flagged as a problem.
//
// One subaccount per practice is enforced by a unique index in the database, so
// a practice already taken is disabled in the dropdown with the reason shown
// rather than offered and then failing on save.
import { useState } from 'react';
import { Card } from '@/components/ui';
import { useSetSubaccountPractice } from '../hooks';
import type { AdAttributionConfig } from '../api';

export default function SubaccountPracticeStep({ config }: { config: AdAttributionConfig }) {
  const setPractice = useSetSubaccountPractice();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const takenBy = new Map<string, string>();
  for (const s of config.subaccounts) {
    if (s.practiceId) takenBy.set(s.practiceId, s.label);
  }

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
        Step 1 — Connect subaccounts to practices
      </h2>
      <p className="mb-3 text-[13px] text-slate-600">
        Each GoHighLevel subaccount belongs to one practice. Leave a subaccount unconnected
        if it is not a practice — its leads are then excluded from ad performance.
      </p>
      {error && (
        <p className="mb-3 text-[13px] text-danger">{error}</p>
      )}
      {config.subaccounts.length === 0 ? (
        <p className="py-3 text-sm text-slate-500">
          No GoHighLevel subaccounts connected yet. Connect one on the Integrations page first.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-3 font-medium">Subaccount</th>
                <th className="py-2 pr-3 text-right font-medium">Pipelines</th>
                <th className="py-2 pr-3 text-right font-medium">Leads</th>
                <th className="py-2 pr-3 font-medium" style={{ width: '32%' }}>Practice</th>
              </tr>
            </thead>
            <tbody>
              {config.subaccounts.map((s) => (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-900">{s.label}</div>
                    <div className="text-[11px] text-slate-400">{s.locationId}</div>
                  </td>
                  <td className="py-2 pr-3 text-right text-slate-600">{s.pipelineCount}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{s.leadCount.toLocaleString('en-GB')}</td>
                  <td className="py-2 pr-3">
                    <select
                      className="w-full rounded border border-slate-300 px-2 py-1 text-[13px]"
                      disabled={saving === s.id}
                      value={s.practiceId ?? ''}
                      onChange={(e) => handle(s.id, e.target.value)}
                    >
                      <option value="">Not a practice — exclude</option>
                      {config.practices.map((p) => {
                        const owner = takenBy.get(p.id);
                        const taken = owner !== undefined && p.id !== s.practiceId;
                        return (
                          <option key={p.id} value={p.id} disabled={taken}>
                            {p.name}{taken ? ` (already ${owner})` : ''}
                          </option>
                        );
                      })}
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
