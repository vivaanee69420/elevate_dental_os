import { NumberInput } from './NumberInput';
import { NavButtons } from './NavButtons';

export function Patients({ baseline, update, onBack, onNext }: any) {
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">Patients & Conversion</h2>
        <p className="text-sm text-ink-muted mb-5">
          The lifeblood of the business. Estimate where you don&apos;t track exactly.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <NumberInput required label="Active patient base" helper="Visited within 24 months" value={baseline.active_patients} onChange={(v: number) => update('active_patients', v)} placeholder="14,820" />
          <NumberInput label="Lapsed patients" helper="No visit 12+ months" value={baseline.lapsed} onChange={(v: number) => update('lapsed', v)} placeholder="2,380" />
          <NumberInput label="Plan members" helper="Recurring monthly payers" value={baseline.plan_members} onChange={(v: number) => update('plan_members', v)} placeholder="2,600" />
          <NumberInput required label="Leads / month" helper="All enquiries" value={baseline.leads_per_month} onChange={(v: number) => update('leads_per_month', v)} placeholder="380" />
          <NumberInput required label="New patients / month" helper="Actually started treatment" value={baseline.new_per_month} onChange={(v: number) => update('new_per_month', v)} placeholder="187" />
          <NumberInput label="Conversion %" value={baseline.conversion} onChange={(v: number) => update('conversion', v)} placeholder="11.5" />
          <NumberInput required label="Average case value (£)" value={baseline.case_value} onChange={(v: number) => update('case_value', v)} placeholder="2,850" />
          <NumberInput required label="FTA / no-show rate %" value={baseline.fta_rate} onChange={(v: number) => update('fta_rate', v)} placeholder="4.2" />
          <NumberInput label="% private revenue" helper="vs NHS" value={baseline.private_pct} onChange={(v: number) => update('private_pct', v)} placeholder="72" />
        </div>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}
