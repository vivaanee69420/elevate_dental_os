// One-org Dentally resync (recent = last 24 months, bounded). Populates the new
// invoice_items + treatment_plans tables (and refreshes the rest). Run:
//   node --env-file=.env scripts/dentally-resync.mjs <orgId>
import { serviceClient } from '../src/lib/supabase.js';
import { syncOneOrg } from '../src/lib/integrations/dentally-sync.js';

const orgId = process.argv[2];
if (!orgId) { console.error('usage: dentally-resync.mjs <orgId>'); process.exit(1); }

const { data: integ, error } = await serviceClient
  .from('integrations')
  .select('organisation_id, secrets, config, last_sync_at')
  .eq('provider', 'dentally').eq('organisation_id', orgId).single();
if (error || !integ) { console.error('integration not found:', error?.message); process.exit(1); }

console.log(`[resync] org ${orgId} — recent (24mo) pull starting…`);
const t0 = Date.now();
const result = await syncOneOrg(orgId, integ, (p) => {
  if (p?.pct != null) process.stdout.write(`\r[resync] ${p.pct}%   `);
}, { recent: true });
console.log(`\n[resync] done in ${Math.round((Date.now() - t0) / 1000)}s:`);
console.log(JSON.stringify(result, null, 2));
process.exit(0);
