import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';
import { syncPractitionersOnly, syncOneOrg } from '../src/lib/integrations/dentally-sync.js';

const ORG = process.argv[2];
if (!ORG) { console.log('usage: node backfill-items-full.mjs <orgId>'); process.exit(1); }
const { data: integ } = await serviceClient.from('integrations')
  .select('*').eq('organisation_id', ORG).eq('provider', 'dentally').maybeSingle();
if (!integ) { console.log('no dentally integration'); process.exit(1); }

// Refresh practitioners so associates.primary_practice_id (practice attribution) is current.
const pr = await syncPractitionersOnly(ORG, integ);
console.log('practitioners:', JSON.stringify(pr));

// Production legacy-backfill path: full window (2yr) + BACKFILL_MAX_PAGES cap.
let last = 0;
const r = await syncOneOrg(ORG, integ, (p) => {
  if (p.phase === 'treatment_items' && p.count && p.count - last >= 5000) { last = p.count; console.log('items pulled:', p.count); }
}, { full: true, resources: ['treatment_items'] });
console.log('done items:', r.treatment_items);
process.exit(0);
