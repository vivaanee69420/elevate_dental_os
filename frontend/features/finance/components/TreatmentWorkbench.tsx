'use client';

// Treatment Economics Workbench (GM Intelligence OS — Treatment Profitability).
// The full money flow for a flagship treatment, recomputed live as the owner
// edits. Server-authoritative: edits update local model state, debounce, and
// post to the pure compute endpoint (no client formula duplication, Arch #3).
// Money is edited in £ and stored/sent as integer pence.

import { useEffect, useMemo, useState } from 'react';
import { PageHeader, KpiTile, DataTable, EmptyState, AlertRow, type Column } from '@/components/ui';
import { formatPence } from '@/lib/format';
import { useTreatmentModels, useTreatmentEconomics } from '../workbench-hooks';
import type { TreatmentModel, WorkbenchComponent } from '../workbench-api';

const poundsToPence = (p: number) => Math.round((Number.isFinite(p) ? p : 0) * 100);
const penceToPounds = (p: number) => Math.round((p || 0) / 100);

export function TreatmentWorkbench() {
  const { data: models, isLoading: modelsLoading, isError } = useTreatmentModels();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [model, setModel] = useState<TreatmentModel | null>(null);

  // Seed the model from the selected default once models arrive / tab changes.
  useEffect(() => {
    if (!models) return;
    const key = activeKey && models[activeKey] ? activeKey : Object.keys(models)[0];
    if (key && key !== activeKey) setActiveKey(key);
    if (key && (!model || model.key !== key)) setModel({ ...models[key], components: models[key].components.map((c) => ({ ...c })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, activeKey]);

  const { data: econ } = useTreatmentEconomics(model);

  const patch = (p: Partial<TreatmentModel>) => setModel((m) => (m ? { ...m, ...p } : m));
  const patchComponent = (i: number, p: Partial<WorkbenchComponent>) =>
    setModel((m) => (m ? { ...m, components: m.components.map((c, j) => (j === i ? { ...c, ...p } : c)) } : m));

  const compCols: Column<WorkbenchComponent & { _i: number }>[] = useMemo(
    () => [
      { header: 'Item', render: (c) => <input className="ci-text" value={c.name} onChange={(e) => patchComponent(c._i, { name: e.target.value })} /> },
      { header: 'Qty', align: 'right', render: (c) => <input type="number" className="ci-num" value={c.qty} onChange={(e) => patchComponent(c._i, { qty: Math.max(0, Number(e.target.value)) })} /> },
      { header: 'Retail £', align: 'right', render: (c) => <input type="number" className="ci-num" value={penceToPounds(c.retailPence)} onChange={(e) => patchComponent(c._i, { retailPence: poundsToPence(Number(e.target.value)) })} /> },
      { header: 'Cost £', align: 'right', render: (c) => <input type="number" className="ci-num" value={penceToPounds(c.costPence)} onChange={(e) => patchComponent(c._i, { costPence: poundsToPence(Number(e.target.value)) })} /> },
      { header: 'Profit', align: 'right', render: (c) => formatPence((c.retailPence - c.costPence) * c.qty) },
    ],
    [],
  );

  if (modelsLoading) return <EmptyState message="Loading workbench…" />;
  if (isError) return <AlertRow tone="bad" title="Couldn't load workbench models" />;
  if (!model || !models) return <EmptyState message="No treatment models available." />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Treatment Economics Workbench"
        subtitle="The full money flow for a flagship treatment, step by step. Move the levers — every figure recalculates live."
      />

      {/* treatment tabs */}
      <div className="flex gap-2 flex-wrap">
        {Object.values(models).map((m) => (
          <button
            key={m.key}
            onClick={() => setActiveKey(m.key!)}
            className={`px-4 py-2 rounded-xl text-[13px] font-semibold border ${
              m.key === activeKey ? 'bg-brand text-white border-brand' : 'bg-card border-border text-ink-muted'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* money-flow results */}
      {econ && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KpiTile label="Case fee" value={formatPence(econ.pricePence)} delta="what the patient pays" />
          <KpiTile label="Gross before clinician" value={formatPence(econ.grossBeforeDentistPence)} delta="after CBCT, lab & components" />
          <KpiTile label="Clinician pay" value={`-${formatPence(econ.dentistGrossPence)}`} delta={`at ${model.dentistPct}% of gross`} deltaTone="down" />
          <KpiTile label="Marketing" value={`-${formatPence(econ.marketingPence)}`} delta={`at ${model.marketingPct}% of fee`} deltaTone="down" />
          <KpiTile label="Practice profit" value={formatPence(econ.practiceProfitPence)} delta="what the chair keeps" />
          <KpiTile label="Net profit / case" value={formatPence(econ.groupProfitPence)} delta={`${econ.marginPct}% margin`} deltaTone={econ.marginPct >= 30 ? 'up' : 'muted'} />
          <KpiTile label="Annual profit" value={formatPence(econ.annualProfitPence)} delta={`${econ.monthlyCases} ${model.unit}s/mo`} deltaTone="up" />
          <KpiTile label="Net margin" value={`${econ.marginPct}%`} delta="of the case fee" />
        </div>
      )}

      {/* secondary metrics */}
      {econ && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KpiTile label="Target price" value={econ.targetPricePence > 0 ? formatPence(econ.targetPricePence) : '—'} delta={`for ${model.targetMarginPct}% margin`} />
          <KpiTile label="Max ad / case" value={formatPence(econ.maxAdAt20Pence)} delta="to hold 20% CAC" />
          <KpiTile label="CAC now" value={formatPence(econ.cacPence)} delta={`per ${model.unit === 'implant' ? 'patient' : 'case'}`} />
          <KpiTile label="Monthly profit" value={formatPence(econ.monthlyProfitPence)} delta={`${econ.monthlyCases} ${model.unit}s/mo`} deltaTone="up" />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 items-start">
        {/* levers */}
        <div className="card-padded flex flex-col gap-4">
          <h3 className="display text-lg">Edit the case — drag the levers</h3>
          <div className="grid grid-cols-3 gap-3">
            <NumField label="Case fee (£)" value={penceToPounds(model.pricePence)} onChange={(v) => patch({ pricePence: poundsToPence(v) })} />
            <NumField label="Lab bill (£)" value={penceToPounds(model.labBillPence)} onChange={(v) => patch({ labBillPence: poundsToPence(v) })} />
            <NumField label="CBCT (£)" value={penceToPounds(model.cbctPence)} onChange={(v) => patch({ cbctPence: poundsToPence(v) })} />
          </div>
          <Slider label="Clinician %" value={model.dentistPct} min={25} max={55} onChange={(v) => patch({ dentistPct: v })} />
          <Slider label="Marketing %" value={model.marketingPct} min={0} max={20} onChange={(v) => patch({ marketingPct: v })} />
          <Slider label="Lab margin %" value={model.labMarginPct} min={0} max={60} onChange={(v) => patch({ labMarginPct: v })} />
          <div className="grid grid-cols-3 gap-3">
            <NumField label="Surgeries / mo" value={model.surgeries} onChange={(v) => patch({ surgeries: Math.max(0, Math.round(v)) })} />
            <NumField label="Cases / surgery" value={model.casesPerSurgery} onChange={(v) => patch({ casesPerSurgery: Math.max(0, Math.round(v)) })} />
            <NumField label="Target margin %" value={model.targetMarginPct} onChange={(v) => patch({ targetMarginPct: Math.max(0, Math.min(100, v)) })} />
          </div>
        </div>

        {/* components + planning */}
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="display text-lg mb-2">Components (lab / implant parts)</h3>
            <DataTable columns={compCols} rows={model.components.map((c, i) => ({ ...c, _i: i }))} rowKey={(c) => String(c._i)} />
          </div>
          {econ && (
            <div className="card-padded">
              <h3 className="display text-lg mb-1">Profit planning — who completes the work?</h3>
              <p className="text-xs text-ink-muted mb-3">
                Principal keeping the clinician margin vs an associate on a {model.dentistPct}% split.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <KpiTile label="Associate completes" value={formatPence(econ.associateProfitPence)} delta="clinician paid their %" />
                <KpiTile label="Principal completes" value={formatPence(econ.principalProfitPence)} delta={`+${formatPence(econ.principalUpliftPence)} / case`} deltaTone="up" />
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        :global(.ci-text) { width: 130px; border: 1px solid var(--border); border-radius: 8px; padding: 4px 6px; font-size: 12px; background: var(--card); color: var(--ink); }
        :global(.ci-num) { width: 64px; text-align: right; border: 1px solid var(--border); border-radius: 8px; padding: 4px 6px; font-size: 12px; background: var(--card); color: var(--ink); }
      `}</style>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-ink-soft font-semibold">{label}</span>
      <input
        type="number"
        className="border border-border rounded-lg px-2 py-1.5 text-sm bg-card"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 text-[12px] text-ink-muted">{label}</span>
      <input type="range" className="flex-1 accent-brand" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <b className="w-12 text-right text-sm tabular-nums">{value}%</b>
    </div>
  );
}
