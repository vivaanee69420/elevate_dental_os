// Backfill: re-pull Dentally /payments and correct payments.status using the
// fixed mapPaymentStatus (unexplained/partially_explained now = settled receipt,
// not pending). The stored rows kept no raw Dentally status, so we re-derive it
// from the live API and update in place by external_id. Amount/date/method are
// already correct and left untouched. Idempotent; safe to re-run.
//
// Run: node --env-file=.env scripts/dentally-backfill-payment-status.mjs
import { serviceClient } from '../src/lib/supabase.js';
import { decryptSecret } from '../src/lib/crypto.js';
import { __test } from '../src/lib/integrations/dentally-sync.js';

const BASE = 'https://api.dentally.co/v1';
const UA = 'ElevateDentalOS/1.0 (status-backfill)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(auth, params) {
  const url = new URL(BASE + '/payments');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let a = 0; a < 5; a++) {
    const r = await fetch(url, { headers: { Authorization: auth, 'User-Agent': UA, Accept: 'application/json' } });
    if (r.status === 429) { await sleep((Number(r.headers.get('retry-after')) || 2) * 1000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
  }
  throw new Error('429 retry loop exhausted');
}

// Update status for a batch of external_ids, only where it actually differs.
async function flip(orgId, status, ids) {
  if (!ids.length) return 0;
  let changed = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const { data, error } = await serviceClient
      .from('payments')
      .update({ status })
      .eq('organisation_id', orgId).eq('source', 'dentally')
      .in('external_id', batch).neq('status', status)
      .select('id');
    if (error) throw new Error(error.message);
    changed += data?.length ?? 0;
  }
  return changed;
}

const { data: integrations } = await serviceClient
  .from('integrations').select('organisation_id, secrets')
  .eq('provider', 'dentally').eq('status', 'active');

for (const integ of integrations ?? []) {
  const orgId = integ.organisation_id;
  let auth;
  try { auth = `Bearer ${JSON.parse(decryptSecret(integ.secrets)).apiKey}`; }
  catch { console.error(`[${orgId}] bad/undecryptable secret — skip`); continue; }

  const byStatus = { settled: [], refunded: [], failed: [], pending: [] };
  let page = 1, scanned = 0, deleted = 0;
  for (;;) {
    let body;
    try { body = await get(auth, { page, per_page: 100 }); }
    catch (e) { console.error(`[${orgId}] page ${page} fetch failed: ${e.message}`); break; }
    const items = body.payments || [];
    if (!items.length) break;
    for (const p of items) {
      if (p.deleted) { deleted++; continue; }          // do not resurrect deleted rows
      const target = __test.mapPaymentStatus(p);         // same logic the sync uses
      (byStatus[target] ||= []).push(String(p.reference ?? p.id));
    }
    scanned += items.length;
    const tp = body.meta?.total_pages || Math.ceil((body.meta?.total || 0) / 100);
    if (page % 25 === 0) console.error(`[${orgId}] page ${page}/${tp} scanned ${scanned}`);
    if (tp && page >= tp) break;
    if (items.length < 100) break;
    page++; await sleep(110);
  }

  let totalChanged = 0;
  for (const st of ['settled', 'refunded', 'failed', 'pending']) {
    const n = await flip(orgId, st, byStatus[st] ?? []);
    totalChanged += n;
    console.log(`[${orgId}] -> ${st}: ${(byStatus[st] ?? []).length} ids, ${n} rows changed`);
  }
  console.log(`[${orgId}] scanned ${scanned} (deleted skipped ${deleted}); ${totalChanged} status rows corrected\n`);
}
process.exit(0);
