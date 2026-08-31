// THROWAWAY read-only spike: does GHL carry ad attribution (gclid/adId/utm)?
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { decryptSecret } from './src/lib/crypto.js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const API='https://services.leadconnectorhq.com', VER='2021-07-28';
const H=(t)=>({Authorization:`Bearer ${t}`,Version:VER,Accept:'application/json'});

const { data: accts } = await db.from('integration_accounts')
  .select('id,external_id,name,secrets,status').eq('provider','gohighlevel').eq('status','active').limit(3);
console.log(`active GHL subaccounts: ${accts?.length ?? 0}`);

for (const a of accts ?? []) {
  console.log(`\n=== ${a.name} (location ${a.external_id}) ===`);
  let token;
  try { token = JSON.parse(decryptSecret(a.secrets)).access_token ?? JSON.parse(decryptSecret(a.secrets)).api_key; }
  catch (e) { console.log('  secret decode failed:', e.message); continue; }

  // Pull a page of contacts and inspect attribution shape.
  const u = new URL(`${API}/contacts/`);
  u.searchParams.set('locationId', a.external_id);
  u.searchParams.set('limit','100');
  const r = await fetch(u,{headers:H(token)});
  const b = await r.json().catch(()=>({}));
  if (!r.ok) { console.log(`  contacts HTTP ${r.status}:`, JSON.stringify(b).slice(0,200)); continue; }
  const contacts = b.contacts ?? [];
  console.log(`  contacts pulled: ${contacts.length}`);
  if (!contacts.length) continue;

  // Which attribution-ish keys exist at all?
  const keys = new Set();
  for (const c of contacts) for (const k of Object.keys(c)) keys.add(k);
  console.log('  contact keys:', [...keys].join(', '));

  const withAttr = contacts.filter(c => c.attributionSource || c.lastAttributionSource);
  console.log(`  >>> contacts with attributionSource: ${withAttr.length}/${contacts.length}`);
  const cover = {};
  for (const c of contacts) {
    for (const src of ['attributionSource','lastAttributionSource']) {
      const o = c[src]; if (!o) continue;
      for (const [k,v] of Object.entries(o)) {
        cover[`${src}.${k}`] ??= {n:0};
        if (v !== null && v !== '' && v !== undefined) cover[`${src}.${k}`].n++;
      }
    }
  }
  if (Object.keys(cover).length) {
    console.log('  attribution field coverage (non-empty / 100 contacts):');
    for (const [k,v] of Object.entries(cover).sort((x,y)=>y[1].n-x[1].n)) console.log(`    ${k.padEnd(42)} ${v.n}`);
  }
  // Show one full example so we see the real shape.
  const ex = withAttr[0];
  if (ex) console.log('  EXAMPLE attributionSource:', JSON.stringify(ex.attributionSource, null, 2).slice(0,900));

  // Single-contact GET often returns richer attribution than the list.
  if (contacts[0]?.id) {
    const r2 = await fetch(`${API}/contacts/${contacts[0].id}`,{headers:H(token)});
    const b2 = await r2.json().catch(()=>({}));
    const c2 = b2.contact ?? {};
    console.log('  single-GET attribution keys:', Object.keys(c2).filter(k=>/attribut|utm|source/i.test(k)).join(', ') || '(none)');
    if (c2.attributionSource) console.log('  single-GET attributionSource:', JSON.stringify(c2.attributionSource).slice(0,600));
  }
}
