'use client';
// QuickBooks company manager. Lists every connected QBO company (each an
// independent entity — no practice mapping), lets the owner connect another
// company through Intuit OAuth, and sync or disconnect each. Mirrors the
// GoHighLevel subaccount panel.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listQboAccounts, connectQboAccount, syncQboAccount, removeQboAccount, type QboAccount } from '../api';
import PanelCard from './PanelCard';

export default function QuickBooksPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['qbo-accounts'], queryFn: listQboAccounts });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accounts = data?.accounts ?? [];

  function refetchSoon() {
    setTimeout(() => qc.invalidateQueries({ queryKey: ['qbo-accounts'] }), 6000);
  }

  async function onConnect() {
    setBusy(true);
    try {
      const { redirectUrl } = await connectQboAccount();
      window.location.href = redirectUrl; // hand off to Intuit
    } catch {
      setNotice('Could not start the QuickBooks connection. Please try again.');
      setBusy(false);
    }
  }

  function onSync(id: string, full: boolean) {
    syncQboAccount(id, full).catch(() => {});
    setNotice('Sync started. Updated figures will appear shortly.');
    refetchSoon();
  }

  async function onDisconnect(a: QboAccount) {
    const name = a.company_name || a.label || 'this company';
    if (!window.confirm(`Disconnect ${name}? Its QuickBooks data will be removed from Elevate.`)) return;
    await removeQboAccount(a.id).catch(() => {});
    setNotice('Company disconnected.');
    qc.invalidateQueries({ queryKey: ['qbo-accounts'] });
  }

  return (
    <PanelCard
      title="QuickBooks companies"
      actions={(
        <button onClick={onConnect} disabled={busy} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', background: 'var(--brand)', color: 'white', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Redirecting…' : 'Connect a company'}
        </button>
      )}
    >
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Connect each QuickBooks company separately. Profit &amp; loss, bank balances,
        outstanding invoices and receipts sync in automatically and roll up across
        every company in your Business Hub.
      </p>

      {notice && (
        <div style={{ marginBottom: 12, padding: '8px 10px', fontSize: 12, borderRadius: 6, background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#047857' }}>
          {notice}
        </div>
      )}

      {isLoading ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>Loading companies…</div>
      ) : accounts.length === 0 ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>No QuickBooks companies connected yet. Connect one above.</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-ink-muted" style={{ textAlign: 'left', fontSize: 11 }}>
              <th style={{ padding: 4 }}>Company</th>
              <th style={{ padding: 4 }}>Status</th>
              <th style={{ padding: 4 }}>Last sync</th>
              <th style={{ padding: 4 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: 6, fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{a.company_name || a.label || 'QuickBooks'}</div>
                  {a.realm_id && <div className="text-ink-muted" style={{ fontSize: 10 }}>Realm {a.realm_id}</div>}
                </td>
                <td style={{ padding: 6, fontSize: 12 }}>
                  <StatusPill status={a.status} />
                  {a.last_error && <div style={{ fontSize: 10, color: '#B91C1C', maxWidth: 220 }}>{a.last_error}</div>}
                </td>
                <td style={{ padding: 6, fontSize: 12 }} className="text-ink-muted">
                  {a.last_sync_at ? new Date(a.last_sync_at).toLocaleString('en-GB') : 'Never'}
                </td>
                <td style={{ padding: 6 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => onSync(a.id, false)} style={btnSm}>Sync</button>
                    <button onClick={() => onSync(a.id, true)} style={btnSm}>Full refresh</button>
                    <button onClick={() => onDisconnect(a)} style={{ ...btnSm, color: '#B91C1C' }}>Disconnect</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PanelCard>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    active: { bg: '#ECFDF5', fg: '#047857', label: 'Active' },
    failed: { bg: '#FEF2F2', fg: '#B91C1C', label: 'Error' },
    revoked: { bg: '#F3F4F6', fg: '#6B7280', label: 'Disconnected' },
    pending: { bg: '#FFFBEB', fg: '#B45309', label: 'Pending' },
  };
  const s = map[status] ?? map.pending;
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: s.bg, color: s.fg }}>{s.label}</span>;
}

const btnSm: React.CSSProperties = { padding: '4px 8px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border)', background: 'white', cursor: 'pointer' };
