import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';

const ORG = 'd3256296-afde-4aec-a87b-db3304c1c8d5';
const ASHFORD_SITE = 'f5792c95-ab93-4579-afde-dd5680d02086';
const ASHFORD_PRACTICE = '8a28ccf2-362b-4133-842b-233cc8575cf5';
const { data: integ } = await serviceClient.from('integrations')
  .select('config, secrets').eq('organisation_id', ORG).eq('provider', 'dentally').maybeSingle();
const auth = `Bearer ${JSON.parse(decryptSecret(integ.secrets)).apiKey}`;
const base = integ.config?.base_url ?? 'https://api.dentally.co/v1';

async function pull(path, params, max = 400) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries({ ...params, page, per_page: 100 })) url.searchParams.set(k, String(v));
    const r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': 'p' } });
    if (!r.ok) break;
    const b = await r.json();
    const key = Object.keys(b).find((k) => Array.isArray(b[k]));
    const items = b[key] || [];
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

// (a) live practitioner -> site
const pracs = await pull('/practitioners', {}, 20);
const pracToSite = new Map(pracs.map((p) => [String(p.id), String(p.site_id)]));

// (b) associates -> primary_practice_id (what the sync stores)
const { data: assoc } = await serviceClient.from('associates')
  .select('pms_external_id, primary_practice_id').eq('organisation_id', ORG).not('pms_external_id','is',null);
const pracToPractice = new Map((assoc||[]).map((a) => [String(a.pms_external_id), a.primary_practice_id]));

const items = await pull('/treatment_plan_items', { updated_after: '2026-05-10T00:00:00Z' }, 400);
const lo = Date.parse('2026-06-01T00:00:00Z'), hi = Date.parse('2026-06-16T00:00:00Z');
const win = items.filter((it) => it.completed === true && it.base_chart === false && it.completed_at && Date.parse(it.completed_at) >= lo && Date.parse(it.completed_at) < hi);
console.log('pulled', items.length, 'window completed !base_chart', win.length);

const pence = (it) => Math.round(Number(it.price || 0) * 100);
const bySite = win.filter((it) => pracToSite.get(String(it.practitioner_id)) === ASHFORD_SITE);
const byAssoc = win.filter((it) => pracToPractice.get(String(it.practitioner_id)) === ASHFORD_PRACTICE);
const sum = (a) => (a.reduce((s, it) => s + pence(it), 0) / 100).toFixed(2);
console.log('(a) by live practitioner.site_id==Ashford:', bySite.length, '£' + sum(bySite));
console.log('(b) by associates.primary_practice_id==Ashford:', byAssoc.length, '£' + sum(byAssoc));

// practitioners that differ between the two methods
const siteIds = new Set(bySite.map((it) => String(it.practitioner_id)));
const assocIds = new Set(byAssoc.map((it) => String(it.practitioner_id)));
const onlySite = [...siteIds].filter((id) => !assocIds.has(id));
console.log('\npractitioner_ids counted Ashford by SITE but NOT by associates:');
for (const id of onlySite) {
  const p = pracs.find((x) => String(x.id) === id);
  console.log(`  ${id} site=${p?.site_id} assoc.primary=${pracToPractice.get(id) ?? 'MISSING'} items=${bySite.filter(it=>String(it.practitioner_id)===id).length}`);
}
process.exit(0);
