// Reconcile + repair all practices in an org for a date window: pull Dentally
// /payments, upsert in-window rows (insert missing + refresh status), then report
// DB vs Dentally per practice. Run:
//   node --env-file=.env scripts/dentally-reconcile-all.mjs <orgId> <from> <to>
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';
import { __test } from '../src/lib/integrations/dentally-sync.js';
const { paymentRow } = __test;

const ORG = process.argv[2] || '1a5f888a-0dfe-4802-acf8-6003665089ad';
const FROM = process.argv[3] || '2026-05-10';
const TO   = process.argv[4] || '2026-06-10';
const BASE = 'https://api.dentally.co/v1', UA = 'ElevateDentalOS/1.0 (reconcile-all)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inWin = (s) => s >= FROM && s <= TO;

const { data: integ } = await serviceClient.from('integrations')
  .select('secrets').eq('organisation_id', ORG).eq('provider', 'dentally').single();
const auth = `Bearer ${JSON.parse(decryptSecret(integ.secrets)).apiKey}`;

const { data: pracs } = await serviceClient.from('practices')
  .select('id, name, pms_site_id').eq('organisation_id', ORG).not('pms_site_id', 'is', null);
const siteMap = new Map(pracs.map((p) => [String(p.pms_site_id), p.id]));   // site -> practice
const nameMap = new Map(pracs.map((p) => [p.id, p.name]));

async function get(params) {
  const url = new URL(BASE + '/payments');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let a = 0; a < 8; a++) {
    const r = await fetch(url, { headers: { Authorization: auth, 'User-Agent': UA, Accept: 'application/json' } });
    if (r.status === 429 || r.status === 403) { // throttle (Dentally uses 403 under load)
      await sleep((Number(r.headers.get('retry-after')) || (a + 1) * 8) * 1000); continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  throw new Error('throttled: retries exhausted');
}

// 1) pull all /payments; tally Dentally window per practice; stash in-window rows
// Dentally returns /payments newest-first, so once we drop below FROM we can
// stop (3-page buffer for any back-dated rows). Avoids paging the whole 31k
// history (and the rate-limit 403 lurking deep in the tail).
const dentTally = new Map(); // practiceId -> {n,amt}
const winRows = []; let page = 1, total = 0, dry = 0, seen = false;
for (;;) {
  const b = await get({ page, per_page: 100 });
  const items = b.payments || [];
  if (!items.length) break;
  let pageHadWin = false;
  for (const p of items) {
    if (p.deleted || !inWin(p.dated_on)) continue;
    pageHadWin = true;
    const prac = siteMap.get(String(p.site_id));
    if (!prac) continue;
    const t = dentTally.get(prac) || { n: 0, amt: 0 };
    t.n++; t.amt += parseFloat(p.amount) || 0; dentTally.set(prac, t);
    winRows.push(p);
  }
  total += items.length;
  if (pageHadWin) { seen = true; dry = 0; } else if (seen) dry++;
  if (page % 25 === 0) console.error(`page ${page} (${total} scanned, ${winRows.length} in window)`);
  const allOlder = items.every((p) => p.dated_on < FROM);
  if (seen && allOlder && dry >= 3) break;
  if (items.length < 100) break; page++; await sleep(300);
}
console.error(`scanned ${total}; ${winRows.length} in-window rows to upsert`);

// 2) contactMap for window patients
const pids = [...new Set(winRows.map((p) => String(p.patient_id)).filter(Boolean))];
const contactMap = new Map();
for (let i = 0; i < pids.length; i += 400) {
  const { data } = await serviceClient.from('contacts').select('id, pms_external_id')
    .eq('organisation_id', ORG).in('pms_external_id', pids.slice(i, i + 400));
  for (const c of data || []) contactMap.set(String(c.pms_external_id), c.id);
}

// 3) upsert window rows; per-row fallback skips constraint violators (logged)
const rows = winRows.map((p) => paymentRow(ORG, p, siteMap, contactMap)).filter(Boolean);
let ok = 0; const bad = [];
for (let i = 0; i < rows.length; i += 300) {
  const chunk = rows.slice(i, i + 300);
  const { error } = await serviceClient.from('payments').upsert(chunk, { onConflict: 'organisation_id,source,external_id' });
  if (!error) { ok += chunk.length; continue; }
  for (const r of chunk) { // isolate the offender
    const { error: e2 } = await serviceClient.from('payments').upsert([r], { onConflict: 'organisation_id,source,external_id' });
    if (e2) bad.push({ ext: r.external_id, method: r.method, err: e2.message }); else ok++;
  }
}
console.error(`upserted ${ok}; skipped ${bad.length}`);
if (bad.length) console.error('SKIPPED:', JSON.stringify(bad.slice(0, 10)));

// 4) DB window per practice (after upsert)
const { data: dbRows } = await serviceClient.rpc ? { data: null } : { data: null };
const report = [];
for (const p of pracs) {
  const { data } = await serviceClient.from('payments')
    .select('amount_pence').eq('practice_id', p.id).eq('source', 'dentally')
    .gte('processed_at', FROM).lte('processed_at', TO + ' 23:59:59');
  const dbN = (data || []).length;
  const dbAmt = (data || []).reduce((s, r) => s + (r.amount_pence || 0), 0) / 100;
  const d = dentTally.get(p.id) || { n: 0, amt: 0 };
  report.push({ practice: nameMap.get(p.id), dentN: d.n, dentAmt: d.amt, dbN, dbAmt, match: dbN === d.n && Math.abs(dbAmt - d.amt) < 0.005 });
}
console.log(`\n=== Reconciliation ${FROM}..${TO} (org ${ORG}) ===`);
for (const r of report) {
  console.log(`${r.match ? 'OK ' : 'XX '} ${r.practice.padEnd(38)} Dentally ${String(r.dentN).padStart(4)}/£${r.dentAmt.toFixed(2).padStart(11)}  DB ${String(r.dbN).padStart(4)}/£${r.dbAmt.toFixed(2).padStart(11)}`);
}
const tDent = report.reduce((s, r) => s + r.dentAmt, 0), tDb = report.reduce((s, r) => s + r.dbAmt, 0);
console.log(`    TOTAL Dentally £${tDent.toFixed(2)}  DB £${tDb.toFixed(2)}  ${Math.abs(tDent - tDb) < 0.005 ? 'MATCH' : 'DIFF £' + (tDent - tDb).toFixed(2)}`);
process.exit(0);
