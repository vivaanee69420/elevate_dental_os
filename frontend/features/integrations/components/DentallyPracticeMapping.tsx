'use client';
// Practice → Dentally site-id mapping. Shown on the Integrations screen once
// Dentally is connected.
//
// On connect, the backend already detects the Dentally sites, auto-creates a
// practice for each, maps the site_id, and pulls the last 24 months — so this
// panel is normally just a confirmation/correction view. Synced
// appointments/payments resolve their practice via practices.pms_site_id =
// Dentally site_id; an unmapped practice means those rows are skipped (patients
// still sync). Owner-only on the backend.

import { useEffect, useState } from 'react';
import {
  usePractices,
  useSetPracticeSiteId,
  useSyncIntegration,
} from '../hooks';
import type { DentallySyncResource } from '../api';
import { useSyncToast } from '../sync-toast';
import PanelCard from './PanelCard';
import { useMe, isAgencyActor } from '@/hooks/useMe';

// Selectable Dentally collections for a scoped backfill. Order = pull order.
const SYNC_RESOURCES: { key: DentallySyncResource; label: string }[] = [
  { key: 'patients', label: 'Patients' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'payments', label: 'Payments' },
  { key: 'treatment_plans', label: 'Treatment plans' },
  { key: 'invoices', label: 'Invoices' },
];

function Row({ id, name, current }: { id: string; name: string; current: string | null }) {
  const save = useSetPracticeSiteId();
  const [value, setValue] = useState(current ?? '');
  useEffect(() => { setValue(current ?? ''); }, [current]);
  const dirty = (value.trim() || null) !== (current ?? null);

  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 4px', fontSize: 13 }}>{name}</td>
      <td style={{ padding: '8px 4px' }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Dentally site id"
          style={{
            width: '100%', padding: '6px 8px', fontSize: 12,
            border: '1px solid var(--border)', borderRadius: 6,
          }}
        />
      </td>
      <td style={{ padding: '8px 4px', width: 78 }}>
        <button
          onClick={() => save.mutate({ id, pms_site_id: value.trim() || null })}
          disabled={!dirty || save.isPending}
          style={{
            padding: '6px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6,
            border: 'none', color: 'white',
            background: dirty ? 'var(--brand)' : '#9CA3AF',
            cursor: dirty && !save.isPending ? 'pointer' : 'default',
          }}
        >
          {save.isPending ? '…' : 'Save'}
        </button>
      </td>
    </tr>
  );
}

export default function DentallyPracticeMapping() {
  const { data: me } = useMe();
  const { data, isLoading } = usePractices();
  const sync = useSyncIntegration();
  // Global sync toast — survives navigation. `syncing` drives button state.
  const { start: startSyncToast, active } = useSyncToast();
  const syncing = active.has('dentally');
  // Which collections to pull. Default = all (the full backfill). Untick the
  // heavy ones (payments/invoices) for a fast, scoped pull — e.g. patients only.
  const [selected, setSelected] = useState<Set<DentallySyncResource>>(
    () => new Set(SYNC_RESOURCES.map((r) => r.key)),
  );
  const practices = data?.practices ?? [];
  const unmapped = practices.filter((p) => !p.pms_site_id).length;
  const allSelected = selected.size === SYNC_RESOURCES.length;

  function toggle(key: DentallySyncResource) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Pull history (full backfill), scoped to the ticked collections. The
  // on-connect pull only fetches the last 24 months; this re-pulls everything.
  // When everything is ticked we send no `resources` so the backend takes the
  // unscoped path (keeps its mid-backfill resume checkpoint); a partial pick
  // sends the explicit list.
  async function pullFullHistory() {
    if (!selected.size) return;
    startSyncToast('dentally');
    const resources = allSelected
      ? undefined
      : SYNC_RESOURCES.map((r) => r.key).filter((k) => selected.has(k));
    await sync.mutateAsync({ provider: 'dentally', full: true, resources });
  }

  // Practice mapping is an agency-actor power (A2) — hide the whole panel.
  if (!isAgencyActor(me)) return null;

  return (
    <PanelCard
      title="Dentally practice mapping"
      badge={unmapped > 0 ? (
        <span style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>{unmapped} unmapped</span>
      ) : undefined}
    >
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Your practices were detected and mapped automatically on connect. We pull
        the last 24 months straight away; older history syncs overnight, or you
        can pull it all now. Each practice must stay matched to its Dentally site
        id — without it, that practice&apos;s appointments and payments are
        skipped (patients still sync).
        {unmapped > 0 && (
          <span style={{ color: 'var(--danger)' }}> {unmapped} unmapped.</span>
        )}
      </p>

      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {SYNC_RESOURCES.map((r) => (
          <label
            key={r.key}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={selected.has(r.key)}
              disabled={syncing}
              onChange={() => toggle(r.key)}
            />
            {r.label}
          </label>
        ))}
      </div>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={pullFullHistory}
          disabled={syncing || selected.size === 0}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
            border: 'none', background: 'var(--brand)', color: 'white',
            cursor: syncing || selected.size === 0 ? 'default' : 'pointer',
            opacity: selected.size === 0 ? 0.6 : 1,
          }}
        >
          {syncing ? 'Pulling…' : allSelected ? 'Pull full history' : 'Pull selected'}
        </button>
        <span className="text-ink-muted" style={{ fontSize: 11 }}>
          {allSelected
            ? 'Optional — pulls all-time data, can take a few minutes.'
            : 'Pulls only the ticked collections — faster than a full backfill.'}
        </span>
      </div>

      {isLoading ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>Loading…</div>
      ) : practices.length === 0 ? (
        <div className="text-ink-muted" style={{ fontSize: 13 }}>No practices yet.</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-ink-muted" style={{ textAlign: 'left', fontSize: 11 }}>
              <th style={{ padding: '4px' }}>Practice</th>
              <th style={{ padding: '4px' }}>Dentally site id</th>
              <th style={{ padding: '4px' }} />
            </tr>
          </thead>
          <tbody>
            {practices.map((p) => (
              <Row key={p.id} id={p.id} name={p.name} current={p.pms_site_id} />
            ))}
          </tbody>
        </table>
      )}
    </PanelCard>
  );
}
