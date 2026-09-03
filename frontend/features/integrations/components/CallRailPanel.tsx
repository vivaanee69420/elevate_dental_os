'use client';
// CallRail — call-tracking company manager. CallRail tracks the phone calls
// each Google Ads campaign drives, so a call can be credited back to the ad
// that produced it. One CallRail company = one API key, mapped 1:1 to a
// practice — the same shape GoHighLevel multi-subaccount already established
// here: the first company added IS the connection, there is no separate
// singleton key-paste route, and there is no owner-maintained tracking-number
// map — a call's practice follows from the company that fetched it.

import { useState } from 'react';
import { Chip, type ChipColour } from '@/components/ui';
import type { CallRailAccount, IntegrationStatus } from '../api';
import {
  useCallRailStatus,
  useAddCallRailAccount,
  useUpdateCallRailAccount,
  useRemoveCallRailAccount,
  useSyncCallRailAccount,
  useSyncAllCallRail,
  useDisconnectCallRail,
  usePractices,
} from '../hooks';
import CollapsibleCard from './CollapsibleCard';

const STATUS_CHIP: Record<IntegrationStatus, ChipColour> = {
  active: 'emerald',
  pending: 'amber',
  verifying: 'amber',
  failed: 'rose',
  revoked: 'slate',
};

export default function CallRailPanel() {
  const { data, isLoading } = useCallRailStatus();
  const { data: practiceData } = usePractices();
  const practices = practiceData?.practices ?? [];

  const add = useAddCallRailAccount();
  const update = useUpdateCallRailAccount();
  const remove = useRemoveCallRailAccount();
  const sync = useSyncCallRailAccount();
  const syncAll = useSyncAllCallRail();
  const disconnectAll = useDisconnectCallRail();

  const [showAdd, setShowAdd] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [label, setLabel] = useState('');
  const [practiceId, setPracticeId] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mappingSavingId, setMappingSavingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmDisconnectAll, setConfirmDisconnectAll] = useState(false);

  if (isLoading) return null;

  const accounts: CallRailAccount[] = data?.accounts ?? [];
  const sourceBreakdown = data?.sourceBreakdown ?? [];
  const connected = !!data?.connected && accounts.length > 0;
  const totalCalls = accounts.reduce((n, a) => n + (a.callCount || 0), 0);
  const hasFailed = accounts.some((a) => a.status === 'failed');

  function resetAddForm() {
    setApiKey('');
    setCompanyId('');
    setLabel('');
    setPracticeId('');
  }

  async function submitAdd() {
    setAddErr(null);
    if (!apiKey.trim() || !companyId.trim() || !label.trim()) return;
    try {
      await add.mutateAsync({
        apiKey: apiKey.trim(),
        callrailAccountId: companyId.trim(),
        label: label.trim(),
        practiceId: practiceId || null,
      });
      resetAddForm();
      setShowAdd(false);
      setNotice('Company connected. The first pull runs tonight — use Sync now to pull immediately.');
    } catch (e) {
      setAddErr((e as Error).message);
    }
  }

  function copyWebhook(id: string, url: string) {
    navigator.clipboard?.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function onSyncOne(id: string) {
    setRowErr(null);
    setSyncingId(id);
    try {
      const res = await sync.mutateAsync(id);
      setNotice(`Pulled ${res.ingested} call${res.ingested === 1 ? '' : 's'}.`);
    } catch (e) {
      setRowErr((e as Error).message);
    } finally {
      setSyncingId(null);
    }
  }

  async function onSyncAll() {
    setRowErr(null);
    try {
      const res = await syncAll.mutateAsync();
      setNotice(`Pulled ${res.ingested} call${res.ingested === 1 ? '' : 's'} across every company.`);
    } catch (e) {
      setRowErr((e as Error).message);
    }
  }

  async function onMapPractice(id: string, value: string) {
    setRowErr(null);
    setMappingSavingId(id);
    try {
      await update.mutateAsync({ id, practiceId: value || null });
    } catch (e) {
      setRowErr((e as Error).message);
    } finally {
      setMappingSavingId(null);
    }
  }

  const addForm = (
    <div
      style={{
        padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#F8FAFC',
        display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 460,
      }}
    >
      <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="CallRail API key" style={inp} />
      <input type="text" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="CallRail company ID" style={inp} />
      <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Bexleyheath)" style={inp} />
      <select value={practiceId} onChange={(e) => setPracticeId(e.target.value)} style={inp}>
        <option value="">No practice yet — assign later</option>
        {practices.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {addErr && <span style={{ fontSize: 11, color: 'var(--danger, #b91c1c)' }}>{addErr}</span>}
      <button
        onClick={submitAdd}
        disabled={add.isPending || !apiKey.trim() || !companyId.trim() || !label.trim()}
        style={{
          alignSelf: 'flex-start', padding: '7px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6,
          border: 'none', background: 'var(--brand)', color: 'white',
          cursor: 'pointer', opacity: (add.isPending || !apiKey.trim() || !companyId.trim() || !label.trim()) ? 0.5 : 1,
        }}
      >
        {add.isPending ? 'Connecting…' : 'Connect company'}
      </button>
      <span className="text-ink-muted" style={{ fontSize: 10 }}>Stored encrypted at rest. Never displayed again.</span>
    </div>
  );

  return (
    <CollapsibleCard
      title="CallRail — call tracking"
      actions={connected ? (
        <button
          onClick={() => setShowAdd((v) => !v)}
          style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', background: 'var(--brand)', color: 'white', cursor: 'pointer' }}
        >
          {showAdd ? 'Cancel' : 'Add company'}
        </button>
      ) : undefined}
    >
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        CallRail tracks the phone calls each Google Ads campaign drives, so a call can be credited
        back to the ad that produced it. Connect one CallRail company per practice — its API key is
        stored encrypted and never shown again.
      </p>

      {notice && (
        <div style={{ marginBottom: 12, padding: '8px 10px', fontSize: 12, borderRadius: 6, background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#047857' }}>
          {notice}
        </div>
      )}
      {rowErr && (
        <div style={{ marginBottom: 12, padding: '8px 10px', fontSize: 12, borderRadius: 6, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>
          {rowErr}
        </div>
      )}

      {!connected ? (
        addForm
      ) : (
        <>
          {showAdd && <div style={{ marginBottom: 16 }}>{addForm}</div>}

          {totalCalls === 0 && (
            <div
              style={{
                marginBottom: 12, padding: '8px 10px', borderRadius: 6, fontSize: 11,
                background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E',
              }}
            >
              No calls have arrived yet. Paste each company&rsquo;s webhook URL below into CallRail
              for real-time delivery — otherwise the first pull runs tonight, and Sync now pulls
              immediately.
            </div>
          )}

          {hasFailed && (
            <div
              style={{
                marginBottom: 12, padding: '8px 10px', borderRadius: 6, fontSize: 11,
                background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
              }}
            >
              One or more companies failed to sync — see the reason below each. Disconnect that
              company and add it again with a corrected API key to reconnect it.
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <button
              onClick={onSyncAll}
              disabled={syncAll.isPending}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none',
                background: 'var(--brand)', color: 'white',
                cursor: syncAll.isPending ? 'default' : 'pointer', opacity: syncAll.isPending ? 0.6 : 1,
              }}
            >
              {syncAll.isPending ? 'Syncing…' : 'Sync now — every company'}
            </button>
          </div>

          <table className="w-full">
            <thead>
              <tr className="text-ink-muted" style={{ textAlign: 'left', fontSize: 11 }}>
                <th style={{ padding: 4 }}>Company</th>
                <th style={{ padding: 4 }}>Practice</th>
                <th style={{ padding: 4 }}>Calls</th>
                <th style={{ padding: 4 }}>Last call</th>
                <th style={{ padding: 4 }}>Status</th>
                <th style={{ padding: 4 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 4px', fontSize: 13 }}>
                    <div style={{ fontWeight: 600 }}>{a.label || 'CallRail'}</div>
                    <div className="text-ink-muted" style={{ fontSize: 11, fontFamily: 'monospace' }}>{a.callrailAccountId}</div>
                  </td>
                  <td style={{ padding: '8px 4px', fontSize: 12 }}>
                    <select
                      value={a.practiceId ?? ''}
                      disabled={mappingSavingId === a.id}
                      onChange={(e) => onMapPractice(a.id, e.target.value)}
                      style={{
                        maxWidth: 180, padding: '4px 6px', fontSize: 12,
                        border: '1px solid var(--border)', borderRadius: 6,
                        color: a.practiceId ? 'inherit' : 'var(--ink-muted, #64748b)',
                      }}
                    >
                      <option value="">Not mapped</option>
                      {practices.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {!a.practiceId && (
                      <div className="text-warning" style={{ fontSize: 10, marginTop: 2 }}>
                        No practice assigned — its calls are not attributed
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 4px', fontSize: 13 }}>{a.callCount.toLocaleString('en-GB')}</td>
                  <td className="text-ink-muted" style={{ padding: '8px 4px', fontSize: 11 }}>
                    {a.lastCallAt ? new Date(a.lastCallAt).toLocaleString('en-GB') : 'none yet'}
                  </td>
                  <td style={{ padding: '8px 4px', fontSize: 12 }}>
                    <Chip colour={STATUS_CHIP[a.status]}>{a.status}</Chip>
                    <div className="text-ink-muted" style={{ fontSize: 10, marginTop: 2 }}>
                      {a.lastSyncedAt ? `synced ${new Date(a.lastSyncedAt).toLocaleDateString('en-GB')}` : 'never synced'}
                    </div>
                    {a.status === 'failed' && a.lastError && (
                      <div style={{ fontSize: 10, marginTop: 2, color: 'var(--danger, #b91c1c)' }}>{a.lastError.slice(0, 80)}</div>
                    )}
                  </td>
                  <td style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>
                    <button onClick={() => onSyncOne(a.id)} disabled={syncingId === a.id} style={btn('white')}>
                      {syncingId === a.id ? 'Syncing…' : 'Sync'}
                    </button>{' '}
                    {confirmRemoveId === a.id ? (
                      <button onClick={() => { remove.mutate(a.id); setConfirmRemoveId(null); }} style={btn('var(--danger)', 'white')}>Confirm</button>
                    ) : (
                      <button onClick={() => setConfirmRemoveId(a.id)} style={btn('white')}>Disconnect</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {accounts.some((a) => a.webhookUrl) && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Webhook URLs</div>
              <p className="text-ink-muted" style={{ fontSize: 11, marginBottom: 8 }}>
                Paste each company&rsquo;s URL into that CallRail company&rsquo;s webhook settings for
                real-time delivery. Not required — data also pulls nightly and on Sync now.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {accounts.filter((a) => a.webhookUrl).map((a) => (
                  <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="text-ink-muted" style={{ fontSize: 11, minWidth: 100 }}>{a.label || 'CallRail'}</span>
                    <code
                      style={{
                        flex: 1, fontSize: 11, background: '#F3F4F6', padding: '6px 8px',
                        border: '1px solid var(--border)', borderRadius: 6, overflowX: 'auto', whiteSpace: 'nowrap',
                      }}
                    >
                      {a.webhookUrl}
                    </code>
                    <button
                      onClick={() => copyWebhook(a.id, a.webhookUrl as string)}
                      style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, background: 'white', cursor: 'pointer' }}
                    >
                      {copiedId === a.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {totalCalls > 0 && sourceBreakdown.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>What CallRail attributes these calls to</div>
              <p className="text-ink-muted" style={{ fontSize: 11, marginBottom: 8 }}>
                The working assumption elsewhere is that every tracked call is a Google Ads call —
                this is where that assumption becomes checkable against what CallRail itself recorded.
              </p>
              <table className="w-full">
                <thead>
                  <tr className="text-ink-muted" style={{ textAlign: 'left', fontSize: 11 }}>
                    <th style={{ padding: 4 }}>Source</th>
                    <th style={{ padding: 4 }}>Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceBreakdown.map((s) => (
                    <tr key={s.source || 'unknown'} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 4px', fontSize: 12 }}>{s.source || 'Unknown'}</td>
                      <td style={{ padding: '6px 4px', fontSize: 12 }}>{s.callCount.toLocaleString('en-GB')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            {!confirmDisconnectAll ? (
              <button
                onClick={() => setConfirmDisconnectAll(true)}
                style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--danger, #b91c1c)', background: 'white', cursor: 'pointer' }}
              >
                Disconnect CallRail
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="text-ink-muted" style={{ fontSize: 11 }}>
                  Removes every company here. Calls already pulled are kept.
                </span>
                <button
                  onClick={() => { disconnectAll.mutate(); setConfirmDisconnectAll(false); }}
                  style={{ padding: '6px 10px', border: 'none', borderRadius: 6, fontSize: 11, background: 'var(--danger, #b91c1c)', color: 'white', cursor: 'pointer' }}
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDisconnectAll(false)}
                  style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, background: 'white', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 };

function btn(bg: string, color = 'var(--ink)'): React.CSSProperties {
  return { padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: bg, color, cursor: 'pointer' };
}
