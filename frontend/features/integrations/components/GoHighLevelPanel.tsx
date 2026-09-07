'use client';
// GoHighLevel subaccount manager. Lists every connected GHL Location (each mapped
// 1:1 to a practice), lets the owner add a subaccount, map/sync/disconnect each,
// and copy the per-subaccount webhook URL to paste into that location's GHL
// settings.
//
// There are TWO ways to add one, and both produce the same kind of row:
//
//   Sign in with GoHighLevel — one consent authorises one Location, and we
//   store the tokens ourselves. Nothing to copy, and no token to re-paste when
//   it is rotated. Offered only when this server has a marketplace app
//   configured, which is what authStyle 'oauth_or_key' reports.
//
//   Private Integration Token — paste a token and its Location ID. Still the
//   only route for a location the person setting this up cannot sign in to,
//   so it stays a first-class option rather than a fallback.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGhlAccounts, useAddGhlAccount, useIntegrations, useStartConnect } from '../hooks';
import { syncGhlAccount } from '../api';
import GhlAccountRow from './GhlAccountRow';
import PanelCard from './PanelCard';
import DailyReportCard from './DailyReportCard';

export default function GoHighLevelPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useGhlAccounts();
  const add = useAddGhlAccount();
  // Shared cache with the Integrations screen, so this costs no extra request.
  const { data: registry } = useIntegrations();
  const startConnect = useStartConnect();

  const [showAdd, setShowAdd] = useState(false);
  const [token, setToken] = useState('');
  const [locId, setLocId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accounts = data?.accounts ?? [];
  // The server tells us whether OAuth is available; we never guess. Without a
  // marketplace app configured the button would send the owner to a consent
  // screen that cannot complete, so it is simply absent.
  const oauthAvailable =
    registry?.available?.find((p) => p.id === 'gohighlevel')?.authStyle === 'oauth_or_key';

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

  async function connectWithOauth() {
    setError(null);
    try {
      const res = await startConnect.mutateAsync({ provider: 'gohighlevel' });
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl;
        return;
      }
      // No redirect means the server is not actually configured for OAuth.
      // Say so rather than leaving a button that appears to do nothing.
      setError('This server has no GoHighLevel app configured, so sign-in is unavailable. Add a subaccount with a token instead.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function onSync(id: string, full: boolean) {
    syncGhlAccount(id, full).catch(() => {});
    setNotice('Sync started. New data will appear shortly.');
    refetchSoon();
  }

  return (
    <PanelCard
      title="GoHighLevel subaccounts"
      actions={(
        <div style={{ display: 'flex', gap: 8 }}>
          {oauthAvailable && (
            <button onClick={connectWithOauth} disabled={startConnect.isPending} style={primaryBtn(startConnect.isPending)}>
              {startConnect.isPending ? 'Opening GoHighLevel…' : 'Sign in with GoHighLevel'}
            </button>
          )}
          <button onClick={() => setShowAdd((v) => !v)} style={oauthAvailable ? secondaryBtn : primaryBtn(false)}>
            {showAdd ? 'Cancel' : oauthAvailable ? 'Add with token' : 'Add subaccount'}
          </button>
        </div>
      )}
    >
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        {oauthAvailable
          ? 'Add each GoHighLevel location once. Sign in and pick the location, or paste a Private Integration Token for a location you cannot sign in to. Contacts and opportunities sync in automatically.'
          : 'Connect each GoHighLevel location with its own Private Integration Token. Contacts and opportunities sync in automatically.'}
      </p>

      {error && (
        <div style={{ marginBottom: 12, padding: '8px 10px', fontSize: 12, borderRadius: 6, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
          {error}
        </div>
      )}

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
          <button
            onClick={submitAdd}
            disabled={add.isPending || !token.trim() || !locId.trim()}
            style={{ alignSelf: 'flex-start', padding: '7px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', background: 'var(--brand)', color: 'white', cursor: 'pointer', opacity: (add.isPending || !token.trim() || !locId.trim()) ? 0.5 : 1 }}
          >
            {add.isPending ? 'Connecting…' : 'Connect'}
          </button>
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

      <DailyReportCard />
    </PanelCard>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 };

const btnBase: React.CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer' };
const primaryBtn = (busy: boolean): React.CSSProperties => ({
  ...btnBase, border: 'none', background: 'var(--brand)', color: 'white',
  opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer',
});
const secondaryBtn: React.CSSProperties = {
  ...btnBase, border: '1px solid var(--border)', background: 'white', color: 'var(--ink)',
};
