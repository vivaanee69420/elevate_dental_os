'use client';
// ============================================================================
// Open days — create an event, then tick the campaigns that promoted it.
//
// LIVES ON THE INTEGRATIONS PAGE, in the Meta tile, beside the other mappings
// (ad account -> practice, Emergent -> practice). Mapping is setup, done once
// and rarely revisited; the Facebook report only DISPLAYS the result. Keeping
// the two apart means the report page stays a report.
//
// THE PICK LIST IS EVERY CAMPAIGN THE ORG HAS EVER RUN, not the selected
// period's. Someone recording last November's open day is reaching for
// campaigns that stopped months ago; narrowing to the window would hide
// exactly the ones they came for. With 84 campaigns across 4 accounts that
// needs search and account grouping, which is what the filter box below is.
//
// A campaign already mapped to ANOTHER event shows that event's name and moves
// on save rather than erroring — the backend upserts on the primary key. The
// label matters: without it an owner silently steals a campaign from April's
// numbers while looking at July's.
// ============================================================================
import { useMemo, useState } from 'react';
import { SkeletonTable } from '@/components/ui';
import { money0 } from '@/features/marketing/_shared/format';
import {
  useOpenDays, useCreateOpenDay, useUpdateOpenDay, useDeleteOpenDay, useSetOpenDayCampaigns,
} from '@/features/marketing/facebook/hooks';

export default function OpenDaysPanel() {
  const { data, isLoading } = useOpenDays();
  const create = useCreateOpenDay();
  const update = useUpdateOpenDay();
  const remove = useDeleteOpenDay();
  const setCampaigns = useSetOpenDayCampaigns();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [filter, setFilter] = useState('');
  // Local tick state, seeded from the server the first time an event is
  // opened. Kept separate so ticking twenty boxes is not twenty requests.
  const [ticked, setTicked] = useState<Set<string> | null>(null);

  const selected = data?.openDays.find((d) => d.id === selectedId) ?? null;

  // Unmapped campaigns, newest activity first — a new open-day campaign lands
  // at the top the day after its first spend. `suggestions` pre-ticks; nothing
  // is written until Confirm.
  const unmapped = useMemo(() => (data?.campaigns ?? [])
    .filter((c) => !data?.assignedTo[c.campaignId])
    .sort((a, b) => String(b.lastDay ?? '').localeCompare(String(a.lastDay ?? ''))),
  [data]);
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const proposed = { ...(data?.suggestions ?? {}), ...confirmed };

  const confirmSuggestions = async () => {
    // One request per affected event: setCampaigns replaces an event's whole
    // set, so the existing ids must be sent alongside the new ones or the
    // confirm would unmap everything already there.
    const byEvent = new Map<string, string[]>();
    for (const [campaignId, eventId] of Object.entries(proposed)) {
      if (!eventId) continue;
      if (!byEvent.has(eventId)) {
        byEvent.set(eventId, [...(data?.openDays.find((d) => d.id === eventId)?.campaignIds ?? [])]);
      }
      byEvent.get(eventId)!.push(campaignId);
    }
    const byId = new Map((data?.campaigns ?? []).map((c) => [c.campaignId, c]));
    for (const [eventId, ids] of byEvent) {
      await setCampaigns.mutateAsync({
        id: eventId,
        campaigns: [...new Set(ids)].map((id) => ({
          campaign_id: id, customer_id: byId.get(id)?.customerId ?? null,
        })),
      });
    }
    setConfirmed({});
  };

  const openEvent = (id: string) => {
    setSelectedId(id);
    const ev = data?.openDays.find((d) => d.id === id);
    setTicked(new Set(ev?.campaignIds ?? []));
  };

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = data?.campaigns ?? [];
    if (!q) return rows;
    return rows.filter((c) =>
      (c.campaignName ?? '').toLowerCase().includes(q)
      || (c.accountName ?? '').toLowerCase().includes(q));
  }, [data?.campaigns, filter]);

  if (isLoading) return <SkeletonTable rows={4} />;

  const save = async () => {
    if (!selected || !ticked) return;
    const byId = new Map((data?.campaigns ?? []).map((c) => [c.campaignId, c]));
    await setCampaigns.mutateAsync({
      id: selected.id,
      campaigns: [...ticked].map((id) => ({
        campaign_id: id,
        customer_id: byId.get(id)?.customerId ?? null,
      })),
    });
    setSelectedId(null);
    setTicked(null);
  };

  return (
    <div className="flex flex-col gap-4 border border-border rounded-xl p-4 bg-card">
      <div>
        <h3 className="text-[15px] font-medium">Open days</h3>
        <p className="text-[13px] text-ink-2">
          Mark which campaigns promoted an open day and the Facebook report will
          show it separately from your always-on advertising. Ignore this if you
          do not run open days — nothing else changes.
        </p>
      </div>

      {/* --- new since you last mapped, with suggestions -------------------- */}
      {unmapped.length > 0 && (
        <div className="flex flex-col gap-2 border-b border-border pb-3">
          <p className="text-[13px] font-medium">New since you last mapped ({unmapped.length})</p>
          {unmapped.slice(0, 20).map((c) => (
            <label key={c.campaignId} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={Boolean(proposed[c.campaignId])}
                onChange={(e) => setConfirmed((v) => ({
                  ...v,
                  [c.campaignId]: e.target.checked
                    ? (proposed[c.campaignId] ?? data?.openDays[0]?.id ?? '')
                    : '',
                }))}
              />
              <span className="flex-1">{c.campaignName ?? c.campaignId}</span>
              <span className="text-ink-2">{c.accountName ?? DASH_ACCOUNT} · {c.lastDay ?? ''}</span>
              {data?.suggestions?.[c.campaignId] && (
                <span className="text-[12px] text-brand">
                  suggested: {data.openDays.find((d) => d.id === data.suggestions[c.campaignId])?.name}
                </span>
              )}
            </label>
          ))}
          <button
            type="button"
            className="self-start px-3 py-1.5 rounded-lg bg-brand text-white text-[13px] disabled:opacity-50"
            disabled={Object.values(proposed).filter(Boolean).length === 0 || setCampaigns.isPending}
            onClick={confirmSuggestions}
          >
            Confirm {Object.values(proposed).filter(Boolean).length} mapping(s)
          </button>
        </div>
      )}

      {/* --- the events ---------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        {(data?.openDays ?? []).map((d) => (
          <div key={d.id} className="flex items-center gap-3 text-[13px]">
            <button
              type="button"
              className={`px-3 py-1.5 rounded-lg border ${selectedId === d.id ? 'border-brand text-brand' : 'border-border'}`}
              onClick={() => openEvent(d.id)}
            >
              {d.name}
            </button>
            <span className="text-ink-2">
              {d.eventDate ?? 'no date'} · {d.campaignIds.length} campaign
              {d.campaignIds.length === 1 ? '' : 's'}
            </span>
            <input
              type="date"
              className="border border-border rounded-lg px-2 py-1"
              value={d.eventDate ?? ''}
              onChange={(e) => update.mutate({ id: d.id, eventDate: e.target.value || null })}
            />
            <button
              type="button"
              className="text-ink-2 underline"
              // Deleting an event returns its campaigns to always-on rather
              // than stranding them (ON DELETE CASCADE on the mapping).
              onClick={() => remove.mutate(d.id)}
            >
              Delete
            </button>
          </div>
        ))}
        {(data?.openDays ?? []).length === 0 && (
          <p className="text-[13px] text-ink-2">No open days recorded yet.</p>
        )}
      </div>

      {/* --- create -------------------------------------------------------- */}
      <div className="flex items-center gap-2">
        <input
          className="border border-border rounded-lg px-3 py-1.5 text-[13px]"
          placeholder="Open day name, e.g. July 26"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <input
          type="date"
          className="border border-border rounded-lg px-2 py-1.5 text-[13px]"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
        />
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg bg-brand text-white text-[13px] disabled:opacity-50"
          disabled={!newName.trim() || create.isPending}
          onClick={async () => {
            await create.mutateAsync({ name: newName.trim(), eventDate: newDate || null });
            setNewName('');
            setNewDate('');
          }}
        >
          Add open day
        </button>
      </div>

      {/* --- campaign picker ----------------------------------------------- */}
      {selected && ticked && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px]">
              Campaigns that promoted <strong>{selected.name}</strong>
            </p>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-brand text-white text-[13px] disabled:opacity-50"
              disabled={setCampaigns.isPending}
              onClick={save}
            >
              Save {ticked.size} campaign{ticked.size === 1 ? '' : 's'}
            </button>
          </div>
          <input
            className="border border-border rounded-lg px-3 py-1.5 text-[13px]"
            placeholder="Search campaigns or accounts"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="max-h-80 overflow-y-auto flex flex-col gap-1">
            {visible.map((c) => {
              const otherId = data?.assignedTo[c.campaignId];
              const elsewhere = otherId && otherId !== selected.id
                ? data?.openDays.find((d) => d.id === otherId)?.name ?? null
                : null;
              return (
                <label key={c.campaignId} className="flex items-center gap-2 text-[13px] py-0.5">
                  <input
                    type="checkbox"
                    checked={ticked.has(c.campaignId)}
                    onChange={(e) => {
                      const next = new Set(ticked);
                      if (e.target.checked) next.add(c.campaignId);
                      else next.delete(c.campaignId);
                      setTicked(next);
                    }}
                  />
                  <span className="flex-1">{c.campaignName ?? c.campaignId}</span>
                  <span className="text-ink-2">
                    {c.accountName ?? DASH_ACCOUNT} · {c.lastDay ?? ''} · {money0(c.spendPence)}
                  </span>
                  {elsewhere && (
                    <span className="text-[12px] text-amber-700">now in {elsewhere}</span>
                  )}
                </label>
              );
            })}
            {visible.length === 0 && (
              <p className="text-[13px] text-ink-2">No campaign matches that search.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// An account with no name is a real state (the account row was removed but its
// metrics remain), and blank reads as a rendering bug.
const DASH_ACCOUNT = 'Unknown account';
