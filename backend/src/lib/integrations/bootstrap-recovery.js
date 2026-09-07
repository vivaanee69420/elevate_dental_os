// ============================================================================
// Finish first pulls that a restart interrupted.
//
// A first pull is an in-process job, so a deploy, an OOM or a dyno recycle kills
// it with no record beyond the rows already written — `last_sync_at` only
// advances on completion, so a half-filled tenant is indistinguishable from one
// that was never connected. Observed live: a deploy stopped a Dentally
// bootstrap at 4,060 patients and 14,463 appointments, with payments, invoices
// and treatment plans never reached and no error recorded anywhere.
//
// `config.bootstrap` is written when a first pull starts and cleared when it
// finishes, so an interrupted one is visible afterwards. This sweep finds
// markers that have gone stale and runs them again; the syncers resume from
// their own phase checkpoints, so a run that died after patients does not
// re-pull them.
//
// Only the providers whose first pull is long enough to be worth resuming are
// listed. The rest sync in seconds: a restart during one costs the next
// scheduled run, not a half-filled tenant.
// ============================================================================
import { integrationRepository } from '../../repositories/integration.repository.js';
import * as supabase_1 from '../supabase.js';

// Imported lazily. These modules import the repositories this one does, and a
// static import here would put the recovery sweep inside their dependency
// graph purely so it can call them back.
const RUNNERS = {
    dentally: async (orgId, row) => (await import('./dentally-sync.js')).bootstrapOnConnect(orgId, row),
    gohighlevel: async (orgId, row) => (await import('./gohighlevel-sync.js')).bootstrapOnConnect(orgId, row),
};
export const RESUMABLE_PROVIDERS = Object.keys(RUNNERS);

// How long a marker must sit untouched before its run is treated as gone. Long
// enough that a live pull is never restarted underneath itself.
export const BOOTSTRAP_STALE_MS = 3 * 60 * 1000;
// A first pull that has died this many times will not succeed by being run
// again — it needs a person. Without a cap, a process that crashes DURING the
// pull relaunches it on every boot, forever, crashing again each time.
export const BOOTSTRAP_MAX_ATTEMPTS = 4;

/** Record that a first pull is in flight. Nothing else knows: last_sync_at is
 *  only stamped on completion. */
export async function markBootstrapStarted(orgId, provider, integration) {
    try {
        await integrationRepository.mergeConfig(orgId, provider, {
            bootstrap: {
                started_at: new Date().toISOString(),
                attempts: Number(integration?.config?.bootstrap?.attempts ?? 0) + 1,
            },
        });
    } catch (err) {
        // Bookkeeping must never block the pull it describes.
        console.warn(`[${provider}] bootstrap marker write skipped: ${err?.message || err}`);
    }
}

/** Clear the marker. Called only on success — a failed run keeps it so the
 *  sweep retries. */
export async function markBootstrapFinished(orgId, provider) {
    try {
        await integrationRepository.mergeConfig(orgId, provider, { bootstrap: null });
    } catch (err) {
        console.warn(`[${provider}] bootstrap marker clear skipped: ${err?.message || err}`);
    }
}

export async function resumeInterruptedImports({ now = Date.now(), providers = RESUMABLE_PROVIDERS } = {}) {
    const resumed = [];
    let checked = 0;
    for (const provider of providers) {
        const run = RUNNERS[provider];
        if (!run) continue;
        const { data: rows, error } = await supabase_1.serviceClient
            .from('integrations')
            .select('*')
            .eq('provider', provider)
            // 'revoked' stays out: a deliberate disconnect with nulled secrets.
            .in('status', ['active', 'failed']);
        if (error) continue;
        checked += (rows ?? []).length;
        for (const row of rows ?? []) {
            const mark = row.config?.bootstrap;
            if (!mark?.started_at) continue;                                    // nothing in flight
            if (now - Date.parse(mark.started_at) < BOOTSTRAP_STALE_MS) continue; // may still be alive
            if (Number(mark.attempts ?? 0) >= BOOTSTRAP_MAX_ATTEMPTS) {
                console.warn(`[${provider}] bootstrap for ${row.organisation_id} gave up after ${mark.attempts} attempts`);
                continue;
            }
            try {
                console.log(`[${provider}] resuming interrupted first pull for ${row.organisation_id}`);
                const r = await run(row.organisation_id, row);
                resumed.push({ orgId: row.organisation_id, provider, error: r?.error ?? null });
            } catch (err) {
                console.error(`[${provider}] bootstrap resume failed for ${row.organisation_id}: ${err?.message || err}`);
            }
        }
    }
    return { checked, resumed: resumed.length, details: resumed };
}
