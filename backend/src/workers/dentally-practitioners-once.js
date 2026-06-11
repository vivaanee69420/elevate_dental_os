// ============================================================================
// One-shot Dentally practitioners-only sync. Backfills the practitioner-endpoint
// metadata (gdc_number, nhs_number, colour, dentally_role, uda_target, uoa_target)
// and pms_user_id onto existing associates rows WITHOUT running the heavy
// patients/appointments/invoice phases. Fast (the clinician set is a few pages).
//   node src/workers/dentally-practitioners-once.js [orgId|--all]
// Defaults to the GM Dental group org if no arg is given. Idempotent; safe re-run.
// ============================================================================
import "dotenv/config";
import Sentry from "../instrument.js";
import * as dentally from "../lib/integrations/dentally-sync.js";
import { serviceClient } from "../lib/supabase.js";

const arg = process.argv[2];
const DEFAULT_ORG = "d3256296-afde-4aec-a87b-db3304c1c8d5"; // GM Dental group

let query = serviceClient
    .from("integrations")
    .select("*")
    .eq("provider", "dentally")
    .eq("status", "active");
query = arg === "--all" ? query : query.eq("organisation_id", arg || DEFAULT_ORG);

const { data: integrations, error } = await query;

if (error || !integrations?.length) {
    console.error(`[practitioners] no active dentally integration(s): ${error?.message || "not found"}`);
    process.exit(1);
}

let failed = 0;
for (const integration of integrations) {
    const orgId = integration.organisation_id;
    const t = Date.now();
    try {
        const r = await dentally.syncPractitionersOnly(orgId, integration);
        if (r?.error) throw new Error(r.error);
        console.log(`[practitioners] org ${orgId} — synced ${r.synced} in ${Math.round((Date.now() - t) / 1000)}s`);
    } catch (err) {
        failed++;
        console.error(`[practitioners] org ${orgId} FAILED — ${err?.message || err}`);
        Sentry.captureException(err);
    }
}

await Sentry.flush(2000).catch(() => {});
process.exit(failed ? 1 : 0);
