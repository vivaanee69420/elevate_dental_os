'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useHealth, useUpdateHealth } from '../hooks';
import { Welcome } from './steps/Welcome';
import { Numbers } from './steps/Numbers';
import { Team } from './steps/Team';
import { Patients } from './steps/Patients';
import { Costs } from './steps/Costs';
import { Targets } from './steps/Targets';
import { ExitStrategy } from './steps/ExitStrategy';
import { Review } from './steps/Review';

const STEPS = [
  { id: 0, title: 'Welcome', desc: 'How this works' },
  { id: 1, title: 'The Numbers', desc: 'Revenue, profit, cash' },
  { id: 2, title: 'Your Team', desc: 'Associates, staff, chairs' },
  { id: 3, title: 'Your Patients', desc: 'Base, conversion, retention' },
  { id: 4, title: 'Cost Structure', desc: 'Where the money goes' },
  { id: 5, title: 'Your Targets', desc: 'Where you want to be' },
  { id: 6, title: 'Exit Strategy', desc: 'The endgame' },
  { id: 7, title: 'Review & Confirm', desc: 'AI analysis of your data' },
];

const SAVE_DEBOUNCE_MS = 600;

export default function HealthSetupScreen() {
  const router = useRouter();
  const { data: health } = useHealth();
  const saveMutation = useUpdateHealth();

  const [step, setStep] = useState(0);
  const [baseline, setBaseline] = useState<Record<string, any>>({});
  const [targets, setTargets] = useState<Record<string, any>>({});

  // Local state is authoritative once the user is editing. Refs mirror the
  // latest committed values so a debounced save always sends the FULL object
  // (no read-modify-write race on the server) without waiting for a re-render.
  const baselineRef = useRef(baseline);
  const targetsRef = useRef(targets);
  baselineRef.current = baseline;
  targetsRef.current = targets;

  // Seed the form from the server EXACTLY ONCE. After that, refetches (e.g.
  // the invalidation that follows every save) must never clobber what the
  // user is currently typing.
  const hydrated = useRef(false);
  useEffect(() => {
    if (health && !hydrated.current) {
      hydrated.current = true;
      setStep(health.setup_step || 0);
      setBaseline(health.baseline || {});
      setTargets(health.targets || {});
    }
  }, [health]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single-flight, debounced save. Always sends the complete baseline + targets
  // so concurrent/stale server reads can never drop a field. Extra fields
  // (setup_step, setup_completed) merge on top.
  function flushSave(extra: Record<string, any> = {}) {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    saveMutation.mutate(
      { baseline: baselineRef.current, targets: targetsRef.current, ...extra },
      extra.setup_completed
        ? { onSuccess: () => router.push('/progress') }
        : undefined,
    );
  }

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flushSave(), SAVE_DEBOUNCE_MS);
  }

  // Don't lose the last in-flight edit if the user navigates away mid-debounce.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveMutation.mutate({ baseline: baselineRef.current, targets: targetsRef.current });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateBaseline(key: string, value: any) {
    const next = { ...baselineRef.current, [key]: value };
    baselineRef.current = next;
    setBaseline(next);
    scheduleSave();
  }

  function updateTargets(key: string, value: any) {
    const next = { ...targetsRef.current, [key]: value };
    targetsRef.current = next;
    setTargets(next);
    scheduleSave();
  }

  function gotoStep(n: number) {
    setStep(n);
    flushSave({ setup_step: n });
  }

  function complete() {
    flushSave({ setup_completed: true, setup_step: 7 });
  }

  const completionPct = (() => {
    const required = ['revenue', 'profit', 'cash', 'debt', 'associates', 'chairs', 'active_patients', 'new_per_month', 'conversion', 'case_value', 'fta_rate'];
    const filled = required.filter((k) => baseline[k] !== undefined && baseline[k] !== '').length;
    const targetFilled = targets.years && targets.profit_multiple && targets.exit_strategy ? 3 : 0;
    return Math.round(((filled + targetFilled) / (required.length + 3)) * 100);
  })();

  const saveStatus = saveMutation.isError
    ? "Couldn't save — check your connection or permissions"
    : saveMutation.isPending
      ? 'Saving…'
      : saveMutation.isSuccess
        ? 'All changes saved'
        : '';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="display text-3xl font-bold">Business Health Setup</h1>
          <p className="text-ink-muted text-sm mt-1">
            Tell us where you are today — we use this to track every improvement
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-muted uppercase">Setup completion</div>
          <div
            className={`display text-4xl font-bold ${
              completionPct === 100 ? 'text-success' : 'text-brand'
            }`}
          >
            {completionPct}%
          </div>
          {saveStatus && (
            <div
              className={`text-[11px] mt-0.5 ${
                saveMutation.isError ? 'text-danger' : 'text-ink-muted'
              }`}
            >
              {saveStatus}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-1 mb-4">
        {STEPS.map((s) => (
          <button
            key={s.id}
            onClick={() => gotoStep(s.id)}
            className={`flex-1 px-3 py-2 rounded-md text-xs border ${
              s.id === step
                ? 'bg-brand text-white border-brand'
                : s.id < step
                  ? 'bg-brand-50 text-brand border-brand'
                  : 'bg-card text-ink-muted border-border'
            }`}
          >
            <div className="opacity-80">{s.id === 0 ? 'START' : `STEP ${s.id}`}</div>
            <div className="font-semibold mt-1">{s.title}</div>
            {s.id < step && <div className="text-[10px] mt-1">✓ Done</div>}
          </button>
        ))}
      </div>

      {step === 0 && <Welcome onNext={() => gotoStep(1)} />}
      {step === 1 && <Numbers baseline={baseline} update={updateBaseline} onBack={() => gotoStep(0)} onNext={() => gotoStep(2)} />}
      {step === 2 && <Team baseline={baseline} update={updateBaseline} onBack={() => gotoStep(1)} onNext={() => gotoStep(3)} />}
      {step === 3 && <Patients baseline={baseline} update={updateBaseline} onBack={() => gotoStep(2)} onNext={() => gotoStep(4)} />}
      {step === 4 && <Costs baseline={baseline} update={updateBaseline} onBack={() => gotoStep(3)} onNext={() => gotoStep(5)} />}
      {step === 5 && <Targets baseline={baseline} targets={targets} update={updateTargets} onBack={() => gotoStep(4)} onNext={() => gotoStep(6)} />}
      {step === 6 && <ExitStrategy targets={targets} update={updateTargets} onBack={() => gotoStep(5)} onNext={() => gotoStep(7)} />}
      {step === 7 && <Review baseline={baseline} targets={targets} onBack={() => gotoStep(6)} onComplete={complete} />}
    </div>
  );
}
