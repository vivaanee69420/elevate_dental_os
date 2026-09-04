'use client';

// Google Sheets — Call Reporting setup panel. One connection, many sheets
// (one per practice). States in one card:
//   1. not connected -> Connect Google (OAuth, read-only Sheets scope)
//   2. connected      -> table of connected sheets (one row per source) +
//                        an "Add sheet" wizard: paste/browse -> pick tab ->
//                        map the five columns against a preview -> save
// Sources whose setup was left unfinished show "Continue setup" to resume
// the wizard. Only the five mapped columns are ever synced — names/phones/
// emails in other columns never leave Google.

import { useMemo, useState } from 'react';
import { Chip } from '@/components/ui';
import PanelCard from './PanelCard';
import { useStartConnect } from '../hooks';
import { fetchSheetsPickerConfig, type SheetSourceInfo } from '@/features/call-reporting/api';
import {
  useAddSheetSource,
  useRemoveSheetSource,
  useSaveSheetMapping,
  useSheetPreview,
  useSheetSourceSync,
  useSheetsDisconnect,
  useSheetsStatus,
} from '@/features/call-reporting/hooks';

const FIELDS: { key: 'date' | 'created_time' | 'called_3m' | 'called_10m' | 'pipeline_name'; label: string; hint: string }[] = [
  { key: 'date', label: 'Date', hint: 'the lead’s date column (MM/DD/YYYY)' },
  { key: 'created_time', label: 'Created time', hint: 'time the lead came in (e.g. Created Time (BST))' },
  { key: 'called_3m', label: 'Called within 3 min', hint: 'Yes/No column' },
  { key: 'called_10m', label: 'Called within 10 min', hint: 'Yes/No column' },
  { key: 'pipeline_name', label: 'Pipeline name', hint: 'also identifies Facebook/Google Ads leads' },
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
  const syncSource = useSheetSourceSync();
  const removeSource = useRemoveSheetSource();
  const disconnect = useSheetsDisconnect();

  // Add-sheet wizard state. null = wizard closed.
  const [wizard, setWizard] = useState<{
    url: string;
    practiceLabel: string;
    sourceId: string | null;
    tabs: string[];
    tab: string | null;
  } | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [columns, setColumns] = useState<Record<string, number | ''>>({
    date: '', created_time: '', called_3m: '', called_10m: '', pipeline_name: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  const connected = !!status?.connected;
  const sources = status?.sources ?? [];
  const { data: preview } = useSheetPreview(wizard?.sourceId ?? null, wizard?.tab ?? null);

  const headers = useMemo(() => {
    const row = preview?.rows?.[headerRow - 1] ?? [];
    const width = Math.max(row.length, ...(preview?.rows ?? []).map((r) => r.length), 0);
    return Array.from({ length: width }, (_, i) => ({
      idx: i,
      label: `${colLetter(i)}${row[i] ? ` — ${row[i]}` : ''}`,
    }));
  }, [preview, headerRow]);

  if (isLoading || !status) return null;

  function resetWizard() {
    setWizard(null);
    setHeaderRow(1);
    setColumns({ date: '', created_time: '', called_3m: '', called_10m: '', pipeline_name: '' });
  }

  async function handleConnect() {
    setErr(null);
    try {
      const res = await startConnect.mutateAsync({ provider: 'google_sheets' });
      if (res.redirectUrl) window.location.href = res.redirectUrl;
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleAddSource(sourceUrl: string, practiceLabel: string) {
    setErr(null);
    if (!practiceLabel.trim()) { setErr('Give this sheet a practice name first (e.g. Barnet).'); return; }
    try {
      const res = await addSource.mutateAsync({ url: sourceUrl, practiceLabel: practiceLabel.trim() });
      setWizard((w) => ({
        url: sourceUrl,
        practiceLabel: practiceLabel.trim(),
        sourceId: res.id,
        tabs: res.tabs,
        tab: res.tabs.length === 1 ? res.tabs[0] : (w?.tab ?? null),
      }));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleBrowse() {
    if (!wizard) return;
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
      if (pickedId) await handleAddSource(pickedId, wizard.practiceLabel);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPickerBusy(false);
    }
  }

  async function handleSaveMapping() {
    setErr(null);
    if (!wizard?.sourceId || !wizard.tab) { setErr('Pick the tab that holds your lead rows.'); return; }
    const missing = FIELDS.filter((f) => columns[f.key] === '');
    if (missing.length) { setErr(`Map every column: ${missing.map((f) => f.label).join(', ')} still unset.`); return; }
    const vals = FIELDS.map((f) => columns[f.key]);
    if (new Set(vals).size !== vals.length) { setErr('Each field must use a different column.'); return; }
    try {
      await saveMapping.mutateAsync({
        sourceId: wizard.sourceId,
        mapping: {
          tab_name: wizard.tab,
          header_row: headerRow,
          columns: {
            date: columns.date as number,
            created_time: columns.created_time as number,
            called_3m: columns.called_3m as number,
            called_10m: columns.called_10m as number,
            pipeline_name: columns.pipeline_name as number,
          },
        },
      });
      resetWizard();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // Resume setup on a source added earlier but never mapped: re-register the
  // same spreadsheet (idempotent upsert) to fetch its tab list again.
  function resumeSetup(s: SheetSourceInfo) {
    setWizard({
      url: s.spreadsheet_url ?? s.spreadsheet_id,
      practiceLabel: s.practice_label ?? '',
      sourceId: null,
      tabs: [],
      tab: null,
    });
    void handleAddSource(s.spreadsheet_url ?? s.spreadsheet_id, s.practice_label ?? '');
  }

  async function handleRemove(s: SheetSourceInfo) {
    if (!window.confirm(`Remove the ${s.practice_label ?? 'unnamed'} sheet? Its synced lead rows will be deleted from the app.`)) return;
    setErr(null);
    try { await removeSource.mutateAsync(s.id); } catch (e) { setErr((e as Error).message); }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Google Sheets? Every connected sheet and all synced lead rows will be deleted from the app.')) return;
    setErr(null);
    try { await disconnect.mutateAsync(); } catch (e) { setErr((e as Error).message); }
  }

  const anyFailed = sources.some((s) => s.status === 'failed');
  const badge = !connected
    ? <Chip colour="amber">Not connected</Chip>
    : anyFailed
      ? <Chip colour="rose">Sync failed</Chip>
      : sources.some((s) => s.mapped)
        ? <Chip colour="emerald">Connected</Chip>
        : <Chip colour="amber">Setup incomplete</Chip>;

  return (
    <PanelCard title="Connected sheets" style={{ marginBottom: 12 }} badge={badge}>
      <div className="space-y-3 text-[13px] text-slate-600">
        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{err}</div>
        )}

        {!connected ? (
          <>
            <p>
              Connect the Google account that can view your lead sheets. Access is read-only —
              the app can never edit or share a sheet — and only the five mapped columns are
              ever synced. Connect one sheet per practice.
            </p>
            <button className="btn-primary" onClick={handleConnect} disabled={startConnect.isPending}>
              {startConnect.isPending ? 'Opening Google…' : 'Connect Google'}
            </button>
          </>
        ) : (
          <>
            {sources.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-[13px]">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[12px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Practice</th>
                      <th className="px-3 py-2">Sheet</th>
                      <th className="px-3 py-2">Rows</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Last synced</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-900">{s.practice_label ?? '—'}</td>
                        <td className="px-3 py-2">
                          {s.title ?? s.spreadsheet_id}
                          {s.tab_name ? <span className="text-slate-400"> · {s.tab_name}</span> : null}
                        </td>
                        <td className="px-3 py-2">
                          {s.row_count.toLocaleString('en-GB')}
                          {s.skipped_rows > 0 && <span className="text-amber-600"> ({s.skipped_rows} skipped)</span>}
                        </td>
                        <td className="px-3 py-2">
                          {!s.mapped
                            ? <Chip colour="amber">Setup incomplete</Chip>
                            : s.status === 'failed'
                              ? <Chip colour="rose">Failed</Chip>
                              : s.status === 'pending'
                                ? <Chip colour="amber">Syncing…</Chip>
                                : <Chip colour="emerald">Active</Chip>}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {s.last_synced_at
                            ? new Date(s.last_synced_at).toLocaleString('en-GB', { timeZone: 'Europe/London' })
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            {!s.mapped ? (
                              <button className="btn-ghost" onClick={() => resumeSetup(s)} disabled={addSource.isPending}>
                                Continue setup
                              </button>
                            ) : (
                              <button className="btn-ghost" onClick={() => syncSource.mutate(s.id)} disabled={syncSource.isPending}>
                                Refresh
                              </button>
                            )}
                            <button className="btn-ghost text-rose-600" onClick={() => handleRemove(s)} disabled={removeSource.isPending}>
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sources.some((s) => s.status === 'failed' && s.last_error) && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
                {sources.filter((s) => s.status === 'failed' && s.last_error)
                  .map((s) => `${s.practice_label ?? s.spreadsheet_id}: ${s.last_error}`)
                  .join(' · ')}
              </div>
            )}

            {!wizard ? (
              <div className="flex gap-2 pt-1">
                <button
                  className="btn-primary"
                  onClick={() => setWizard({ url: '', practiceLabel: '', sourceId: null, tabs: [], tab: null })}
                >
                  Add sheet
                </button>
                <button className="btn-ghost text-rose-600" onClick={handleDisconnect} disabled={disconnect.isPending}>
                  {disconnect.isPending ? 'Removing…' : 'Disconnect Google'}
                </button>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">Add a practice&apos;s sheet</span>
                  <button className="btn-ghost" onClick={resetWizard}>Cancel</button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-slate-500">Practice name</label>
                  <input
                    className="input-base w-44"
                    placeholder="e.g. Barnet"
                    value={wizard.practiceLabel}
                    onChange={(e) => setWizard((w) => (w ? { ...w, practiceLabel: e.target.value } : w))}
                  />
                </div>
                {!wizard.sourceId ? (
                  <>
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
                        value={wizard.url}
                        onChange={(e) => setWizard((w) => (w ? { ...w, url: e.target.value } : w))}
                      />
                      <button
                        className="btn-ghost"
                        onClick={() => handleAddSource(wizard.url, wizard.practiceLabel)}
                        disabled={addSource.isPending || wizard.url.trim().length < 10}
                      >
                        {addSource.isPending ? 'Checking…' : 'Add sheet'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-slate-500">Tab</label>
                      <select
                        className="input-base"
                        value={wizard.tab ?? ''}
                        onChange={(e) => setWizard((w) => (w ? { ...w, tab: e.target.value || null } : w))}
                      >
                        <option value="">— pick a tab —</option>
                        {wizard.tabs.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <label className="text-slate-500">Header row</label>
                      <input
                        type="number" min={1} max={1000} className="input-base w-20"
                        value={headerRow}
                        onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </div>
                    {wizard.tab && preview && (
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
                )}
              </div>
            )}
          </>
        )}
      </div>
    </PanelCard>
  );
}
