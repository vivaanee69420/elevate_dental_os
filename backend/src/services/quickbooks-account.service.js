// ============================================================================
// QuickBooks company service — owner-only management of N QBO companies per org.
// Connection goes through OAuth (returns a redirect URL); each company is one
// integration_accounts row keyed by realmId, populated by the OAuth callback
// (see quickbooks-provider.js). No practice mapping — a QB company is an
// independent entity. Removal revokes the row + purges that company's data.
// ============================================================================
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { integrationRepository } from "../repositories/integration.repository.js";
import { QuickBooksProvider } from "../lib/integrations/quickbooks-provider.js";
import { syncAccount as runSyncAccount } from "../lib/integrations/quickbooks-sync.js";
import { invalidate as invalidateGating } from "../lib/integration-gating.js";
import * as supabase_1 from "../lib/supabase.js";
import * as errors_1 from "../middleware/errors.js";

const PROVIDER = 'quickbooks';

export const quickbooksAccountService = {
    // List connected companies (no secrets). Decorate with the realmId + company
    // name pulled from config for the management UI.
    async listAccounts(orgId) {
        const accounts = await integrationAccountRepository.list(orgId, PROVIDER);
        return {
            accounts: accounts.map((a) => ({
                id: a.id,
                realm_id: a.config?.realm_id ?? a.external_account_id ?? null,
                company_name: a.config?.company_name ?? a.label ?? null,
                label: a.label,
                status: a.status,
                last_sync_at: a.last_sync_at,
                last_error: a.last_error,
                created_at: a.created_at,
            })),
        };
    },

    // Begin connecting a new company: returns the Intuit OAuth redirect URL. The
    // callback creates the integration_accounts row and kicks the first sync.
    async connect(orgId) {
        const { redirectUrl } = await QuickBooksProvider.authorize(orgId);
        return { redirectUrl };
    },

    // Trigger an on-demand sync for one company (fire-and-forget at the caller).
    async syncAccount(orgId, id, opts = {}) {
        const existing = await integrationAccountRepository.getById(orgId, id);
        if (!existing) throw new errors_1.AppError('account not found', 404);
        return runSyncAccount(orgId, id, () => {}, opts);
    },

    // Disconnect a company: revoke the credential row and purge its synced data
    // from the four QB-fed tables. If no active companies remain, flip the marker
    // integrations row to revoked too (un-gates nothing else; just bookkeeping).
    async removeAccount(orgId, id) {
        const existing = await integrationAccountRepository.getById(orgId, id);
        if (!existing) throw new errors_1.AppError('account not found', 404);
        await integrationAccountRepository.markRevoked(orgId, id);
        await this._purgeData(orgId, id);
        const remaining = await integrationAccountRepository.list(orgId, PROVIDER);
        if (!remaining.some((a) => a.status === 'active')) {
            await integrationRepository.markRevoked(orgId, PROVIDER);
        }
        invalidateGating(orgId);
        return { ok: true };
    },

    // Delete this company's rows from monthly_financials / bank_accounts /
    // invoices / payments (every QB write is stamped with integration_account_id).
    async _purgeData(orgId, accountId) {
        for (const table of ['monthly_financials', 'bank_accounts', 'invoices', 'payments']) {
            const { error } = await supabase_1.serviceClient
                .from(table)
                .delete()
                .eq('organisation_id', orgId)
                .eq('integration_account_id', accountId);
            if (error) console.warn(`[quickbooks-account] purge ${table} failed: ${error.message}`);
        }
    },
};
