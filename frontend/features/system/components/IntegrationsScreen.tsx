'use client';
// System → Integrations — wired to /api/integrations.
//
// One tile per integration in a flat, searchable grid. A tile's Manage button
// opens a dialog holding that integration's configuration panels, so a
// provider with several panels (Dentally: practice mapping + webhook) reads as
// one integration rather than several loose cards on the page.
//
// Google is ONE tile over THREE backend connections (Ads, Sheets Call
// Reporting, Sheets Conversion Export). They stay separate server-side on
// purpose — each holds a different OAuth scope, and the read-only Call
// Reporting grant must never be widened by the read/write export grant — so
// the Google dialog offers three connections rather than one "Connect Google".
//
// Connect flow:
//   OAuth  : POST /api/integrations/connect → { redirectUrl } → window.location
//   Broker : POST /api/integrations/connect → { requiresKeyPaste } → modal
//            → POST /api/integrations/:provider/callback { apiKey }

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Chip } from '@/components/ui';
import { useMe } from '@/hooks/useMe';
import {
  useIntegrations,
  useStartConnect,
  useSubmitBrokerKey,
  useRevoke,
  useSyncIntegration,
  useCallRailStatus,
  useEmergentStatus,
} from '@/features/integrations/hooks';

// Providers with a real on-demand pull (Refresh button + first-connect sync).
const SYNCABLE = new Set(['dentally', 'xero', 'gohighlevel', 'quickbooks', 'google_ads', 'meta_ads']);
import type {
  IntegrationRow,
  ProviderMeta,
} from '@/features/integrations/api';
import DentallyPracticeMapping from '@/features/integrations/components/DentallyPracticeMapping';
import DentallyWebhookPanel from '@/features/integrations/components/DentallyWebhookPanel';
import GoHighLevelPanel from '@/features/integrations/components/GoHighLevelPanel';
import QuickBooksPanel from '@/features/integrations/components/QuickBooksPanel';
import CallRailPanel from '@/features/integrations/components/CallRailPanel';
import EmergentPanel from '@/features/integrations/components/EmergentPanel';
import GoogleSheetsPanel from '@/features/integrations/components/GoogleSheetsPanel';
import GoogleSheetsWriterPanel from '@/features/integrations/components/GoogleSheetsWriterPanel';
import OpenDaysPanel from '@/features/integrations/components/OpenDaysPanel';
import EmergentPracticeMapping from '@/features/integrations/components/EmergentPracticeMapping';
import AdAccountSelector from '@/features/integrations/components/AdAccountSelector';
import IntegrationTile, { type TileMenuItem } from '@/features/integrations/components/IntegrationTile';
import IntegrationModal from '@/features/integrations/components/IntegrationModal';
import ProviderIcon from '@/features/integrations/components/ProviderIcon';
import PanelCard from '@/features/integrations/components/PanelCard';
import {
  copyFor,
  GOOGLE_SERVICE_IDS,
  GOOGLE_SERVICE_LABELS,
  PROVIDER_COPY,
} from '@/features/integrations/provider-copy';
import { useSyncToast } from '@/features/integrations/sync-toast';
import { AdReconciliationPanel } from '@/features/marketing/components/AdReconciliationPanel';

// Registry providers folded into the single Google tile — they must not also
// appear as tiles of their own.
const GOOGLE_MEMBERS = new Set<string>(GOOGLE_SERVICE_IDS);

// Integrations that are not registry providers: they own their connect flow
// inside their panel, so they get a tile but never a generic Connect button.
const STANDALONE_IDS = ['callrail', 'emergent'] as const;

// Internal-feature key that must be enabled for a tile or section to show.
const FEATURE_KEY: Record<string, string> = {
  emergent: 'emergent',
  google_sheets: 'call_reporting',
  google_sheets_writer: 'sheet_export',
};

// Map an OAuth callback error code to a human title + message. Known codes get
// specific guidance; anything else falls back to the raw message.
function explainOauthError(code: string, provider: string): { title: string; message: string } {
  const name = provider || 'the provider';
  if (code === 'NO_AD_ACCOUNT') {
    return {
      title: 'No Google Ads account on that email',
      message:
        'You signed in with a Google account that has no Google Ads account. ' +
        'Disconnect and reconnect, choosing the Google email that has access to ' +
        'your Google Ads account. If you do not have one yet, create it at ads.google.com.',
    };
  }
  return { title: `Could not connect ${name}`, message: code };
}

function statusOf(provider: string, rows: IntegrationRow[]): IntegrationRow['status'] | null {
  return rows.find((r) => r.provider === provider)?.status ?? null;
}

function rowOf(provider: string, rows: IntegrationRow[]): IntegrationRow | undefined {
  return rows.find((r) => r.provider === provider);
}

// "2 minutes ago" style relative time for last-sync display.
function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function authLabel(style: ProviderMeta['authStyle']): string {
  if (style === 'oauth') return 'OAuth';
  if (style === 'oauth_or_key') return 'OAuth / API key';
  return 'API key';
}

// What the page renders for one integration. `body` is the dialog content;
// a tile with no body has nothing to manage and offers Connect only.
interface Tile {
  id: string;
  label: string;
  description: string;
  connected: boolean;
  status: string;
  tone: 'connected' | 'attention' | 'idle';
  error?: string | null;
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  menu: TileMenuItem[];
  body?: ReactNode;
  dialogSubtitle?: string;
}

export default function IntegrationsScreen() {
  const { data: me } = useMe();
  // undefined = backend predates features (allow); [] = nothing enabled.
  const hasFeature = (k: string) => !me?.features || me.features.includes(k);
  const { data, isLoading, error } = useIntegrations();
  const startConnect = useStartConnect();
  const submitKey = useSubmitBrokerKey();
  const revoke = useRevoke();
  const sync = useSyncIntegration();
  const { data: callRail } = useCallRailStatus();
  const { data: emergent } = useEmergentStatus();
  // Global sync toast — survives navigation; per-provider button state via active.
  const { start: startSyncToast, active } = useSyncToast();
  const [brokerModal, setBrokerModal] = useState<{
    provider: string;
    hint: string;
    requiresLocationId?: boolean;
  } | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [locInput, setLocInput] = useState('');
  // Tile whose Manage dialog is open (tile id), and the search filter.
  const [openTile, setOpenTile] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Provider awaiting disconnect confirmation (disconnect hides its data).
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: 'error' | 'success';
    title: string;
    message: string;
  } | null>(null);

  // OAuth providers redirect back to /integrations with ?connected=<provider> on
  // success or ?error=<code>&provider=<provider> on failure. Surface that as a
  // dialog, then strip the params so a refresh doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const err = params.get('error');
    const provider = params.get('provider') ?? connected ?? '';
    if (connected) {
      setNotice({ kind: 'success', title: 'Connected', message: `${connected} is now connected.` });
    } else if (err) {
      setNotice({ kind: 'error', ...explainOauthError(err, provider) });
    }
    if (connected || err) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const integrations = useMemo(() => data?.integrations ?? [], [data]);
  const providers = useMemo(() => data?.available ?? [], [data]);

  const dentallyConnected = statusOf('dentally', integrations) === 'active';
  // For GHL we show the panel as long as the integration row exists (any status except
  // 'revoked'), because the multi-subaccount model stores secrets in integration_accounts,
  // not the main integrations row, so 'failed' on the main row should not hide the panel.
  const ghlRow = integrations.find((i) => i.provider === 'gohighlevel');
  const ghlPanelVisible = !!ghlRow && ghlRow.status !== 'revoked';
  const metaAdsConnected = statusOf('meta_ads', integrations) === 'active';

  async function handleConnect(p: { id: string }) {
    const res = await startConnect.mutateAsync({ provider: p.id });
    if (res.redirectUrl) {
      window.location.href = res.redirectUrl;
    } else if (res.requiresKeyPaste) {
      setBrokerModal({
        provider: p.id,
        hint: res.pasteHint ?? 'Paste your API key.',
        requiresLocationId: res.requiresLocationId,
      });
    }
  }

  async function handleConnectWithKey(p: ProviderMeta) {
    try {
      const res = await startConnect.mutateAsync({ provider: p.id, method: 'key' });
      if (res.requiresKeyPaste) {
        setBrokerModal({
          provider: p.id,
          hint: res.pasteHint ?? 'Paste your API key.',
          requiresLocationId: res.requiresLocationId,
        });
      }
    } catch (err) {
      setNotice({ kind: 'error', title: `Could not connect ${p.label}`, message: (err as Error).message });
    }
  }

  async function handleBrokerSubmit() {
    if (!brokerModal) return;
    const provider = brokerModal.provider;
    // submitBrokerKey persists the key; the backend then runs the first pull
    // automatically (Dentally: detect sites → map practices → pull; GHL: pull
    // contacts + opportunities). Show the progress overlay so the user sees it
    // land — pasting the key (+ Location ID for GHL) is the only manual step.
    await submitKey.mutateAsync({
      provider,
      apiKey: keyInput,
      locationId: brokerModal.requiresLocationId ? locInput : undefined,
    });
    setBrokerModal(null);
    setKeyInput('');
    setLocInput('');
    if (SYNCABLE.has(provider)) startSyncToast(provider);
  }

  async function handleRefresh(provider: string) {
    startSyncToast(provider);
    // Fire-and-forget on the server (returns immediately); the overlay polls
    // progress and clears itself via onDone. Incremental pull (latest changes
    // since the last sync) — full history is the separate button on the
    // Dentally mapping panel.
    await sync.mutateAsync({ provider, full: false });
  }

  // Secondary actions shared by every registry-backed connection.
  function providerMenu(id: string, meta?: ProviderMeta): TileMenuItem[] {
    const connected = statusOf(id, integrations) === 'active';
    const items: TileMenuItem[] = [];
    if (connected && SYNCABLE.has(id)) {
      items.push({
        label: active.has(id) ? 'Refreshing…' : 'Refresh data',
        disabled: active.has(id),
        onSelect: () => handleRefresh(id),
      });
    }
    if (!connected && meta?.authStyle === 'oauth_or_key') {
      items.push({ label: 'Connect with API key', onSelect: () => handleConnectWithKey(meta) });
    }
    if (connected) {
      items.push({ label: 'Disconnect', danger: true, onSelect: () => setConfirmDisconnect(id) });
    }
    return items;
  }

  // Status line + colour for a registry connection.
  function providerStatus(id: string): { text: string; tone: Tile['tone'] } {
    const row = rowOf(id, integrations);
    if (!row || row.status === 'revoked') return { text: 'Not connected', tone: 'idle' };
    if (row.status !== 'active') return { text: 'Needs attention', tone: 'attention' };
    return { text: `Synced ${relTime(row.last_sync_at)}`, tone: 'connected' };
  }

  // A connected provider with no bespoke panel still needs something to manage,
  // so it gets this: what the connection is, when it last pulled, and the same
  // refresh/disconnect controls the tile menu offers.
  function genericBody(meta: ProviderMeta) {
    const row = rowOf(meta.id, integrations);
    const connected = row?.status === 'active';
    return (
      <PanelCard
        title={`${meta.label} connection`}
        badge={connected
          ? <Chip colour="emerald">Connected</Chip>
          : <Chip colour="amber">Not connected</Chip>}
      >
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 12, margin: 0 }}>
          <dt className="text-ink-muted">Sign-in</dt>
          <dd style={{ margin: 0 }}>{authLabel(meta.authStyle)}</dd>
          <dt className="text-ink-muted">Category</dt>
          <dd style={{ margin: 0, textTransform: 'capitalize' }}>{meta.category}</dd>
          <dt className="text-ink-muted">Last sync</dt>
          <dd style={{ margin: 0 }}>{relTime(row?.last_sync_at ?? null)}</dd>
        </dl>
        {row?.last_error && (
          <p style={{ fontSize: 11, marginTop: 10, marginBottom: 0, color: 'var(--danger, #b91c1c)' }}>
            {row.last_error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {connected && SYNCABLE.has(meta.id) && (
            <button
              type="button"
              onClick={() => handleRefresh(meta.id)}
              disabled={active.has(meta.id)}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                border: '1px solid var(--border)', background: 'white',
                cursor: active.has(meta.id) ? 'default' : 'pointer',
              }}
            >
              {active.has(meta.id) ? 'Refreshing…' : 'Refresh data'}
            </button>
          )}
          {connected ? (
            <button
              type="button"
              onClick={() => { setOpenTile(null); setConfirmDisconnect(meta.id); }}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                border: '1px solid var(--border)', background: 'white',
                color: 'var(--danger, #b91c1c)', cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleConnect(meta)}
              disabled={startConnect.isPending}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
                border: 'none', background: 'var(--brand)', color: 'white',
                cursor: startConnect.isPending ? 'default' : 'pointer',
              }}
            >
              {startConnect.isPending ? 'Redirecting…' : `Connect ${meta.label}`}
            </button>
          )}
        </div>
      </PanelCard>
    );
  }

  // One of the three Google connections, as a section inside the Google dialog.
  // Each carries its own connect/disconnect because each is its own OAuth grant.
  function googleService(id: string, panels: ReactNode) {
    const meta = providers.find((p) => p.id === id);
    const row = rowOf(id, integrations);
    const connected = row?.status === 'active';
    return (
      <div key={id} style={{ marginBottom: 18 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <h3 className="display" style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
              {GOOGLE_SERVICE_LABELS[id] ?? meta?.label ?? id}
            </h3>
            {connected
              ? <Chip colour="emerald">Connected</Chip>
              : <Chip colour="amber">Not connected</Chip>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {connected && SYNCABLE.has(id) && (
              <button
                type="button"
                onClick={() => handleRefresh(id)}
                disabled={active.has(id)}
                style={{
                  padding: '5px 10px', fontSize: 11, borderRadius: 6,
                  border: '1px solid var(--border)', background: 'white',
                  cursor: active.has(id) ? 'default' : 'pointer',
                }}
              >
                {active.has(id) ? 'Refreshing…' : 'Refresh data'}
              </button>
            )}
            {connected ? (
              <button
                type="button"
                onClick={() => { setOpenTile(null); setConfirmDisconnect(id); }}
                style={{
                  padding: '5px 10px', fontSize: 11, borderRadius: 6,
                  border: '1px solid var(--border)', background: 'white',
                  color: 'var(--danger, #b91c1c)', cursor: 'pointer',
                }}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleConnect({ id })}
                disabled={startConnect.isPending}
                style={{
                  padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6,
                  border: 'none', background: 'var(--brand)', color: 'white',
                  cursor: startConnect.isPending ? 'default' : 'pointer',
                }}
              >
                {startConnect.isPending ? '…' : 'Connect'}
              </button>
            )}
          </div>
        </div>
        {row?.last_error && (
          <p style={{ fontSize: 11, marginBottom: 8, color: 'var(--danger, #b91c1c)' }}>
            {row.last_error}
          </p>
        )}
        {panels}
      </div>
    );
  }

  // --- Tiles ---------------------------------------------------------------
  const tiles: Tile[] = [];

  // Google — one tile, three connections. Hidden only if every service it
  // covers is feature-disabled for this organisation.
  {
    const googleServices = GOOGLE_SERVICE_IDS.filter(
      (id) => !FEATURE_KEY[id] || hasFeature(FEATURE_KEY[id]),
    );
    if (googleServices.length > 0) {
      const liveCount = googleServices.filter((id) => statusOf(id, integrations) === 'active').length;
      const copy = PROVIDER_COPY.google;
      tiles.push({
        id: 'google',
        label: copy.label,
        description: copy.description,
        connected: liveCount > 0,
        status: liveCount === 0
          ? 'Not connected'
          : `${liveCount} of ${googleServices.length} services connected`,
        tone: liveCount === 0 ? 'idle' : liveCount === googleServices.length ? 'connected' : 'attention',
        primaryLabel: 'Manage',
        onPrimary: () => setOpenTile('google'),
        // Disconnect is per-service inside the dialog: a tile-level Disconnect
        // would be ambiguous across three separate grants.
        menu: [],
        dialogSubtitle: 'Three separate Google connections, each with its own permissions.',
        body: (
          <>
            {googleServices.includes('google_ads') && googleService('google_ads', (
              <>
                {statusOf('google_ads', integrations) === 'active' && (
                  <>
                    <AdAccountSelector provider="google_ads" label="Google Ads" />
                    <AdReconciliationPanel provider="google_ads" />
                  </>
                )}
              </>
            ))}
            {googleServices.includes('google_sheets') && googleService('google_sheets', <GoogleSheetsPanel />)}
            {googleServices.includes('google_sheets_writer') && googleService('google_sheets_writer', <GoogleSheetsWriterPanel />)}
          </>
        ),
      });
    }
  }

  // Dentally
  {
    const meta = providers.find((p) => p.id === 'dentally');
    if (meta) {
      const s = providerStatus('dentally');
      tiles.push({
        id: 'dentally',
        label: copyFor('dentally', meta.label).label,
        description: copyFor('dentally', meta.label).description,
        connected: dentallyConnected,
        status: s.text,
        tone: s.tone,
        error: rowOf('dentally', integrations)?.last_error ?? null,
        primaryLabel: dentallyConnected ? 'Manage' : 'Connect',
        primaryDisabled: !dentallyConnected && startConnect.isPending,
        onPrimary: () => (dentallyConnected ? setOpenTile('dentally') : handleConnect(meta)),
        menu: providerMenu('dentally', meta),
        body: dentallyConnected ? (
          <>
            <DentallyPracticeMapping />
            <DentallyWebhookPanel />
          </>
        ) : undefined,
      });
    }
  }

  // GoHighLevel
  {
    const meta = providers.find((p) => p.id === 'gohighlevel');
    if (meta) {
      const s = providerStatus('gohighlevel');
      tiles.push({
        id: 'gohighlevel',
        label: copyFor('gohighlevel', meta.label).label,
        description: copyFor('gohighlevel', meta.label).description,
        connected: ghlPanelVisible,
        status: s.text,
        tone: s.tone,
        error: ghlRow?.last_error ?? null,
        primaryLabel: ghlPanelVisible ? 'Manage' : 'Connect',
        primaryDisabled: !ghlPanelVisible && startConnect.isPending,
        onPrimary: () => (ghlPanelVisible ? setOpenTile('gohighlevel') : handleConnect(meta)),
        menu: providerMenu('gohighlevel', meta),
        body: ghlPanelVisible ? <GoHighLevelPanel /> : undefined,
      });
    }
  }

  // Meta Ads
  {
    const meta = providers.find((p) => p.id === 'meta_ads');
    if (meta) {
      const s = providerStatus('meta_ads');
      tiles.push({
        id: 'meta_ads',
        label: copyFor('meta_ads', meta.label).label,
        description: copyFor('meta_ads', meta.label).description,
        connected: metaAdsConnected,
        status: s.text,
        tone: s.tone,
        error: rowOf('meta_ads', integrations)?.last_error ?? null,
        primaryLabel: metaAdsConnected ? 'Manage' : 'Connect',
        primaryDisabled: !metaAdsConnected && startConnect.isPending,
        onPrimary: () => (metaAdsConnected ? setOpenTile('meta_ads') : handleConnect(meta)),
        menu: providerMenu('meta_ads', meta),
        // Reconciliation only makes sense once the provider is actually
        // connected — an unconnected provider has no campaign total to compare
        // against, so its panel would show nothing but misleading zeroes.
        //
        // No window is passed to the panel. It used to be computed here from
        // Date.now() in UTC while the sync computes its own in LONDON, so
        // through BST the two disagreed for the hour after midnight and the
        // panel asked for a day that could not yet exist in the deep tables.
        // The server now supplies the window on the sync's own clock.
        body: metaAdsConnected ? (
          <>
            <AdAccountSelector provider="meta_ads" label="Meta Ads" />
            <AdReconciliationPanel provider="meta_ads" />
            {/* Open-day mapping sits with the other mappings rather than on the
                report: it is setup, done once, and a tenant who runs no open
                days simply never opens it. */}
            <OpenDaysPanel />
          </>
        ) : undefined,
      });
    }
  }

  // QuickBooks — the panel manages N companies and owns its own connect
  // button, so Manage is always the right primary action.
  {
    const meta = providers.find((p) => p.id === 'quickbooks');
    if (meta) {
      const s = providerStatus('quickbooks');
      tiles.push({
        id: 'quickbooks',
        label: copyFor('quickbooks', meta.label).label,
        description: copyFor('quickbooks', meta.label).description,
        connected: statusOf('quickbooks', integrations) === 'active',
        status: s.text,
        tone: s.tone,
        error: rowOf('quickbooks', integrations)?.last_error ?? null,
        primaryLabel: 'Manage',
        onPrimary: () => setOpenTile('quickbooks'),
        menu: providerMenu('quickbooks', meta),
        body: <QuickBooksPanel />,
      });
    }
  }

  // The remaining registry providers have no bespoke panel — Xero, SOE and
  // anything registered later all land here rather than dropping off the grid.
  for (const meta of providers) {
    if (GOOGLE_MEMBERS.has(meta.id)) continue;
    if (['dentally', 'gohighlevel', 'meta_ads', 'quickbooks'].includes(meta.id)) continue;
    if (FEATURE_KEY[meta.id] && !hasFeature(FEATURE_KEY[meta.id])) continue;
    const connected = statusOf(meta.id, integrations) === 'active';
    const s = providerStatus(meta.id);
    const copy = copyFor(meta.id, meta.label);
    tiles.push({
      id: meta.id,
      label: copy.label,
      description: copy.description || `${authLabel(meta.authStyle)} · ${meta.category}`,
      connected,
      status: s.text,
      tone: s.tone,
      error: rowOf(meta.id, integrations)?.last_error ?? null,
      primaryLabel: connected ? 'Manage' : 'Connect',
      primaryDisabled: !connected && startConnect.isPending,
      onPrimary: () => (connected ? setOpenTile(meta.id) : handleConnect(meta)),
      menu: providerMenu(meta.id, meta),
      body: connected ? genericBody(meta) : undefined,
    });
  }

  // CallRail and Emergent are not registry providers: each panel owns its own
  // connect flow, so the tile always opens the panel rather than offering a
  // generic Connect that no backend route would serve.
  for (const id of STANDALONE_IDS) {
    if (FEATURE_KEY[id] && !hasFeature(FEATURE_KEY[id])) continue;
    const copy = PROVIDER_COPY[id];
    const connected = id === 'callrail' ? !!callRail?.connected : !!emergent?.connected;
    const detail = id === 'callrail' && connected
      ? `${callRail?.accounts?.length ?? 0} companies connected`
      : id === 'emergent' && connected
        ? `Synced ${relTime(emergent?.lastSyncAt ?? null)}`
        : 'Not connected';
    tiles.push({
      id,
      label: copy.label,
      description: copy.description,
      connected,
      status: detail,
      tone: connected ? 'connected' : 'idle',
      primaryLabel: connected ? 'Manage' : 'Set up',
      onPrimary: () => setOpenTile(id),
      menu: [],
      body: id === 'callrail'
        ? <CallRailPanel />
        : <><EmergentPanel /><EmergentPracticeMapping /></>,
    });
  }

  // Connected first, then alphabetically — the integrations a practice already
  // relies on are the ones it comes back to.
  const q = query.trim().toLowerCase();
  const visible = tiles
    .filter((t) => !q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
    .sort((a, b) => (Number(b.connected) - Number(a.connected)) || a.label.localeCompare(b.label));

  const connectedCount = tiles.filter((t) => t.connected).length;
  const open = tiles.find((t) => t.id === openTile);

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div
        className="mb-6"
        style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}
      >
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>Integrations</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            {isLoading ? 'Loading…' : `${connectedCount} of ${tiles.length} connected`}
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search integrations"
          aria-label="Search integrations"
          style={{
            width: 280, maxWidth: '100%', padding: '8px 12px', fontSize: 13,
            border: '1px solid var(--border)', borderRadius: 8, background: 'white',
          }}
        />
      </div>

      {error && (
        <div className="card" style={{ padding: 12, marginBottom: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 12 }}>
          Failed to load integrations: {(error as Error).message}
        </div>
      )}

      {!isLoading && visible.length === 0 && (
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          No integrations match &ldquo;{query}&rdquo;.
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
        }}
      >
        {visible.map((t) => (
          <IntegrationTile
            key={t.id}
            id={t.id}
            label={t.label}
            description={t.description}
            status={t.status}
            tone={t.tone}
            error={t.error}
            primaryLabel={t.primaryLabel}
            primaryDisabled={t.primaryDisabled}
            onPrimary={t.onPrimary}
            menu={t.menu}
          />
        ))}
      </div>

      {open?.body && (
        <IntegrationModal
          title={open.label}
          subtitle={open.dialogSubtitle ?? open.status}
          icon={<ProviderIcon id={open.id} label={open.label} size={28} />}
          onClose={() => setOpenTile(null)}
        >
          {open.body}
        </IntegrationModal>
      )}

      {notice && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
          }}
          onClick={() => setNotice(null)}
        >
          <div
            className="card-padded"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', maxWidth: 460, width: '90%' }}
          >
            <h3
              style={{
                fontSize: 16, fontWeight: 700, marginBottom: 8,
                color: notice.kind === 'error' ? 'var(--danger, #b91c1c)' : 'var(--ink, #111)',
              }}
            >
              {notice.title}
            </h3>
            <p className="text-ink-muted" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              {notice.message}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setNotice(null)}
                style={{
                  padding: '8px 14px', background: 'var(--brand)', color: 'white',
                  border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDisconnect && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
          }}
          onClick={() => setConfirmDisconnect(null)}
        >
          <div
            className="card-padded"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', maxWidth: 440, width: '90%' }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Disconnect {confirmDisconnect}?
            </h3>
            <p className="text-ink-muted" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              This stops syncing and hides all data from this integration across the app.
              Your synced records are kept — reconnecting restores them. Manually-entered data
              is not affected.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDisconnect(null)}
                style={{
                  padding: '8px 14px', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 12, background: 'white', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const provider = confirmDisconnect;
                  setConfirmDisconnect(null);
                  revoke.mutate(provider);
                }}
                disabled={revoke.isPending}
                style={{
                  padding: '8px 14px', background: 'var(--danger, #b91c1c)',
                  color: 'white', border: 'none', borderRadius: 6,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {revoke.isPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
      {brokerModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
          }}
          onClick={() => setBrokerModal(null)}
        >
          <div
            className="card-padded"
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', maxWidth: 480, width: '90%' }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Connect {brokerModal.provider}
            </h3>
            <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
              {brokerModal.hint}
            </p>
            <input
              type="password"
              autoFocus
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="API key"
              style={{
                width: '100%', padding: '8px 10px',
                border: '1px solid var(--border)', borderRadius: 6,
                fontSize: 13, marginBottom: 12,
              }}
            />
            {brokerModal.requiresLocationId && (
              <input
                type="text"
                value={locInput}
                onChange={(e) => setLocInput(e.target.value)}
                placeholder="Location ID"
                style={{
                  width: '100%', padding: '8px 10px',
                  border: '1px solid var(--border)', borderRadius: 6,
                  fontSize: 13, marginBottom: 12,
                }}
              />
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setBrokerModal(null)}
                style={{
                  padding: '8px 14px', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 12, background: 'white', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleBrokerSubmit}
                disabled={!keyInput || (brokerModal.requiresLocationId && !locInput) || submitKey.isPending}
                style={{
                  padding: '8px 14px', background: 'var(--brand)',
                  color: 'white', border: 'none', borderRadius: 6,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {submitKey.isPending ? 'Saving…' : 'Save key'}
              </button>
            </div>
            <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 10 }}>
              Stored encrypted at rest. Never displayed again.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
