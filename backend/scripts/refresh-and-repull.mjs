import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';
import { syncPractitionersOnly, syncOneOrg } from '../src/lib/integrations/dentally-sync.js';

const ORG = 'd3256296-afde-4aec-a87b-db3304c1c8d5';
const { data: integ } = await serviceClient.from('integrations')
  .select('*').eq('organisation_id', ORG).eq('provider', 'dentally').maybeSingle();

const pr = await syncPractitionersOnly(ORG, integ);
console.log('practitioners refreshed:', JSON.stringify(pr));

const r = await syncOneOrg(ORG, { ...integ, last_sync_at: '2026-05-10T00:00:00Z' }, () => {}, { resources: ['treatment_items'] });
console.log('items re-pulled:', r.treatment_items);
process.exit(0);
