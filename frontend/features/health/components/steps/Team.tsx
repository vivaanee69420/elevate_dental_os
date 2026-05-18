import { NumberInput } from './NumberInput';
import { NavButtons } from './NavButtons';

export function Team({ baseline, update, onBack, onNext }: any) {
  return (
    <>
      <div className="card-padded mb-4">
        <h2 className="display text-xl font-semibold mb-1">Your Team & Capacity</h2>
        <p className="text-sm text-ink-muted mb-5">Physical and human capacity.</p>
        <div className="grid grid-cols-3 gap-4">
          <NumberInput required label="Number of practices" value={baseline.practices} onChange={(v: number) => update('practices', v)} placeholder="5" />
          <NumberInput required label="Total chairs" value={baseline.chairs} onChange={(v: number) => update('chairs', v)} placeholder="18" />
          <NumberInput required label="Associate clinicians" value={baseline.associates} onChange={(v: number) => update('associates', v)} placeholder="8" />
          <NumberInput label="Hygienists / therapists" value={baseline.hygienists} onChange={(v: number) => update('hygienists', v)} placeholder="6" />
          <NumberInput label="Dental nurses" value={baseline.nurses} onChange={(v: number) => update('nurses', v)} placeholder="14" />
          <NumberInput label="Reception / admin" value={baseline.admin} onChange={(v: number) => update('admin', v)} placeholder="10" />
          <NumberInput label="Practice managers" value={baseline.managers} onChange={(v: number) => update('managers', v)} placeholder="3" />
          <NumberInput label="Chair utilisation %" helper="% of available time booked" value={baseline.utilisation} onChange={(v: number) => update('utilisation', v)} placeholder="78" />
        </div>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </>
  );
}
