'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useUnreadCount, useNotifications, useMarkRead } from '../data';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: count = 0 } = useUnreadCount();
  const { data: items = [] } = useNotifications(false);
  const markRead = useMarkRead();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative text-ink-muted hover:text-ink"
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-brand text-white text-[10px] flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-lg shadow-lg z-20">
          <div className="px-4 py-2 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Notifications</span>
            <Link href="/notifications" className="text-xs text-brand" onClick={() => setOpen(false)}>
              See all
            </Link>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-4 py-6 text-sm text-ink-muted text-center">No notifications</li>
            )}
            {items.slice(0, 8).map((n) => (
              <li key={n.id}>
                <Link
                  href={n.link_url || '/notifications'}
                  onClick={() => { markRead.mutate(n.id); setOpen(false); }}
                  className={`block px-4 py-3 border-b border-border hover:bg-bg ${n.read_at ? '' : 'bg-brand-50'}`}
                >
                  <p className="text-sm text-ink">{n.title}</p>
                  {n.body && <p className="text-xs text-ink-muted mt-0.5">{n.body}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
