import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';
import { integrationRepository } from '../src/repositories/integration.repository.js';
import { __test } from '../src/lib/integrations/dentally-sync.js';

const { fetchAllPages, authHeader } = __test;
const ORG = '1a5f888a-0dfe-4802-acf8-6003665089ad';
const SITE = 'f5792c95-ab93-4579-afde-dd5680d02086'; // Ashford
const FROM = '2026-06-01', TO = '2026-06-15';
const DEFAULT_BASE = 'https://api.dentally.co';

const inWin = (d) => d && d >= FROM && d <= TO;

async function run() {
  const integ = await integrationRepository.getByProvider(ORG, 'dentally');
  if (!integ) return console.error('no dentally integration');
  const base = integ.config?.base_url ?? DEFAULT_BASE;
  const auth = authHeader(integ.secrets);
  if (!auth) return console.error('no auth');

  // Dentally live feed
  const pays = await fetchAllPages(base, '/payments', auth, { dated_after: FROM });
  const live = pays.filter((p) => String(p.site_id) === SITE && inWin(p.dated_on));
  let liveSum = 0, liveNeg = 0;
  const liveIds = new Set();
  for (const p of live) {
    liveIds.add(String(p.id));
    const pence = Math.round(Number(p.amount) * 100);
    liveSum += pence;
    if (pence < 0) liveNeg += pence;
  }

  // Our DB rows (settled, the Takings feed)
  const { data: ours } = await serviceClient
    .from('payments')
    .select('external_id, amount_pence, status, method, processed_at')
    .eq('practice_id', 'bf70e504-a7e0-45f6-b90b-ef4039e4b789')
    .eq('status', 'settled')
    .gte('processed_at', '2026-06-01T00:00:00Z')
    .lt('processed_at', '2026-06-16T00:00:00Z');
  const ourIds = new Set(ours.map((r) => String(r.external_id)));
  const ourSum = ours.reduce((s, r) => s + r.amount_pence, 0);

  // Diff
  const phantom = ours.filter((r) => !liveIds.has(String(r.external_id))); // in our DB, NOT in live feed
  const missing = live.filter((p) => !ourIds.has(String(p.id)));           // in live, NOT in our DB
  const phantomSum = phantom.reduce((s, r) => s + r.amount_pence, 0);

  console.log('=== Dentally live /payments (Ashford, 1-15 Jun) ===');
  console.log(`rows=${live.length}  sum=£${(liveSum/100).toFixed(2)}  negatives=£${(liveNeg/100).toFixed(2)}`);
  console.log(`=== Our DB settled rows ===`);
  console.log(`rows=${ours.length}  sum=£${(ourSum/100).toFixed(2)}`);
  console.log(`=== DIFF ===`);
  console.log(`our_sum - live_sum = £${((ourSum-liveSum)/100).toFixed(2)}`);
  console.log(`PHANTOM rows (in our DB, NOT in current Dentally feed): ${phantom.length}  £${(phantomSum/100).toFixed(2)}`);
  for (const r of phantom) console.log(`  ext ${r.external_id} | £${(r.amount_pence/100).toFixed(2)} | ${r.method} | ${r.processed_at}`);
  console.log(`MISSING rows (in Dentally feed, NOT in our DB): ${missing.length}`);
  for (const p of missing.slice(0,20)) console.log(`  ext ${p.id} | £${Number(p.amount).toFixed(2)} | paid=${p.paid} | ${p.dated_on}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
