'use client';
// The people counted under more than one channel — the reason the channel
// columns do not sum to the group total.
import { cockpitStyles as s } from '@/components/ui';
import type { OverlapPerson } from '../derive';
import type { PerfChannel } from '../api';

const LABEL: Record<PerfChannel, string> = {
  google_ads: 'Google',
  meta_ads: 'Facebook',
  unassigned: 'Unassigned',
};

export function OverlapTable({ people }: { people: OverlapPerson[] }) {
  if (people.length === 0) {
    return (
      <p className={s.subtle} style={{ fontSize: 13 }}>
        No one in this window was found under more than one channel.
      </p>
    );
  }
  return (
    <div className={s.scrollX} style={{ maxHeight: 420 }}>
      <table className={s.table} style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Counted under</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.key}>
              <td>{p.name ?? '—'}</td>
              <td>{p.email ?? '—'}</td>
              <td>{p.phone ?? '—'}</td>
              <td>{p.channels.map((c) => LABEL[c]).join(' + ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
