import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';

const ORG = 'd3256296-afde-4aec-a87b-db3304c1c8d5';
const ASHFORD_PMS_SITE = 'f5792c95-ab93-4579-afde-dd5680d02086'; // practices.pms_site_id
const { data: integ } = await serviceClient.from('integrations')
  .select('config, secrets').eq('organisation_id', ORG).eq('provider', 'dentally').maybeSingle();
const auth = `Bearer ${JSON.parse(decryptSecret(integ.secrets)).apiKey}`;
const base = integ.config?.base_url ?? 'https://api.dentally.co/v1';

async function pull(path, params, max = 200) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries({ ...params, page, per_page: 100 })) url.searchParams.set(k, String(v));
    const r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': 'p' } });
    if (!r.ok) { console.log(path, 'HTTP', r.status); break; }
    const b = await r.json();
    const key = Object.keys(b).find((k) => Array.isArray(b[k]));
    const items = b[key] || [];
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

// practitioner_id -> pms_site_id (one sample practitioner first to see shape)
const prac1 = await pull('/practitioners', { page: 1 }, 1);
console.log('practitioner fields:', prac1[0] ? Object.keys(prac1[0]) : null);
console.log('practitioner sample:', JSON.stringify({ id: prac1[0]?.id, site_id: prac1[0]?.site_id, user_id: prac1[0]?.user_id }));

const practitioners = await pull('/practitioners', {}, 20);
const pracToSite = new Map();
for (const p of practitioners) pracToSite.set(String(p.id), String(p.site_id));
console.log('practitioners:', practitioners.length);

// Pull completed items updated since late May (catches June completions). updated_after WORKS.
const items = await pull('/treatment_plan_items', { updated_after: '2026-05-20T00:00:00Z' }, 300);
console.log('items pulled (updated_after 2026-05-20):', items.length);

// Filter: completed in [2026-06-01, 2026-06-16)
const lo = Date.parse('2026-06-01T00:00:00Z'), hi = Date.parse('2026-06-16T00:00:00Z');
const inWin = items.filter((it) => it.completed === true && it.completed_at && Date.parse(it.completed_at) >= lo && Date.parse(it.completed_at) < hi);
console.log('completed in [06-01,06-16):', inWin.length);

// Attribute to Ashford via practitioner site
const ashford = inWin.filter((it) => pracToSite.get(String(it.practitioner_id)) === ASHFORD_PMS_SITE);
const pence = (it) => Math.round(Number(it.price || 0) * 100);
const sum = ashford.reduce((s, it) => s + pence(it), 0);
const patients = new Set(ashford.map((it) => it.patient_id)).size;
console.log('\n--- ASHFORD via practitioner-site, completed 01-15 Jun ---');
console.log('items:', ashford.length, '| patients:', patients, '| value: £' + (sum / 100).toFixed(2));
console.log('Dentally report: 421 / 223 patients / £79,757.72');
// count semantics diagnostics
const cnt = (pred) => ashford.filter(pred).length;
console.log('\nappear_on_invoice=true:', cnt((it) => it.appear_on_invoice === true));
console.log('base_chart=true:', cnt((it) => it.base_chart === true), '| base_chart=false:', cnt((it) => it.base_chart === false));
console.log('charged=true:', cnt((it) => it.charged === true));
console.log('price>0:', cnt((it) => pence(it) > 0), '| price=0:', cnt((it) => pence(it) === 0));
console.log('distinct treatment_appointment_id:', new Set(ashford.map((it) => it.treatment_appointment_id)).size);
console.log('distinct id:', new Set(ashford.map((it) => it.id)).size);
console.log('region values:', JSON.stringify([...new Set(ashford.map((it)=>it.region))]));
// combos
console.log('\nappear_on_invoice=true value: £' + (ashford.filter(it=>it.appear_on_invoice===true).reduce((s,it)=>s+pence(it),0)/100).toFixed(2));
console.log('base_chart=false count:', cnt((it) => it.base_chart === false), 'value: £' + (ashford.filter(it=>it.base_chart===false).reduce((s,it)=>s+pence(it),0)/100).toFixed(2));
process.exit(0);
