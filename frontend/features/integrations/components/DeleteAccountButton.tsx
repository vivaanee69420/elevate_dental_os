'use client';
// ============================================================================
// "Delete" on a connected-account row — the second step after Disconnect.
//
// Disconnect marks an account revoked and stops syncing it, which is the right
// default because a disconnected account's history stays readable. But nothing
// ever removed the row, so revoked subaccounts accumulated in the panel with
// no way to clear them. This is that missing step, and it appears ONLY on a
// row that is already revoked — two deliberate actions, so a live account the
// owner is still syncing cannot go in one stray click.
//
// The confirmation is not ceremony. Seven of the eleven foreign keys onto
// `integration_accounts` are ON DELETE CASCADE, so deleting a QuickBooks
// company takes its whole P&L (957 monthly_financials rows, 47 invoices and 18
// bank accounts on the live org) and a legacy GoHighLevel row takes 137 synced
// appointments. The backend refuses such a delete and returns the counts; this
// component shows them and asks. An owner deciding in front of the numbers is
// the point — a bare "Are you sure?" would be worth nothing here.
// ============================================================================

import { useState } from 'react';
import {
  deleteAccountPermanently,
  type AccountDeleteProvider,
  type AccountDeleteImpact,
} from '../api';

// The table names the API reports, in the words an owner uses.
const TABLE_LABEL: Record<string, string> = {
  invoices: 'invoices',
  payments: 'payments',
  monthly_financials: 'profit & loss rows',
  ghl_appointments: 'calendar bookings',
  bank_accounts: 'bank accounts',
  bank_balance_snapshots: 'bank balance snapshots',
  ad_channel_pipelines: 'ad channel mappings',
  contacts: 'contacts',
  leads: 'leads',
  communications: 'conversations',
  callrail_calls: 'tracked calls',
};

const describe = (counts: Record<string, number>) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([table, n]) => `${n.toLocaleString('en-GB')} ${TABLE_LABEL[table] ?? table}`)
    .join(', ');

export function DeleteAccountButton({
  provider, id, label, status, onDeleted,
}: {
  provider: AccountDeleteProvider;
  id: string;
  label: string;
  status: string | null;
  onDeleted: () => void;
}) {
  const [impact, setImpact] = useState<AccountDeleteImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Disconnect first. Offering Delete on a live account would make the two
  // buttons a coin toss on a row that is still syncing.
  if (status !== 'revoked') return null;

  async function run(confirm: boolean) {
    setBusy(true);
    setError(null);
    try {
      await deleteAccountPermanently(provider, id, confirm);
      onDeleted();
    } catch (e) {
      const err = e as { status?: number; details?: AccountDeleteImpact; message?: string };
      // 409 + details = "this would destroy things, here they are". Anything
      // else is a real failure and is shown as one rather than swallowed.
      if (err.status === 409 && err.details?.cascade) setImpact(err.details);
      else setError(err.message || 'Could not delete this account');
    } finally {
      setBusy(false);
    }
  }

  if (impact) {
    const destroys = describe(impact.cascade);
    const detaches = describe(impact.detach);
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-xs max-w-md">
        <p className="font-semibold text-ink">Delete “{label}” and its synced records?</p>
        {destroys && (
          <p className="mt-1 text-ink">
            This permanently deletes <strong>{destroys}</strong>. Reports that read them will change.
          </p>
        )}
        {detaches && (
          <p className="mt-1 text-ink-muted">
            {detaches} will be kept, but will no longer be attributed to this account.
          </p>
        )}
        <p className="mt-1 text-ink-muted">This cannot be undone.</p>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => run(true)}
            className="rounded-lg bg-danger px-3 py-1.5 text-white font-medium disabled:opacity-50">
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
          <button type="button" disabled={busy} onClick={() => { setImpact(null); setError(null); }}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-ink">
            Keep it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button type="button" disabled={busy} onClick={() => run(false)}
        title="Remove this disconnected account from the list"
        className="rounded-lg border border-danger/40 bg-card px-3 py-1.5 text-xs text-danger hover:bg-danger/5 disabled:opacity-50">
        {busy ? 'Deleting…' : 'Delete'}
      </button>
      {error && <span className="text-[11px] text-danger max-w-[220px]">{error}</span>}
    </div>
  );
}
