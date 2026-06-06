// ============================================================================
// Platform-admin repository — serviceClient only, bypasses RLS by design.
// All cross-tenant aggregations live here. NEVER imported by tenant code.
// ============================================================================

import { serviceClient } from '../lib/supabase.js';

export const platformAdminRepository = {
  // ---- platform_admins ---------------------------------------------------
  async findByEmail(email) {
    const { data, error } = await serviceClient
      .from('platform_admins')
      .select('id, email, password_hash, full_name, role, must_change_password, last_login_at')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async findById(id) {
    const { data, error } = await serviceClient
      .from('platform_admins')
      .select('id, email, full_name, role, must_change_password, last_login_at, created_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // Recipients for platform-wide notifications (e.g. new signup awaiting approval).
  async listActiveAdmins() {
    const { data, error } = await serviceClient
      .from('platform_admins')
      .select('id, email');
    if (error) throw error;
    return data ?? [];
  },

  async count() {
    const { count, error } = await serviceClient
      .from('platform_admins')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  },

  async insert({ email, password_hash, full_name, role, must_change_password }) {
    const { data, error } = await serviceClient
      .from('platform_admins')
      .insert({ email, password_hash, full_name, role, must_change_password })
      .select('id, email, role')
      .single();
    if (error) throw error;
    return data;
  },

  async updateLastLogin(id) {
    const { error } = await serviceClient
      .from('platform_admins')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async setPassword(id, password_hash) {
    const { error } = await serviceClient
      .from('platform_admins')
      .update({ password_hash, must_change_password: false })
      .eq('id', id);
    if (error) throw error;
  },

  // ---- platform_audit_log ------------------------------------------------
  async insertAudit(row) {
    const { error } = await serviceClient
      .from('platform_audit_log')
      .insert(row);
    if (error) throw error;
  },

  async listAudit({ limit, offset }) {
    const { data, error } = await serviceClient
      .from('platform_audit_log')
      .select('id, platform_admin_id, action, target_organisation_id, target_user_id, ip_address, user_agent, payload, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return data ?? [];
  },

  // ---- cross-tenant aggregations ----------------------------------------
  async listOrgs({ q, limit, offset }) {
    let query = serviceClient
      .from('organisations')
      .select('id, name, slug, plan, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (q) query = query.ilike('name', `%${q}%`);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: data ?? [], total: count ?? 0 };
  },

  async getOrg(id) {
    const { data, error } = await serviceClient
      .from('organisations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listOrgUsers(orgId) {
    const { data, error } = await serviceClient
      .from('users')
      .select('id, email, full_name, role, status, last_seen_at, created_at')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  // ---- self-signup approval queue ---------------------------------------
  // Owners who self-signed-up and are awaiting platform approval. Embeds the
  // org name/slug (users.organisation_id -> organisations FK).
  async listPendingSignups() {
    const { data, error } = await serviceClient
      .from('users')
      .select('id, email, full_name, organisation_id, status, created_at, organisations(name, slug)')
      .eq('role', 'owner')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      email: r.email,
      full_name: r.full_name,
      organisation_id: r.organisation_id,
      organisation_name: r.organisations?.name ?? null,
      organisation_slug: r.organisations?.slug ?? null,
      status: r.status,
      created_at: r.created_at,
    }));
  },

  // Single user by id (global — approval/reject acts on the owner directly).
  async getUserById(userId) {
    const { data, error } = await serviceClient
      .from('users')
      .select('id, email, role, status, organisation_id')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // Set a user's status by id (approve -> 'active', reject -> 'rejected').
  async setUserStatusById(userId, status) {
    const { error } = await serviceClient
      .from('users')
      .update({ status })
      .eq('id', userId);
    if (error) throw error;
  },

  async countUsersByOrg(orgId) {
    const { count, error } = await serviceClient
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId);
    if (error) throw error;
    return count ?? 0;
  },

  async searchUsers({ q, limit }) {
    const { data, error } = await serviceClient
      .from('users')
      .select('id, email, full_name, role, organisation_id, status, created_at')
      .ilike('email', `%${q}%`)
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  async listOrgActivity(orgId, limit = 100) {
    const { data, error } = await serviceClient
      .from('audit_log')
      .select('id, user_id, action, entity_type, entity_id, ip_address, created_at')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  async listAuditCrossOrg({ organisation_id, user_id, action, limit, offset }) {
    let query = serviceClient
      .from('audit_log')
      .select('id, organisation_id, user_id, action, entity_type, entity_id, ip_address, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (organisation_id) query = query.eq('organisation_id', organisation_id);
    if (user_id)         query = query.eq('user_id', user_id);
    if (action)          query = query.eq('action', action);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: data ?? [], total: count ?? 0 };
  },

  // ---- metrics ----------------------------------------------------------
  async metricsOverview(days) {
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();

    const [{ count: totalOrgs }, { count: totalUsers }, { count: newOrgs }, { count: newUsers }] =
      await Promise.all([
        serviceClient.from('organisations').select('id', { count: 'exact', head: true }),
        serviceClient.from('users').select('id', { count: 'exact', head: true }),
        serviceClient.from('organisations').select('id', { count: 'exact', head: true }).gte('created_at', since),
        serviceClient.from('users').select('id', { count: 'exact', head: true }).gte('created_at', since),
      ]);

    return {
      total_orgs: totalOrgs ?? 0,
      total_users: totalUsers ?? 0,
      new_orgs_window: newOrgs ?? 0,
      new_users_window: newUsers ?? 0,
      window_days: days,
    };
  },

  async integrationsHealth() {
    const { data, error } = await serviceClient
      .from('integrations')
      .select('provider, status, organisation_id');
    if (error) {
      // Integrations table may not exist on every deploy yet. Return an empty
      // structure instead of failing the whole metrics endpoint.
      if (error.code === '42P01' || /relation .* does not exist/i.test(error.message)) {
        return [];
      }
      throw error;
    }
    const by = new Map();
    for (const row of data ?? []) {
      const key = row.provider;
      const bucket = by.get(key) ?? { provider: key, connected: 0, error: 0, total: 0 };
      bucket.total += 1;
      if (row.status === 'connected' || row.status === 'active') bucket.connected += 1;
      if (row.status === 'error' || row.status === 'failed')     bucket.error += 1;
      by.set(key, bucket);
    }
    return Array.from(by.values());
  },
};
