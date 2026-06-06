'use client';
// Data Hub — CSV manual feed. Upload a dataset CSV, see a row-level validation
// report, then a DIFFERENT user approves the staged batch before it lands in
// live tables (dual control). Mirrors the prototype launch-manual-feed screen;
// reuses the app's Card / Chip / table primitives.

import { useState } from 'react';
import { Card, Chip, Skeleton } from '@/components/ui';
import { useMe } from '@/hooks/useMe';
import {
  useImportBatches, useUploadCsv, useApproveBatch, useRejectBatch,
  type Dataset, type ImportResult, type ImportBatch,
} from '../imports-api';

const DATASETS: { id: Dataset; label: string }[] = [
  { id: 'payments', label: 'Payments' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'patients', label: 'Patients' },
];

function statusChip(s: ImportBatch['status']) {
  if (s === 'approved') return <Chip colour="emerald">Approved</Chip>;
  if (s === 'rejected') return <Chip colour="rose">Rejected</Chip>;
  return <Chip colour="amber">Pending approval</Chip>;
}

export default function DataHubScreen() {
  const { data: me } = useMe();
  const [dataset, setDataset] = useState<Dataset>('payments');
  const [filename, setFilename] = useState('');
  const [content, setContent] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const upload = useUploadCsv();
  const approve = useApproveBatch();
  const reject = useRejectBatch();
  const { data, isLoading, error } = useImportBatches();
  const batches = data?.batches ?? [];

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  async function onUpload() {
    if (!content) return;
    const res = await upload.mutateAsync({ dataset, filename, content });
    setResult(res);
    setContent('');
    setFilename('');
  }

  return (
    <div className="container mx-auto" style={{ maxWidth: 1400 }}>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Data Hub</h1>
        <p className="text-sm text-ink-muted mt-1">
          Manually feed payments, appointments or patients by CSV. Rows are validated, then a
          second team member approves before they go live.
        </p>
      </div>

      {/* Upload */}
      <Card className="mb-4">
        <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 12 }}>Upload a CSV</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13 }}>
            <div className="text-ink-muted" style={{ marginBottom: 4 }}>Dataset</div>
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value as Dataset)}
              className="card-padded"
              style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}
            >
              {DATASETS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            <div className="text-ink-muted" style={{ marginBottom: 4 }}>File</div>
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
          </label>
          <button
            onClick={onUpload}
            disabled={!content || upload.isPending}
            style={{
              background: content ? 'var(--brand)' : 'var(--border)', color: '#fff', border: 'none',
              padding: '9px 18px', borderRadius: 8, fontWeight: 600, fontSize: 13,
              cursor: content ? 'pointer' : 'not-allowed',
            }}
          >
            {upload.isPending ? 'Validating…' : 'Upload & validate'}
          </button>
        </div>
        {upload.isError && (
          <div style={{ marginTop: 10, color: 'var(--danger)', fontSize: 13 }}>
            {(upload.error as Error).message}
          </div>
        )}
      </Card>

      {/* Result report */}
      {result && (
        <Card className="mb-4">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <Chip colour="emerald">{result.valid_count} valid</Chip>
            {result.rejected_count > 0 && <Chip colour="rose">{result.rejected_count} rejected</Chip>}
            <span className="text-ink-muted" style={{ fontSize: 13 }}>
              staged as <b>{result.dataset}</b> — pending a second approver
            </span>
          </div>
          {result.rejected_count === 0 ? (
            <div className="text-ink-muted" style={{ fontSize: 13 }}>All rows clean.</div>
          ) : (
            <table className="table">
              <thead><tr><th>Row</th><th>Why it was rejected</th></tr></thead>
              <tbody>
                {result.rejected.map((r) => (
                  <tr key={r.row_number}>
                    <td>{r.row_number}</td>
                    <td style={{ color: 'var(--danger)' }}>{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 10 }}>
            Fix rejected rows in the source file and re-upload — re-importing is safe (no duplicates).
          </p>
        </Card>
      )}

      {/* Approval queue */}
      <Card>
        <h2 className="display font-semibold" style={{ fontSize: 17, marginBottom: 12 }}>Approval queue</h2>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : error ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>Failed to load: {(error as Error).message}</div>
        ) : batches.length === 0 ? (
          <div className="text-ink-muted" style={{ fontSize: 13 }}>No imports yet. Upload a CSV above to get started.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Dataset</th><th>File</th><th>Rows</th><th>Status</th><th>Uploaded</th><th /></tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const isOwnUpload = me?.id && b.uploaded_by === me.id;
                const pending = b.status === 'pending';
                return (
                  <tr key={b.id}>
                    <td><b>{b.dataset}</b></td>
                    <td className="text-ink-muted">{b.filename ?? '—'}</td>
                    <td>{b.valid_count} valid{b.rejected_count > 0 ? `, ${b.rejected_count} rejected` : ''}</td>
                    <td>{statusChip(b.status)}</td>
                    <td className="text-ink-muted">{new Date(b.created_at).toLocaleDateString('en-GB')}</td>
                    <td style={{ textAlign: 'right' }}>
                      {pending && (
                        <span style={{ display: 'inline-flex', gap: 8 }}>
                          <button
                            onClick={() => approve.mutate(b.id)}
                            disabled={!!isOwnUpload || approve.isPending}
                            title={isOwnUpload ? 'A different user must approve this import' : 'Approve and import'}
                            style={{
                              background: isOwnUpload ? 'var(--border)' : 'var(--brand)', color: '#fff', border: 'none',
                              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                              cursor: isOwnUpload ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => reject.mutate({ id: b.id })}
                            disabled={reject.isPending}
                            style={{
                              background: 'none', color: 'var(--danger)', border: '1px solid var(--border)',
                              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            }}
                          >
                            Reject
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
