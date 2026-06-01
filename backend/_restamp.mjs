import 'dotenv/config';
import * as sb from './src/lib/supabase.js';
import { integrationRepository } from './src/repositories/integration.repository.js';
import { syncOneOrg } from './src/lib/integrations/gohighlevel-sync.js';
const org = 'd3256296-afde-4aec-a87b-db3304c1c8d5'; // GM Dental org
const integ = await integrationRepository.getByProvider(org, 'gohighlevel');
const res = await syncOneOrg(org, integ, ()=>{}, { full:false });
console.log('RESYNC:', JSON.stringify(res));
const { count } = await sb.serviceClient.from('leads').select('id',{count:'exact',head:true}).eq('organisation_id',org).eq('source','gohighlevel').gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString());
console.log('leads created today (real GHL date):', count);
process.exit(0);
