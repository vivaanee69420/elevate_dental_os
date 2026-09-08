'use client';
// CRM Today — live work queue derived from real leads + messages:
//   • New leads today      (leads created today, still open)
//   • Needs follow-up      (open leads not yet progressed, oldest first)
//   • Recent messages      (inbound communications, newest first)
// Replaces the mock task generator.

import { useMemo, useState } from 'react';
import { useLeads, useTodayCounters } from '@/features/leads/hooks';
import { useCommunications } from '../hooks';
import type { Lead } from '@/features/leads/api';
import type { Communication } from '../api';
import { agoLabel } from '../data';
import { DASH } from '@/features/marketing/_shared/format';
import { KpiTile, PageHeader } from '@/components/ui';
import { LeadDetailModal } from '../_shared/LeadDetailModal';

import { useGhlAccounts } from '@/features/integrations/hooks';
import { SubaccountFilterBar } from '@/features/ghl/components/SubaccountFilterBar';

type Selected = { kind: 'lead'; lead: Lead } | { kind: 'msg'; comm: Communication };

// Lookback window for the "New leads" list. 'recent' = since the start of
// yesterday (buffers the nightly GHL sync lag); the rest are rolling day counts.
type WindowKey = 'today' | 'recent' | '7d' | '30d' | 'all';
const WINDOWS: { key: WindowKey; label: string; days: number }[] = [
  { key: 'today', label: 'Today', days: 0 },
  { key: 'recent', label: 'Since yesterday', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', days: Infinity },
];

const OPEN_FOLLOWUP: Lead['status'][] = ['new', 'contact_attempted', 'contact_made'];
const CLOSED: Lead['status'][] = ['not_proceeding', 'treatment_completed', 'failed_to_attend'];

function nameOf(l: Lead): string {
  const n = `${l.contact?.first_name ?? ''} ${l.contact?.last_name ?? ''}`.trim();
  return n || `Lead ${l.id.slice(0, 8)}`;
}
function minsSince(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 60_000));
}
function stripJunk(s: string | null): string {
  if (!s) return '';
  return s.replace(/If you no longer wish to receive these emails[\s\S]*$/i, '')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/\b(undefined|null)\b/g, 'N/A')
    .replace(/\s{2,}/g, ' ').trim();
}

export default function TodayScreen() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data: ghlData } = useGhlAccounts();

  // THE LISTS are a page; THE COUNTERS are not. This fetch feeds the three
  // lists below, which are bounded by design. The headline counters come from
  // an SQL aggregate over every lead (useTodayCounters), because counting this
  // page made "Active leads" read 500 — its own page size — against a true
  // 17,778, and made "Needs follow-up" the oldest of the NEWEST 500, which is
  // never an actually old lead.
  const { data: leadData, isLoading } = useLeads({
    limit: 500,
    ...(accountId ? { integration_account_id: accountId } : {}),
  });
  const { data: commData } = useCommunications({
    ...(accountId ? { integration_account_id: accountId } : {}),
  });
  const leads: Lead[] = leadData?.leads ?? [];
  const comms = commData?.communications ?? [];
  const [selected, setSelected] = useState<Selected | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>('recent');

  // ONE window start, shared by the counters and the lists beneath them, so
  // the two can never disagree about where "today" begins.
  const sinceIso = useMemo(() => {
    const days = WINDOWS.find((w) => w.key === windowKey)?.days ?? 1;
    if (!Number.isFinite(days)) return null;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days);
    return start.toISOString();
  }, [windowKey]);

  const { data: counters } = useTodayCounters({ since: sinceIso, accountId });

  const { newLeads, followUps, messages } = useMemo(() => {
    // Window start = local midnight minus N days. 'recent' (N=1) buffers the
    // nightly GHL sync lag: leads land ~22:00 carrying GHL's real createdAt, so
    // a strict calendar-today filter reads 0 every morning even when leads
    // flowed overnight. 'all' (N=Infinity) treats every open lead as new.
    const startMs = sinceIso ? new Date(sinceIso).getTime() : 0;

    const open = leads.filter((l) => !CLOSED.includes(l.status));
    const newLeads = open
      .filter((l) => new Date(l.created_at).getTime() >= startMs)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const followUps = open
      .filter((l) => OPEN_FOLLOWUP.includes(l.status) && new Date(l.created_at).getTime() < startMs)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)) // oldest first
      .slice(0, 25);
    const messages = comms
      .filter((c) => c.direction === 'inbound')
      .slice(0, 20);
    return { newLeads, followUps, messages };
  }, [leads, comms, sinceIso]);

  const windowLabel = WINDOWS.find((w) => w.key === windowKey)?.label ?? 'Recent';
  // Every figure here is server-aggregated. `newLeads.length` and friends are
  // the lengths of bounded lists and must never be presented as counts.
  const counterCards: { label: string; value: number | undefined; info: string }[] = [
    { label: `New leads · ${windowLabel}`, value: counters?.new_leads,
      info: 'Open leads created inside the selected window. Counted in SQL over every lead, not the page listed below.' },
    { label: 'Needs follow-up', value: counters?.follow_ups,
      info: 'Open leads older than the window that are still at new, contact attempted or contact made. The list shows the oldest 25; this counts all of them.' },
    { label: `Messages in · ${windowLabel}`, value: counters?.inbound_messages,
      info: 'Inbound messages received inside the selected window, across every channel.' },
    { label: 'Active leads', value: counters?.active_leads,
      info: 'Every open lead, regardless of when it arrived — not marked not-proceeding, treatment-completed or failed-to-attend.' },
  ];

  return (
    <div className="mx-auto space-y-4" style={{ maxWidth: 1280 }}>
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <PageHeader
          title="Today"
          subtitle={isLoading || !counters
            ? 'Loading…'
            : `${counters.new_leads.toLocaleString('en-GB')} new leads · `
              + `${counters.follow_ups.toLocaleString('en-GB')} to follow up · `
              + `${counters.inbound_messages.toLocaleString('en-GB')} messages in`}
        />
        <select
          value={windowKey}
          onChange={(e) => setWindowKey(e.target.value as WindowKey)}
          aria-label="New leads window"
          style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 13, background: 'white', cursor: 'pointer' }}
        >
          {WINDOWS.map((w) => (
            <option key={w.key} value={w.key}>{w.label}</option>
          ))}
        </select>
      </div>

      {ghlData && ghlData.accounts.length > 0 && (
        <SubaccountFilterBar
          accounts={ghlData.accounts.map((a) => ({
            accountId: a.id,
            label: a.label || 'GoHighLevel',
            practiceId: a.practice_id ?? null,
          })) as any}
          selected={accountId}
          onSelect={setAccountId}
        />
      )}

      {/* KpiTile: the product-wide headline card, so Today matches every other
          section instead of carrying its own stat styling. Each tile explains
          what it counts, because three of these four numbers were wrong for
          months and looked entirely plausible. */}
      <div className="grid gap-3 mb-5 sm:grid-cols-2 lg:grid-cols-4">
        {counterCards.map((s) => (
          <KpiTile
            key={s.label}
            label={s.label}
            // An em dash while loading, never a placeholder 0 — a zero that
            // later becomes 17,778 was a wrong answer, not a loading state.
            value={s.value === undefined ? DASH : s.value.toLocaleString('en-GB')}
            info={s.info}
          />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Section title={`New leads · ${windowLabel}`} empty="No new leads in this window.">
          {newLeads.map((l) => (
            <Row key={l.id} title={nameOf(l)} sub={l.ghl_stage_name ?? undefined} tag={l.source ?? undefined} ago={agoLabel(minsSince(l.created_at))} onClick={() => setSelected({ kind: 'lead', lead: l })} />
          ))}
        </Section>
        <Section title="Needs follow-up" empty="Nothing to follow up.">
          {followUps.map((l) => (
            <Row key={l.id} title={nameOf(l)} sub={l.status.replace(/_/g, ' ')} ago={agoLabel(minsSince(l.created_at))} onClick={() => setSelected({ kind: 'lead', lead: l })} />
          ))}
        </Section>
      </div>

      <div style={{ marginTop: 14 }}>
        <Section title="Recent messages" empty="No recent inbound messages.">
          {messages.map((m) => (
            <Row
              key={m.id}
              title={`${m.contact?.first_name ?? ''} ${m.contact?.last_name ?? ''}`.trim() || 'Unknown'}
              sub={stripJunk(m.body)}
              tag={m.channel}
              ago={agoLabel(minsSince(m.created_at))}
              onClick={() => setSelected({ kind: 'msg', comm: m })}
            />
          ))}
        </Section>
      </div>

      {/* Leads use the shared dialog, so "what does a lead say" is defined
          once. Two copies would be two places to forget that
          `leads.treatment` must never be rendered. Messages keep the local
          modal below — a message is a different thing. */}
      {selected?.kind === 'lead' && (
        <LeadDetailModal lead={selected.lead} onClose={() => setSelected(null)} />
      )}
      {selected?.kind === 'msg' && <MessageDetailModal comm={selected.comm} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <span className="text-ink-muted">{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// Messages only. Leads use the shared LeadDetailModal — this used to serve
// both, and its lead branch is gone rather than left unreachable, so there is
// no second copy of the lead fields to drift or to reintroduce
// `leads.treatment`.
function MessageDetailModal({ comm, onClose }: { comm: Communication; onClose: () => void }) {
  const title = `${comm.contact?.first_name ?? ''} ${comm.contact?.last_name ?? ''}`.trim() || 'Unknown';
  return (
    <div
      onClick={onClose}
      role="presentation"
      className="crm-overlay fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Message from ${title}`}
        className="crm-dialog card-padded relative max-h-[85vh] w-full max-w-[520px] overflow-y-auto bg-card shadow-panel"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-2.5 rounded-md px-1.5 text-xl leading-none text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          ×
        </button>
        <h3 className="mb-3 pr-8 text-lg font-bold">{title}</h3>
        <Field label="Email" value={comm.contact?.email} />
        <Field label="Channel" value={comm.channel} />
        <Field label="Direction" value={comm.direction} />
        <Field label="Received" value={new Date(comm.created_at).toLocaleString('en-GB')} />
        <div style={{ marginTop: 12 }}>
          <div className="text-ink-muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Message</div>
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{stripJunk(comm.body) || '(empty)'}</div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const has = items.filter(Boolean).length > 0;
  return (
    <div className="card-padded">
      <h2 className="display font-bold" style={{ fontSize: 16, marginBottom: 10 }}>{title}</h2>
      {has ? <div style={{ display: 'grid', gap: 6 }}>{children}</div>
        : <div className="text-ink-muted" style={{ fontSize: 12, padding: '8px 0' }}>{empty}</div>}
    </div>
  );
}

function Row({ title, sub, tag, ago, onClick }: { title: string; sub?: string; tag?: string; ago: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span className="text-ink-muted" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{ago}</span>
      </div>
      {sub && (
        <div className="text-ink-muted" style={{ fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {sub}
        </div>
      )}
      {tag && (
        <span className="text-ink-muted" style={{ fontSize: 9, padding: '1px 5px', background: 'var(--bg)', borderRadius: 3, marginTop: 4, display: 'inline-block' }}>{tag}</span>
      )}
    </div>
  );
}
