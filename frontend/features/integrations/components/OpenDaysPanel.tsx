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
// No event has to exist first and no chip has to be clicked: every campaign
// row carries its own "Always-on"-or-event dropdown, so an owner can see and
// categorise all 84 campaigns without inventing an event to unlock them.
// ============================================================================
import { useMemo, useState } from 'react';
import { SkeletonTable } from '@/components/ui';
import { money0 } from '@/features/marketing/_shared/format';
import type { OpenDayCampaignOption } from '@/features/marketing/facebook/api';
import {
  useOpenDays, useCreateOpenDay, useUpdateOpenDay, useDeleteOpenDay,
  useSetOpenDayCampaigns, useSetOpenDayCampaign,
} from '@/features/marketing/facebook/hooks';

// An account with no name is a real state (the account row was removed but
// its metrics remain), and blank reads as a rendering bug.
const DASH_ACCOUNT = 'Unknown account';

interface AccountGroup {
  key: string;
  accountName: string;
  spendPence: number;
  campaigns: OpenDayCampaignOption[];
}

export default function OpenDaysPanel() {
  const { data, isLoading } = useOpenDays();
  const create = useCreateOpenDay();
  const update = useUpdateOpenDay();
  const remove = useDeleteOpenDay();
  const setCampaigns = useSetOpenDayCampaigns();
  const setCampaign = useSetOpenDayCampaign();

  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [filter, setFilter] = useState('');

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
          All campaigns — pick an open day for each, or leave it Always-on.
        </p>
        <input
          className="border border-border rounded-lg px-3 py-1.5 text-[13px]"
          placeholder="Search campaigns or accounts"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="max-h-96 overflow-y-auto flex flex-col gap-3">
          {accounts.map((group) => (
            <div key={group.key} className="flex flex-col gap-1">
              <p className="text-[13px] font-medium text-ink-2">
                {group.accountName} ({group.campaigns.length})
              </p>
              {group.campaigns.map((c) => (
                <div key={c.campaignId} className="flex items-center gap-2 text-[13px] py-0.5">
                  <span className="flex-1">{c.campaignName ?? c.campaignId}</span>
                  <span className="text-ink-2 whitespace-nowrap">{c.lastDay ?? ''} · {money0(c.spendPence)}</span>
                  <select
                    className="border border-border rounded-lg px-2 py-1 text-[13px]"
                    value={data?.assignedTo[c.campaignId] ?? ''}
                    disabled={setCampaign.isPending}
                    onChange={(e) => setCampaign.mutate({
                      campaignId: c.campaignId,
                      customerId: c.customerId,
                      openDayId: e.target.value || null,
                    })}
                  >
                    <option value="">Always-on</option>
                    {(data?.openDays ?? []).map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              ))}
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
