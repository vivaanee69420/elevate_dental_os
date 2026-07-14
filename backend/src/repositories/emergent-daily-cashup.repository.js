// Emergent daily cash-up repository. serviceClient path -> explicit
// organisation_id filter on every query (rule 3). Money is integer pence.
import * as supabase_1 from "../lib/supabase.js";

const SAFE_COLS =
  'id, organisation_id, business_id, business_name, practice_id, cashup_date, external_id, ' +
  'treatments_accepted, tx_plans_given, tx_plan_given_value_pence, cash_up_money_taken_pence, ' +
  'num_bookings, num_new_leads, num_follow_ups, num_attended, total_chairs, chairs_used, ' +
  'chair_utilisation, reviews_collected, before_after_pictures, video_testimonials, ' +
  'practice_plan_signups, total_refunds_pence, source_google, source_facebook, source_walk_in, ' +
  'source_friends_family, source_wl_website, source_dentist_referral, source_instagram, ' +
  'source_youtube, source_other, custom_sources, refunds, appointment_booked_for, ' +
  'crm_system_notes, detail_patient_rows_count, detail_patient_money_total_pence, ' +
  'variance_manager_vs_detail, synced_at, updated_at';

export const emergentDailyCashupRepository = {
    async upsert(row) {
        const { data, error } = await supabase_1.serviceClient
            .from('emergent_daily_cashup')
            .upsert({ ...row, updated_at: new Date().toISOString() },
                { onConflict: 'organisation_id,business_id,cashup_date' })
            .select(SAFE_COLS)
            .single();
        if (error) throw new Error(error.message);
        return data;
    },
    async listByOrg(orgId, { since = null, until = null, limit = 500 } = {}) {
        let q = supabase_1.serviceClient
            .from('emergent_daily_cashup')
            .select(SAFE_COLS)
            .eq('organisation_id', orgId)
            .order('cashup_date', { ascending: false })
            .limit(limit);
        if (since) q = q.gte('cashup_date', since);
        if (until) q = q.lte('cashup_date', until);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data ?? [];
    },
};
