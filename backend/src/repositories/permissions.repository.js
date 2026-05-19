// ============================================================================
// Permissions repository — data access only (queries in, rows out).
// Uses serviceClient; every query is explicitly scoped by organisation_id
// (the service-client path has no automatic RLS isolation — see CLAUDE.md).
// ============================================================================

import { serviceClient } from '../lib/supabase.js';

export const permissionsRepository = {
  /** All role_permissions rows for an org (the full matrix). */
  async listByOrg(orgId) {
    const { data, error } = await serviceClient
      .from('role_permissions')
      .select('role, permission_key, allowed')
      .eq('organisation_id', orgId);
    if (error) throw error;
    return data || [];
  },

  /** role_permissions rows for one (org, role) — the per-request lookup. */
  async listByOrgRole(orgId, role) {
    const { data, error } = await serviceClient
      .from('role_permissions')
      .select('permission_key, allowed')
      .eq('organisation_id', orgId)
      .eq('role', role);
    if (error) throw error;
    return data || [];
  },

  /** Upsert one (org, role, key) -> allowed. */
  async setRolePermission(orgId, role, permissionKey, allowed) {
    const { error } = await serviceClient
      .from('role_permissions')
      .upsert(
        {
          organisation_id: orgId,
          role,
          permission_key: permissionKey,
          allowed,
        },
        { onConflict: 'organisation_id,role,permission_key' },
      );
    if (error) throw error;
  },

  /** Read a single user's row (org-scoped) for override edits. */
  async getUser(orgId, userId) {
    const { data, error } = await serviceClient
      .from('users')
      .select('id, organisation_id, role, permissions')
      .eq('organisation_id', orgId)
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  },

  /** Replace a user's permissions JSONB overrides (org-scoped write). */
  async setUserOverrides(orgId, userId, overrides) {
    const { error } = await serviceClient
      .from('users')
      .update({ permissions: overrides })
      .eq('organisation_id', orgId)
      .eq('id', userId);
    if (error) throw error;
  },
};
