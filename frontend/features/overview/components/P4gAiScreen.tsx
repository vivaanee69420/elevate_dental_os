'use client';
// Plan4Growth AI — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES['p4g-ai'] + p4gAISend / generateP4GAIResponse). A single-column
// chat: empty state with starter buttons, then user/bot bubbles with a
// typing indicator before each canned reply. Replies come from
// answerP4G() in ../data.ts (mock only, no backend). The prototype's
// .p4g-ai* / .message* / .typing CSS is not in globals.css, so the layout
// is reproduced with inline styles here (frozen-primitive constraint).
//
// ASCII data-flow:
//   starter click / form submit ─► send(text)
//     └─► push user bubble ─► show typing ─► answerP4G(text) ─► push bot bubble

import { useRef, useState } from 'react';
import { answerP4G, P4G_STARTERS } from '../data';

const BRAND = '#0E7C7B';

/** One chat turn. */
interface Message {
  id: number;
  role: 'user' | 'bot';
  text: string;
}

/** Sparkles glyph used in the header + empty state (inline SVG, no emoji). */
function Sparkles({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 13v4M21 15h-4M5 19v2M6 20H4" />
    </svg>
  );
}

/** Three-dot bouncing typing indicator (animation via Tailwind animate-bounce). */
function Typing() {
  return (
    <span className="inline-flex items-center" style={{ gap: 4, padding: '4px 0' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="animate-bounce"
          style={{
            width: 6,
            height: 6,
            background: 'var(--ink-muted)',
            borderRadius: '50%',
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </span>
  );
}

/** Plan4Growth AI chat page. */
export default function P4gAiScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const nextId = useRef(0);

  /**
   * Submit a question: append the user bubble, show the typing indicator,
   * then after a short delay append the canned reply (mirrors the
   * prototype's 900ms setTimeout).
   */
  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: Message = { id: nextId.current++, role: 'user', text: trimmed };
    setMessages((m) => [...m, userMsg]);
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages((m) => [
        ...m,
        { id: nextId.current++, role: 'bot', text: answerP4G(trimmed) },
      ]);
    }, 900);
  }

  const empty = messages.length === 0 && !typing;

  return (
    <div
      className="mx-auto flex flex-col"
      style={{ maxWidth: 768, height: 'calc(100vh - 120px)' }}
    >
      {/* Header */}
      <div className="flex items-center" style={{ gap: 12, marginBottom: 16 }}>
        <div
          className="flex items-center justify-center text-white"
          style={{ width: 40, height: 40, background: BRAND, borderRadius: 8 }}
        >
          <Sparkles size={20} />
        </div>
        <div>
          <h1 className="display font-semibold" style={{ fontSize: 22 }}>
            Plan4Growth AI
          </h1>
          <p className="text-ink-muted" style={{ fontSize: 13 }}>
            Your AI CFO. Ask anything about your numbers.
          </p>
        </div>
      </div>

      {/* Messages */}
      <div
        className="card"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 24,
          marginBottom: 16,
        }}
      >
        {empty ? (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ height: '100%' }}
          >
            <div
              className="flex items-center justify-center"
              style={{
                width: 64,
                height: 64,
                background: 'var(--brand-50)',
                color: BRAND,
                borderRadius: '50%',
                marginBottom: 16,
              }}
            >
              <Sparkles size={28} />
            </div>
            <h3 className="display font-semibold" style={{ fontSize: 20, marginBottom: 8 }}>
              Hi, I&apos;m Plan4Growth AI.
            </h3>
            <p
              className="text-ink-muted"
              style={{ maxWidth: 360, marginBottom: 24 }}
            >
              I have access to your live financial and operational data. Same
              question, same answer — every time.
            </p>
            <div
              className="grid w-full"
              style={{ gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 480 }}
            >
              {P4G_STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-left"
                  style={{
                    fontSize: 12,
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    background: 'white',
                    cursor: 'pointer',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <div
                key={m.id}
                className="flex"
                style={{
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 14,
                    maxWidth: '80%',
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                    background: m.role === 'user' ? BRAND : 'var(--bg)',
                    color: m.role === 'user' ? 'white' : 'var(--ink)',
                    borderTopRightRadius: m.role === 'user' ? 4 : 14,
                    borderTopLeftRadius: m.role === 'user' ? 14 : 4,
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 14,
                    background: 'var(--bg)',
                    borderTopLeftRadius: 4,
                  }}
                >
                  <Typing />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input */}
      <form
        className="flex"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
          setDraft('');
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about revenue, leads, conversion, pipeline…"
          autoComplete="off"
          className="input"
          style={{ flex: 1, padding: '12px 16px' }}
        />
        <button
          type="submit"
          className="btn btn-primary flex items-center justify-center"
          style={{ width: 48, height: 44 }}
          aria-label="Send"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            style={{ width: 18, height: 18 }}
            aria-hidden="true"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}
