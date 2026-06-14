'use client';
// Automations (Workflows) — live GoHighLevel workflows via GET /api/workflows/ghl.
// GHL's API exposes id/name/status only (no per-workflow sent/conversion), so
// the table shows name + status + last-updated, with total/active KPIs.

import { useMemo, useState } from 'react';
import { Card, DataTable, KpiTile, Chip, type Column } from '@/components/ui';
import { useGhlWorkflows } from '../hooks';
import type { GhlWorkflow } from '../api';
import { useGhlAccounts } from '@/features/integrations/hooks';
import { SubaccountFilterBar } from '@/features/ghl/components/SubaccountFilterBar';

function isActive(status: string | null): boolean {
  const s = (status ?? '').toLowerCase();
  return s === 'published' || s === 'active';
}

/** Automations screen — GoHighLevel workflows. */
export default function WorkflowsScreen() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data: ghlData } = useGhlAccounts();

  const { data, isLoading } = useGhlWorkflows(accountId);
  const workflows = data?.workflows ?? [];

  const active = useMemo(() => workflows.filter((w) => isActive(w.status)).length, [workflows]);

  const columns: Column<GhlWorkflow>[] = [
    { header: 'Workflow', render: (w) => <strong>{w.name}</strong> },
    {
      header: 'Status',
      render: (w) => (
        <Chip colour={isActive(w.status) ? 'emerald' : 'amber'}>{w.status ?? 'unknown'}</Chip>
      ),
    },
    {
      header: 'Updated',
      align: 'right',
      render: (w) => (
        <span className="text-ink-muted" style={{ fontSize: 12 }}>
          {w.updatedAt ? new Date(w.updatedAt).toLocaleDateString('en-GB') : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>Automations</h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {isLoading ? 'Loading…' : `${workflows.length} GoHighLevel workflows · ${active} active`}
        </p>
      </div>

      {ghlData && ghlData.accounts.length > 0 && (
        <div className="mb-4">
          <SubaccountFilterBar
            accounts={ghlData.accounts.map((a) => ({
              accountId: a.id,
              label: a.label || 'GoHighLevel',
              practiceId: a.practice_id ?? null,
            })) as any}
            selected={accountId}
            onSelect={setAccountId}
          />
        </div>
      )}

      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <KpiTile label="Total workflows" value={String(workflows.length)} />
        <KpiTile label="Active" value={String(active)} />
      </div>

      <Card padded={false}>
        {workflows.length === 0 ? (
          <div className="text-ink-muted" style={{ padding: 24, fontSize: 13, textAlign: 'center' }}>
            {isLoading ? 'Loading workflows…' : 'No GoHighLevel workflows synced yet — connect GoHighLevel and run a sync.'}
          </div>
        ) : (
          <DataTable columns={columns} rows={workflows} rowKey={(w) => w.id} />
        )}
      </Card>
    </div>
  );
}
