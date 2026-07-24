'use client';

// Ad account selector (Google Ads / Meta Ads). Lists every ad account the
// connected login can reach and lets the owner pick which ones feed the
// marketing views (Marketing Snapshot, Marketing ROI, ad-spend). Selection is
// org-isolated and persisted server-side; default = all selected. Pull-all,
// filter-on-read: deselecting never deletes synced history.

import { useEffect, useState } from 'react';
import { Chip } from '@/components/ui';
import {
  useAdAccounts, useSetAdAccountSelection, useSetAdAccountPractice, usePractices,
  useSyncIntegration,
} from '@/features/integrations/hooks';
import CollapsibleCard from './CollapsibleCard';

export default function AdAccountSelector({ provider, label }: { provider: string; label: string }) {
  const { data: accounts, isLoading } = useAdAccounts(provider);
  const save = useSetAdAccountSelection(provider);
  // Practice mapping: which practice each account's spend belongs to. Without
  // it the marketing "By practice" split shows spend as "Not reporting".
  const { data: practiceData } = usePractices();
  const practices = practiceData?.practices ?? [];
  const setPractice = useSetAdAccountPractice(provider);
  const [mappingSaving, setMappingSaving] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);

  async function onMapPractice(id: string, practiceId: string) {
    setMappingSaving(id);
    setMappingError(null);
    try {
      await setPractice.mutateAsync({ id, practiceId: practiceId || null });
    } catch (e) {
      setMappingError((e as Error).message || 'Could not save that mapping. Please try again.');
    } finally {
      setMappingSaving(null);
    }
  }
  // Full 12-month backfill. The Refresh button only pulls the incremental
  // (~31-day) window, so historical months show low spend/impressions/clicks
  // (summed from daily rows) until a full pull lands. Fire-and-forget server-side.
  const backfill = useSyncIntegration();
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
    <CollapsibleCard
      title={`${label} accounts`}
      style={{ marginBottom: 16 }}
      actions={(
        <span className="text-ink-muted" style={{ fontSize: 11 }}>
          {selectedCount} of {accounts.length} included
        </span>
      )}
    >
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Choose which ad accounts feed the marketing dashboards. Unticking an account hides it from
        the views — its synced history is kept and returns when re-ticked. Map each account to its
        practice so spend and cost per lead split by practice; unmapped spend counts for the group
        only and shows as &ldquo;Not reporting&rdquo; on practice rows.
      </p>

      {mappingError && (
        <p style={{ fontSize: 12, marginBottom: 10, color: 'var(--danger, #b91c1c)' }}>{mappingError}</p>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        <button onClick={() => setAll(true)} style={linkBtn}>Select all</button>
        <button onClick={() => setAll(false)} style={linkBtn}>Clear all</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {accounts.map((a) => (
          <div
            key={a.customer_id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
              border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer', minWidth: 0 }}>
              <input
                type="checkbox"
                checked={selected[a.customer_id] ?? false}
                onChange={() => toggle(a.customer_id)}
              />
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name || a.customer_id}
              </span>
            </label>
            {practices.length > 0 && (
              <select
                value={a.practice_id ?? ''}
                disabled={mappingSaving === a.id}
                onChange={(e) => onMapPractice(a.id, e.target.value)}
                style={{
                  maxWidth: 200, padding: '4px 6px', fontSize: 12,
                  border: '1px solid var(--border)', borderRadius: 6,
                  color: a.practice_id ? 'inherit' : 'var(--ink-muted, #64748b)',
                }}
              >
                <option value="">Group only — no practice</option>
                {practices.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {a.currency && <span className="text-ink-muted" style={{ fontSize: 11 }}>{a.currency}</span>}
            {a.status && a.status !== 'active' && (
              <Chip colour="amber">{a.status}</Chip>
            )}
            {/* Only show the raw account id when there's no readable name. */}
            {!a.name && <span className="text-ink-muted" style={{ fontSize: 11 }}>{a.customer_id}</span>}
          </div>
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
        {!dirty && (
          <span className="text-ink-muted" style={{ fontSize: 12 }}>
            {save.isSuccess ? 'Saved' : 'All changes saved — tick or untick an account to update'}
          </span>
        )}
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <button
          onClick={() => backfill.mutate({ provider, full: true })}
          disabled={backfill.isPending}
          style={{ ...linkBtn, fontWeight: 700, cursor: backfill.isPending ? 'default' : 'pointer' }}
        >
          {backfill.isPending ? 'Starting backfill…' : 'Backfill 12 months'}
        </button>
        <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 4 }}>
          {backfill.isSuccess
            ? 'Backfill started — it runs in the background; spend/impressions update in a minute or two.'
            : 'Re-pulls 12 months of spend, impressions and clicks. Use if historical months look low (the daily Refresh only fetches the last ~31 days).'}
        </p>
      </div>
    </CollapsibleCard>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontSize: 12, color: 'var(--brand)', fontWeight: 600,
};
