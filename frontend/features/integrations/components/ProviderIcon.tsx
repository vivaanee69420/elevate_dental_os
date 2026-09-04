'use client';
// Brand marks for the integration tiles, inline rather than fetched.
//
// These are drawn here, not loaded from a CDN or a /public asset, for two
// reasons: the app ships no image pipeline for them, and a tile whose logo
// silently 404s reads as a broken integration. An unknown provider falls back
// to a monogram, so adding a provider to the backend registry never leaves a
// hole in the grid.

import { ReactNode } from 'react';

const MARKS: Record<string, { node: ReactNode; bg: string }> = {
  google: {
    bg: '#FFFFFF',
    node: (
      <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.3 17.6 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.2 7-17.4z" />
        <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.8-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.4 0-11.7-3.8-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
    ),
  },
  meta_ads: {
    bg: '#FFFFFF',
    node: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          fill="#0866FF"
          d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"
        />
      </svg>
    ),
  },
  dentally: {
    bg: '#0F766E',
    node: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="#FFFFFF" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5.5c-1.6-1.4-4-1.9-5.7-.7C4.4 6.2 4 8.9 4.6 11.4c.5 2.1 1.6 5 2.5 6.6.6 1 1.8 1.2 2.4.2.5-.8.9-2 1.2-3.1.3-1 1.4-1 1.7 0 .3 1.1.7 2.3 1.2 3.1.6 1 1.8.8 2.4-.2.9-1.6 2-4.5 2.5-6.6.6-2.5.2-5.2-1.7-6.6-1.7-1.2-4.1-.7-5.7.7z" />
      </svg>
    ),
  },
  gohighlevel: {
    bg: '#111827',
    node: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l5-6 4 3.5L21 6" />
        <path d="M15.5 6H21v5.5" />
      </svg>
    ),
  },
  quickbooks: {
    bg: '#2CA01C',
    node: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="#2CA01C" />
        <path
          fill="#FFFFFF"
          d="M10.4 6.6v1.9H9.1a3.5 3.5 0 100 7h.6v-1.9h-.6a1.6 1.6 0 110-3.2h1.3v7.1h1.8V6.6zM13.6 17.4v-1.9h1.3a3.5 3.5 0 100-7h-.6v1.9h.6a1.6 1.6 0 110 3.2h-1.3V6.6h-1.8v10.8z"
        />
      </svg>
    ),
  },
  xero: {
    bg: '#13B5EA',
    node: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="#13B5EA" />
        <path
          fill="#FFFFFF"
          d="M9.2 12l-2-2 1.1-1.1 2 2 2-2L13.4 10l-2 2 2 2-1.1 1.1-2-2-2 2L7.2 14zM16.2 13.4a1.4 1.4 0 110-2.8 1.4 1.4 0 010 2.8z"
        />
      </svg>
    ),
  },
  callrail: {
    bg: '#00C2A8',
    node: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.2a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z" />
      </svg>
    ),
  },
  emergent: {
    bg: '#7C3AED',
    node: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6M10 21h4" />
        <path d="M12 3a6 6 0 00-3.5 10.9c.3.2.5.6.5 1V15h6v-.1c0-.4.2-.8.5-1A6 6 0 0012 3z" />
      </svg>
    ),
  },
  soe: {
    bg: '#334155',
    node: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M8 21h8M12 18v3M7 9h5M7 13h8" />
      </svg>
    ),
  },
};

// Deterministic monogram for a provider with no drawn mark.
function monogram(label: string) {
  const letters = label
    .split(/[\s—-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return letters || label.slice(0, 1).toUpperCase();
}

export default function ProviderIcon({
  id,
  label,
  size = 36,
}: {
  id: string;
  label: string;
  size?: number;
}) {
  const mark = MARKS[id];
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: mark ? mark.bg : '#F1F5F9',
        border: '1px solid var(--border)',
        color: '#475569',
        fontSize: size <= 28 ? 11 : 13,
        fontWeight: 700,
        letterSpacing: 0.2,
      }}
    >
      {mark ? mark.node : monogram(label)}
    </div>
  );
}
