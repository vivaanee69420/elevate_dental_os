'use client';

// Google Sheets — GHL -> Dentally Conversion Export. Simpler sibling of
// GoogleSheetsPanel (Call Reporting): one connection, one destination sheet
// (one tab per practice), no column mapping. States:
//   1. not connected     -> Connect Google account
//   2. connected, no dest -> paste destination sheet URL -> Save destination
//   3. active             -> destination link, export-since, counts, Export now, Disconnect
//   4. failed             -> amber banner with lastError -> Reconnect

import { useState } from 'react';
import { Chip } from '@/components/ui';
import CollapsibleCard from './CollapsibleCard';
import { useStartConnect } from '../hooks';
import {
  useDisconnectSheetsWriter,
  useDrainSheetsWriter,
  useSetSheetsWriterDestination,
  useSheetsWriterStatus,
} from '../hooks';

export default function GoogleSheetsWriterPanel() {
  const { data: status, isLoading } = useSheetsWriterStatus();
  const startConnect = useStartConnect();
  const setDestination = useSetSheetsWriterDestination();
  const drain = useDrainSheetsWriter();
  const disconnect = useDisconnectSheetsWriter();

  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [changingDestination, setChangingDestination] = useState(false);

  if (isLoading || !status) return null;

  const connected = status.connected;
  const failed = status.status === 'failed';
  const active = connected && !!status.spreadsheetId && !failed;
  const counts = status.counts;

  async function handleConnect() {
    setErr(null);
    try {
      const res = await startConnect.mutateAsync({ provider: 'google_sheets_writer' });
      if (res.redirectUrl) window.location.href = res.redirectUrl;
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleSaveDestination() {
    setErr(null);
    if (!url.trim()) { setErr('Paste the destination spreadsheet URL first.'); return; }
    try {
      await setDestination.mutateAsync(url.trim());
      setUrl('');
      setChangingDestination(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleExportNow() {
    setErr(null);
    try {
      await drain.mutateAsync();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Google Sheets? Exported rows already written to the sheet are kept, but the connection and destination will be removed.')) return;
    setErr(null);
    try { await disconnect.mutateAsync(); } catch (e) { setErr((e as Error).message); }
  }

  const badge = !connected
    ? <Chip colour="amber">Not connected</Chip>
    : failed
      ? <Chip colour="rose">Sync failed</Chip>
      : active
        ? <Chip colour="emerald">Connected</Chip>
        : <Chip colour="amber">Setup incomplete</Chip>;

  return (
    <CollapsibleCard title="Google Sheets — Conversion Export" style={{ marginBottom: 12 }} actions={badge}>
      <div className="space-y-3 text-[13px] text-slate-600">
        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{err}</div>
        )}

        {!connected ? (
          <>
            <p>
              Automatically records each new patient&apos;s first appointment in a Google Sheet
              when they match a GoHighLevel pipeline lead — name, contact details, pipeline and
              dates. One tab per practice.
            </p>
            <button className="btn-primary" onClick={handleConnect} disabled={startConnect.isPending}>
              {startConnect.isPending ? 'Opening Google…' : 'Connect Google account'}
            </button>
          </>
        ) : failed ? (
          <>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              {status.lastError ?? 'The connection failed. Reconnect your Google account to resume exporting.'}
            </div>
            <button className="btn-primary" onClick={handleConnect} disabled={startConnect.isPending}>
              {startConnect.isPending ? 'Opening Google…' : 'Reconnect'}
            </button>
            <p className="pt-1">
              If the destination sheet was deleted, reconnecting alone will not fix it —
              paste a new destination below.
            </p>
            <div className="flex gap-2">
              <input
                className="input-base flex-1"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                className="btn-ghost"
                onClick={handleSaveDestination}
                disabled={setDestination.isPending || url.trim().length < 10}
              >
                {setDestination.isPending ? 'Saving…' : 'Save destination'}
              </button>
            </div>
          </>
        ) : !status.spreadsheetId ? (
          <>
            <p>Paste the destination spreadsheet URL — the sheet the export writes to.</p>
            <div className="flex gap-2">
              <input
                className="input-base flex-1"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                className="btn-primary"
                onClick={handleSaveDestination}
                disabled={setDestination.isPending || url.trim().length < 10}
              >
                {setDestination.isPending ? 'Saving…' : 'Save destination'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-slate-200 p-3 space-y-2">
              <div>
                <span className="text-slate-500">Destination: </span>
                <a
                  className="font-medium text-indigo-600 underline"
                  href={`https://docs.google.com/spreadsheets/d/${status.spreadsheetId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  https://docs.google.com/spreadsheets/d/{status.spreadsheetId}
                </a>
              </div>
              <div>
                <span className="text-slate-500">Exporting since: </span>
                <span className="font-medium text-slate-900">
                  {status.exportSince ? new Date(status.exportSince).toLocaleDateString('en-GB') : '—'}
                </span>
              </div>
              {counts && (
                <div className="flex flex-wrap gap-4 pt-1 text-[12px]">
                  <span><span className="font-medium text-slate-900">{counts.pending}</span> Pending</span>
                  <span><span className="font-medium text-slate-900">{counts.exported}</span> Exported</span>
                  <span><span className="font-medium text-slate-900">{counts.no_match}</span> No match</span>
                  <span><span className="font-medium text-slate-900">{counts.failed}</span> Failed</span>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button className="btn-primary" onClick={handleExportNow} disabled={drain.isPending}>
                {drain.isPending ? 'Exporting…' : 'Export now'}
              </button>
              <button
                className="btn-ghost"
                onClick={() => { setErr(null); setChangingDestination((v) => !v); }}
              >
                {changingDestination ? 'Cancel' : 'Change destination'}
              </button>
              <button className="btn-ghost text-rose-600" onClick={handleDisconnect} disabled={disconnect.isPending}>
                {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
            {changingDestination && (
              <div className="flex gap-2 pt-1">
                <input
                  className="input-base flex-1"
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <button
                  className="btn-primary"
                  onClick={handleSaveDestination}
                  disabled={setDestination.isPending || url.trim().length < 10}
                >
                  {setDestination.isPending ? 'Saving…' : 'Save destination'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </CollapsibleCard>
  );
}
