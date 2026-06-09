// ============================================================================
// AI usage + config data access. serviceClient + explicit org filter (project
// convention — repos enforce tenant isolation manually).
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const aiUsageRepository = {
  async config(orgId) {
    const { data } = await supabase_1.serviceClient
      .from('ai_config').select('*').eq('organisation_id', orgId).maybeSingle();
    return data || null;
  },
  async monthTokens(orgId, firstOfMonth) {
    const { data } = await supabase_1.serviceClient
      .from('ai_usage').select('input_tokens, output_tokens')
      .eq('organisation_id', orgId).gte('day', firstOfMonth);
    return (data || []).reduce((n, r) => n + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
  },
  async record(row) {
    await supabase_1.serviceClient.from('ai_usage').insert(row);
  },
};
