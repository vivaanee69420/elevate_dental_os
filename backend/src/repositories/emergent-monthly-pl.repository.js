// Emergent monthly P&L repository. serviceClient path -> explicit
// organisation_id filter on every query (rule 3). Money is integer pence.
import * as supabase_1 from "../lib/supabase.js";

const SAFE_COLS =
  'id, organisation_id, business_id, business_name, practice_id, period_month, external_id, ' +
  'notes, revenue_pence, gross_profit_pence, net_profit_pence, total_cost_of_sales_pence, ' +
  'total_operating_expenses_pence, cash_collected_pence, tx_accepted_amount_pence, ' +
  'bank_balance_pence, average_wait_time, principal_fees_pence, hygienist_therapist_pence, ' +
  'lab_fees_pence, materials_pence, sedation_services_pence, advertising_marketing_pence, ' +
  'bank_charges_pence, business_rates_rent_pence, salaries_staff_cost_pence, telephone_wifi_pence, ' +
  'utilities_pence, insurance_pence, management_fees_pence, subscriptions_pence, it_expenses_pence, ' +
  'card_machine_charges_pence, custom_lines, line_notes, synced_at, updated_at';

export const emergentMonthlyPlRepository = {
    async upsert(row) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_monthly_pl')
            .upsert({ ...row, updated_at: new Date().toISOString() },
                { onConflict: 'organisation_id,business_id,period_month' })
            .select(SAFE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },
    async listByOrg(orgId, { sinceMonth = null, untilMonth = null, limit = 500 } = {}) {
        let q = supabase_1.serviceClient
            .from('emergent_monthly_pl')
            .select(SAFE_COLS)
            .eq('organisation_id', orgId)
            .order('period_month', { ascending: false })
            .limit(limit);
        if (sinceMonth) q = q.gte('period_month', sinceMonth);
        if (untilMonth) q = q.lte('period_month', untilMonth);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
    },
};
