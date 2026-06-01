'use client';
// CRM Today — live work queue derived from real leads + messages:
//   • New leads today      (leads created today, still open)
//   • Needs follow-up      (open leads not yet progressed, oldest first)
//   • Recent messages      (inbound communications, newest first)
// Replaces the mock task generator.

import { useMemo } from 'react';
import { useLeads } from '@/features/leads/hooks';
import { useCommunications } from '../hooks';
import type { Lead } from '@/features/leads/api';
import { agoLabel } from '../data';

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

  const { newLeads, followUps, messages, activeCount } = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();

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
  }, [leads, comms]);

  const counters = [
    { label: 'New leads today', value: newLeads.length, colour: '#3B82F6' },
    { label: 'Needs follow-up', value: followUps.length, colour: '#F59E0B' },
    { label: 'Recent messages', value: messages.length, colour: '#8B5CF6' },
    { label: 'Active leads', value: activeCount, colour: '#10B981' },
  ];

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>Today</h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          {isLoading ? 'Loading…' : `${newLeads.length} new leads · ${followUps.length} to follow up · ${messages.length} recent messages`}
        </p>
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
        <Section title="New leads today" empty="No new leads today.">
          {newLeads.map((l) => (
            <Row key={l.id} title={nameOf(l)} sub={l.treatment} tag={l.source ?? undefined} ago={agoLabel(minsSince(l.created_at))} />
          ))}
        </Section>
        <Section title="Needs follow-up" empty="Nothing to follow up.">
          {followUps.map((l) => (
            <Row key={l.id} title={nameOf(l)} sub={`${l.treatment} · ${l.status.replace(/_/g, ' ')}`} ago={agoLabel(minsSince(l.created_at))} />
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
            />
          ))}
        </Section>
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

function Row({ title, sub, tag, ago }: { title: string; sub?: string; tag?: string; ago: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
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
