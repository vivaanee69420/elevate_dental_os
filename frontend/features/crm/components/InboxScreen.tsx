'use client';
// CRM Inbox — pixel-faithful port of preview/elevate-dental-os-v2.html
// (effective PAGES.inbox at ~line 7916). A unified multichannel inbox:
// left thread list (search + channel filter chips), right conversation view.
//
// Data flow:
//   INBOX_THREADS -> filter by channel/unread + search -> list
//   selected thread -> THREAD_MESSAGES[id] -> conversation bubbles
// All client-side state (filter, search, selection) is local — no API.

import { useMemo, useState } from 'react';
import {
  INBOX_THREADS,
  THREAD_MESSAGES,
  CRM_NAVY,
  agoLabel,
  type InboxThread,
} from '../data';

// Per-channel accent colour (emoji indicators dropped per rule 7).
const CHANNEL_COLOUR: Record<string, string> = {
  sms: '#F59E0B',
  email: '#3B82F6',
  whatsapp: '#25D366',
  voice_ai: '#8B5CF6',
};
const CHANNEL_LABEL: Record<string, string> = {
  sms: 'SMS',
  email: 'Email',
  whatsapp: 'WhatsApp',
  voice_ai: 'Voice AI',
};

/** CRM unified-inbox screen. */
export default function InboxScreen() {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>(INBOX_THREADS[0].id);

  const totalUnread = useMemo(
    () => INBOX_THREADS.reduce((s, t) => s + t.unread, 0),
    [],
  );

  // Filtered thread list: channel/unread chip + free-text search.
  const filtered = useMemo(() => {
    let list: InboxThread[] = INBOX_THREADS;
    if (filter === 'unread') list = list.filter((t) => t.unread > 0);
    else if (filter !== 'all') list = list.filter((t) => t.channel === filter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        `${t.name} ${t.lastSnippet}`.toLowerCase().includes(q),
      );
    }
    return list;
  }, [filter, search]);

  const selected =
    INBOX_THREADS.find((t) => t.id === selectedId) || filtered[0] || null;
  const messages = selected ? THREAD_MESSAGES[selected.id] || [] : [];

  const filterChips = [
    { k: 'all', l: 'All', c: INBOX_THREADS.length },
    { k: 'unread', l: 'Unread', c: totalUnread },
    { k: 'sms', l: 'SMS', c: INBOX_THREADS.filter((t) => t.channel === 'sms').length },
    { k: 'email', l: 'Email', c: INBOX_THREADS.filter((t) => t.channel === 'email').length },
    { k: 'whatsapp', l: 'WhatsApp', c: INBOX_THREADS.filter((t) => t.channel === 'whatsapp').length },
    { k: 'voice_ai', l: 'Voice', c: INBOX_THREADS.filter((t) => t.channel === 'voice_ai').length },
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
            {INBOX_THREADS.length} conversations · {totalUnread} unread · SMS,
            Email, WhatsApp, Voice AI all in one place
          </p>
        </div>
      </div>

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
          <div
            style={{ padding: 10, borderBottom: '1px solid var(--border)' }}
          >
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
            {filtered.length === 0 ? (
              <div
                className="text-ink-muted text-center"
                style={{ padding: '30px 20px', fontSize: 12 }}
              >
                No conversations
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
                        ? `3px solid ${CHANNEL_COLOUR[t.channel]}`
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
                            background: `${CHANNEL_COLOUR[t.channel]}20`,
                            color: CHANNEL_COLOUR[t.channel],
                            borderRadius: 3,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                          }}
                        >
                          {CHANNEL_LABEL[t.channel]}
                        </span>
                        {t.tag && (
                          <span
                            className="text-ink-muted"
                            style={{
                              fontSize: 9,
                              padding: '1px 6px',
                              background: 'var(--bg)',
                              borderRadius: 3,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                            }}
                          >
                            {t.tag}
                          </span>
                        )}
                        {t.unread > 0 && (
                          <span
                            style={{
                              marginLeft: 'auto',
                              background: '#EF4444',
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
              Select a conversation to view messages
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
                    {CHANNEL_LABEL[selected.channel]} ·{' '}
                    {selected.tag || 'no tag'}
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
                  messages.map((m, i) => (
                    <div
                      key={i}
                      className="flex"
                      style={{
                        justifyContent:
                          m.dir === 'out' ? 'flex-end' : 'flex-start',
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '70%',
                          padding: '8px 12px',
                          borderRadius:
                            m.dir === 'out'
                              ? '12px 12px 0 12px'
                              : '12px 12px 12px 0',
                          background:
                            m.dir === 'out'
                              ? `${CHANNEL_COLOUR[selected.channel]}22`
                              : 'white',
                          border: '1px solid var(--border)',
                          fontSize: 13,
                        }}
                      >
                        {m.text}
                        {m.template && (
                          <div
                            style={{
                              fontSize: 9,
                              color: CHANNEL_COLOUR[selected.channel],
                              fontWeight: 700,
                              marginTop: 4,
                              textTransform: 'uppercase',
                            }}
                          >
                            via template: {m.template}
                          </div>
                        )}
                        <div
                          className="text-ink-muted"
                          style={{
                            fontSize: 10,
                            marginTop: 4,
                            textAlign: 'right',
                          }}
                        >
                          {agoLabel(m.minutesAgo)}
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
                  placeholder={`Reply via ${CHANNEL_LABEL[selected.channel]}…`}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <button
                  style={{
                    padding: '8px 14px',
                    background: CHANNEL_COLOUR[selected.channel],
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
