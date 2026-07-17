// practice_cost_model data access — the manual per-practice fixed-cost /
// breakeven / working-days / revenue-target inputs behind the cockpit's §6
// Profit vs Breakeven and §1 Daily target.
//
// Queries in, rows out. No business logic — the maths lives in
// lib/formulas.js (calculateBreakeven).
//
// MULTI-TENANT: serviceClient BYPASSES RLS, so every query chains an explicit
// .eq('organisation_id', orgId). There is no automatic isolation here.
import * as supabase_1 from "../lib/supabase.js";

const COLS = 'id, practice_id, effective_from, fixed_cost_pence_month, breakeven_low_pence, ' +
    'breakeven_high_pence, working_days_per_month, revenue_target_pence_month';

export const practiceCostModelRepository = {
    // The as-of read: for each practice, the newest model in force at asOfDate.
    // Ordered newest-first and collapsed in JS — a window function would need an
    // RPC, and the row count here is one per practice per edit, not per day.
    async asOf(orgId, asOfDate) {
        let q = supabase_1.serviceClient
            .from('practice_cost_model')
            .select(COLS)
            .eq('organisation_id', orgId)
            .order('effective_from', { ascending: false });
        if (asOfDate) q = q.lte('effective_from', asOfDate);
        const { data, error } = await q;
        if (error) throw new Error(`practice_cost_model asOf: ${error.message}`);

        const latest = new Map();
        for (const row of data ?? []) {
            if (!latest.has(row.practice_id)) latest.set(row.practice_id, row);
        }
        return Array.from(latest.values());
    },

    // Upsert at (practice_id, effective_from) — the table's unique key. Editing
    // twice on the same day updates that day's row rather than stacking two.
    async upsert(orgId, practiceId, effectiveFrom, fields) {
        const { data, error } = await supabase_1.serviceClient
            .from('practice_cost_model')
            .upsert({
                organisation_id: orgId,
                practice_id: practiceId,
                effective_from: effectiveFrom,
                ...fields,
            }, { onConflict: 'practice_id,effective_from' })
            .select(COLS)
            .single();
        if (error) throw new Error(`practice_cost_model upsert: ${error.message}`);
        return data;
    },
};
