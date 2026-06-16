import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';

const ORG = '1a5f888a-0dfe-4802-acf8-6003665089ad'; // Plan4growth
const ASHFORD_SITE = 'f5792c95-ab93-4579-afde-dd5680d02086';
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

const pracs = await pull('/practitioners', {}, 20);
const pracToSite = new Map(pracs.map((p) => [String(p.id), String(p.site_id)]));

// Plan4growth associates: practitioner -> stored primary_practice_id
const { data: assoc } = await serviceClient.from('associates')
  .select('pms_external_id, primary_practice_id, full_name').eq('organisation_id', ORG).not('pms_external_id','is',null);
const pracToAssoc = new Map((assoc||[]).map((a) => [String(a.pms_external_id), a.primary_practice_id]));
const { data: practices } = await serviceClient.from('practices').select('id, name, pms_site_id').eq('organisation_id', ORG);
const siteToPractice = new Map((practices||[]).map((p) => [String(p.pms_site_id), p.id]));
const practiceName = new Map((practices||[]).map((p) => [p.id, p.name]));
const ASHFORD_PRACTICE = siteToPractice.get(ASHFORD_SITE);
console.log('Plan4growth Ashford practice id:', ASHFORD_PRACTICE);

const items = await pull('/treatment_plan_items', { updated_after: '2026-05-10T00:00:00Z' }, 400);
const lo = Date.parse('2026-06-01T00:00:00Z'), hi = Date.parse('2026-06-16T00:00:00Z');
const win = items.filter((it) => it.completed === true && it.base_chart === false && it.completed_at && Date.parse(it.completed_at) >= lo && Date.parse(it.completed_at) < hi);

// Items that TRULY belong to Ashford (by live practitioner site)
const truthAshford = win.filter((it) => pracToSite.get(String(it.practitioner_id)) === ASHFORD_SITE);
const pence = (it) => Math.round(Number(it.price || 0) * 100);
console.log('TRUTH Ashford June:', truthAshford.length, '£' + (truthAshford.reduce((s,it)=>s+pence(it),0)/100).toFixed(2));

// Of those, which would our STORED attribution (associates) put elsewhere / nowhere?
const mis = {};
for (const it of truthAshford) {
  const stored = pracToAssoc.get(String(it.practitioner_id));
  if (stored !== ASHFORD_PRACTICE) {
    const k = String(it.practitioner_id);
    mis[k] = mis[k] || { prac: k, name: pracs.find(p=>String(p.id)===k)?.user?.last_name || '?', site: pracToSite.get(k), assoc: stored ?? 'MISSING', assocName: stored ? practiceName.get(stored) : 'MISSING', n: 0, v: 0 };
    mis[k].n++; mis[k].v += pence(it);
  }
}
console.log('\nAshford-truth items our associates map MIS-attributes:');
for (const m of Object.values(mis)) console.log(`  prac ${m.prac} site=${m.site} -> assoc=${m.assoc} (${m.assocName})  items=${m.n} £${(m.v/100).toFixed(2)}`);
const totMis = Object.values(mis).reduce((s,m)=>({n:s.n+m.n,v:s.v+m.v}),{n:0,v:0});
console.log(`TOTAL mis-attributed: ${totMis.n} items £${(totMis.v/100).toFixed(2)}`);
process.exit(0);
