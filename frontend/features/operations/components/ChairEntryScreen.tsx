'use client';
// Chair Utilisation — data entry.
//
// Split from Chair Efficiency (/chair) because the two are gated differently:
// Efficiency needs finance.view, this needs operations.view. Stacked on one
// page, a practice manager without finance access got a half-broken screen.

import { useEffect, useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { usePractices } from '@/features/integrations/hooks';
import {
  useChairWeek, useSaveChairWeek, useCreateChair, useUpdateChair, useDeleteChair, useSaveOpeningHours,
} from '../chair-entry-hooks';
import type { OpeningHoursDay, WeekCellInput } from '../chair-entry-api';
import { ChairsPanel } from './ChairsPanel';
import { OpeningHoursPanel } from './OpeningHoursPanel';
import { ChairWeekGrid } from './ChairWeekGrid';

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

export function ChairEntryScreen() {
  const { data: practicesData } = usePractices();
  const practices = practicesData?.practices ?? [];
  const [practiceId, setPracticeId] = useState('');
  const selectedPractice = practiceId || practices[0]?.id || '';

  const { data: week, isPending, error } = useChairWeek(selectedPractice || undefined);
  const [chairId, setChairId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveWeek = useSaveChairWeek(selectedPractice || undefined);
  const addChair = useCreateChair(selectedPractice || undefined);
  const renameChair = useUpdateChair(selectedPractice || undefined);
  const retireChair = useDeleteChair(selectedPractice || undefined);
  const saveHours = useSaveOpeningHours(selectedPractice || undefined);

  // Keep the selected chair valid as chairs are added, renamed or retired, and
  // when the practice changes underneath it.
  useEffect(() => {
    if (!week) return;
    const ids = week.chairs.map((c) => c.id);
    if (!chairId || !ids.includes(chairId)) setChairId(ids[0] ?? null);
  }, [week, chairId]);

  const coverage = week?.coverage;
  const coverageLabel = useMemo(() => {
    if (!coverage) return null;
    if (coverage.openCells === 0) return 'No opening hours set yet';
    return `${coverage.enteredCells} of ${coverage.openCells} open slots entered`;
  }, [coverage]);

  function onSaveWeek(cells: WeekCellInput[]) {
    if (!selectedPractice || !chairId) return;
    setSaved(false);
    saveWeek.mutate(
      { practice_id: selectedPractice, chair_id: chairId, cells },
      { onSuccess: () => setSaved(true) },
    );
  }

  function onSaveHours(days: OpeningHoursDay[]) {
    if (!selectedPractice) return;
    saveHours.mutate({ practice_id: selectedPractice, days });
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6 flex items-center justify-between flex-wrap" style={{ gap: 12 }}>
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>Chair Utilisation</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            How much of each chair&apos;s open time is booked, in a typical week.
          </p>
        </div>
        <select
          value={selectedPractice}
          onChange={(e) => { setPracticeId(e.target.value); setChairId(null); setSaved(false); }}
          aria-label="Practice"
          style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}
        >
          {practices.length === 0 && <option value="">No practices</option>}
          {practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {error && (
        <div className="card-padded" style={{ marginBottom: 16, color: 'var(--danger)', fontSize: 13 }}>
          Could not load this practice&apos;s chair data: {msg(error)}
        </div>
      )}

      {isPending && !week && <Skeleton className="w-full" style={{ height: 240 }} />}

      {week && (
        <>
          <OpeningHoursPanel
            week={week}
            practiceId={selectedPractice}
            saving={saveHours.isPending}
            onSave={onSaveHours}
          />

          <ChairsPanel
            chairs={week.chairs}
            selectedId={chairId}
            onSelect={(id) => { setChairId(id); setSaved(false); }}
            onAdd={(name) => addChair.mutate({ practice_id: selectedPractice, name })}
            onRename={(id, name) => renameChair.mutate({ id, patch: { name } })}
            onRetire={(id) => retireChair.mutate(id)}
            busy={addChair.isPending}
            error={
              addChair.error ? msg(addChair.error)
                : renameChair.error ? msg(renameChair.error)
                  : retireChair.error ? msg(retireChair.error)
                    : null
            }
          />

          <div className="card-padded">
            <div className="flex items-center justify-between flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
              <h2 className="display font-bold" style={{ fontSize: 17 }}>
                {week.chairs.find((c) => c.id === chairId)?.name ?? 'This chair'} · typical week
              </h2>
              {coverageLabel && (
                <span className="text-ink-muted" style={{ fontSize: 12 }}>{coverageLabel}</span>
              )}
            </div>

            <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Enter the hours booked in each slot and what that slot earns in a typical week.
              The open time beside each box comes from your opening hours, so you never type it.
            </p>

            {chairId ? (
              <ChairWeekGrid
                week={week}
                chairId={chairId}
                saving={saveWeek.isPending}
                onSave={onSaveWeek}
              />
            ) : (
              <p className="text-ink-muted" style={{ fontSize: 13 }}>
                Add a chair above to start entering its week.
              </p>
            )}

            {saveWeek.error && (
              <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>
                Could not save: {msg(saveWeek.error)}
              </div>
            )}
            {saved && !saveWeek.isPending && !saveWeek.error && (
              <div className="text-ink-muted" style={{ fontSize: 13, marginTop: 10 }}>Week saved.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
