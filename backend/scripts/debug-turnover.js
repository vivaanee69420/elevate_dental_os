import 'dotenv/config';
import { serviceClient } from '../src/lib/supabase.js';

async function run() {
  const p1 = 'bf70e504-a7e0-45f6-b90b-ef4039e4b789'; // Ashford 1

  const { data: invoices, error } = await serviceClient
    .from('invoices')
    .select('external_id, amount_pence, dated_on, patient_name, paid')
    .eq('practice_id', p1)
    .gte('dated_on', '2026-06-01')
    .lte('dated_on', '2026-06-15')
    .order('dated_on', { ascending: true });
    
  if (error) {
    console.error(error);
    return;
  }
  
  console.log(`Invoices for Ashford 1 (1-15 Jun): ${invoices.length} invoices`);
  for (const inv of invoices) {
    console.log(`${inv.dated_on} | ID: ${inv.external_id} | Patient: ${inv.patient_name || 'N/A'} | Amount: £${(inv.amount_pence/100).toFixed(2)} | Paid: ${inv.paid}`);
  }
}

run().catch(console.error);
