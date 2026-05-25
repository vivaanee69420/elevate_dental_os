'use client';
// Practice → Dentally site-id mapping. Shown on the Integrations screen once
// Dentally is connected. Synced appointments/payments resolve their practice
// via practices.pms_site_id = Dentally site_id; unmapped practices mean those
// rows are skipped (patients still sync). Owner-only on the backend.

import { useEffect, useState } from 'react';
import {
  usePractices,
  useSetPracticeSiteId,
  useDetectSiteIds,
  useCreatePractice,
  useSyncIntegration,
  useFinishSync,
} from '../hooks';
import type { DetectedSiteId } from '../api';
import SyncOverlay from './SyncOverlay';

function Row({ id, name, current, detected }: { id: string; name: string; current: string | null; detected: DetectedSiteId[] }) {
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
          list={detected.length ? `siteids-${id}` : undefined}
          style={{
            width: '100%', padding: '6px 8px', fontSize: 12,
            border: '1px solid var(--border)', borderRadius: 6,
          }}
        />
        {detected.length > 0 && (
          <datalist id={`siteids-${id}`}>
            {detected.map((d) => (
              <option key={d.site_id} value={d.site_id}>{`site ${d.site_id} (${d.count} records)`}</option>
            ))}
          </datalist>
        )}
      </td>
      <td style={{ padding: '8px 4px', width: 78 }}>
        <button
          onClick={() => save.mutate({ id, pms_site_id: value.trim() || null })}
          disabled={!dirty || save.isPending}
          style={{
            padding: '6px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6,
            border: 'none', color: 'white',
            background: dirty ? '#0E7C7B' : '#9CA3AF',
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
  const { data, isLoading } = usePractices();
  const detect = useDetectSiteIds('dentally');
  const create = useCreatePractice();
  const sync = useSyncIntegration();
  const finishSync = useFinishSync();
  const [syncing, setSyncing] = useState(false);
  const detected = detect.data?.siteIds ?? [];
  const practices = data?.practices ?? [];
  const unmapped = practices.filter((p) => !p.pms_site_id).length;

  // Site ids returned by Dentally that aren't yet attached to any practice.
  const mappedSiteIds = new Set(practices.map((p) => p.pms_site_id).filter(Boolean));
  const unprovisioned = detected.filter((d) => !mappedSiteIds.has(d.site_id));

  // Build one practice per detected-but-unmapped site (real Dentally name when
  // known), pms_site_id pre-set, then immediately re-pull so the now-mapped
  // appointments/payments land without a separate Refresh click.
  async function provisionFromSites() {
    for (const d of unprovisioned) {
      await create.mutateAsync({
        name: d.name || `Dentally site ${d.site_id.slice(0, 8)}`,
        pms_site_id: d.site_id,
      });
    }
    setSyncing(true);
    await sync.mutateAsync({ provider: 'dentally', full: true });
  }

  return (
    <div className="card-padded" style={{ marginBottom: 20 }}>
      {syncing && (
        <SyncOverlay
          provider="dentally"
          onDone={() => { finishSync(); setSyncing(false); }}
        />
      )}
      <h2 className="display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        Dentally practice mapping
      </h2>
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Match each practice to its Dentally site id. Without it, synced
        appointments and payments for that practice are skipped (patients still
        sync). Find the site id in Dentally → Settings → Sites.
        {unmapped > 0 && (
          <span style={{ color: 'var(--danger)' }}> {unmapped} unmapped.</span>
        )}
      </p>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => detect.mutate()}
          disabled={detect.isPending}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
            border: '1px solid var(--border)', background: 'white', cursor: 'pointer',
          }}
        >
          {detect.isPending ? 'Detecting…' : 'Detect site IDs'}
        </button>
        {unprovisioned.length > 0 && (
          <button
            onClick={provisionFromSites}
            disabled={create.isPending || syncing}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
              border: 'none', background: '#0E7C7B', color: 'white', cursor: 'pointer',
            }}
          >
            {create.isPending ? 'Creating…' : syncing ? 'Syncing…'
              : `Create ${unprovisioned.length} practice${unprovisioned.length > 1 ? 's' : ''} + sync`}
          </button>
        )}
        {detect.isSuccess && detected.length === 0 && (
          <span className="text-ink-muted" style={{ fontSize: 11 }}>No site ids in the sampled data.</span>
        )}
        {detected.map((d) => (
          <span key={d.site_id} className="chip" style={{ fontSize: 11 }}>
            {d.name || `site ${d.site_id.slice(0, 8)}`} · {d.count}
          </span>
        ))}
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
              <Row key={p.id} id={p.id} name={p.name} current={p.pms_site_id} detected={detected} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
