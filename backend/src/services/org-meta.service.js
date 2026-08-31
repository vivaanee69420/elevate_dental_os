// ============================================================================
// Small cached lookup of organisations hierarchy fields, used on the auth hot
// path for agency-switch validation. Mirrors features.service.js's cache
// shape (60s TTL). Errors return null and are NOT cached, so a transient DB
// blip only costs a retry, never a stuck wrong answer.
// ============================================================================
import { serviceClient } from '../lib/supabase.js';

const TTL_MS = 60_000;
const cache = new Map(); // orgId -> { at, meta }
// Sentinel key for the singleton agency-org lookup (never a real org id).
const AGENCY_KEY = '__agency_org__';

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

    // The single agency org — the one org that may parent sub-accounts. Agency
    // admins are granted per user and may sit in a DIFFERENT org, so the org
    // they administer cannot be inferred from their own organisation_id.
    // Cached on the same 60s TTL; null when no org is flagged.
    async getAgencyOrgId() {
        const hit = cache.get(AGENCY_KEY);
        if (hit && Date.now() - hit.at < TTL_MS) return hit.meta;
        const { data, error } = await serviceClient
            .from('organisations')
            .select('id')
            .eq('is_agency', true)
            .limit(1)
            .maybeSingle();
        if (error) return null; // not cached — a blip costs a retry, not a wrong answer
        const id = data?.id ?? null;
        cache.set(AGENCY_KEY, { at: Date.now(), meta: id });
        return id;
    },

    invalidate(orgId) {
        if (orgId) cache.delete(orgId);
        else cache.clear();
    },
};
