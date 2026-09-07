// ============================================================================
// Permanently delete a connected-account row — the one implementation, shared
// by every provider that keeps its accounts in `integration_accounts`
// (GoHighLevel subaccounts, CallRail companies, QuickBooks companies).
//
// "Disconnect" marks an account `revoked` and stops syncing it; that is the
// right default, because a disconnected account's history stays readable. What
// was missing is the second step: getting the row out of the panel.
//
// THIS IS NOT A PLAIN DELETE. `integration_accounts` is referenced by eleven
// columns and the rules are not uniform:
//
//   ON DELETE SET NULL   contacts, leads, communications, callrail_calls
//   ON DELETE CASCADE    invoices, payments, monthly_financials,
//                        ghl_appointments, bank_accounts,
//                        bank_balance_snapshots, ad_channel_pipelines
//
// A bare `delete` on a QuickBooks company therefore destroys that company's
// whole P&L — one live account owns 957 monthly_financials rows, 47 invoices
// and 18 bank accounts — and a legacy GoHighLevel row takes 137 synced
// appointments with it. None of that is visible at the call site, so the
// service counts the dependents itself and refuses by default, naming them.
// Passing `confirm` proceeds, which is a decision the owner makes in front of
// the numbers rather than one the schema makes silently on their behalf.
// ============================================================================
import * as errors_1 from "../middleware/errors.js";
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { invalidate as invalidateGating } from "../lib/integration-gating.js";

/**
 * @param {string} orgId
 * @param {string} id        the account row
 * @param {string} provider  the provider whose route this is — the row must match
 * @param {{confirm?: boolean}} opts
 */
export async function deleteAccountPermanently(orgId, id, provider, { confirm = false } = {}) {
    // Org-scoped read: a foreign id resolves to nothing, and the delete stops
    // here rather than falling through to a bare delete by id.
    const account = await integrationAccountRepository.getById(orgId, id);
    if (!account) throw new errors_1.AppError('account not found', 404);
    // The routes are per-provider. A QuickBooks id posted to the GoHighLevel
    // delete route would otherwise drop a company's entire P&L through a panel
    // that never mentions QuickBooks. Reported as 404, not 403: from this
    // route's point of view the account genuinely does not exist.
    if (account.provider !== provider) throw new errors_1.AppError('account not found', 404);
    // Disconnect first, then delete. Two steps, so a live account the owner is
    // still syncing cannot go in one stray click.
    if (account.status !== 'revoked') {
        throw new errors_1.AppError('disconnect this account before deleting it', 409);
    }

    const { cascade, detach } = await integrationAccountRepository.ownedRowCounts(orgId, id);
    const destroys = Object.keys(cascade).length > 0;
    if (destroys && !confirm) {
        // Naming what is in the way is the point. A refusal that only says "no"
        // leaves the owner with a button that does not work, which is the bug
        // this whole change exists to fix.
        throw new errors_1.AppError(
            'this account still owns synced records that deleting it would destroy',
            409,
            'ACCOUNT_OWNS_RECORDS',
            { cascade, detach },
        );
    }

    await integrationAccountRepository.deleteById(orgId, id);
    invalidateGating(orgId);
    // Reported, not assumed: the caller sees exactly what the delete took with
    // it, including the rows that survived and merely lost their attribution.
    return { deleted: true, cascade, detach };
}
