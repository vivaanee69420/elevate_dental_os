// One-shot GoHighLevel sync — runs syncAllOrgs ONCE then exits. For a
// schedule-managed (e.g. Railway "Cron Schedule") service that must run-and-exit,
// rather than the persistent node-cron worker in index.js.
//
//   Railway: set this service's Start Command to `node src/workers/ghl-sync-once.js`
//   and the Cron Schedule to `0 22 * * *` (UTC — ~10pm UK; shifts 1h with DST).
//   Do NOT also run the persistent worker (index.js) for the same job.
import 'dotenv/config';
import { syncAllOrgs } from '../lib/integrations/gohighlevel-sync.js';

(async () => {
    const started = Date.now();
    try {
        const results = await syncAllOrgs();
        const secs = Math.round((Date.now() - started) / 1000);
        console.log(`[ghl-sync-once] done in ${secs}s: ${results.length} org(s)`, JSON.stringify(results));
        process.exit(0);
    } catch (err) {
        console.error('[ghl-sync-once] failed', err);
        process.exit(1);
    }
})();
