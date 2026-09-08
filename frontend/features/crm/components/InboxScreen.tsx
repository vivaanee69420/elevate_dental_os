'use client';
// CRM Inbox — wired to GET /api/comms/inbox and GET /api/comms/thread.
//
// It used to fetch a flat list of `communications` (capped at 200 rows
// server-side) and thread, count and search that page in the browser. On live
// data that showed 105 of 12,764 conversations — 0.8% — with an unread badge
// reading 10 against a true 5,753, and a search box that only searched those
// 105, so it answered "no results" for 99% of the real inbox. Nothing about it
// looked broken.
//
// Now the grouping, counting, filtering, searching and paging all happen in
// SQL over every message the organisation has. This component renders one page
// of conversations, fetches the open conversation's messages on demand, and
// takes every number from the server rather than from the length of what it
// happens to be holding.

import { useEffect, useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { useInbox, useThread, useSendCommunication } from '../hooks';
import { type Communication, type InboxThread } from '../api';
import { CRM_NAVY, agoLabel } from '../data';
import { useGhlAccounts } from '@/features/integrations/hooks';
import { SubaccountFilterBar } from '@/features/ghl/components/SubaccountFilterBar';

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

// Threading now happens in SQL (crm_inbox_threads), not here. The key is a
// stored generated column on communications: contact_id, else lead_id, else
// channel + counterparty address — the same precedence the browser-side
// groupIntoThreads() used to apply, moved to where the whole population is
// visible rather than the newest 200 rows.

// Conversations per page. Small enough to scan, and the pager states the
// total, so the list is bounded rather than truncated.
const PAGE_SIZE = 50;

// Map one server-aggregated thread onto the shape the presentation below
// already speaks. `messages` is deliberately empty here: the list needs a
// thread's summary, and only the OPEN conversation fetches its messages.
function toDerivedThread(t: InboxThread): DerivedThread {
  const addr = t.counterparty ?? '';
  const contactName = `${t.contact_first_name ?? ''} ${t.contact_last_name ?? ''}`.trim();
  const name = contactName || deriveDisplayName(
    addr,
    t.contact_id
      ? `Contact ${t.contact_id.slice(0, 8)}`
      : t.lead_id
        ? `Lead ${t.lead_id.slice(0, 8)}`
        : 'Unknown sender',
  );
  return {
    id: t.thread_key,
    name,
    initials: initialsOf(name),
    channel: t.channel,
    unread: t.unread_count,
    subject: t.last_subject ?? undefined,
    lastSnippet: cleanBody(t.last_body) || '(no content)',
    minutesAgo: minutesAgoFrom(t.last_at),
    tag: '',
    contactId: t.contact_id,
    toAddress: addr,
    messages: [],
  };
}

/** CRM unified-inbox screen — backed by GET /api/comms/inbox. */
export default function InboxScreen() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data: ghlData } = useGhlAccounts();

  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [page, setPage] = useState(0);
  const sendMsg = useSendCommunication();

  // Search runs on the SERVER, so it is debounced — every keystroke is a query
  // over the organisation's whole message history, not a filter over an array
  // already in memory.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Changing what is being asked for returns you to the first page; leaving the
  // offset behind lands the user on page 7 of a 2-page result, which reads as
  // "no conversations".
  useEffect(() => { setPage(0); }, [debouncedSearch, filter, accountId]);

  const { data, isLoading, error, isFetching } = useInbox({
    integration_account_id: accountId,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(filter === 'unread' ? { unread_only: true } : {}),
    ...(filter !== 'all' && filter !== 'unread' ? { channel: filter } : {}),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  // The list on screen is one page of a server-side result. `total` is how many
  // conversations match the current filters; `summary` counts the whole inbox
  // regardless of them. Neither is ever inferred from the page's length — that
  // is precisely what made this screen report 105 conversations and 10 unread
  // when the truth was 12,764 and 5,753.
  const threads: DerivedThread[] = useMemo(
    () => (data?.threads ?? []).map(toDerivedThread),
    [data?.threads],
  );
  const matchingTotal = data?.total ?? 0;
  const totalUnread = data?.summary.unread_messages ?? 0;
  const totalThreads = data?.summary.total_threads ?? 0;
  const pageCount = Math.max(1, Math.ceil(matchingTotal / PAGE_SIZE));

  // The list is already filtered and paged by SQL — there is nothing left to
  // filter here, and re-filtering it in the browser is the bug being removed.
  const filtered = threads;

  const selected =
    threads.find((t) => t.id === selectedId) ?? filtered[0] ?? null;

  // A conversation's messages are fetched for the conversation you opened, not
  // sliced out of a page of the whole inbox — so an old thread opens with its
  // full history rather than only whatever happened to be in the last 200
  // messages org-wide.
  const { data: threadData, isLoading: threadLoading } = useThread(selected?.id ?? null);
  const messages = threadData?.messages ?? [];

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

  // Only the two chips whose totals are actually known carry a number. The
  // per-channel chips used to count the loaded page — with 105 of 12,764
  // threads loaded, "SMS 12" was a count of the sample, not of the inbox.
  // A chip with no number is honest; a chip with a wrong one is not.
  const filterChips: { k: string; l: string; c: number | null }[] = [
    { k: 'all', l: 'All', c: totalThreads },
    { k: 'unread', l: 'Unread', c: data?.summary.unread_threads ?? null },
    { k: 'sms', l: 'SMS', c: null },
    { k: 'email', l: 'Email', c: null },
    { k: 'whatsapp', l: 'WhatsApp', c: null },
    { k: 'call', l: 'Call', c: null },
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
              : `${totalThreads.toLocaleString('en-GB')} conversations · `
                + `${totalUnread.toLocaleString('en-GB')} unread · `
                + 'SMS, Email, WhatsApp, Voice AI all in one place'}
          </p>
        </div>
      </div>

      {ghlData && ghlData.accounts.length > 0 && (
        <div className="mb-4">
          <SubaccountFilterBar
            accounts={ghlData.accounts.map((a) => ({
              accountId: a.id,
              label: a.label || 'GoHighLevel',
              practiceId: a.practice_id ?? null,
            })) as any}
            selected={accountId}
            onSelect={setAccountId}
          />
        </div>
      )}

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
                {f.c === null ? f.l : `${f.l} · ${f.c.toLocaleString('en-GB')}`}
              </button>
            ))}
          </div>
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 700 }}>
            {isLoading ? (
              <div className="p-3 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div
                className="text-ink-muted text-center"
                style={{ padding: '30px 20px', fontSize: 12 }}
              >
                {/* Three different states that used to look identical. An
                    inbox with nothing in it, a filter that matched nothing,
                    and a search that matched nothing are different facts, and
                    the last one is only trustworthy now that the search runs
                    over every conversation rather than over 0.8% of them. */}
                {totalThreads === 0
                  ? 'No conversations yet — outbound sends will appear here.'
                  : debouncedSearch
                    ? `Nothing matches “${debouncedSearch}” in ${totalThreads.toLocaleString('en-GB')} conversations.`
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

          {/* Pager. The list is bounded and SAYS so, with the real total
              beside it — the difference between showing a page and quietly
              being a page. */}
          {matchingTotal > 0 && (
            <div
              className="flex"
              style={{
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderTop: '1px solid var(--border)',
                fontSize: 11,
              }}
            >
              <span className="text-ink-muted">
                {(page * PAGE_SIZE + 1).toLocaleString('en-GB')}–
                {Math.min((page + 1) * PAGE_SIZE, matchingTotal).toLocaleString('en-GB')}
                {' of '}
                {matchingTotal.toLocaleString('en-GB')}
                {isFetching ? ' · updating…' : ''}
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={{
                    padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    border: '1px solid var(--border)', background: 'white',
                    cursor: page === 0 ? 'not-allowed' : 'pointer',
                    opacity: page === 0 ? 0.45 : 1,
                  }}
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  style={{
                    padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    border: '1px solid var(--border)', background: 'white',
                    cursor: page >= pageCount - 1 ? 'not-allowed' : 'pointer',
                    opacity: page >= pageCount - 1 ? 0.45 : 1,
                  }}
                >
                  Next
                </button>
              </span>
            </div>
          )}
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
                {threadLoading ? (
                  // The conversation is fetched on open, so it has a real
                  // loading state. "No messages yet" while it is still in
                  // flight would be a wrong answer, not a pending one.
                  <div className="space-y-3" style={{ padding: 12 }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
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
