// ============================================================================
// THROWAWAY — one-shot 12-month Dentally re-sync to backfill DNA/cancelled
// (no_show) appointments for a single org. `recent: true` => last 12 months
// with `cancelled: true`, which pulls the previously-withheld DNA + cancelled
// rows. Idempotent upserts; safe to re-run. Delete after use.
//   node src/workers/dentally-noshow-backfill-once.js [orgId]
// Defaults to the GM Dental group org if no arg is given.
// ============================================================================
import "dotenv/config";
import Sentry from "../instrument.js";
import * as dentally from "../lib/integrations/dentally-sync.js";
import { serviceClient } from "../lib/supabase.js";

const orgId = process.argv[2] || "d3256296-afde-4aec-a87b-db3304c1c8d5";

const { data: integration, error } = await serviceClient
    .from("integrations")
    .select("*")
    .eq("provider", "dentally")
    .eq("organisation_id", orgId)
    .eq("status", "active")
    .single();

if (error || !integration) {
    console.error(`[backfill] no active dentally integration for org ${orgId}: ${error?.message || "not found"}`);
    process.exit(1);
}

console.log(`[backfill] org ${orgId} — starting 12-month recent re-sync (cancelled:true)`);
const t = Date.now();
let lastPhase = "";
const onProgress = ({ phase, pct, count }) => {
    if (phase !== lastPhase) {
        lastPhase = phase;
        console.log(`[backfill] phase=${phase} pct=${pct ?? 0} count=${count ?? 0}`);
    }
};

try {
    const r = await dentally.syncOneOrg(orgId, integration, onProgress, { recent: true });
    console.log(`[backfill] DONE in ${Math.round((Date.now() - t) / 1000)}s:`, JSON.stringify(r));
} catch (err) {
    console.error(`[backfill] FAILED — ${err?.message || err}`);
    Sentry.captureException(err);
}
await Sentry.flush(2000).catch(() => {});
process.exit(0);
