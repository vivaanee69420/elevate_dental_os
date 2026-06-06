// Read-only Dentally payload probe. Pulls ONE record from each endpoint for a
// connected org and prints the field SHAPE (keys + types) so we can verify the
// real payload before changing the connector. PII-safe: string values are
// redacted to "<str:len>"; numbers/booleans/enums are shown (so we can see
// which fields carry money + categories). Run:
//   node --env-file=.env scripts/dentally-probe.mjs
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';

const BASE = 'https://api.dentally.co/v1';
const UA = 'ElevateOS/1.0 (integrations@elevate.app)';
const SINCE = '2005-01-01T00:00:00.000Z';

function authHeader(secrets) {
  try {
    const parsed = JSON.parse(decryptSecret(secrets));
    return parsed.apiKey ? `Bearer ${parsed.apiKey}` : null;
  } catch (e) { return null; }
}

// Redact a value to its shape. Strings -> length only (PII-safe). Numbers,
// booleans, null shown. Objects -> nested keys. Arrays -> [type of first].
function shape(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? `[${v.length} x ${shape(v[0], depth + 1)}]` : '[]';
  const t = typeof v;
  if (t === 'number') return `num(${v})`;
  if (t === 'boolean') return `bool(${v})`;
  if (t === 'string') return `"<str:${v.length}>"`;
  if (t === 'object') {
    if (depth >= 2) return '{…}';
    const inner = Object.entries(v).map(([k, val]) => `${k}: ${shape(val, depth + 1)}`);
    return `{ ${inner.join(', ')} }`;
  }
  return t;
}

async function probe(auth, path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, val] of Object.entries({ updated_since: SINCE, page: 1, per_page: 1, ...params })) {
    url.searchParams.set(k, String(val));
  }
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: auth, 'User-Agent': UA, Accept: 'application/json' } });
  } catch (e) {
    return console.log(`\n### ${path}\n  NETWORK ERROR: ${e.message}`);
  }
  console.log(`\n### ${path}  ->  HTTP ${res.status}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return console.log(`  body: ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  const wrapperKey = Object.keys(body).find((k) => Array.isArray(body[k]));
  console.log(`  wrapper key: ${wrapperKey ?? '(none)'} · meta: ${JSON.stringify(body.meta ?? {}).slice(0, 120)}`);
  const item = wrapperKey ? body[wrapperKey][0] : (body[path.replace('/', '').replace(/s$/, '')] ?? null);
  if (!item) return console.log('  (no rows returned)');
  for (const [k, v] of Object.entries(item)) console.log(`  ${k}: ${shape(v)}`);
}

const { data: rows, error } = await serviceClient
  .from('integrations')
  .select('organisation_id, secrets, config, last_sync_at')
  .eq('provider', 'dentally')
  .not('secrets', 'is', null);
if (error) { console.error('DB error:', error.message); process.exit(1); }

let used = null;
for (const r of rows) {
  const auth = authHeader(r.secrets);
  if (!auth) { console.log(`org ${r.organisation_id}: secrets did not decrypt, skipping`); continue; }
  // Quick liveness check before committing to the full probe.
  try {
    const u = new URL(`${BASE}/appointments`);
    u.searchParams.set('updated_since', SINCE); u.searchParams.set('per_page', '1');
    const t = await fetch(u, { headers: { Authorization: auth, 'User-Agent': UA, Accept: 'application/json' } });
    if (t.ok) { used = { org: r.organisation_id, auth }; break; }
    console.log(`org ${r.organisation_id}: appointments probe HTTP ${t.status}, trying next`);
  } catch (e) { console.log(`org ${r.organisation_id}: ${e.message}, trying next`); }
}
if (!used) { console.error('No org returned a live Dentally response.'); process.exit(1); }

console.log(`\n=== Probing with org ${used.org} ===`);
await probe(used.auth, '/appointments');
await probe(used.auth, '/treatment_plans');
await probe(used.auth, '/invoices');
await probe(used.auth, '/invoice_items');
await probe(used.auth, '/payments');
console.log('\nDone.');
process.exit(0);
