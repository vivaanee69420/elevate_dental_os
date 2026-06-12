'use client';
// CRM Today — live work queue derived from real leads + messages:
//   • New leads today      (leads created today, still open)
//   • Needs follow-up      (open leads not yet progressed, oldest first)
//   • Recent messages      (inbound communications, newest first)
// Replaces the mock task generator.

import { useMemo, useState } from 'react';
import { useLeads } from '@/features/leads/hooks';
import { useCommunications } from '../hooks';
import type { Lead } from '@/features/leads/api';
import type { Communication } from '../api';
import { agoLabel } from '../data';
import { formatPence } from '@/lib/format';

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
  const { data: leadData, isLoading } = useLeads({ limit: 500 });
  const { data: commData } = useCommunications();
  const leads: Lead[] = leadData?.leads ?? [];
  const comms = commData?.communications ?? [];
  const [selected, setSelected] = useState<Selected | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>('recent');

  const { newLeads, followUps, messages, activeCount } = useMemo(() => {
    // Window start = local midnight minus N days. 'recent' (N=1) buffers the
    // nightly GHL sync lag: leads land ~22:00 carrying GHL's real createdAt, so
    // a strict calendar-today filter reads 0 every morning even when leads
    // flowed overnight. 'all' (N=Infinity) treats every open lead as new.
    const days = WINDOWS.find((w) => w.key === windowKey)?.days ?? 1;
    let startMs = 0;
    if (Number.isFinite(days)) {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - days);
      startMs = start.getTime();
    }

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
    return { newLeads, followUps, messages, activeCount: open.length };
  }, [leads, comms, windowKey]);

  const windowLabel = WINDOWS.find((w) => w.key === windowKey)?.label ?? 'Recent';
  const counters = [
    { label: `New leads · ${windowLabel}`, value: newLeads.length, colour: '#3B82F6' },
    { label: 'Needs follow-up', value: followUps.length, colour: 'var(--warning)' },
    { label: 'Recent messages', value: messages.length, colour: '#8B5CF6' },
    { label: 'Active leads', value: activeCount, colour: 'var(--success)' },
  ];

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6 flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>Today</h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            {isLoading ? 'Loading…' : `${newLeads.length} new leads · ${followUps.length} to follow up · ${messages.length} recent messages`}
          </p>
        </div>
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

      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {counters.map((s) => (
          <div key={s.label} className="card-padded" style={{ borderLeft: `3px solid ${s.colour}` }}>
            <div className="text-ink-muted uppercase font-bold" style={{ fontSize: 10, letterSpacing: '0.05em' }}>{s.label}</div>
            <div className="display font-bold" style={{ fontSize: 28, color: s.colour, marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Section title={`New leads · ${windowLabel}`} empty="No new leads in this window.">
          {newLeads.map((l) => (
            <Row key={l.id} title={nameOf(l)} sub={l.treatment} tag={l.source ?? undefined} ago={agoLabel(minsSince(l.created_at))} onClick={() => setSelected({ kind: 'lead', lead: l })} />
          ))}
        </Section>
        <Section title="Needs follow-up" empty="Nothing to follow up.">
          {followUps.map((l) => (
            <Row key={l.id} title={nameOf(l)} sub={`${l.treatment} · ${l.status.replace(/_/g, ' ')}`} ago={agoLabel(minsSince(l.created_at))} onClick={() => setSelected({ kind: 'lead', lead: l })} />
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

      {selected && <DetailModal selected={selected} onClose={() => setSelected(null)} />}
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

function DetailModal({ selected, onClose }: { selected: Selected; onClose: () => void }) {
  const isLead = selected.kind === 'lead';
  const l = isLead ? selected.lead : null;
  const m = !isLead ? selected.comm : null;
  const title = isLead
    ? nameOf(l!)
    : `${m!.contact?.first_name ?? ''} ${m!.contact?.last_name ?? ''}`.trim() || 'Unknown';
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div className="card-padded" onClick={(e) => e.stopPropagation()} style={{ background: 'white', maxWidth: 520, width: '92%', maxHeight: '85vh', overflowY: 'auto', position: 'relative' }}>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 10, right: 12, border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--ink-muted)' }}>×</button>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{title}</h3>
        {isLead ? (
          <div>
            <Field label="Email" value={l!.contact?.email} />
            <Field label="Phone" value={l!.contact?.phone} />
            <Field label="Treatment" value={l!.treatment} />
            <Field label="Stage" value={l!.ghl_stage_name ?? l!.status.replace(/_/g, ' ')} />
            <Field label="Status" value={l!.status.replace(/_/g, ' ')} />
            <Field label="Value" value={l!.estimated_value_pence ? formatPence(l!.estimated_value_pence) : null} />
            <Field label="Source" value={l!.source} />
            <Field label="Created" value={new Date(l!.created_at).toLocaleString('en-GB')} />
            <Field label="Synced from" value={l!.sync_status === 'synced' ? 'GoHighLevel' : 'Manual'} />
          </div>
        ) : (
          <div>
            <Field label="Email" value={m!.contact?.email} />
            <Field label="Channel" value={m!.channel} />
            <Field label="Direction" value={m!.direction} />
            <Field label="Received" value={new Date(m!.created_at).toLocaleString('en-GB')} />
            <div style={{ marginTop: 12 }}>
              <div className="text-ink-muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Message</div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{stripJunk(m!.body) || '(empty)'}</div>
            </div>
          </div>
        )}
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
