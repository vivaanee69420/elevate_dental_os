// Refresh stale invoices.paid for Plan4growth, then propagate to invoice_items.
// The nightly /invoices + propagate_invoice_paid phases have been 403-rate-limit-
// failing (they run last), so invoices.paid was 3 days stale and Plan Fees Collected
// understated. Re-pull recently-changed invoices (updated_after — the filter Dentally
// honours) into the invoices table, then run propagate_invoice_paid to refresh the
// invoice_items.invoice_paid flag the card reads. Paced + 403-aware.
import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';
import { invoiceRow } from '../src/lib/integrations/dentally-sync.js';

const ORG = '1a5f888a-0dfe-4802-acf8-6003665089ad';
const UPDATED_AFTER = '2026-05-01T00:00:00Z'; // covers the months the cards show
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const { data: integ } = await serviceClient.from('integrations')
  .select('config, secrets').eq('organisation_id', ORG).eq('provider', 'dentally').maybeSingle();
const auth = `Bearer ${JSON.parse(decryptSecret(integ.secrets)).apiKey}`;
const base = integ.config?.base_url ?? 'https://api.dentally.co/v1';

// siteMap: pms_site_id -> practice_id ; contactMap: pms patient id -> contact_id
const siteMap = new Map();
{
  const { data } = await serviceClient.from('practices').select('id, pms_site_id')
    .eq('organisation_id', ORG).not('pms_site_id', 'is', null);
  for (const p of data ?? []) siteMap.set(String(p.pms_site_id), p.id);
}
const contactMap = new Map();
for (let from = 0; ; from += 1000) {
  const { data } = await serviceClient.from('contacts').select('id, pms_external_id')
    .eq('organisation_id', ORG).eq('source', 'dentally').not('pms_external_id', 'is', null).range(from, from + 999);
  for (const c of data ?? []) contactMap.set(String(c.pms_external_id), c.id);
  if ((data ?? []).length < 1000) break;
}

let synced = 0, skipped = 0;
for (let page = 1; ; page++) {
  const url = new URL(`${base}/invoices`);
  url.searchParams.set('updated_after', UPDATED_AFTER);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', '100');
  let r;
  try { r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': 'p4g-invrefresh' } }); }
  catch (e) { console.warn(`net blip p${page}: ${e.message}`); await sleep(5000); page--; continue; }
  if (!r.ok) {
    const txt = await r.text();
    if ((r.status === 403 || r.status === 429) && /rate limit/i.test(txt)) { console.log(`rate-limited p${page} — wait 5m`); await sleep(5 * 60 * 1000); page--; continue; }
    throw new Error(`HTTP ${r.status} p${page}: ${txt.slice(0, 120)}`);
  }
  const b = await r.json();
  const items = b.invoices || [];
  const rows = items.map((inv) => invoiceRow(ORG, inv, siteMap, contactMap)).filter(Boolean);
  skipped += items.length - rows.length;
  if (rows.length) {
    const { error } = await serviceClient.from('invoices').upsert(rows, { onConflict: 'organisation_id,source,external_id' });
    if (error) throw new Error(`upsert p${page}: ${error.message}`);
    synced += rows.length;
  }
  if (page % 10 === 0) console.log(`p${page} | invoices upserted: ${synced} skipped: ${skipped}`);
  if (items.length < 100) break;
  await sleep(450);
}
console.log(`invoices refreshed: ${synced} (skipped ${skipped})`);

const { data: prop, error: perr } = await serviceClient.rpc('propagate_invoice_paid', { p_org: ORG });
if (perr) throw new Error(`propagate: ${perr.message}`);
console.log('propagate_invoice_paid ->', JSON.stringify(prop));
process.exit(0);
