'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useNotifications, useMarkRead, useMarkAllRead } from '../data';

export default function NotificationsScreen() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data: items = [], isLoading } = useNotifications(unreadOnly);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-medium text-ink">Notifications</h1>
        <div className="flex items-center gap-3">
          <label className="text-sm text-ink-muted flex items-center gap-1">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />
            Unread only
          </label>
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="text-sm text-brand disabled:opacity-50"
          >
            Mark all read
          </button>
          <Link href="/notifications/preferences" className="text-sm text-brand">
            Preferences
          </Link>
        </div>
      </div>

      {isLoading && <p className="text-sm text-ink-muted">Loading...</p>}

      <ul className="border border-border rounded-lg overflow-hidden bg-card">
        {!isLoading && items.length === 0 && (
          <li className="px-4 py-8 text-sm text-ink-muted text-center">Nothing here yet</li>
        )}
        {items.map((n) => (
          <li key={n.id}>
            <Link
              href={n.link_url ?? '#'}
              onClick={() => {
                if (!n.read_at) markRead.mutate(n.id);
              }}
              className={`block px-4 py-3 border-b border-border hover:bg-bg last:border-b-0 ${
                n.read_at ? '' : 'bg-brand-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-ink">{n.title}</p>
                <span className="text-[11px] text-ink-muted">
                  {new Date(n.created_at).toLocaleDateString('en-GB')}
                </span>
              </div>
              {n.body && <p className="text-xs text-ink-muted mt-0.5">{n.body}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
