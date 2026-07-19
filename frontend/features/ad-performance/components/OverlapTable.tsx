'use client';
// The people counted under more than one channel — the reason the channel
// columns do not sum to the group total.
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
      <p className="py-2 text-sm text-slate-500">
        No one in this window was found under more than one channel.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto" style={{ maxHeight: 420 }}>
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2 pr-3 font-medium">Name</th>
            <th className="py-2 pr-3 font-medium">Email</th>
            <th className="py-2 pr-3 font-medium">Phone</th>
            <th className="py-2 pr-3 font-medium">Counted under</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.key} className="border-b border-slate-100">
              <td className="py-2 pr-3 text-slate-900">{p.name ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-600">{p.email ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-600">{p.phone ?? '—'}</td>
              <td className="py-2 pr-3 text-slate-600">
                {p.channels.map((c) => LABEL[c]).join(' + ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
