// Targeted repair of dentally_treatment_items for the displayed (2026) months.
// The full-history backfill keeps tripping Dentally's sustained 403 rate-limit, and
// the card only needs RECENT completions (the bulk of older rows are already stored).
// updated_after=2026-01-01 captures every item touched in 2026 — i.e. all 2026
// completions, the months the Business Hub actually shows — in a few hundred requests.
// Paced under the rate-limit and rate-limit-AWARE: on a 403 "Rate limit exceeded" it
// waits and retries the SAME page, so it converges even if the cap is tripped.
import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';
import { treatmentItemRow } from '../src/lib/integrations/dentally-sync.js';

const ORG = '1a5f888a-0dfe-4802-acf8-6003665089ad'; // Plan4growth
const UPDATED_AFTER = '2026-01-01T00:00:00Z';
const PAGE_DELAY_MS = 450;        // ~130 req/min — under Dentally's sustained cap
const RATE_WAIT_MS = 5 * 60 * 1000; // wait out a tripped sustained cap, then retry the page
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const { data: integ } = await serviceClient.from('integrations')
  .select('config, secrets').eq('organisation_id', ORG).eq('provider', 'dentally').maybeSingle();
const auth = `Bearer ${JSON.parse(decryptSecret(integ.secrets)).apiKey}`;
const base = integ.config?.base_url ?? 'https://api.dentally.co/v1';

// maps (associate primary practice + contact), same as the connector
const practiceByPractitioner = new Map();
const associateMap = new Map();
{
  const { data } = await serviceClient.from('associates')
    .select('id, pms_external_id, primary_practice_id').eq('organisation_id', ORG).not('pms_external_id', 'is', null);
  for (const a of data ?? []) {
    associateMap.set(String(a.pms_external_id), a.id);
    if (a.primary_practice_id) practiceByPractitioner.set(String(a.pms_external_id), a.primary_practice_id);
  }
}
const contactMap = new Map();
for (let from = 0; ; from += 1000) {
  const { data } = await serviceClient.from('contacts').select('id, pms_external_id')
    .eq('organisation_id', ORG).eq('source', 'dentally').not('pms_external_id', 'is', null).range(from, from + 999);
  for (const c of data ?? []) contactMap.set(String(c.pms_external_id), c.id);
  if ((data ?? []).length < 1000) break;
}
console.log(`maps ready: practitioners=${practiceByPractitioner.size} contacts=${contactMap.size}`);

async function getPage(page) {
  for (;;) {
    const url = new URL(`${base}/treatment_plan_items`);
    url.searchParams.set('updated_after', UPDATED_AFTER);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');
    let r;
    try { r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': 'p4g-repair' } }); }
    catch (e) { console.warn(`net blip p${page}: ${e.message} — retrying in 5s`); await sleep(5000); continue; }
    if (r.ok) return r.json();
    const txt = await r.text();
    if ((r.status === 403 || r.status === 429) && /rate limit/i.test(txt)) {
      console.log(`rate-limited at p${page} — waiting ${RATE_WAIT_MS / 60000}m`);
      await sleep(RATE_WAIT_MS);
      continue;
    }
    throw new Error(`HTTP ${r.status} p${page}: ${txt.slice(0, 120)}`);
  }
}

let completed = 0, total = null;
for (let page = 1; ; page++) {
  const b = await getPage(page);
  if (total == null) { total = b.meta?.total ?? null; console.log(`total items updated since 2026-01-01: ${total} (${total ? Math.ceil(total / 100) : '?'} pages)`); }
  const items = b.treatment_plan_items || [];
  const rows = items.filter((it) => it && it.id != null && it.completed === true)
    .map((it) => treatmentItemRow(ORG, it, practiceByPractitioner, associateMap, contactMap));
  if (rows.length) {
    const { error } = await serviceClient.from('dentally_treatment_items')
      .upsert(rows, { onConflict: 'organisation_id,source,pms_external_id' });
    if (error) throw new Error(`upsert p${page}: ${error.message}`);
    completed += rows.length;
  }
  if (page % 20 === 0) console.log(`p${page}/${total ? Math.ceil(total / 100) : '?'} | completed upserted: ${completed}`);
  if (items.length < 100) break;
  await sleep(PAGE_DELAY_MS);
}
console.log(`REPAIR DONE. completed upserted: ${completed}`);
process.exit(0);
