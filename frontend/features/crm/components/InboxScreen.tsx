'use client';
// CRM Inbox — wired to GET /api/comms.
//
// Server returns a flat list of `communications` rows scoped to the caller's
// organisation_id. This component groups them client-side into "threads" by
// (contact_id || lead_id || channel+address), picks the latest message per
// thread for the list view, and renders the full message history for the
// selected thread. UI is pixel-identical to the prototype; only the data
// source moved from mock fixtures to the real endpoint.

import { useMemo, useState } from 'react';
import { useCommunications, useSendCommunication } from '../hooks';
import { type Communication } from '../api';
import { CRM_NAVY, agoLabel } from '../data';

// Per-channel accent colour (emoji indicators dropped per rule 7).
const CHANNEL_COLOUR: Record<string, string> = {
  sms: 'var(--warning)',
  email: '#3B82F6',
  whatsapp: '#25D366',
  voice_ai: '#8B5CF6',
  call: '#8B5CF6',
  in_person: 'var(--ink-muted)',
};
const CHANNEL_LABEL: Record<string, string> = {
  sms: 'SMS',
  email: 'Email',
  whatsapp: 'WhatsApp',
  voice_ai: 'Voice AI',
  call: 'Call',
  in_person: 'In person',
};

interface DerivedThread {
  id: string;                 // synthetic thread key (contact_id || lead_id || channel+address)
  name: string;
  initials: string;
  channel: Communication['channel'];
  unread: number;
  subject?: string;
  lastSnippet: string;
  minutesAgo: number;
  tag: string;
  contactId: string | null;   // our contact uuid, for replying
  toAddress: string;          // counterparty email/phone, for native send + display
  messages: Communication[];  // ordered oldest → newest within thread
}

// GHL emails append an unsubscribe footer + tracking/unsubscribe links
// (e.g. "…you may unsubscribe [https://services.msgsndr.com/…]"). Strip that
// noise so the Inbox shows just the message.
function cleanBody(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/If you no longer wish to receive these emails[\s\S]*$/i, '')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/https?:\/\/services\.msgsndr\.com\/\S+/g, '')
    // Empty GHL merge fields render as the literal "undefined"/"null"
    // (e.g. "Appointment Notes: undefined") — show "N/A" instead.
    .replace(/:\s*(undefined|null)\b/gi, ': N/A')
    .replace(/\b(undefined|null)\b/g, 'N/A')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function counterpartyAddress(c: Communication): string {
  if (c.direction === 'inbound') return c.from_address ?? c.to_address ?? '';
  return c.to_address ?? c.from_address ?? '';
}

function deriveDisplayName(addr: string, fallback: string): string {
  if (!addr) return fallback;
  // Strip "Name <email>" angle-bracket form if present.
  const m = addr.match(/^([^<]+)<[^>]+>$/);
  if (m) return m[1].trim();
  return addr;
}

function initialsOf(name: string): string {
  const parts = name.replace(/[<>@]/g, ' ').trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return '??';
  return parts
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase() || '??';
}

function minutesAgoFrom(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

// Group flat communications into threads. Key precedence:
// contact_id > lead_id > (channel + counterparty address).
function groupIntoThreads(rows: Communication[]): DerivedThread[] {
  const buckets = new Map<string, Communication[]>();

  for (const c of rows) {
    const key =
      c.contact_id
        ? `c:${c.contact_id}`
        : c.lead_id
          ? `l:${c.lead_id}`
          : `a:${c.channel}:${counterpartyAddress(c)}`;
    const list = buckets.get(key);
    if (list) list.push(c);
    else buckets.set(key, [c]);
  }

  const threads: DerivedThread[] = [];
  for (const [id, msgs] of buckets) {
    // Sort oldest → newest within thread for natural conversation reading.
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const latest = msgs[msgs.length - 1];
    const addr = counterpartyAddress(latest);
    // Prefer the joined contact's real name; fall back to the address, then the id.
    const withContact = msgs.find((m) => m.contact?.first_name || m.contact?.last_name);
    const contactName = withContact
      ? `${withContact.contact?.first_name ?? ''} ${withContact.contact?.last_name ?? ''}`.trim()
      : '';
    const displayName = contactName || deriveDisplayName(
      addr,
      id.startsWith('c:')
        ? `Contact ${id.slice(2, 10)}`
        : id.startsWith('l:')
          ? `Lead ${id.slice(2, 10)}`
          : 'Unknown sender',
    );
    threads.push({
      id,
      name: displayName,
      initials: initialsOf(displayName),
      channel: latest.channel,
      unread: msgs.filter((m) => m.direction === 'inbound' && !m.read_at).length,
      subject: latest.subject ?? undefined,
      lastSnippet: cleanBody(latest.body) || '(no content)',
      minutesAgo: minutesAgoFrom(latest.created_at),
      tag: '',
      contactId: latest.contact_id ?? null,
      toAddress: addr,
      messages: msgs,
    });
  }

  // Newest activity first in the list.
  threads.sort((a, b) => a.minutesAgo - b.minutesAgo);
  return threads;
}

/** CRM unified-inbox screen — backed by GET /api/comms. */
export default function InboxScreen() {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const sendMsg = useSendCommunication();

  const { data, isLoading, error } = useCommunications();

  const threads = useMemo(
    () => groupIntoThreads(data?.communications ?? []),
    [data?.communications],
  );

  const totalUnread = useMemo(
    () => threads.reduce((s, t) => s + t.unread, 0),
    [threads],
  );

  // Filtered thread list: channel/unread chip + free-text search.
  const filtered = useMemo(() => {
    let list = threads;
    if (filter === 'unread') list = list.filter((t) => t.unread > 0);
    else if (filter !== 'all') list = list.filter((t) => t.channel === filter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        `${t.name} ${t.lastSnippet}`.toLowerCase().includes(q),
      );
    }
    return list;
  }, [threads, filter, search]);

  const selected =
    threads.find((t) => t.id === selectedId) ?? filtered[0] ?? null;
  const messages = selected?.messages ?? [];

  // Only sms/email/whatsapp are sendable (call/in_person are log-only).
  const canSend =
    !!selected && ['sms', 'email', 'whatsapp'].includes(selected.channel);

  async function handleSend() {
    if (!selected || !canSend || !reply.trim() || sendMsg.isPending) return;
    await sendMsg.mutateAsync({
      contact_id: selected.contactId ?? undefined,
      channel: selected.channel as 'sms' | 'email' | 'whatsapp',
      to: selected.toAddress,
      body: reply.trim(),
      ...(selected.channel === 'email' && selected.subject ? { subject: selected.subject } : {}),
    });
    setReply('');
  }

  const filterChips = [
    { k: 'all', l: 'All', c: threads.length },
    { k: 'unread', l: 'Unread', c: totalUnread },
    { k: 'sms', l: 'SMS', c: threads.filter((t) => t.channel === 'sms').length },
    { k: 'email', l: 'Email', c: threads.filter((t) => t.channel === 'email').length },
    { k: 'whatsapp', l: 'WhatsApp', c: threads.filter((t) => t.channel === 'whatsapp').length },
    { k: 'call', l: 'Call', c: threads.filter((t) => t.channel === 'call').length },
  ];

  return (
    <div className="mx-auto" style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div
        className="mb-6 flex"
        style={{
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="display font-bold" style={{ fontSize: 28 }}>
            Inbox
          </h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            {isLoading
              ? 'Loading conversations…'
              : `${threads.length} conversations · ${totalUnread} unread · SMS, Email, WhatsApp, Voice AI all in one place`}
          </p>
        </div>
      </div>

      {error && (
        <div
          className="card"
          style={{
            padding: 12,
            marginBottom: 12,
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#991B1B',
            fontSize: 12,
          }}
        >
          Failed to load communications: {(error as Error).message}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '360px 1fr',
          gap: 14,
          minHeight: 600,
        }}
      >
        {/* LEFT: thread list */}
        <div
          className="card"
          style={{
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
          }}
        >
          <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
            <input
              type="text"
              value={search}
              placeholder="Search conversations…"
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 12,
              }}
            />
          </div>
          <div
            className="flex"
            style={{
              gap: 4,
              padding: 8,
              borderBottom: '1px solid var(--border)',
              overflowX: 'auto',
            }}
          >
            {filterChips.map((f) => (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                style={{
                  padding: '4px 8px',
                  borderRadius: 12,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: '1px solid var(--border)',
                  background: filter === f.k ? CRM_NAVY : 'white',
                  color: filter === f.k ? 'white' : 'var(--ink)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {f.l} · {f.c}
              </button>
            ))}
          </div>
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 700 }}>
            {isLoading ? (
              <div
                className="text-ink-muted text-center"
                style={{ padding: '30px 20px', fontSize: 12 }}
              >
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div
                className="text-ink-muted text-center"
                style={{ padding: '30px 20px', fontSize: 12 }}
              >
                {threads.length === 0
                  ? 'No conversations yet — outbound sends will appear here.'
                  : 'No conversations match this filter.'}
              </div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background:
                      selected && selected.id === t.id ? '#F0F9FF' : 'white',
                    border: 'none',
                    borderLeft:
                      selected && selected.id === t.id
                        ? `3px solid ${CHANNEL_COLOUR[t.channel] ?? CRM_NAVY}`
                        : '3px solid transparent',
                  }}
                >
                  <div
                    className="flex"
                    style={{ gap: 10, alignItems: 'flex-start' }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: '50%',
                        background: CRM_NAVY,
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 13,
                        flexShrink: 0,
                      }}
                    >
                      {t.initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="flex"
                        style={{
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 2,
                        }}
                      >
                        <strong style={{ fontSize: 13 }}>{t.name}</strong>
                        <span
                          className="text-ink-muted"
                          style={{ fontSize: 10 }}
                        >
                          {agoLabel(t.minutesAgo)}
                        </span>
                      </div>
                      {t.subject && (
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            marginBottom: 2,
                          }}
                        >
                          {t.subject}
                        </div>
                      )}
                      <div
                        className="text-ink-muted"
                        style={{
                          fontSize: 11,
                          lineHeight: 1.3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t.lastSnippet}
                      </div>
                      <div
                        className="flex"
                        style={{
                          gap: 4,
                          marginTop: 4,
                          alignItems: 'center',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 9,
                            padding: '1px 6px',
                            background: `${CHANNEL_COLOUR[t.channel] ?? 'var(--ink-muted)'}20`,
                            color: CHANNEL_COLOUR[t.channel] ?? 'var(--ink-muted)',
                            borderRadius: 3,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                          }}
                        >
                          {CHANNEL_LABEL[t.channel] ?? t.channel}
                        </span>
                        {t.unread > 0 && (
                          <span
                            style={{
                              marginLeft: 'auto',
                              background: 'var(--danger)',
                              color: 'white',
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 10,
                            }}
                          >
                            {t.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* RIGHT: conversation */}
        <div
          className="card"
          style={{
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
          }}
        >
          {!selected ? (
            <div
              className="text-ink-muted text-center"
              style={{ padding: '60px 20px', fontSize: 13 }}
            >
              {isLoading
                ? 'Loading…'
                : threads.length === 0
                  ? 'No conversations yet.'
                  : 'Select a conversation to view messages'}
            </div>
          ) : (
            <>
              <div
                className="flex"
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border)',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div
                    className="display font-bold"
                    style={{ fontSize: 15 }}
                  >
                    {selected.name}
                  </div>
                  <div
                    className="text-ink-muted"
                    style={{ fontSize: 11 }}
                  >
                    {CHANNEL_LABEL[selected.channel] ?? selected.channel}
                  </div>
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: 14,
                  background: 'var(--bg)',
                  maxHeight: 540,
                }}
              >
                {messages.length === 0 ? (
                  <div
                    className="text-ink-muted text-center"
                    style={{ fontSize: 12, padding: 30 }}
                  >
                    No messages yet
                  </div>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className="flex"
                      style={{
                        justifyContent:
                          m.direction === 'outbound' ? 'flex-end' : 'flex-start',
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '70%',
                          padding: '8px 12px',
                          borderRadius:
                            m.direction === 'outbound'
                              ? '12px 12px 0 12px'
                              : '12px 12px 12px 0',
                          background:
                            m.direction === 'outbound'
                              ? `${CHANNEL_COLOUR[m.channel] ?? 'var(--ink-muted)'}22`
                              : 'white',
                          border: '1px solid var(--border)',
                          fontSize: 13,
                        }}
                      >
                        {m.subject && m.channel === 'email' && (
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              marginBottom: 4,
                            }}
                          >
                            {m.subject}
                          </div>
                        )}
                        {cleanBody(m.body) || '(empty)'}
                        <div
                          className="text-ink-muted"
                          style={{
                            fontSize: 10,
                            marginTop: 4,
                            textAlign: 'right',
                          }}
                        >
                          {agoLabel(minutesAgoFrom(m.created_at))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div
                className="flex"
                style={{
                  padding: 10,
                  borderTop: '1px solid var(--border)',
                  gap: 8,
                }}
              >
                <input
                  type="text"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                  disabled={!canSend || sendMsg.isPending}
                  placeholder={
                    canSend
                      ? `Reply via ${CHANNEL_LABEL[selected.channel] ?? selected.channel}…`
                      : `${CHANNEL_LABEL[selected.channel] ?? selected.channel} is not sendable`
                  }
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!canSend || !reply.trim() || sendMsg.isPending}
                  style={{
                    padding: '8px 14px',
                    background: canSend && reply.trim() ? (CHANNEL_COLOUR[selected.channel] ?? CRM_NAVY) : '#9CA3AF',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: canSend && reply.trim() && !sendMsg.isPending ? 'pointer' : 'default',
                  }}
                >
                  {sendMsg.isPending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
