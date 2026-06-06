// Fast targeted pull: ONLY invoices + invoice_items + treatment_plans for one
// org (patients/appts/payments already synced). Avoids the slow 24mo re-pull.
//   node --env-file=.env scripts/dentally-pull-invoices.mjs <orgId>
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';
import { __test } from '../src/lib/integrations/dentally-sync.js';

const { fetchAllPages, invoiceItemRow, treatmentPlanRow } = __test;
const BASE = 'https://api.dentally.co/v1';
const SINCE = new Date(Date.now() - 24 * 30 * 86400000).toISOString();
const orgId = process.argv[2];
if (!orgId) { console.error('usage: <orgId>'); process.exit(1); }

const { data: integ } = await serviceClient.from('integrations')
  .select('secrets').eq('provider', 'dentally').eq('organisation_id', orgId).single();
const auth = `Bearer ${JSON.parse(decryptSecret(integ.secrets)).apiKey}`;

async function mapFrom(table, keyCol, valCol, extraEq) {
  const m = new Map(); const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = serviceClient.from(table).select(`${keyCol}, ${valCol}`).eq('organisation_id', orgId).not(keyCol, 'is', null);
    if (extraEq) q = q.eq(extraEq[0], extraEq[1]);
    const { data } = await q.range(from, from + PAGE - 1);
    const rows = data ?? [];
    for (const r of rows) m.set(String(r[keyCol]), r[valCol]);
    if (rows.length < PAGE) break;
  }
  return m;
}

async function upsert(table, rows) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await serviceClient.from(table).upsert(chunk, { onConflict: 'organisation_id,source,pms_external_id' });
    if (error) { console.error(`${table} chunk error: ${error.message}`); } else n += chunk.length;
  }
  return n;
}

console.log('[pull] loading maps…');
const siteMap = await mapFrom('practices', 'pms_site_id', 'id');
const contactMap = await mapFrom('contacts', 'pms_external_id', 'id', ['source', 'dentally']);
const practitionerMap = await mapFrom('associates', 'pms_external_id', 'id');
console.log(`[pull] sites=${siteMap.size} contacts=${contactMap.size} practitioners=${practitionerMap.size}`);

console.log('[pull] /invoices…');
const invoices = await fetchAllPages(BASE, '/invoices', auth, { updated_since: SINCE }, null, 900);
const invoiceMap = new Map();
for (const inv of invoices) if (inv?.id != null) invoiceMap.set(String(inv.id), {
  practice_id: siteMap.get(String(inv.site_id)) ?? null,
  contact_id: contactMap.get(String(inv.patient_id)) ?? null,
  dated_on: inv.dated_on ?? null, paid: inv.paid === true,
});
console.log(`[pull] invoices=${invoices.length}`);

console.log('[pull] /invoice_items…');
const items = await fetchAllPages(BASE, '/invoice_items', auth, { updated_since: SINCE }, null, 900);
const itemRows = items.filter((it) => it?.id != null).map((it) => invoiceItemRow(orgId, it, invoiceMap, practitionerMap));
const itemsSynced = await upsert('invoice_items', itemRows);
console.log(`[pull] invoice_items pulled=${items.length} synced=${itemsSynced}`);

console.log('[pull] /treatment_plans…');
const plans = await fetchAllPages(BASE, '/treatment_plans', auth, { updated_since: SINCE }, null, 900);
const planRows = plans.filter((tp) => tp?.id != null).map((tp) => treatmentPlanRow(orgId, tp, practitionerMap, contactMap));
const plansSynced = await upsert('treatment_plans', planRows);
console.log(`[pull] treatment_plans pulled=${plans.length} synced=${plansSynced}`);

console.log('[pull] DONE');
process.exit(0);
