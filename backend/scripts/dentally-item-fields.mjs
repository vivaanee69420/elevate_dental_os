// One-shot field probe: dump the RAW shape of Dentally /invoice_items so we can
// see whether items carry their OWN date (vs inheriting the invoice's dated_on).
// Used to fix turnover date-basis (we currently stamp items with inv.dated_on).
//   node --env-file=.env scripts/dentally-item-fields.mjs <orgId>
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';

const BASE = 'https://api.dentally.co/v1';
const orgId = process.argv[2];
if (!orgId) { console.error('usage: <orgId>'); process.exit(1); }

const { data: integ } = await serviceClient.from('integrations')
  .select('secrets').eq('provider', 'dentally').eq('organisation_id', orgId).single();
const auth = `Bearer ${JSON.parse(decryptSecret(integ.secrets)).apiKey}`;

const res = await fetch(`${BASE}/invoice_items?per_page=3`, { headers: { Authorization: auth } });
const body = await res.json();
const items = body.invoice_items ?? body.invoice_item ?? [];
console.log('HTTP', res.status, 'count', items.length);
if (items[0]) {
  console.log('\nKEYS:', Object.keys(items[0]).sort().join(', '));
  console.log('\nDATE-LIKE FIELDS:');
  for (const it of items) {
    const dates = Object.fromEntries(Object.entries(it).filter(([k]) => /date|_at|_on|created|perform|complet/i.test(k)));
    console.log(' ', JSON.stringify(dates));
  }
  console.log('\nSAMPLE[0]:', JSON.stringify(items[0], null, 2));
}
process.exit(0);
