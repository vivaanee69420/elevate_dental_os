"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyticsRepository = void 0;
// ============================================================================
// Analytics repository — Supabase reads for the analytics domain.
// ============================================================================
const supabase_1 = require("../lib/supabase");
exports.analyticsRepository = {
    async baselineMaybe(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline')
            .eq('organisation_id', orgId)
            .maybeSingle();
        return data;
    },
    async baselineSingle(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('business_health')
            .select('baseline')
            .eq('organisation_id', orgId)
            .single();
        return data;
    },
};
