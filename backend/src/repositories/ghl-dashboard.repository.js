// ============================================================================
// GHL dashboard repository — thin wrapper over the ghl_dashboard_aggregate RPC.
// Returns one raw per-practice row per bucket (snake_case from SQL). Org scope
// is enforced inside the RPC via p_org. The service sums + decorates these.
// ============================================================================
import * as supabase_1 from "../lib/supabase.js";

export const ghlDashboardRepository = {
  _client() { return supabase_1.serviceClient; },

  async aggregate(orgId, since, until, practiceId = null) {
    const { data, error } = await this._client().rpc('ghl_dashboard_aggregate', {
      p_org: orgId,
      p_since: since,
      p_until: until,
      p_practice: practiceId ?? null,
    });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};
