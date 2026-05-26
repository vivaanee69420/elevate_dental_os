'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { platformApi } from '@/lib/platform-api';

// Reachable even while must_change_password is set: platformAuthenticate
// allows /me and /change-password through the forced-reset gate. On success
// the backend clears the flag and the admin can use the console.
export default function PlatformChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next1, setNext1] = useState('');
  const [next2, setNext2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next1 !== next2) { setError('New passwords do not match.'); return; }
    if (next1.length < 12) { setError('New password must be at least 12 characters.'); return; }
    setBusy(true);
    try {
      await platformApi('/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next1 }),
      });
      router.replace('/platform/overview');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-md">
      <PageHeader
        title="Change password"
        subtitle="Set a new password to finish securing your platform account."
      />
      <form onSubmit={submit} className="border border-border rounded p-4 space-y-3">
        <label className="text-sm block">
          Current password
          <input
            required
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="mt-1 w-full border border-border rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm block">
          New password
          <input
            required
            type="password"
            value={next1}
            onChange={(e) => setNext1(e.target.value)}
            placeholder="At least 12 characters"
            className="mt-1 w-full border border-border rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm block">
          Confirm new password
          <input
            required
            type="password"
            value={next2}
            onChange={(e) => setNext2(e.target.value)}
            className="mt-1 w-full border border-border rounded px-3 py-2 text-sm"
          />
        </label>
        {error && <div className="text-sm text-danger">{error}</div>}
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded text-sm font-semibold bg-brand text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
