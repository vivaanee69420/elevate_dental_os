// One-shot Dentally FULL re-sync — recovers fields that null'd on older syncs
// (notably appointments.appointment_type, which powers the Treatment Mix chart).
// A full pull upserts every appointment on (organisation_id, source,
// pms_external_id), so existing rows are UPDATED in place — null appointment_type
// is overwritten with Dentally's `appointment_type ?? reason`. No duplicates.
//
// Usage:
//   node src/workers/dentally-resync-once.js <orgId> [<orgId> ...]   # specific orgs
//   node src/workers/dentally-resync-once.js --all                   # every active dentally org
//
// Targeted (one org) is the default — re-syncing all orgs is a heavy backfill
// (BACKFILL_SINCE 2005, up to 5000 pages/resource), so it must be opted into
// explicitly with --all. Per-org isolation: one org's failure never blocks the rest.
import 'dotenv/config';
import { syncOneOrg } from '../lib/integrations/dentally-sync.js';
import { integrationRepository } from '../repositories/integration.repository.js';
import { serviceClient } from '../lib/supabase.js';

async function loadIntegrations(orgIds) {
    let q = serviceClient
        .from('integrations')
        .select('*')
        .eq('provider', 'dentally')
        .eq('status', 'active');
    if (orgIds.length) q = q.in('organisation_id', orgIds);
    const { data, error } = await q;
    if (error) throw new Error(`load integrations failed: ${error.message}`);
    return data ?? [];
}

(async () => {
    const args = process.argv.slice(2);
    const all = args.includes('--all');
    const orgIds = args.filter((a) => a !== '--all');

    if (!all && orgIds.length === 0) {
        console.error('Usage: node src/workers/dentally-resync-once.js <orgId> [<orgId> ...] | --all');
        process.exit(2);
    }

    const started = Date.now();
    const rows = await loadIntegrations(all ? [] : orgIds);
    if (rows.length === 0) {
        console.error(`[dentally-resync] no active dentally integration found for: ${all ? '--all' : orgIds.join(', ')}`);
        process.exit(1);
    }

    const results = [];
    for (const row of rows) {
        const orgId = row.organisation_id;
        const t0 = Date.now();
        try {
            // full:true -> BACKFILL_SINCE window + lifted page cap: re-pulls and
            // upserts all history, overwriting null appointment_type on old rows.
            const r = await syncOneOrg(orgId, row, () => {}, { full: true });
            // A manual full resync IS the history backfill — record the same
            // one-time flag the nightly syncAllOrgs() sets, so the next cron run
            // rides the cheap incremental cursor instead of re-pulling all of
            // history again. Without this the flag stayed unset on manually
            // backfilled orgs, forcing a redundant full backfill every night.
            if (!r.error) {
                await integrationRepository.mergeConfig(orgId, 'dentally', { history_backfilled: true });
            }
            const secs = Math.round((Date.now() - t0) / 1000);
            console.log(`[dentally-resync] ${orgId} done in ${secs}s`, JSON.stringify(r));
            results.push({ orgId, ...r });
        } catch (err) {
            console.error(`[dentally-resync] ${orgId} failed`, err?.message || err);
            results.push({ orgId, error: String(err?.message || err) });
        }
    }

    const secs = Math.round((Date.now() - started) / 1000);
    const failed = results.filter((r) => r.error).length;
    console.log(`[dentally-resync] all done in ${secs}s: ${results.length} org(s), ${failed} failed`);
    process.exit(failed === results.length ? 1 : 0);
})();
