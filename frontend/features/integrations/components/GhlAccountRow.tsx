'use client';
import { useState } from 'react';
import { DeleteAccountButton } from './DeleteAccountButton';
import type { GhlAccount } from '../api';
import { useRemoveGhlAccount, useDeleteAccountPermanently } from '../hooks';

export default function GhlAccountRow({
  account, onSync,
}: {
  account: GhlAccount;
  onSync: (id: string, full: boolean) => void;
}) {
  const remove = useRemoveGhlAccount();
  const onDeleted = useDeleteAccountPermanently();
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 4px', fontSize: 13 }}>
        <div style={{ fontWeight: 600 }}>{account.label || 'GoHighLevel'}</div>
        <div className="text-ink-muted" style={{ fontSize: 11, fontFamily: 'monospace' }}>{account.external_account_id}</div>
      </td>
      <td style={{ padding: '8px 4px', fontSize: 12 }}>
        <span style={{ color: account.status === 'active' ? 'var(--success, #047857)' : 'var(--danger)' }}>{account.status}</span>
        <div className="text-ink-muted" style={{ fontSize: 10 }}>
          {account.last_sync_at ? `synced ${new Date(account.last_sync_at).toLocaleDateString('en-GB')}` : 'never synced'}
        </div>
      </td>
      <td style={{ padding: '8px 4px', fontSize: 11 }}>
        {account.webhook_url
          ? <code style={{ fontSize: 10, wordBreak: 'break-all' }}>{account.webhook_url}</code>
          : <span className="text-ink-muted">—</span>}
      </td>
      <td style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <button onClick={() => onSync(account.id, false)} style={btn('white')}>Sync</button>
          {account.status !== 'revoked' && (!confirmRemove
            ? <button onClick={() => setConfirmRemove(true)} style={btn('white')}>Disconnect</button>
            : <button onClick={() => remove.mutate(account.id)} style={btn('var(--danger)', 'white')}>Confirm</button>)}
          {/* Only on a row that is already disconnected — Disconnect stops the
              sync, Delete removes the row that was left behind. */}
          <DeleteAccountButton
            provider="gohighlevel"
            id={account.id}
            label={account.label || 'this subaccount'}
            status={account.status}
            onDeleted={onDeleted}
          />
        </div>
      </td>
    </tr>
  );
}

function btn(bg: string, color = 'var(--ink)'): React.CSSProperties {
  return { padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: bg, color, cursor: 'pointer' };
}
