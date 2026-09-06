'use client';
// ============================================================================
// Open days — every campaign is visible immediately, grouped by ad account;
// assigning one to an event is a single dropdown change.
//
// LIVES ON THE INTEGRATIONS PAGE, in the Meta tile, beside the other mappings
// (ad account -> practice, Emergent -> practice). Mapping is setup, done once
// and rarely revisited; the Facebook report only DISPLAYS the result. Keeping
// the two apart means the report page stays a report.
//
// THE LIST IS EVERY CAMPAIGN THE ORG HAS EVER RUN, not the selected period's.
// Someone recording last November's open day is reaching for campaigns that
// stopped months ago; narrowing to the window would hide exactly the ones
// they came for. With 84 campaigns across 4 accounts that needs search and
// account grouping, which is what the filter box and the per-account
// headings below are.
//
// EVERY ROW CARRIES THE SAME SEGMENTED CONTROL THE GOHIGHLEVEL PIPELINE LIST
// USES — [ Always-on | Open day ] — because the previous dropdown offered
// "Always-on" and nothing else until an event already existed. An org with no
// events therefore saw 84 campaigns all reading Always-on with no way to
// change any of them: the control looked live and was inert. Marking the first
// campaign now CREATES the first event, so the feature works from cold.
// ============================================================================
import { useMemo, useState } from 'react';
import { SkeletonTable } from '@/components/ui';
import { money0 } from '@/features/marketing/_shared/format';
import type { OpenDayCampaignOption } from '@/features/marketing/facebook/api';
import {
  useOpenDays, useCreateOpenDay, useUpdateOpenDay, useDeleteOpenDay,
  useSetOpenDayCampaign,
} from '@/features/marketing/facebook/hooks';

// An account with no name is a real state (the account row was removed but
// its metrics remain), and blank reads as a rendering bug.
const DASH_ACCOUNT = 'Unknown account';

// Placeholder name for the first event, created when somebody marks a campaign
// before naming any event. Deliberately NOT read off the campaign name — a
// name derived from the data is a guess; this is a label the owner renames.
const FIRST_EVENT_NAME = 'Open day';

interface AccountGroup {
  key: string;
  accountName: string;
  spendPence: number;
  campaigns: OpenDayCampaignOption[];
}

// Same shape as ChannelButtons in PipelineChannelStep, deliberately: marking a
// Meta campaign and marking a GoHighLevel pipeline are the same act, so they
// should not be two different controls.
function MarkButtons({ isOpenDay, busy, onSet }: {
  isOpenDay: boolean;
  busy: boolean;
  onSet: (openDay: boolean) => void;
}) {
  const options = [
    { value: false, label: 'Always-on' },
    { value: true, label: 'Open day' },
  ];
  return (
    <span className="inline-flex overflow-hidden rounded border border-slate-300">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          disabled={busy}
          onClick={() => onSet(o.value)}
          className={`px-2 py-1 text-[12px] ${
            isOpenDay === o.value
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

export default function OpenDaysPanel() {
  const { data, isLoading } = useOpenDays();
  const create = useCreateOpenDay();
  const update = useUpdateOpenDay();
  const remove = useDeleteOpenDay();
  const setCampaign = useSetOpenDayCampaign();

  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // Accounts are closed until clicked: the panel answers "what is in THIS ad
  // account", not "here are all 84 campaigns at once", which is what the flat
  // list it replaces actually did.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Marking works from cold: with no events yet, the first mark CREATES one.
  // open_day_id is NOT NULL and a foreign key, so without this the button
  // would have nothing to write to and would silently do nothing.
  async function ensureOpenDayId(preferred: string | null): Promise<string> {
    if (preferred) return preferred;
    const existing = data?.openDays?.[0]?.id;
    if (existing) return existing;
    const made = await create.mutateAsync({ name: FIRST_EVENT_NAME, eventDate: null });
    return (made as unknown as { id: string }).id;
  }

  async function mark(c: OpenDayCampaignOption, openDay: boolean, suggestedId: string | null = null) {
    setBusy(c.campaignId);
    setError(null);
    try {
      await setCampaign.mutateAsync({
        campaignId: c.campaignId,
        customerId: c.customerId,
        openDayId: openDay ? await ensureOpenDayId(suggestedId) : null,
      });
    } catch (e) {
      setError(`${c.campaignName ?? c.campaignId}: ${(e as Error).message || 'Could not save that change.'}`);
    } finally {
      setBusy(null);
    }
  }

  // Every campaign, filtered by the search box, grouped by account. Accounts
  // order by total spend descending; within an account, campaigns order by
  // last-active descending — the same "most recent first" rule the
  // suggestions block above uses.
  const accounts = useMemo<AccountGroup[]>(() => {
    const q = filter.trim().toLowerCase();
    const rows = (data?.campaigns ?? []).filter((c) => !q
      || (c.campaignName ?? '').toLowerCase().includes(q)
      || (c.accountName ?? '').toLowerCase().includes(q));

    const byAccount = new Map<string, AccountGroup>();
    for (const c of rows) {
      const key = c.customerId ?? c.accountName ?? 'unknown';
      if (!byAccount.has(key)) {
        byAccount.set(key, { key, accountName: c.accountName ?? DASH_ACCOUNT, spendPence: 0, campaigns: [] });
      }
      const group = byAccount.get(key)!;
      group.spendPence += c.spendPence;
      group.campaigns.push(c);
    }
    const groups = [...byAccount.values()];
    for (const g of groups) {
      g.campaigns.sort((a, b) => String(b.lastDay ?? '').localeCompare(String(a.lastDay ?? '')));
    }
    groups.sort((a, b) => b.spendPence - a.spendPence);
    return groups;
  }, [data?.campaigns, filter]);

  // A hit inside a closed account would read as no result, so searching opens
  // every account.
  const searching = filter.trim().length > 0;
  const isOpen = (key: string) => searching || Boolean(opened[key]);

  if (isLoading) return <SkeletonTable rows={4} />;

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

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {/* --- the events ---------------------------------------------------- */}
      <div className="flex flex-col gap-2">
        {(data?.openDays ?? []).map((d) => (
          <div key={d.id} className="flex items-center gap-3 text-[13px]">
            <span className="px-3 py-1.5 rounded-lg border border-border">{d.name}</span>
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

      {/* --- every campaign, grouped by account ----------------------------- */}
      <div className="flex flex-col gap-3 border-t border-border pt-3">
        <p className="text-[13px]">
          Open an ad account to see its campaigns, then mark each one Always-on or
          Open day.
        </p>
        <input
          className="border border-border rounded-lg px-3 py-1.5 text-[13px]"
          placeholder="Search campaigns or accounts"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="max-h-[28rem] overflow-y-auto flex flex-col gap-2">
          {accounts.map((group) => (
            <div key={group.key} className="rounded border border-border">
              <button
                type="button"
                onClick={() => setOpened((o) => ({ ...o, [group.key]: !isOpen(group.key) }))}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="text-[12px] text-ink-2">{isOpen(group.key) ? '\u25be' : '\u25b8'}</span>
                <span className="text-[13px] font-medium">{group.accountName}</span>
                <span className="text-[12px] text-ink-2">
                  {group.campaigns.length} campaign{group.campaigns.length === 1 ? '' : 's'}
                </span>
                <span className="ml-auto text-[12px] text-ink-2">{money0(group.spendPence)}</span>
              </button>
              <div className={`flex-col gap-1 px-3 pb-2 ${isOpen(group.key) ? 'flex' : 'hidden'}`}>
              {group.campaigns.map((c) => (
                <div key={c.campaignId} className="flex items-center gap-2 text-[13px] py-0.5">
                  <span className="flex-1">{c.campaignName ?? c.campaignId}</span>
                  <span className="text-ink-2 whitespace-nowrap">{c.lastDay ?? ''} · {money0(c.spendPence)}</span>
                  <MarkButtons
                    isOpenDay={Boolean(data?.assignedTo[c.campaignId])}
                    busy={busy === c.campaignId}
                    onSet={(v) => mark(c, v)}
                  />
                  {/* WHICH event — shown only once the campaign IS an open
                      day, so it can never be the only way in. */}
                  {data?.assignedTo[c.campaignId] && (data?.openDays.length ?? 0) > 1 && (
                    <select
                      className="border border-border rounded-lg px-2 py-1 text-[13px]"
                      value={data.assignedTo[c.campaignId]}
                      disabled={setCampaign.isPending}
                      onChange={(e) => setCampaign.mutate({
                        campaignId: c.campaignId,
                        customerId: c.customerId,
                        openDayId: e.target.value || null,
                      })}
                    >
                      {(data?.openDays ?? []).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
              </div>
            </div>
          ))}
          {accounts.length === 0 && (
            <p className="text-[13px] text-ink-2">No campaign matches that search.</p>
          )}
        </div>
      </div>
    </div>
  );
}
