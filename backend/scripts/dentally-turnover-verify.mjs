// Verify which date basis reproduces Dentally's Income report (£669,523.74 for
// Ashford, 01 Jan -> 10 Jun 2026). Pulls /invoices + /invoice_items live, buckets
// Ashford items two ways: by INVOICE dated_on (what we sync) vs by ITEM created_at.
//   node --env-file=.env scripts/dentally-turnover-verify.mjs <orgId> <ashfordPracticeId>
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';
import { __test } from '../src/lib/integrations/dentally-sync.js';

const { fetchAllPages } = __test;
const BASE = 'https://api.dentally.co/v1';
const SINCE = new Date(Date.now() - 24 * 30 * 86400000).toISOString();
const [orgId, ashfordPid] = process.argv.slice(2);
if (!orgId || !ashfordPid) { console.error('usage: <orgId> <ashfordPracticeId>'); process.exit(1); }

const { data: integ } = await serviceClient.from('integrations')
  .select('secrets').eq('provider', 'dentally').eq('organisation_id', orgId).single();
const auth = `Bearer ${JSON.parse(decryptSecret(integ.secrets)).apiKey}`;

// pms_site_id -> practice_id
const { data: pracs } = await serviceClient.from('practices')
  .select('id, pms_site_id').eq('organisation_id', orgId);
const siteToPractice = new Map((pracs ?? []).map((p) => [String(p.pms_site_id), p.id]));

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const CACHE = '/tmp/dentally-verify-cache.json';
let invMeta, items;
if (existsSync(CACHE)) {
  console.log('[cache] loading', CACHE);
  const c = JSON.parse(readFileSync(CACHE, 'utf8'));
  invMeta = new Map(c.invMeta);
  items = c.items;
  console.log(`[cache] invoices=${invMeta.size} items=${items.length}`);
} else {
  console.log('[pull] /invoices…');
  const invoices = await fetchAllPages(BASE, '/invoices', auth, { updated_since: SINCE }, null, 900);
  invMeta = new Map();
  for (const inv of invoices) if (inv?.id != null) invMeta.set(String(inv.id), {
    practice_id: siteToPractice.get(String(inv.site_id)) ?? null,
    dated_on: inv.dated_on ?? null,
  });
  console.log('[pull] /invoice_items…');
  const raw = await fetchAllPages(BASE, '/invoice_items', auth, { updated_since: SINCE }, null, 900);
  // keep only fields we analyse, to shrink the cache
  items = raw.map((it) => ({ name: it.name, quantity: it.quantity, total_price: it.total_price,
    item_price: it.item_price, invoice_id: it.invoice_id, treatment_plan_id: it.treatment_plan_id,
    treatment_plan_item_id: it.treatment_plan_item_id, created_at: it.created_at }));
  writeFileSync(CACHE, JSON.stringify({ invMeta: [...invMeta], items }));
  console.log(`[cache] wrote ${CACHE} invoices=${invMeta.size} items=${items.length}`);
}

const FROM = '2026-01-01', TO = '2026-06-11'; // [FROM, TO)
const inWin = (d) => d && d.slice(0, 10) >= FROM && d.slice(0, 10) < TO;
const pounds = (n) => (n / 1).toFixed(2);

const clean = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const norm = (s) => clean(s);                       // our it.name has no code prefix
// CSV name = "code - actual name"; strip up to the FIRST " - " (spaced hyphen).
const normCsv = (s) => { const i = String(s).indexOf(' - '); return clean(i >= 0 ? s.slice(i + 3) : s); };

// our windowed Ashford totals by normalised name
const ours = new Map();
for (const it of items) {
  const inv = invMeta.get(String(it.invoice_id));
  if (!inv || inv.practice_id !== ashfordPid) continue;
  if (!inWin(inv.dated_on)) continue;
  const fee = Number(it.total_price ?? it.item_price ?? 0);
  if (fee === 0) continue;
  const k = norm(it.name);
  const o = ours.get(k) || { qty: 0, sum: 0 }; o.qty += Number(it.quantity) || 1; o.sum += fee; ours.set(k, o);
}
// Dentally CSV (repo root)
const csv = new Map();
for (const line of readFileSync('../income_report_invoiced_items_20260610.csv', 'utf8').split('\n').slice(1)) {
  if (!line.trim()) continue;
  const m = line.match(/^(.*),(\d+),([\d.]+)$/) || line.match(/^"(.*)",(\d+),([\d.]+)$/);
  if (!m) continue;
  csv.set(normCsv(m[1].replace(/^"|"$/g, '')), { qty: +m[2], sum: +m[3] });
}
// Dedup test: does counting each treatment_plan_item_id ONCE match Dentally?
let rawSum = 0, dedupSum = 0, dupVal = 0, dupN = 0;
const seenTpi = new Set();
for (const it of items) {
  const inv = invMeta.get(String(it.invoice_id));
  if (!inv || inv.practice_id !== ashfordPid || !inWin(inv.dated_on)) continue;
  const fee = Number(it.total_price ?? it.item_price ?? 0);
  if (fee === 0) continue;
  rawSum += fee;
  const tpi = it.treatment_plan_item_id;
  if (tpi != null) {
    if (seenTpi.has(String(tpi))) { dupVal += fee; dupN++; continue; }
    seenTpi.add(String(tpi));
  }
  dedupSum += fee;
}
console.log(`\nRAW positive sum:                 £${pounds(rawSum)}`);
console.log(`DEDUP by treatment_plan_item_id:  £${pounds(dedupSum)}   (dropped ${dupN} dup lines = £${pounds(dupVal)})`);
console.log(`Dentally Income target:           £669,523.74`);

const names = new Set([...ours.keys(), ...csv.keys()]);
const rows = [];
for (const n of names) {
  const o = ours.get(n) || { qty: 0, sum: 0 }, c = csv.get(n) || { qty: 0, sum: 0 };
  rows.push({ n, dSum: o.sum - c.sum, dQty: o.qty - c.qty, oSum: o.sum, cSum: c.sum });
}
rows.sort((a, b) => Math.abs(b.dSum) - Math.abs(a.dSum));
console.log(`\nTop name-level diffs (ours - Dentally), gap total £${pounds([...ours.values()].reduce((s, v) => s + v.sum, 0) - 669523.74)}:`);
for (const r of rows.slice(0, 25))
  console.log(`  £${pounds(r.dSum).padStart(11)}  dQty=${String(r.dQty).padStart(4)}  ours=${pounds(r.oSum).padStart(10)} dent=${pounds(r.cSum).padStart(10)}  ${r.n}`);
process.exit(0);
