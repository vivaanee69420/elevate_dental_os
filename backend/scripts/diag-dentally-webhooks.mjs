// One-shot diagnostic: what webhooks does Dentally have registered for Plan4growth?
// Read-only. Does NOT print the API key. Run: node scripts/diag-dentally-webhooks.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { decryptSecret } from '../src/lib/crypto.js';

const ORG_NAME = process.argv[2] || 'Plan4growth';
const BASE = 'https://api.dentally.co/v1';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: org, error: oerr } = await sb.from('organisations').select('id,name').ilike('name', ORG_NAME).single();
if (oerr || !org) { console.error('org lookup failed', oerr?.message); process.exit(1); }

const { data: integ, error: ierr } = await sb.from('integrations')
  .select('id,status,secrets,config').eq('organisation_id', org.id).eq('provider', 'dentally').single();
if (ierr || !integ) { console.error('integration lookup failed', ierr?.message); process.exit(1); }

console.log(`org=${org.name} (${org.id}) integration=${integ.id} status=${integ.status}`);
console.log(`config keys: ${Object.keys(integ.config || {}).join(', ') || '(none)'}`);
console.log(`webhook_secret configured: ${!!integ.config?.webhook_secret}`);

let apiKey;
try {
  const parsed = JSON.parse(decryptSecret(integ.secrets));
  apiKey = parsed.apiKey;
} catch (e) { console.error('decrypt failed:', e.message); process.exit(1); }
if (!apiKey) { console.error('no apiKey in decrypted secret'); process.exit(1); }
console.log(`apiKey decrypted ok (len=${apiKey.length})`);

const base = integ.config?.base_url ?? BASE;
const r = await fetch(`${base}/webhooks`, {
  headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': 'dental-os-diag' },
});
console.log(`\nGET ${base}/webhooks -> ${r.status} ${r.statusText}`);
const text = await r.text();
try {
  const j = JSON.parse(text);
  const hooks = j.webhooks || j.data || j;
  console.log(JSON.stringify(hooks, null, 2));
} catch {
  console.log(text.slice(0, 2000));
}
