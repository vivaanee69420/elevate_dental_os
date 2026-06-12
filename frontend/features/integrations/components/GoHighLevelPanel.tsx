'use client';
// GoHighLevel subaccount manager. Lists every connected GHL Location (each mapped
// 1:1 to a practice), lets the owner add a subaccount (paste a Private Integration
// Token + Location ID + pick a practice), map/sync/disconnect each, and copy the
// per-subaccount webhook URL to paste into that location's GHL settings.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGhlAccounts, useAddGhlAccount } from '../hooks';
import { syncGhlAccount } from '../api';
import GhlAccountRow from './GhlAccountRow';

export default function GoHighLevelPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useGhlAccounts();
  const add = useAddGhlAccount();

  const [showAdd, setShowAdd] = useState(false);
  const [token, setToken] = useState('');
  const [locId, setLocId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const accounts = data?.accounts ?? [];

  // Per-account sync + add-bootstrap run server-side with no progress stream;
  // refetch the list shortly after so status/last_sync update.
  function refetchSoon() {
    setTimeout(() => qc.invalidateQueries({ queryKey: ['ghl-accounts'] }), 6000);
  }

  async function submitAdd() {
    if (!token.trim() || !locId.trim()) return;
    await add.mutateAsync({ token: token.trim(), locationId: locId.trim() });
    setToken(''); setLocId(''); setShowAdd(false);
    setNotice('Subaccount connected. Initial sync is running — contacts and leads will appear shortly.');
    refetchSoon();
  }

  function onSync(id: string, full: boolean) {
    syncGhlAccount(id, full).catch(() => {});
    setNotice('Sync started. New data will appear shortly.');
    refetchSoon();
  }

  return (
    <div className="card-padded" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>GoHighLevel subaccounts</h2>
        <button onClick={() => setShowAdd((v) => !v)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', background: 'var(--brand)', color: 'white', cursor: 'pointer' }}>
          {showAdd ? 'Cancel' : 'Add subaccount'}
        </button>
      </div>
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Connect each GoHighLevel location with its own Private Integration Token.
        Contacts and opportunities sync in automatically.
      </p>

      {notice && (
        <div style={{ marginBottom: 12, padding: '8px 10px', fontSize: 12, borderRadius: 6, background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#047857' }}>
          {notice}
        </div>
      )}

      {showAdd && (
        <div style={{ marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#F8FAFC', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 460 }}>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Private Integration Token (pit-…)" style={inp} />
          <input type="text" value={locId} onChange={(e) => setLocId(e.target.value)} placeholder="Location ID" style={inp} />
          <span className="text-ink-muted" style={{ fontSize: 10 }}>The token must be created inside the same GHL sub-account as the Location ID.</span>
        </div>
      )}

      {isLoading ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>Loading subaccounts…</div>
      ) : accounts.length === 0 ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>No subaccounts connected yet. Add one above.</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-ink-muted" style={{ textAlign: 'left', fontSize: 11 }}>
              <th style={{ padding: 4 }}>Subaccount</th>
              <th style={{ padding: 4 }}>Status</th>
              <th style={{ padding: 4 }}>Webhook URL</th>
              <th style={{ padding: 4 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <GhlAccountRow key={a.id} account={a} onSync={onSync} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 };
