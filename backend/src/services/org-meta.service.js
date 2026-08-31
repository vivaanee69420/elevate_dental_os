// ============================================================================
// Small cached lookup of organisations hierarchy fields, used on the auth hot
// path for agency-switch validation. Mirrors features.service.js's cache
// shape (60s TTL). Errors return null and are NOT cached, so a transient DB
// blip only costs a retry, never a stuck wrong answer.
// ============================================================================
import { serviceClient } from '../lib/supabase.js';

const TTL_MS = 60_000;
const cache = new Map(); // orgId -> { at, meta }

export const orgMetaService = {
    async getOrgMeta(orgId) {
        if (!orgId) return null;
        const hit = cache.get(orgId);
        if (hit && Date.now() - hit.at < TTL_MS) return hit.meta;
        const { data, error } = await serviceClient
            .from('organisations')
            .select('id, name, parent_organisation_id, is_agency')
            .eq('id', orgId)
            .maybeSingle();
        if (error || !data) return null;
        cache.set(orgId, { at: Date.now(), meta: data });
        return data;
    },

    invalidate(orgId) {
        if (orgId) cache.delete(orgId);
        else cache.clear();
    },
};
