// One-shot GoHighLevel sync — runs syncAllOrgs ONCE then exits. For a
// schedule-managed (e.g. Railway "Cron Schedule") service that must run-and-exit,
// rather than the persistent node-cron worker in index.js.
//
//   Railway: set this service's Start Command to `node src/workers/ghl-sync-once.js`
//   and the Cron Schedule to `0 22 * * *` (UTC — ~10pm UK; shifts 1h with DST).
//   Do NOT also run the persistent worker (index.js) for the same job.
import 'dotenv/config';
// Sentry after dotenv (so SENTRY_DSN is populated), before the job runs. This
// run-and-exit process needs its own init; no-op when SENTRY_DSN is unset.
import Sentry from '../instrument.js';
import { syncAllOrgs } from '../lib/integrations/gohighlevel-sync.js';

// Cron monitor for the schedule-managed variant of the GHL sync. Run ONLY ONE
// of this and the persistent worker (index.js) for the GHL job.
const monitorConfig = {
    schedule: { type: 'crontab', value: '0 22 * * *' },
    checkinMargin: 5,
    maxRuntime: 55,
};

(async () => {
    const started = Date.now();
    try {
        const results = await Sentry.withMonitor('gohighlevel-sync-once', () => syncAllOrgs(), monitorConfig);
        const secs = Math.round((Date.now() - started) / 1000);
        console.log(`[ghl-sync-once] done in ${secs}s: ${results.length} org(s)`, JSON.stringify(results));
        await Sentry.flush(2000);   // drain buffered events before exit
        process.exit(0);
    } catch (err) {
        console.error('[ghl-sync-once] failed', err);
        await Sentry.flush(2000);
        process.exit(1);
    }
})();
