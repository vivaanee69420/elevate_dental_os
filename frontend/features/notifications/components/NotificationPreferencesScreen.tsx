'use client';
import { useEffect, useState } from 'react';
import { usePreferences, useUpdatePreferences, type Preference } from '../data';

const LABELS: Record<string, string> = {
  account: 'Account',
  team: 'Team',
  integration: 'Integrations',
  digest: 'Weekly digest',
  system: 'System',
};

export default function NotificationPreferencesScreen() {
  const { data } = usePreferences();
  const update = useUpdatePreferences();
  const [rows, setRows] = useState<Preference[]>([]);

  useEffect(() => {
    if (data) setRows(data);
  }, [data]);

  function toggle(i: number, key: 'in_app' | 'email' | 'sms') {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: !row[key] } : row)));
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-lg font-medium text-ink mb-4">Notification preferences</h1>
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg text-ink-muted">
              <th className="text-left px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">In-app</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">SMS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.category} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 text-ink">{LABELS[row.category] ?? row.category}</td>
                {(['in_app', 'email', 'sms'] as const).map((k) => (
                  <td key={k} className="text-center px-4 py-3">
                    <input
                      type="checkbox"
                      checked={row[k]}
                      onChange={() => toggle(i, k)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => update.mutate(rows)}
        disabled={update.isPending}
        className="mt-4 px-4 py-2 bg-brand text-white rounded-lg text-sm disabled:opacity-50"
      >
        {update.isPending ? 'Saving...' : 'Save preferences'}
      </button>
    </div>
  );
}
