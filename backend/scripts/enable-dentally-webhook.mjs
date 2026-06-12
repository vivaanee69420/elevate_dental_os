// Enable an existing Dentally webhook + store its matching secret on our side.
// Usage: node scripts/enable-dentally-webhook.mjs <OrgName> <webhookId> <secret>
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { decryptSecret } from '../src/lib/crypto.js';

const [ORG_NAME, WEBHOOK_ID, SECRET] = process.argv.slice(2);
if (!ORG_NAME || !WEBHOOK_ID || !SECRET) { console.error('args: <OrgName> <webhookId> <secret>'); process.exit(1); }
const BASE = 'https://api.dentally.co/v1';
const mask = s => `${String(s).slice(0,2)}…(${String(s).length})`;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: org } = await sb.from('organisations').select('id,name').ilike('name', ORG_NAME).single();
const { data: integ } = await sb.from('integrations')
  .select('id,secrets,config').eq('organisation_id', org.id).eq('provider', 'dentally').single();
const apiKey = JSON.parse(decryptSecret(integ.secrets)).apiKey;
const auth = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };

console.log(`org=${org.name} webhook=#${WEBHOOK_ID} secret=${mask(SECRET)}`);

// 1) store matching secret on our side FIRST (no failed-delivery window)
const newConfig = { ...(integ.config || {}), webhook_secret: SECRET, webhook_id: Number(WEBHOOK_ID) };
const { error: uerr } = await sb.from('integrations').update({ config: newConfig }).eq('id', integ.id);
if (uerr) { console.error('DB update failed:', uerr.message); process.exit(1); }
console.log('1) stored matching webhook_secret + webhook_id in integrations.config');

// 2) re-enable the webhook on Dentally
const pRes = await fetch(`${BASE}/webhooks/${WEBHOOK_ID}`, {
  method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ webhook: { active: true } }),
});
const pText = await pRes.text();
console.log(`2) PUT /webhooks/${WEBHOOK_ID} active:true -> ${pRes.status}`);
if (!pRes.ok) { console.log(pText.slice(0, 1500)); process.exit(1); }

// 3) verify
const vRes = await fetch(`${BASE}/webhooks/${WEBHOOK_ID}`, { headers: auth });
const v = (await vRes.json()).webhook;
console.log(`3) VERIFY #${v.id}: active=${v.active} events=${JSON.stringify(v.events)} fail=${v.failed_deliveries} ok=${v.successful_deliveries} url=${v.url}`);
console.log('DONE.');
