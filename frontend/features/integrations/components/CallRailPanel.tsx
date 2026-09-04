'use client';
// CallRail — call-tracking company manager. CallRail tracks the phone calls
// each Google Ads campaign drives, so a call can be credited back to the ad
// that produced it. One CallRail company = one API key, mapped 1:1 to a
// practice — the same shape GoHighLevel multi-subaccount already established
// here: the first company added IS the connection, there is no separate
// singleton key-paste route, and there is no owner-maintained tracking-number
// map — a call's practice follows from the company that fetched it.
//
// Add-company is KEY-ONLY DISCOVERY: the owner pastes ONE CallRail API key —
// which may cover several CallRail accounts (an agency-style key) — and the
// backend resolves EVERY account and company it can reach
// (discoverCallRailAccounts). The owner ticks the companies they want,
// assigns a practice to each (agency actor only), and connects them all in
// one request (bulkConnectCallRailAccounts). No account id or company id is
// ever typed by hand, which removes the whole class of paste-the-wrong-id
// error this integration originally shipped with — and unblocks an owner who
// genuinely has no account id to hand.

import { Fragment, useState } from 'react';
import { Chip, type ChipColour } from '@/components/ui';
import { useMe, isAgencyActor } from '@/hooks/useMe';
import type { CallRailAccount, CallRailBulkConnectEntry, CallRailDiscoveredAccount, IntegrationStatus } from '../api';
import {
  useCallRailStatus,
  useDiscoverCallRailAccounts,
  useBulkConnectCallRailAccounts,
  useUpdateCallRailAccount,
  useRemoveCallRailAccount,
  useSyncCallRailAccount,
  useSyncAllCallRail,
  useDisconnectCallRail,
  usePractices,
} from '../hooks';
import PanelCard from './PanelCard';

const STATUS_CHIP: Record<IntegrationStatus, ChipColour> = {
  active: 'emerald',
  pending: 'amber',
  verifying: 'amber',
  failed: 'rose',
  revoked: 'slate',
};

export default function CallRailPanel() {
  const { data: me } = useMe();
  // Practice mapping is an agency-actor power here, same rule as the GHL
  // account's practice_id field — a non-agency owner still needs to SEE which
  // practice each company is mapped to (it is their own attribution), just
  // not change it.
  const canMap = isAgencyActor(me);
  const { data, isLoading } = useCallRailStatus();
  const { data: practiceData } = usePractices();
  const practices = practiceData?.practices ?? [];

  const discover = useDiscoverCallRailAccounts();
  const bulkConnect = useBulkConnectCallRailAccounts();
  const update = useUpdateCallRailAccount();
  const remove = useRemoveCallRailAccount();
  const sync = useSyncCallRailAccount();
  const syncAll = useSyncAllCallRail();
  const disconnectAll = useDisconnectCallRail();

  const [showAdd, setShowAdd] = useState(false);
  // Add-company step 1 (key-only discovery) fields.
  const [apiKey, setApiKey] = useState('');
  const [discoverErr, setDiscoverErr] = useState<string | null>(null);
  // Add-company step 2 (pick companies from what discovery found). null =
  // discovery not yet run; [] = ran, found zero accounts.
  const [discovered, setDiscovered] = useState<CallRailDiscoveredAccount[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [practiceByCompany, setPracticeByCompany] = useState<Record<string, string>>({});
  const [connectErr, setConnectErr] = useState<string | null>(null);

  const [rowErr, setRowErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mappingSavingId, setMappingSavingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmDisconnectAll, setConfirmDisconnectAll] = useState(false);

  // Per-company credentials panel — rotate the API key without disconnecting,
  // and paste/replace/clear the webhook signing key.
  const [credsOpenId, setCredsOpenId] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [signingKeyDraft, setSigningKeyDraft] = useState('');
  const [credsErr, setCredsErr] = useState<string | null>(null);
  const [credsSavingId, setCredsSavingId] = useState<string | null>(null);

  if (isLoading) return null;

  const accounts: CallRailAccount[] = data?.accounts ?? [];
  const sourceBreakdown = data?.sourceBreakdown ?? [];
  const connected = !!data?.connected && accounts.length > 0;
  // sourceBreakdown is org-WIDE and still counts a revoked company's
  // historical calls (see callrailService.status). accounts, by contrast,
  // already excludes revoked companies — summing callCount from accounts
  // alone means an org whose only call-bearing company was disconnected
  // reads as "no calls have arrived yet" while its real history (visible in
  // sourceBreakdown) sits hidden. Use the org-wide total for both the empty
  // state and the breakdown's own visibility.
  const orgCallCount = sourceBreakdown.reduce((n, s) => n + (s.callCount || 0), 0);
  const hasFailed = accounts.some((a) => a.status === 'failed');

  function resetAddForm() {
    setApiKey('');
    setDiscoverErr(null);
    setDiscovered(null);
    setSelectedIds(new Set());
    setPracticeByCompany({});
    setConnectErr(null);
  }

  async function submitDiscover() {
    setDiscoverErr(null);
    if (!apiKey.trim()) return;
    try {
      const res = await discover.mutateAsync({ apiKey: apiKey.trim() });
      // Empty results (zero accounts) are shown inline in the results view
      // below, not as an error — the key is valid, it just can't see anything.
      setDiscovered(res.accounts);
      setSelectedIds(new Set());
      setPracticeByCompany({});
    } catch (e) {
      setDiscoverErr((e as Error).message);
    }
  }

  function backToKey() {
    setDiscovered(null);
    setSelectedIds(new Set());
    setPracticeByCompany({});
    setDiscoverErr(null);
    setConnectErr(null);
  }

  function toggleSelected(companyId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }

  function setPracticeForCompany(companyId: string, value: string) {
    setPracticeByCompany((prev) => ({ ...prev, [companyId]: value }));
  }

  const selectedCount = selectedIds.size;

  async function submitConnect() {
    setConnectErr(null);
    if (!discovered || selectedCount === 0) return;
    const entries: CallRailBulkConnectEntry[] = [];
    for (const acc of discovered) {
      for (const c of acc.companies) {
        if (!selectedIds.has(c.id)) continue;
        entries.push({
          accountId: acc.accountId,
          companyId: c.id,
          // Omitted, not sent as null, when the caller can't map: the backend
          // 403s the whole request if ANY entry carries practiceId for a
          // non-agency actor. A non-agency owner's companies are connected
          // unmapped — a state the panel already renders.
          ...(canMap ? { practiceId: practiceByCompany[c.id] || null } : {}),
        });
      }
    }
    if (entries.length === 0) return;
    try {
      const res = await bulkConnect.mutateAsync({ apiKey: apiKey.trim(), companies: entries });
      const failed = res.results.filter((r) => !r.ok);
      const okCount = res.results.length - failed.length;

      // Mark succeeded companies as connected locally (they leave the
      // selectable list) and drop them from the selection, so a partial
      // failure never leaves a company looking both "selected" and
      // "already connected".
      const okIds = new Set(res.results.filter((r) => r.ok).map((r) => r.companyId));
      setDiscovered((prev) => prev?.map((acc) => ({
        ...acc,
        companies: acc.companies.map((c) => (okIds.has(c.id) ? { ...c, alreadyConnected: true } : c)),
      })) ?? null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of okIds) next.delete(id);
        return next;
      });

      if (failed.length === 0) {
        resetAddForm();
        setShowAdd(false);
        setNotice(`Connected ${okCount} compan${okCount === 1 ? 'y' : 'ies'} — pulling recent call history now. Refresh in a moment, or use Sync now.`);
      } else {
        const companyName = (id: string) => discovered?.flatMap((a) => a.companies).find((c) => c.id === id)?.name ?? id;
        const detail = failed.map((f) => `${companyName(f.companyId)}: ${f.error}`).join(' · ');
        setConnectErr(`${okCount} connected, ${failed.length} failed — ${detail}`);
        if (okCount > 0) {
          setNotice(`Connected ${okCount} compan${okCount === 1 ? 'y' : 'ies'} — pulling recent call history now.`);
        }
      }
    } catch (e) {
      setConnectErr((e as Error).message);
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
      setNotice(`Pulled ${res.ingested} call${res.ingested === 1 ? '' : 's'}.${res.truncated ? ' More were waiting than this pull could fetch — sync again to continue.' : ''}`);
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

  function toggleCreds(id: string) {
    setCredsErr(null);
    setApiKeyDraft('');
    setSigningKeyDraft('');
    setCredsOpenId((cur) => (cur === id ? null : id));
  }

  async function saveApiKey(id: string) {
    if (!apiKeyDraft.trim()) return;
    setCredsErr(null);
    setCredsSavingId(id);
    try {
      await update.mutateAsync({ id, apiKey: apiKeyDraft.trim() });
      setApiKeyDraft('');
      setNotice('API key updated. This company will resume syncing on the next pull.');
    } catch (e) {
      setCredsErr((e as Error).message);
    } finally {
      setCredsSavingId(null);
    }
  }

  async function saveSigningKey(id: string) {
    if (!signingKeyDraft.trim()) return;
    setCredsErr(null);
    setCredsSavingId(id);
    try {
      await update.mutateAsync({ id, signingKey: signingKeyDraft.trim() });
      setSigningKeyDraft('');
      setNotice('Signing key saved. Signature checking is now active for this company.');
    } catch (e) {
      setCredsErr((e as Error).message);
    } finally {
      setCredsSavingId(null);
    }
  }

  async function clearSigningKey(id: string) {
    setCredsErr(null);
    setCredsSavingId(id);
    try {
      await update.mutateAsync({ id, signingKey: null });
      setNotice('Signing key cleared. Deliveries are now accepted on the URL token alone.');
    } catch (e) {
      setCredsErr((e as Error).message);
    } finally {
      setCredsSavingId(null);
    }
  }

  const addForm = (
    <div
      style={{
        padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#F8FAFC',
        display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560,
      }}
    >
      {!discovered ? (
        <>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="CallRail API key" style={inp} />
          {discoverErr && <span style={{ fontSize: 11, color: 'var(--danger, #b91c1c)' }}>{discoverErr}</span>}
          <button
            onClick={submitDiscover}
            disabled={discover.isPending || !apiKey.trim()}
            style={{
              alignSelf: 'flex-start', padding: '7px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6,
              border: 'none', background: 'var(--brand)', color: 'white',
              cursor: 'pointer', opacity: (discover.isPending || !apiKey.trim()) ? 0.5 : 1,
            }}
          >
            {discover.isPending ? 'Looking up…' : 'Find my CallRail accounts'}
          </button>
          <span className="text-ink-muted" style={{ fontSize: 10 }}>
            One key can reveal several CallRail accounts — the next step lists every account and
            company it can reach, so you pick which ones to connect.
          </span>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-ink-muted" style={{ fontSize: 11 }}>
              {discovered.length} account{discovered.length === 1 ? '' : 's'} found
            </span>
            <button
              onClick={backToKey}
              style={{ padding: '3px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 6, background: 'white', cursor: 'pointer' }}
            >
              Change key
            </button>
          </div>

          {discovered.length === 0 && (
            <span style={{ fontSize: 12 }}>This key cannot see any CallRail accounts.</span>
          )}

          {!canMap && discovered.length > 0 && (
            <span className="text-ink-muted" style={{ fontSize: 10 }}>
              Practice mapping is managed by your agency admin. Companies you connect here are added
              unmapped — their calls won&rsquo;t be attributed until they&rsquo;re mapped.
            </span>
          )}

          {discovered.map((acc) => (
            <div key={acc.accountId} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{acc.accountName}</div>
              {acc.error && (
                <div style={{ fontSize: 10, color: 'var(--danger, #b91c1c)', marginBottom: 6 }}>
                  Could not list this account&rsquo;s companies: {acc.error}
                </div>
              )}
              {acc.companies.length === 0 && !acc.error && (
                <div className="text-ink-muted" style={{ fontSize: 10 }}>No companies under this account.</div>
              )}
              {acc.companies.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    disabled={c.alreadyConnected}
                    onChange={() => toggleSelected(c.id)}
                  />
                  <span style={{ flex: 1, fontSize: 12, color: c.alreadyConnected ? 'var(--ink-muted, #64748b)' : 'inherit' }}>
                    {c.name}
                    {c.alreadyConnected && ' — already connected'}
                  </span>
                  {canMap && !c.alreadyConnected && (
                    <select
                      value={practiceByCompany[c.id] ?? ''}
                      onChange={(e) => setPracticeForCompany(c.id, e.target.value)}
                      style={{ ...inp, maxWidth: 180 }}
                    >
                      <option value="">No practice yet</option>
                      {practices.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          ))}

          {connectErr && <span style={{ fontSize: 11, color: 'var(--danger, #b91c1c)' }}>{connectErr}</span>}

          {discovered.length > 0 && (
            <button
              onClick={submitConnect}
              disabled={bulkConnect.isPending || selectedCount === 0}
              style={{
                alignSelf: 'flex-start', padding: '7px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                border: 'none', background: 'var(--brand)', color: 'white',
                cursor: 'pointer', opacity: (bulkConnect.isPending || selectedCount === 0) ? 0.5 : 1,
              }}
            >
              {bulkConnect.isPending ? 'Connecting…' : `Connect selected (${selectedCount})`}
            </button>
          )}
        </>
      )}
      <span className="text-ink-muted" style={{ fontSize: 10 }}>Stored encrypted at rest. Never displayed again.</span>
    </div>
  );

  return (
    <PanelCard
      title="CallRail — call tracking"
      actions={connected ? (
        <button
          onClick={() => { setShowAdd((v) => !v); if (showAdd) resetAddForm(); }}
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

          {orgCallCount === 0 && (
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
              One or more companies failed to sync — see the reason below each. Open
              Credentials on that row to paste a corrected API key directly (no disconnect
              needed) — or disconnect and add it again; both now work.
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
                <Fragment key={a.id}>
                  <tr style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 4px', fontSize: 13 }}>
                      <div style={{ fontWeight: 600 }}>{a.label || 'CallRail'}</div>
                      <div className="text-ink-muted" style={{ fontSize: 10, fontFamily: 'monospace' }}>company {a.callrailCompanyId}</div>
                      <div className="text-ink-muted" style={{ fontSize: 10, fontFamily: 'monospace' }}>account {a.callrailAccountId ?? '—'}</div>
                    </td>
                    <td style={{ padding: '8px 4px', fontSize: 12 }}>
                      {canMap ? (
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
                      ) : (
                        // Visible and readable, not editable — a non-agency owner
                        // still needs to see which practice a company is mapped
                        // to, to understand their own numbers.
                        <span style={{ color: a.practiceId ? 'inherit' : 'var(--ink-muted, #64748b)' }}>
                          {a.practiceName || 'Not mapped'}
                        </span>
                      )}
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
                      <div className="text-ink-muted" style={{ fontSize: 10, marginTop: 2 }}>
                        {a.signingKeyConfigured ? 'Signature checking active' : 'Signature: URL token only'}
                      </div>
                      {a.status === 'failed' && a.lastError && (
                        <div style={{ fontSize: 10, marginTop: 2, color: 'var(--danger, #b91c1c)' }}>{a.lastError.slice(0, 80)}</div>
                      )}
                    </td>
                    <td style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>
                      <button onClick={() => onSyncOne(a.id)} disabled={syncingId === a.id} style={btn('white')}>
                        {syncingId === a.id ? 'Syncing…' : 'Sync'}
                      </button>{' '}
                      <button onClick={() => toggleCreds(a.id)} style={btn('white')}>
                        {credsOpenId === a.id ? 'Close' : 'Credentials'}
                      </button>{' '}
                      {confirmRemoveId === a.id ? (
                        <button onClick={() => { remove.mutate(a.id); setConfirmRemoveId(null); }} style={btn('var(--danger)', 'white')}>Confirm</button>
                      ) : (
                        <button onClick={() => setConfirmRemoveId(a.id)} style={btn('white')}>Disconnect</button>
                      )}
                    </td>
                  </tr>
                  {credsOpenId === a.id && (
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td colSpan={6} style={{ padding: '10px 4px', background: '#F8FAFC' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Replace API key</div>
                            <p className="text-ink-muted" style={{ fontSize: 10, marginBottom: 6 }}>
                              A key rotated at CallRail&rsquo;s end can be pasted here directly — no need
                              to disconnect this company first.
                            </p>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input
                                type="password"
                                value={apiKeyDraft}
                                onChange={(e) => setApiKeyDraft(e.target.value)}
                                placeholder="New CallRail API key"
                                style={{ ...inp, flex: 1 }}
                              />
                              <button
                                onClick={() => saveApiKey(a.id)}
                                disabled={credsSavingId === a.id || !apiKeyDraft.trim()}
                                style={{ ...btn('var(--brand)', 'white'), opacity: (credsSavingId === a.id || !apiKeyDraft.trim()) ? 0.5 : 1 }}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Webhook signing key</div>
                            <p className="text-ink-muted" style={{ fontSize: 10, marginBottom: 6 }}>
                              {a.signingKeyConfigured
                                ? 'Signature checking active — deliveries are verified against this key.'
                                : 'Not configured — deliveries accepted on the URL token alone.'}
                              {' '}Paste the signing key from this company&rsquo;s Webhooks page in CallRail
                              to turn signature checking on.
                            </p>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <input
                                type="password"
                                value={signingKeyDraft}
                                onChange={(e) => setSigningKeyDraft(e.target.value)}
                                placeholder="CallRail signing key"
                                style={{ ...inp, flex: 1 }}
                              />
                              <button
                                onClick={() => saveSigningKey(a.id)}
                                disabled={credsSavingId === a.id || !signingKeyDraft.trim()}
                                style={{ ...btn('var(--brand)', 'white'), opacity: (credsSavingId === a.id || !signingKeyDraft.trim()) ? 0.5 : 1 }}
                              >
                                Save
                              </button>
                              {a.signingKeyConfigured && (
                                <button
                                  onClick={() => clearSigningKey(a.id)}
                                  disabled={credsSavingId === a.id}
                                  style={btn('white')}
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          </div>
                          {credsErr && <span style={{ fontSize: 11, color: 'var(--danger, #b91c1c)' }}>{credsErr}</span>}
                          <span className="text-ink-muted" style={{ fontSize: 10 }}>Stored encrypted at rest. Never displayed again.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
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

          {sourceBreakdown.length > 0 && (
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
    </PanelCard>
  );
}

const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6 };

function btn(bg: string, color = 'var(--ink)'): React.CSSProperties {
  return { padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--border)', background: bg, color, cursor: 'pointer' };
}
