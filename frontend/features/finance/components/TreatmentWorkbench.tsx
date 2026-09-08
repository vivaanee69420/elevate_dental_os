'use client';

// Treatment Economics Workbench (GM Intelligence OS — Treatment Profitability).
// The full money flow for a flagship treatment, recomputed live as the owner
// edits. Server-authoritative: edits update local model state, debounce, and
// post to the pure compute endpoint (no client formula duplication, Arch #3).
// Money is edited in £ and stored/sent as integer pence.

import { useEffect, useMemo, useState } from 'react';
import { PageHeader, KpiTile, DataTable, EmptyState, AlertRow, SkeletonKpiRow, SkeletonTable, type Column } from '@/components/ui';
import { formatPence } from '@/lib/format';
import {
  useTreatmentModels, useTreatmentEconomics, useTreatmentFeeBenchmarks,
  useSaveTreatmentModel, useDeleteTreatmentModel,
} from '../workbench-hooks';
import { slugifyTreatmentKey, type TreatmentModel, type WorkbenchComponent } from '../workbench-api';
import { DetailModal } from '@/features/marketing/_shared/DetailModal';
import PracticeTabs from '@/features/practices/PracticeTabs';
import DateRangeFilter, { type DateRange } from './DateRangeFilter';
import { buildWorkbenchProofs, EDITABLE_BY_TILE } from './workbench-proof';

// The workbench's default window. Twelve months of invoices is enough for a
// stable mean on a treatment a practice does a few times a month.
function lastTwelveMonths(): DateRange {
  const to = new Date();
  const from = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: ymd(from), to: ymd(to) };
}

const poundsToPence = (p: number) => Math.round((Number.isFinite(p) ? p : 0) * 100);
const penceToPounds = (p: number) => Math.round((p || 0) / 100);

export function TreatmentWorkbench() {
  const { data: models, isLoading: modelsLoading, isError } = useTreatmentModels();
  // SCOPE. The workbench had none: it read every invoice in the organisation
  // over a fixed twelve months and called the result "real". The fee genuinely
  // differs by site, so an org-wide mean describes no practice.
  const [scopePractice, setScopePractice] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(lastTwelveMonths());
  const { data: feeBenchmarks } = useTreatmentFeeBenchmarks({
    practiceId: scopePractice, since: range.from, until: range.to,
  });
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [model, setModel] = useState<TreatmentModel | null>(null);

  const benchOf = (key?: string | null) =>
    (key && feeBenchmarks?.benchmarks?.[key as 'fullarch' | 'implant' | 'invisalign']) || null;

  // Seed the model from the selected default once models arrive / tab changes.
  // When a real Dentally case-fee benchmark exists for the treatment, seed the
  // case fee from it (the patient FEE — costs below stay owner-entered).
  useEffect(() => {
    if (!models) return;
    const key = activeKey && models[activeKey] ? activeKey : Object.keys(models)[0];
    if (key && key !== activeKey) setActiveKey(key);
    if (key && (!model || model.key !== key)) {
      const seed = { ...models[key], components: models[key].components.map((c) => ({ ...c })) };
      const bench = benchOf(key);
      if (bench?.feePence) seed.pricePence = bench.feePence;
      setModel(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, activeKey]);

  // Benchmarks can arrive AFTER the model was seeded from defaults. Upgrade the
  // case fee to the real average only if the owner hasn't edited it yet (still
  // equal to the hardcoded default), so a manual edit is never clobbered.
  useEffect(() => {
    const key = model?.key;
    if (!key || !models || !feeBenchmarks) return;
    const bench = benchOf(key);
    if (bench?.feePence && model?.pricePence === models[key]?.pricePence) {
      setModel((m) => (m && m.key === key ? { ...m, pricePence: bench.feePence } : m));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeBenchmarks, models, model?.key]);

  const { data: econ } = useTreatmentEconomics(model);
  const save = useSaveTreatmentModel();
  const remove = useDeleteTreatmentModel();

  // Is what is on screen different from what the server holds? Drives whether
  // Save is offered at all — an always-live Save button gives no signal about
  // whether the work has been kept, which is the thing the owner needs to know.
  const stored = model?.key ? models?.[model.key] : undefined;
  const dirty = !!model && !!stored && JSON.stringify(model) !== JSON.stringify({ ...stored, key: model.key });

  // In-app dialogs. window.prompt/confirm/alert render the BROWSER's own
  // chrome — "localhost:3000 says" — which is unstyled, cannot be branded,
  // blocks the whole tab, and in some embedded contexts is suppressed
  // entirely, so the feature would silently do nothing.
  const [dialog, setDialog] = useState<'add' | 'remove' | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [proofKey, setProofKey] = useState<string | null>(null);

  async function onSave() {
    if (!model?.key) return;
    await save.mutateAsync({ key: model.key, model });
  }

  // Reset a built-in to its default, or delete a treatment this org invented.
  // Both are the same DELETE — a built-in simply has a default left underneath
  // once the override row is gone.
  async function onRemoveConfirmed() {
    if (!model?.key) return;
    const custom = stored?.isCustom;
    const next = await remove.mutateAsync(model.key);
    setDialog(null);
    const first = Object.keys(next)[0] ?? null;
    setActiveKey(custom ? first : model.key);
    setModel(null);
  }

  // A new treatment starts from the one on screen rather than from nothing: an
  // owner adding 'Bone Graft' wants their own clinician split and marketing
  // percentage, not a blank form and twelve fields to retype.
  async function onAddConfirmed() {
    const label = newLabel.trim();
    if (!label || !model) { setDialogError('Give the treatment a name.'); return; }
    const key = slugifyTreatmentKey(label);
    if (models?.[key]) { setDialogError(`"${label}" already exists.`); return; }
    await save.mutateAsync({ key, model: { ...model, key, label } });
    setDialog(null);
    setNewLabel('');
    setDialogError(null);
    setActiveKey(key);
    setModel(null);
  }

  // Half these tiles are DERIVED and half follow a lever below, and they
  // looked identical. This appends the marker from ONE list (EDITABLE_BY_TILE),
  // so a tile cannot be marked here and missed in the proof panel.
  const sub = (tile: string, text: string) =>
    EDITABLE_BY_TILE[tile] ? `${text} · click to edit` : text;

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

  if (modelsLoading)
    return (
      <div className="flex flex-col gap-4">
        <SkeletonKpiRow count={4} />
        <SkeletonTable rows={6} cols={4} />
      </div>
    );
  if (isError) return <AlertRow tone="bad" title="Couldn't load workbench models" />;
  if (!model || !models) return <EmptyState message="No treatment models available." />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Treatment Economics Workbench"
        subtitle="The full money flow for a flagship treatment, step by step. Move the levers — every figure recalculates live."
      />

      {/* Scope. Both of these used to be absent entirely, so every figure on
          the page was org-wide over a fixed twelve months and said so nowhere. */}
      <PracticeTabs dentallyOnly value={scopePractice} onChange={setScopePractice} />
      <DateRangeFilter value={range} onChange={setRange} />

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
        <button
          onClick={() => { setNewLabel(''); setDialogError(null); setDialog('add'); }}
          className="px-4 py-2 rounded-xl text-[13px] font-semibold border border-dashed border-border text-ink-muted"
        >
          + Add treatment
        </button>
      </div>

      {/* SAVE. Everything on this page used to live in React state and nothing
          else: the lab bill, the component prices, the surgery run cost and the
          clinician split are in no feed — Dentally sends what the patient paid
          and never what the work cost — so a refresh destroyed the only copy.
          The button appears only when there is something unsaved, so its
          presence is the signal. */}
      <div className="flex items-center gap-3 flex-wrap">
        {dirty ? (
          <>
            <button className="btn btn-primary text-[13px]" onClick={onSave} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : `Save ${model.label}`}
            </button>
            <span className="text-[12px] text-ink-muted">Unsaved changes</span>
          </>
        ) : (
          <span className="text-[12px] text-ink-muted">
            {stored?.isCustom || stored ? 'Saved' : 'Standard figures — edit anything to save your own'}
          </span>
        )}
        {stored ? (
          <button className="btn btn-ghost text-[12px]" onClick={() => { setDialogError(null); setDialog('remove'); }} disabled={remove.isPending}>
            {stored.isCustom ? 'Delete treatment' : 'Reset to standard'}
          </button>
        ) : null}
      </div>

      {/* Add a treatment. An in-app dialog, not window.prompt: the browser's
          own is unstyled, says "localhost:3000 says", blocks the tab, and is
          suppressed outright in some embedded contexts. */}
      <DetailModal
        open={dialog === 'add'}
        title="Add a treatment"
        subtitle={`It starts from ${model.label}, so your clinician split, marketing and throughput carry over. Change anything you like before saving.`}
        onClose={() => setDialog(null)}
      >
        <div className="flex flex-col gap-3 text-[13px]">
          <label className="flex flex-col gap-1">
            <span className="text-ink-muted">Treatment name</span>
            <input
              autoFocus
              className="ci-text"
              value={newLabel}
              placeholder="Bone Graft"
              onChange={(e) => { setNewLabel(e.target.value); setDialogError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') onAddConfirmed(); }}
            />
          </label>
          {dialogError ? <span className="text-danger">{dialogError}</span> : null}
          <div className="flex gap-2 justify-end">
            <button className="btn btn-ghost text-[13px]" onClick={() => setDialog(null)}>Cancel</button>
            <button className="btn btn-primary text-[13px]" onClick={onAddConfirmed} disabled={save.isPending}>
              {save.isPending ? 'Adding…' : 'Add treatment'}
            </button>
          </div>
        </div>
      </DetailModal>

      <DetailModal
        open={dialog === 'remove'}
        title={stored?.isCustom ? `Delete ${model.label}?` : `Reset ${model.label}?`}
        subtitle={stored?.isCustom
          ? 'This removes the treatment and everything entered for it. It cannot be undone.'
          : 'Your saved figures for this treatment are removed and it goes back to the standard ones.'}
        onClose={() => setDialog(null)}
      >
        <div className="flex gap-2 justify-end text-[13px]">
          <button className="btn btn-ghost" onClick={() => setDialog(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={onRemoveConfirmed} disabled={remove.isPending}>
            {remove.isPending ? 'Working…' : stored?.isCustom ? 'Delete treatment' : 'Reset to standard'}
          </button>
        </div>
      </DetailModal>

      {save.isError ? <AlertRow tone="bad" title="Could not save" body="Your changes are still on screen. Try again, or check you have finance edit permission." /> : null}

      {/* Real case-fee provenance — only when Dentally invoices give a benchmark
          for this treatment. Patient fee only; costs stay owner-entered. */}
      {(() => {
        const bench = benchOf(model.key);
        if (!bench?.feePence) return null;
        const defaultPence = models[model.key!]?.pricePence ?? 0;
        const usingReal = model.pricePence === bench.feePence;
        const gbp = (pence: number) => `£${penceToPounds(pence).toLocaleString('en-GB')}`;
        return (
          <AlertRow
            tone={usingReal ? 'good' : 'info'}
            title={usingReal ? `Case fee from real Dentally invoices — ${gbp(bench.feePence)}` : `Real case fee available — ${gbp(bench.feePence)}`}
            body={`Average total across ${bench.sampleSize} ${model.label} invoice${bench.sampleSize === 1 ? '' : 's'} in the last ${feeBenchmarks?.windowMonths ?? 12} months. This is the patient fee — your lab/CBCT/component costs below stay manual (Dentally never sends supplier cost).`}
            tag={
              <button
                className="btn btn-ghost text-[12px] whitespace-nowrap"
                onClick={() => patch({ pricePence: usingReal ? defaultPence : bench.feePence })}
              >
                {usingReal ? `Use default ${gbp(defaultPence)}` : `Use real ${gbp(bench.feePence)}`}
              </button>
            }
          />
        );
      })()}

      {/* Every tile opens its own working. The figures are a MODEL built from
          the owner's own costs, not a measurement — only the case fee is
          measured, from real Dentally invoices — and each panel says which it
          is rather than letting a confident number imply it was observed. */}
      {econ && model ? (() => {
        const proofs = buildWorkbenchProofs(econ, model, benchOf(model.key), feeBenchmarks?.windowMonths ?? 12,
          { practiceName: null, since: feeBenchmarks?.since ?? '', until: feeBenchmarks?.until ?? null });
        const proof = proofKey ? proofs[proofKey] : null;
        return (
          <DetailModal
            open={!!proof}
            title={proof?.title ?? ''}
            subtitle={proof?.means}
            onClose={() => setProofKey(null)}
          >
            {proof ? (
              <div className="text-[13px]">
                <p className="text-ink-muted mb-3">{proof.basis}</p>
                {/* Say plainly whether this is a figure the reader can move, and
                    which control moves it. A derived tile says nothing, so the
                    absence is meaningful too. */}
                {/* THE CONTROL LIVES HERE, not just a pointer to one. Telling a
                    reader a figure is editable and then making them hunt for the
                    lever that moves it is barely better than saying nothing. */}
                {proof.editable ? (
                  <div className="mb-4 rounded-lg border border-border p-3">
                    <div className="font-semibold mb-2">Change it here</div>
                    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(proof.editable.length, 2)}, minmax(0, 1fr))` }}>
                      {proof.editable.map((f) => (
                        <label key={f.key} className="flex flex-col gap-1">
                          <span className="text-ink-muted text-[12px]">
                            {f.label}{f.kind === 'money' ? ' (£)' : f.kind === 'pct' ? ' (%)' : ''}
                          </span>
                          <input
                            type="number"
                            className="ci-num"
                            value={f.kind === 'money' ? penceToPounds(model[f.key] as number) : (model[f.key] as number)}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (f.kind === 'money') patch({ [f.key]: poundsToPence(v) } as Partial<TreatmentModel>);
                              else if (f.kind === 'pct') patch({ [f.key]: Math.max(0, Math.min(100, v)) } as Partial<TreatmentModel>);
                              else patch({ [f.key]: Math.max(1, Math.round(v)) } as Partial<TreatmentModel>);
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <p className="text-ink-muted text-[12px] mt-2">
                      Every figure recalculates as you type. Close this and press Save to keep it.
                    </p>
                  </div>
                ) : (
                  <p className="text-ink-muted mb-4 text-[12px]">
                    Worked out from the figures above — not something you enter directly.
                  </p>
                )}
                <table className="w-full">
                  <tbody>
                    {proof.rows.map((r) => (
                      <tr key={r.name} className="border-t border-border">
                        <td className={'py-2 pr-2 ' + (r.muted ? 'text-ink-muted' : '')}>{r.name}</td>
                        <td className={'py-2 text-right tabular-nums ' + (r.muted ? 'text-ink-muted' : '')}>{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td className="py-2.5 pr-2 font-semibold">{proof.total.name}</td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">{proof.total.value}</td>
                    </tr>
                  </tfoot>
                </table>
                {proof.caveat ? <p className="text-ink-muted mt-4 text-[12px] leading-relaxed">{proof.caveat}</p> : null}
              </div>
            ) : null}
          </DetailModal>
        );
      })() : null}

      {/* money-flow results */}
      {econ && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KpiTile label="Case fee" value={formatPence(econ.pricePence)} delta={sub("Case fee", "what the patient pays")}  onClick={() => setProofKey("Case fee")} />
          <KpiTile label="Gross before clinician" value={formatPence(econ.grossBeforeDentistPence)} delta={sub("Gross before clinician", "after CBCT, lab & components")}  onClick={() => setProofKey("Gross before clinician")} />
          <KpiTile label="Clinician pay" value={`-${formatPence(econ.dentistGrossPence)}`} delta={sub("Clinician pay", `at ${model.dentistPct}% of gross`)} deltaTone="down"  onClick={() => setProofKey("Clinician pay")} />
          <KpiTile label="Marketing" value={`-${formatPence(econ.marketingPence)}`} delta={sub("Marketing", `at ${model.marketingPct}% of fee`)} deltaTone="down"  onClick={() => setProofKey("Marketing")} />
          <KpiTile label="Practice profit" value={formatPence(econ.practiceProfitPence)} delta={sub("Practice profit", "what the chair keeps")}  onClick={() => setProofKey("Practice profit")} />
          <KpiTile label="Net profit / case" value={formatPence(econ.groupProfitPence)} delta={sub("Net profit / case", `${econ.marginPct}% margin`)} deltaTone={econ.marginPct >= 30 ? 'up' : 'muted'} onClick={() => setProofKey("Net profit / case")} />
          <KpiTile label="Annual profit" value={formatPence(econ.annualProfitPence)} delta={sub("Annual profit", `${econ.monthlyCases} ${model.unit}s/mo`)} deltaTone="up"  onClick={() => setProofKey("Annual profit")} />
          <KpiTile label="Net margin" value={`${econ.marginPct}%`} delta={sub("Net margin", "of the case fee")}  onClick={() => setProofKey("Net margin")} />
        </div>
      )}

      {/* secondary metrics */}
      {econ && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KpiTile label="Target price" value={econ.targetPricePence > 0 ? formatPence(econ.targetPricePence) : '—'} delta={sub("Target price", `for ${model.targetMarginPct}% margin`)} onClick={() => setProofKey("Target price")} />
          <KpiTile label="Max ad / case" value={formatPence(econ.maxAdAt20Pence)} delta={sub("Max ad / case", "to hold 20% CAC")}  onClick={() => setProofKey("Max ad / case")} />
          <KpiTile label="CAC now" value={formatPence(econ.cacPence)} delta={sub("CAC now", `per ${model.unit === 'implant' ? 'patient' : 'case'}`)}  onClick={() => setProofKey("CAC now")} />
          <KpiTile label="Monthly profit" value={formatPence(econ.monthlyProfitPence)} delta={sub("Monthly profit", `${econ.monthlyCases} ${model.unit}s/mo`)} deltaTone="up"  onClick={() => setProofKey("Monthly profit")} />
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

          {/* THESE THREE FED THE MATHS WITH NO CONTROL ON THE PAGE. Full Arch
              carried £600 of surgery run cost the owner could not see, let alone
              change. Like the lab bill and the components, they come from no
              feed at all — Dentally sends patient fees and QuickBooks is
              company-level — so if they are not editable here they are not
              editable anywhere. */}
          <div>
            <h4 className="text-[13px] font-semibold mb-1">Costs only you know</h4>
            <p className="text-[12px] text-ink-muted mb-3">
              Nothing sends us these — not Dentally, not QuickBooks. Enter what the case
              really costs you and every figure above follows.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <NumField label="Surgery run cost (£)" value={penceToPounds(model.surgeryRunCostPence)} onChange={(v) => patch({ surgeryRunCostPence: poundsToPence(v) })} />
              <NumField label="Utilities (£)" value={penceToPounds(model.utilitiesPence)} onChange={(v) => patch({ utilitiesPence: poundsToPence(v) })} />
              <NumField label={model.unit === 'implant' ? 'Implants / patient' : 'Units / case'} value={model.implantsPerPatient} onChange={(v) => patch({ implantsPerPatient: Math.max(1, Math.round(v)) })} />
            </div>
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
                <KpiTile label="Associate completes" value={formatPence(econ.associateProfitPence)} delta={sub("Associate completes", "clinician paid their %")}  onClick={() => setProofKey("Associate completes")} />
                <KpiTile label="Principal completes" value={formatPence(econ.principalProfitPence)} delta={sub("Principal completes", `+${formatPence(econ.principalUpliftPence)} / case`)} deltaTone="up"  onClick={() => setProofKey("Principal completes")} />
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
