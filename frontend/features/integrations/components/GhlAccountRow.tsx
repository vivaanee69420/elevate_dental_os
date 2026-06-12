'use client';
import { useState } from 'react';
import type { GhlAccount, PracticeRow } from '../api';
import { useUpdateGhlAccount, useRemoveGhlAccount } from '../hooks';

export default function GhlAccountRow({
  account, practices, onSync,
}: {
  account: GhlAccount;
  practices: PracticeRow[];
  onSync: (id: string, full: boolean) => void;
}) {
  const update = useUpdateGhlAccount();
  const remove = useRemoveGhlAccount();
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 4px', fontSize: 13 }}>
        <div style={{ fontWeight: 600 }}>{account.label || 'GoHighLevel'}</div>
        <div className="text-ink-muted" style={{ fontSize: 11, fontFamily: 'monospace' }}>{account.external_account_id}</div>
      </td>
      <td style={{ padding: '8px 4px', width: 220 }}>
        <select
          value={account.practice_id ?? ''}
          onChange={(e) => update.mutate({ id: account.id, practiceId: e.target.value || null })}
          style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'white' }}
        >
          <option value="">Unmapped</option>
          {practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {update.isError && <div style={{ fontSize: 10, color: 'var(--danger)' }}>{(update.error as Error).message}</div>}
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
        <button onClick={() => onSync(account.id, false)} style={btn('white')}>Sync</button>{' '}
        {!confirmRemove
          ? <button onClick={() => setConfirmRemove(true)} style={btn('white')}>Disconnect</button>
          : <button onClick={() => remove.mutate(account.id)} style={btn('var(--danger)', 'white')}>Confirm</button>}
      </td>
    </tr>
  );
}

function btn(bg: string, color = 'var(--ink)'): React.CSSProperties {
  return { padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: bg, color, cursor: 'pointer' };
}
