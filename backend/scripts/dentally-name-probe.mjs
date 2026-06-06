// Pull invoice_item treatment NAMES (catalog labels, not patient PII) to tune
// workbench keyword matching. Aggregates distinct names + count + avg fee.
//   node --env-file=.env scripts/dentally-name-probe.mjs <orgId> [pages]
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';

const BASE = 'https://api.dentally.co/v1';
const UA = 'ElevateOS/1.0 (integrations@elevate.app)';
const orgId = process.argv[2];
const PAGES = Number(process.argv[3] || 20);
if (!orgId) { console.error('usage: <orgId> [pages]'); process.exit(1); }

const { data: integ } = await serviceClient.from('integrations')
  .select('secrets').eq('provider', 'dentally').eq('organisation_id', orgId).single();
const auth = `Bearer ${JSON.parse(decryptSecret(integ.secrets)).apiKey}`;

const agg = new Map(); // name -> { n, fee }
for (let page = 1; page <= PAGES; page++) {
  const u = new URL(`${BASE}/invoice_items`);
  u.searchParams.set('updated_since', '2005-01-01T00:00:00.000Z');
  u.searchParams.set('page', page); u.searchParams.set('per_page', '100');
  const res = await fetch(u, { headers: { Authorization: auth, 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) { console.error(`page ${page} HTTP ${res.status}`); break; }
  const body = await res.json();
  const items = body.invoice_item || body.invoice_items || [];
  for (const it of items) {
    const name = (it.name || '(blank)').trim();
    const a = agg.get(name) || { n: 0, fee: 0 };
    a.n += 1; a.fee += Number(it.total_price || it.item_price || 0);
    agg.set(name, a);
  }
  if (items.length < 100) break;
}

const rows = [...agg.entries()].map(([name, a]) => ({ name, n: a.n, avg: Math.round(a.fee / a.n) }))
  .sort((x, y) => y.n - x.n);
console.log(`distinct names: ${rows.length}\n`);
for (const r of rows.slice(0, 60)) console.log(`${String(r.n).padStart(5)}  £${String(r.avg).padStart(6)}  ${r.name}`);
process.exit(0);
