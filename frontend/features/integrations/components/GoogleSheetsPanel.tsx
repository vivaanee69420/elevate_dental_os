'use client';

// Google Sheets — Call Reporting setup panel. Four states in one card:
//   1. not connected  -> Connect Google (OAuth, read-only Sheets scope)
//   2. no source      -> paste the sheet URL
//   3. no mapping     -> pick tab, map the five columns against a preview
//   4. active         -> status, practice mapping table, refresh, disconnect
// Only the five mapped columns are ever synced — names/phones/emails in other
// columns never leave Google.

import { useMemo, useState } from 'react';
import { Chip } from '@/components/ui';
import CollapsibleCard from './CollapsibleCard';
import { useStartConnect } from '../hooks';
import { fetchSheetsPickerConfig } from '@/features/call-reporting/api';
import {
  useAddSheetSource,
  useSaveSheetMapping,
  useSetSheetPractice,
  useSheetPracticeMap,
  useSheetPreview,
  useSheetsDisconnect,
  useSheetsStatus,
  useSheetsSync,
} from '@/features/call-reporting/hooks';

const FIELDS: { key: 'practice' | 'created_at' | 'first_call_at' | 'source' | 'pipeline_status'; label: string; hint: string }[] = [
  { key: 'practice', label: 'Practice', hint: 'the practice/site name column' },
  { key: 'created_at', label: 'Lead created', hint: 'date & time the lead came in' },
  { key: 'first_call_at', label: 'First call', hint: 'date & time of the first call (blank = not called)' },
  { key: 'source', label: 'Lead source', hint: 'e.g. Facebook Ads, Google Ads' },
  { key: 'pipeline_status', label: 'Pipeline status', hint: 'the lead’s pipeline stage' },
];

// Load Google's picker script once and open a spreadsheet picker. Resolves
// with the picked spreadsheet id, or null if the user cancelled.
function openSheetPicker(cfg: { apiKey: string; appId: string | null; accessToken: string }): Promise<string | null> {
  const w = window as any;
  const loadScript = () =>
    new Promise<void>((resolve, reject) => {
      if (w.gapi) return resolve();
      const s = document.createElement('script');
      s.src = 'https://apis.google.com/js/api.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load the Google Picker'));
      document.head.appendChild(s);
    });
  return loadScript()
    .then(() => new Promise<void>((resolve) => w.gapi.load('picker', () => resolve())))
    .then(
      () =>
        new Promise<string | null>((resolve) => {
          const g = w.google.picker;
          let builder = new g.PickerBuilder()
            .addView(new g.DocsView(g.ViewId.SPREADSHEETS))
            .setOAuthToken(cfg.accessToken)
            .setDeveloperKey(cfg.apiKey)
            .setCallback((data: any) => {
              if (data.action === g.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
              else if (data.action === g.Action.CANCEL) resolve(null);
            });
          if (cfg.appId) builder = builder.setAppId(cfg.appId);
          builder.build().setVisible(true);
        }),
    );
}

function colLetter(idx: number) {
  let n = idx;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export default function GoogleSheetsPanel() {
  const { data: status, isLoading } = useSheetsStatus();
  const startConnect = useStartConnect();
  const addSource = useAddSheetSource();
  const saveMapping = useSaveSheetMapping();
  const syncNow = useSheetsSync();
  const disconnect = useSheetsDisconnect();

  const [url, setUrl] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);
  const [tab, setTab] = useState<string | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [columns, setColumns] = useState<Record<string, number | ''>>({
    practice: '', created_at: '', first_call_at: '', source: '', pipeline_status: '',
  });
  const [err, setErr] = useState<string | null>(null);

  const source = status?.source ?? null;
  const connected = !!status?.connected;
  const mapped = !!status?.mapped;
  const { data: preview } = useSheetPreview(connected && source && !mapped ? tab : null);
  const { data: practiceMap } = useSheetPracticeMap(mapped);
  const setPractice = useSetSheetPractice();

  const headers = useMemo(() => {
    const row = preview?.rows?.[headerRow - 1] ?? [];
    const width = Math.max(row.length, ...(preview?.rows ?? []).map((r) => r.length), 0);
    return Array.from({ length: width }, (_, i) => ({
      idx: i,
      label: `${colLetter(i)}${row[i] ? ` — ${row[i]}` : ''}`,
    }));
  }, [preview, headerRow]);

  if (isLoading || !status) return null;

  async function handleConnect() {
    setErr(null);
    try {
      const res = await startConnect.mutateAsync({ provider: 'google_sheets' });
      if (res.redirectUrl) window.location.href = res.redirectUrl;
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleAddSource(sourceUrl: string) {
    setErr(null);
    try {
      const res = await addSource.mutateAsync(sourceUrl);
      setTabs(res.tabs);
      if (res.tabs.length === 1) setTab(res.tabs[0]);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const [pickerBusy, setPickerBusy] = useState(false);
  async function handleBrowse() {
    setErr(null);
    setPickerBusy(true);
    try {
      const cfg = await fetchSheetsPickerConfig();
      if (!cfg.enabled || !cfg.apiKey || !cfg.accessToken) {
        setErr('Sheet browsing is not configured on the server yet — paste the sheet URL instead.');
        return;
      }
      const pickedId = await openSheetPicker({
        apiKey: cfg.apiKey,
        appId: cfg.appId ?? null,
        accessToken: cfg.accessToken,
      });
      if (pickedId) await handleAddSource(pickedId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPickerBusy(false);
    }
  }

  async function handleSaveMapping() {
    setErr(null);
    if (!tab) { setErr('Pick the tab that holds your lead rows.'); return; }
    const missing = FIELDS.filter((f) => columns[f.key] === '');
    if (missing.length) { setErr(`Map every column: ${missing.map((f) => f.label).join(', ')} still unset.`); return; }
    const vals = FIELDS.map((f) => columns[f.key]);
    if (new Set(vals).size !== vals.length) { setErr('Each field must use a different column.'); return; }
    try {
      await saveMapping.mutateAsync({
        tab_name: tab,
        header_row: headerRow,
        columns: {
          practice: columns.practice as number,
          created_at: columns.created_at as number,
          first_call_at: columns.first_call_at as number,
          source: columns.source as number,
          pipeline_status: columns.pipeline_status as number,
        },
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Google Sheets? All synced lead rows will be deleted from the app.')) return;
    setErr(null);
    try { await disconnect.mutateAsync(); } catch (e) { setErr((e as Error).message); }
  }

  const badge = mapped && source?.status === 'active'
    ? <Chip colour="emerald">Connected</Chip>
    : source?.status === 'failed'
      ? <Chip colour="rose">Sync failed</Chip>
      : connected
        ? <Chip colour="amber">Setup incomplete</Chip>
        : <Chip colour="amber">Not connected</Chip>;

  return (
    <CollapsibleCard title="Google Sheets — Call Reporting" style={{ marginBottom: 12 }} actions={badge}>
      <div className="space-y-3 text-[13px] text-slate-600">
        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{err}</div>
        )}

        {!connected ? (
          <>
            <p>
              Connect the Google account that can view your lead sheet. Access is read-only —
              the app can never edit or share the sheet — and only the five mapped columns are
              ever synced.
            </p>
            <button className="btn-primary" onClick={handleConnect} disabled={startConnect.isPending}>
              {startConnect.isPending ? 'Opening Google…' : 'Connect Google'}
            </button>
          </>
        ) : !source ? (
          <>
            <p>Pick the Google Sheet that holds your lead rows.</p>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary" onClick={handleBrowse} disabled={pickerBusy || addSource.isPending}>
                {pickerBusy ? 'Opening…' : 'Browse my sheets'}
              </button>
              <span className="text-slate-400">or paste its URL:</span>
            </div>
            <div className="flex gap-2">
              <input
                className="input-base flex-1"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                className="btn-ghost"
                onClick={() => handleAddSource(url)}
                disabled={addSource.isPending || url.trim().length < 10}
              >
                {addSource.isPending ? 'Checking…' : 'Add sheet'}
              </button>
            </div>
          </>
        ) : !mapped ? (
          <>
            <p>
              <span className="font-medium text-slate-900">{source.title ?? 'Sheet added'}.</span>{' '}
              Now tell us which tab and columns hold the lead data.
            </p>
            {tabs.length === 0 ? (
              <button
                className="btn-ghost"
                onClick={() => handleAddSource(source.spreadsheet_url ?? source.spreadsheet_id)}
                disabled={addSource.isPending}
              >
                {addSource.isPending ? 'Loading tabs…' : 'Load tabs'}
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-slate-500">Tab</label>
                <select className="input-base" value={tab ?? ''} onChange={(e) => setTab(e.target.value || null)}>
                  <option value="">— pick a tab —</option>
                  {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="text-slate-500">Header row</label>
                <input
                  type="number" min={1} max={1000} className="input-base w-20"
                  value={headerRow}
                  onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            )}
            {tab && preview && (
              <>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-[12px]">
                    <tbody>
                      {preview.rows.slice(0, 5).map((row, ri) => (
                        <tr key={ri} className={ri === headerRow - 1 ? 'bg-slate-50 font-medium' : ''}>
                          {headers.map((h) => (
                            <td key={h.idx} className="whitespace-nowrap border-b border-slate-100 px-2 py-1">
                              {row[h.idx] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {FIELDS.map((f) => (
                    <label key={f.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                      <span>
                        <span className="font-medium text-slate-900">{f.label}</span>
                        <span className="block text-[12px] text-slate-400">{f.hint}</span>
                      </span>
                      <select
                        className="input-base"
                        value={columns[f.key]}
                        onChange={(e) => setColumns((c) => ({ ...c, [f.key]: e.target.value === '' ? '' : Number(e.target.value) }))}
                      >
                        <option value="">—</option>
                        {headers.map((h) => <option key={h.idx} value={h.idx}>{h.label}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <button className="btn-primary" onClick={handleSaveMapping} disabled={saveMapping.isPending}>
                  {saveMapping.isPending ? 'Saving…' : 'Save mapping & sync'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-medium text-slate-900">{source.title ?? source.spreadsheet_id}</span>
              <span>Tab: {source.tab_name}</span>
              <span>{source.row_count.toLocaleString('en-GB')} rows</span>
              {source.skipped_rows > 0 && <span className="text-amber-600">{source.skipped_rows} rows skipped (bad dates)</span>}
              <span>
                {source.last_synced_at
                  ? `Last synced ${new Date(source.last_synced_at).toLocaleString('en-GB', { timeZone: 'Europe/London' })}`
                  : 'Not synced yet'}
              </span>
            </div>
            {source.status === 'failed' && source.last_error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
                Last sync failed: {source.last_error}
              </div>
            )}

            {practiceMap && practiceMap.values.length > 0 && (
              <div>
                <div className="mb-1 font-medium text-slate-900">Practice mapping</div>
                <p className="mb-2 text-[12px] text-slate-400">
                  Match each practice name found in the sheet to a practice. Changes apply instantly — no re-sync.
                </p>
                <table className="min-w-[320px] text-[13px]">
                  <tbody>
                    {practiceMap.values.map((v) => (
                      <tr key={v.sheet_value}>
                        <td className="py-1 pr-4 text-slate-900">{v.sheet_value}</td>
                        <td className="py-1">
                          <select
                            className="input-base"
                            value={v.practice_id ?? ''}
                            disabled={setPractice.isPending}
                            onChange={(e) => setPractice.mutate({ sheetValue: v.sheet_value, practiceId: e.target.value || null })}
                          >
                            <option value="">— Do not map —</option>
                            {practiceMap.practices.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button className="btn-ghost" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
                {syncNow.isPending ? 'Starting…' : 'Refresh now'}
              </button>
              <button className="btn-ghost text-rose-600" onClick={handleDisconnect} disabled={disconnect.isPending}>
                {disconnect.isPending ? 'Removing…' : 'Disconnect'}
              </button>
            </div>
          </>
        )}
      </div>
    </CollapsibleCard>
  );
}
