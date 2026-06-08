'use client';

// Ad account selector (Google Ads / Meta Ads). Lists every ad account the
// connected login can reach and lets the owner pick which ones feed the
// marketing views (Marketing Snapshot, Marketing ROI, ad-spend). Selection is
// org-isolated and persisted server-side; default = all selected. Pull-all,
// filter-on-read: deselecting never deletes synced history.

import { useEffect, useState } from 'react';
import { Chip } from '@/components/ui';
import { useAdAccounts, useSetAdAccountSelection } from '@/features/integrations/hooks';

export default function AdAccountSelector({ provider, label }: { provider: string; label: string }) {
  const { data: accounts, isLoading } = useAdAccounts(provider);
  const save = useSetAdAccountSelection(provider);
  // Local checkbox state, seeded from the server selection.
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!accounts) return;
    setSelected(Object.fromEntries(accounts.map((a) => [a.customer_id, a.is_selected])));
  }, [accounts]);

  if (isLoading) return null;
  if (!accounts || accounts.length === 0) return null;

  const dirty = accounts.some((a) => (selected[a.customer_id] ?? false) !== a.is_selected);
  const selectedCount = Object.values(selected).filter(Boolean).length;

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }
  function setAll(value: boolean) {
    setSelected(Object.fromEntries(accounts!.map((a) => [a.customer_id, value])));
  }
  function onSave() {
    const ids = accounts!.filter((a) => selected[a.customer_id]).map((a) => a.customer_id);
    save.mutate(ids);
  }

  return (
    <div className="card-padded" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 className="display" style={{ fontSize: 15, fontWeight: 600 }}>{label} accounts</h3>
        <span className="text-ink-muted" style={{ fontSize: 11 }}>
          {selectedCount} of {accounts.length} included
        </span>
      </div>
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Choose which ad accounts feed the marketing dashboards. Unticking an account hides it from
        the views — its synced history is kept and returns when re-ticked.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        <button onClick={() => setAll(true)} style={linkBtn}>Select all</button>
        <button onClick={() => setAll(false)} style={linkBtn}>Clear all</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {accounts.map((a) => (
          <label
            key={a.customer_id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
              border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={selected[a.customer_id] ?? false}
              onChange={() => toggle(a.customer_id)}
            />
            <span style={{ flex: 1, fontWeight: 600 }}>{a.name || a.customer_id}</span>
            {a.currency && <span className="text-ink-muted" style={{ fontSize: 11 }}>{a.currency}</span>}
            {a.status && a.status !== 'active' && (
              <Chip colour="amber">{a.status}</Chip>
            )}
            <span className="text-ink-muted" style={{ fontSize: 11 }}>{a.customer_id}</span>
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button
          onClick={onSave}
          disabled={!dirty || save.isPending}
          style={{
            padding: '8px 14px', background: dirty ? 'var(--brand)' : 'var(--border)',
            color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700,
            cursor: dirty && !save.isPending ? 'pointer' : 'default',
          }}
        >
          {save.isPending ? 'Saving…' : 'Save selection'}
        </button>
        {save.isSuccess && !dirty && (
          <span className="text-ink-muted" style={{ fontSize: 12 }}>Saved</span>
        )}
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontSize: 12, color: 'var(--brand)', fontWeight: 600,
};
