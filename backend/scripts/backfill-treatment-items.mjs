import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';
import { syncOneOrg } from '../src/lib/integrations/dentally-sync.js';

const ORG = process.argv[2] || 'd3256296-afde-4aec-a87b-db3304c1c8d5';
const { data: integ } = await serviceClient.from('integrations')
  .select('*').eq('organisation_id', ORG).eq('provider', 'dentally').maybeSingle();
if (!integ) { console.log('no dentally integration for', ORG); process.exit(1); }

// Optional since override (incremental window) so a short, complete window fits
// under the page cap. Falls back to the 1-year recent bootstrap.
const since = process.argv[3];
const opts = since
  ? { resources: ['treatment_items'] }
  : { recent: true, resources: ['treatment_items'] };
const integ2 = since ? { ...integ, last_sync_at: since } : integ;
let last = 0;
const r = await syncOneOrg(ORG, integ2, (p) => {
  if (p.phase === 'treatment_items' && p.count && p.count - last >= 2000) { last = p.count; console.log('treatment_items pulled:', p.count); }
}, opts);
console.log('done:', JSON.stringify(r));
process.exit(0);
