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
  useFinishSync,
} from '../hooks';
import SyncOverlay from './SyncOverlay';

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
  const { data, isLoading } = usePractices();
  const sync = useSyncIntegration();
  const finishSync = useFinishSync();
  const [syncing, setSyncing] = useState(false);
  const practices = data?.practices ?? [];
  const unmapped = practices.filter((p) => !p.pms_site_id).length;

  // Pull all history (full backfill). The on-connect pull only fetches the last
  // 24 months; this re-pulls everything for practices that want the full record.
  async function pullFullHistory() {
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
        Your practices were detected and mapped automatically on connect. We pull
        the last 24 months straight away; older history syncs overnight, or you
        can pull it all now. Each practice must stay matched to its Dentally site
        id — without it, that practice&apos;s appointments and payments are
        skipped (patients still sync).
        {unmapped > 0 && (
          <span style={{ color: 'var(--danger)' }}> {unmapped} unmapped.</span>
        )}
      </p>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={pullFullHistory}
          disabled={syncing}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6,
            border: 'none', background: 'var(--brand)', color: 'white',
            cursor: syncing ? 'default' : 'pointer',
          }}
        >
          {syncing ? 'Pulling…' : 'Pull full history'}
        </button>
        <span className="text-ink-muted" style={{ fontSize: 11 }}>
          Optional — pulls all-time data, can take a few minutes.
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
    </div>
  );
}
