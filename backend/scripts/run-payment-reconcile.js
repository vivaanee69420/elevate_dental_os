import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';
import { integrationRepository } from '../src/repositories/integration.repository.js';
import { reconcileDeletedPayments } from '../src/lib/integrations/dentally-sync.js';

const ORG = '1a5f888a-0dfe-4802-acf8-6003665089ad';
const DEFAULT_BASE = 'https://api.dentally.co';

async function run() {
  const integ = await integrationRepository.getByProvider(ORG, 'dentally');
  const base = integ?.config?.base_url ?? DEFAULT_BASE;
  // authHeader is internal; reconcile needs the decrypted Bearer. Pull it the
  // same way the sync does via the exported helper on __test.
  const { __test } = await import('../src/lib/integrations/dentally-sync.js');
  const auth = __test.authHeader(integ.secrets);

  // Same ±35-day window the sync uses.
  const wMs = 35 * 86400000;
  const sinceISO = new Date(Date.now() - wMs).toISOString();
  const untilISO = new Date(Date.now() + wMs).toISOString();

  console.log(`Reconciling payments for org ${ORG}, window ${sinceISO.slice(0,10)}..${untilISO.slice(0,10)}`);
  const res = await reconcileDeletedPayments(ORG, base, auth, { sinceISO, untilISO });
  console.log('RESULT:', JSON.stringify(res));
}
run().catch((e) => { console.error(e); process.exit(1); });
