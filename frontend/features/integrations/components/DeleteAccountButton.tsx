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
// IT DOES NOT MAKE THE OWNER WAIT. Deleting the legacy GoHighLevel row on the
// live org cascades 137 calendar bookings and sets 54,368 conversations to
// null; that write takes as long as it takes, and there is nothing on screen
// worth blocking for while it does. So:
//
//   * the impact is fetched when the row RENDERS, not when it is clicked, so
//     the click costs no round trip and the confirmation appears instantly;
//   * on click the row disappears immediately and the request runs in the
//     background — the panel is already showing the state that is about to be
//     true, and if the request fails the row comes back carrying the reason.
//
// The confirmation is not ceremony. Seven of the eleven foreign keys onto
// `integration_accounts` are ON DELETE CASCADE, so deleting a QuickBooks
// company takes its whole P&L (957 monthly_financials rows, 47 invoices and 18
// bank accounts on the live org). An owner deciding in front of those numbers
// is the point — a bare "Are you sure?" would be worth nothing here.
// ============================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  deleteAccountPermanently,
  fetchAccountDeleteImpact,
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
  /** Optimistic removal. `drop` takes the row out of the cached lists on the
   *  click; `settle` re-reads from the server once the request has resolved. */
  onDeleted: { drop: (id: string) => void; settle: () => void };
}) {
  const revoked = status === 'revoked';
  const [asking, setAsking] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Asked on RENDER, so the click has nothing to wait for. Only for revoked
  // rows: a live account is not deletable and the probe would be wasted.
  const { data: impact } = useQuery({
    queryKey: ['account-delete-impact', provider, id],
    queryFn: () => fetchAccountDeleteImpact(provider, id),
    enabled: revoked,
    staleTime: 60_000,
  });

  // Disconnect first. Offering Delete on a live account would make the two
  // buttons a coin toss on a row that is still syncing.
  if (!revoked) return null;

  // Fire and forget. The row is already dismissed; the request finishes on the
  // server whether or not this component is still mounted, and a failure brings
  // the row back rather than disappearing silently.
  function run(confirm: boolean) {
    setGone(true);
    setAsking(false);
    // The row leaves the list now. `settle` runs only once the server has
    // answered — invalidating here would refetch mid-delete and bring it back.
    onDeleted.drop(id);
    deleteAccountPermanently(provider, id, confirm)
      .then(() => onDeleted.settle())
      .catch((e) => {
        const err = e as { message?: string };
        setGone(false);
        setError(err.message || 'Could not delete this account');
        // Puts the row back, rather than leaving it silently missing from a
        // panel whose server still has it.
        onDeleted.settle();
      });
  }

  // The row this button sits in is already out of the list; this only shows if
  // the panel is still rendering a stale copy of it.
  if (gone) {
    return <span className="text-[11px] text-ink-muted">Deleting…</span>;
  }

  if (asking && impact) {
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
          <button type="button" onClick={() => run(true)}
            className="rounded-lg bg-danger px-3 py-1.5 text-white font-medium">
            Delete permanently
          </button>
          <button type="button" onClick={() => setAsking(false)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-ink">
            Keep it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        // A clean row goes straight away; one that would destroy records asks
        // first, with the counts already in hand.
        onClick={() => (impact?.needsConfirm ? setAsking(true) : run(false))}
        title="Remove this disconnected account from the list"
        className="rounded-lg border border-danger/40 bg-card px-3 py-1.5 text-xs text-danger hover:bg-danger/5"
      >
        Delete
      </button>
      {error && <span className="text-[11px] text-danger max-w-[220px]">{error}</span>}
    </div>
  );
}
